import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAINS, ENERGY_MAX, GEN_WORK_TIER, ENERGY_REGEN_SEC, HOLD_MS, apply, addPlayer, cellAt, createWorld, emptyWorld, expireHolds,
  START_BLOCK, fromJson, parseAction, scrapCoins, isOpenCell, kindOf, mulberry32, openBlock, syncEnergy, toJson, xpToNext,
} from '../src/index.ts';
import type { Item, Player, World } from '../src/index.ts';

const T0 = 1_000_000;

/** 中央 2×2 区画だけ開いた、何も置いていないワールド */
function bare(): World {
  const w = emptyWorld();
  for (let bx = 8; bx < 12; bx++) for (let by = 8; by < 12; by++) w.blocks[by * 20 + bx] = 1;
  return w;
}

function put(w: World, kind: number, x: number, y: number, extra: Partial<Item> = {}): Item {
  const it: Item = { id: w.nextId++, kind, cell: cellAt(x, y), ...extra };
  w.items.set(it.id, it);
  w.cells[it.cell] = it.id;
  return it;
}

function setup() {
  const w = bare();
  addPlayer(w, 'a', 'Aさん', T0);
  addPlayer(w, 'b', 'Bさん', T0);
  return w;
}

const rng = mulberry32(1);
const bread = (t: number) => kindOf('bread', t);

test('参加すると最初の発生器（パン窯）がもらえる', () => {
  const w = setup();
  const gens = [...w.items.values()].filter((i) => i.owner === 'a');
  assert.equal(gens.length, 1);
  // 最初のパン窯だけは、部品ではなく動く段階で
  assert.equal(gens[0]!.kind, kindOf('oven', GEN_WORK_TIER));
  assert.ok(isOpenCell(w, gens[0]!.cell));
});

test('同じアイテムを重ねると1段上がり、経験値が入る', () => {
  const w = setup();
  const x = put(w, bread(1), 40, 40);
  const y = put(w, bread(1), 41, 40);
  assert.ok(apply(w, 'a', { t: 'grab', item: x.id }, T0, rng).ok);
  const r = apply(w, 'a', { t: 'drop', item: x.id, cell: y.cell }, T0, rng);
  assert.ok(r.ok);
  assert.equal(w.items.has(x.id), false);
  assert.equal(w.items.get(y.id)!.kind, bread(2));
  assert.equal(w.items.get(y.id)!.maker, 'a');
  assert.equal(w.players.get('a')!.xp, 2);
  assert.equal(w.holds.size, 0);
});

test('違うアイテムの上に落とすと入れ替わる', () => {
  const w = setup();
  const x = put(w, bread(1), 40, 40);
  const y = put(w, bread(2), 41, 40);
  apply(w, 'a', { t: 'grab', item: x.id }, T0, rng);
  assert.ok(apply(w, 'a', { t: 'drop', item: x.id, cell: y.cell }, T0, rng).ok);
  assert.equal(x.cell, cellAt(41, 40));
  assert.equal(y.cell, cellAt(40, 40));
  assert.equal(w.cells[cellAt(41, 40)], x.id);
});

test('最大段階どうしはマージせず入れ替える', () => {
  const w = setup();
  const x = put(w, bread(8), 40, 40);
  const y = put(w, bread(8), 41, 40);
  apply(w, 'a', { t: 'grab', item: x.id }, T0, rng);
  apply(w, 'a', { t: 'drop', item: x.id, cell: y.cell }, T0, rng);
  assert.equal(w.items.size, 4); // 発生器2 + 2個
  assert.equal(x.cell, cellAt(41, 40));
});

test('ほかの人が持っているアイテムはつかめない・落とし先にもできない', () => {
  const w = setup();
  const x = put(w, bread(1), 40, 40);
  const y = put(w, bread(1), 42, 40);
  assert.ok(apply(w, 'a', { t: 'grab', item: x.id }, T0, rng).ok);
  const r = apply(w, 'b', { t: 'grab', item: x.id }, T0, rng);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'held');

  assert.ok(apply(w, 'b', { t: 'grab', item: y.id }, T0, rng).ok);
  const r2 = apply(w, 'b', { t: 'drop', item: y.id, cell: x.cell }, T0, rng);
  assert.equal(!r2.ok && r2.reason, 'held');
  assert.equal(w.items.get(x.id)!.kind, bread(1));
});

test('予約は時間で切れ、ほかの人がつかめるようになる', () => {
  const w = setup();
  const x = put(w, bread(1), 40, 40);
  apply(w, 'a', { t: 'grab', item: x.id }, T0, rng);
  const ops = expireHolds(w, T0 + HOLD_MS);
  assert.deepEqual(ops, [{ t: 'unhold', id: x.id }]);
  assert.ok(apply(w, 'b', { t: 'grab', item: x.id }, T0 + HOLD_MS, rng).ok);
});

test('閉じた区画には置けない', () => {
  const w = setup();
  const x = put(w, bread(1), 40, 40);
  apply(w, 'a', { t: 'grab', item: x.id }, T0, rng);
  const r = apply(w, 'a', { t: 'drop', item: x.id, cell: cellAt(39, 40) }, T0, rng);
  assert.equal(!r.ok && r.reason, 'locked');
  assert.equal(w.holds.size, 0);
});

test('ほかの人の発生器は触れない・タップできない', () => {
  const w = setup();
  const genA = [...w.items.values()].find((i) => i.owner === 'a')!;
  const g = apply(w, 'b', { t: 'grab', item: genA.id }, T0, rng);
  assert.equal(!g.ok && g.reason, 'not-yours');
  const t = apply(w, 'b', { t: 'tap', gen: genA.id }, T0, rng);
  assert.equal(!t.ok && t.reason, 'not-yours');
});

test('発生器をタップすると近くにアイテムが出て、エネルギーとチャージが減る', () => {
  const w = setup();
  const gen = [...w.items.values()].find((i) => i.owner === 'a')!;
  const before = w.items.size;
  const r = apply(w, 'a', { t: 'tap', gen: gen.id }, T0, rng);
  assert.ok(r.ok);
  assert.equal(w.items.size, before + 1);
  const spawned = r.ok && r.ops.find((o) => o.t === 'spawn');
  assert.ok(spawned && spawned.t === 'spawn');
  const dx = Math.abs((spawned.item.cell % 100) - (gen.cell % 100));
  const dy = Math.abs(Math.floor(spawned.item.cell / 100) - Math.floor(gen.cell / 100));
  assert.ok(Math.max(dx, dy) === 1);
  // パン窯からは、パンとピザの段階1だけ（パン窯の段階1は段階アップなし）
  assert.ok([bread(1), kindOf('pizza', 1)].includes(spawned.item.kind));
  assert.equal(w.players.get('a')!.energy, ENERGY_MAX - 1);
  assert.equal(gen.charges, 11);
});

test('エネルギーがないとタップできず、時間で回復する', () => {
  const w = setup();
  const p = w.players.get('a')!;
  const gen = [...w.items.values()].find((i) => i.owner === 'a')!;
  p.energy = 0;
  p.energyAt = T0;
  const r = apply(w, 'a', { t: 'tap', gen: gen.id }, T0, rng);
  assert.equal(!r.ok && r.reason, 'energy');
  syncEnergy(p, T0 + ENERGY_REGEN_SEC * 1000 * 3 + 500);
  assert.equal(p.energy, 3);
});

test('まわりが埋まっているとエネルギーを減らさずに断る', () => {
  const w = setup();
  const gen = [...w.items.values()].find((i) => i.owner === 'a')!;
  // 開いている所が全部埋まっているとき（空いていれば遠くても出す）
  for (let c = 0; c < w.cells.length; c++) if (!w.cells[c] && isOpenCell(w, c)) put(w, bread(5), c % 100, Math.floor(c / 100));
  const r = apply(w, 'a', { t: 'tap', gen: gen.id }, T0, rng);
  assert.equal(!r.ok && r.reason, 'no-space');
  assert.equal(w.players.get('a')!.energy, ENERGY_MAX);
});

test('レベルが上がると新しい発生器がもらえ、出るものが増える', () => {
  const w = setup();
  const p = w.players.get('a')!;
  let need = 0;
  for (let l = 1; l < 5; l++) need += xpToNext(l);
  p.xp = need - 2;
  const x = put(w, bread(1), 40, 40);
  const y = put(w, bread(1), 41, 40);
  apply(w, 'a', { t: 'grab', item: x.id }, T0, rng);
  const r = apply(w, 'a', { t: 'drop', item: x.id, cell: y.cell }, T0, rng);
  assert.ok(r.ok);
  assert.equal(p.level, 5);
  const lv = r.ok ? r.events.filter((e) => e.t === 'levelup') : [];
  assert.equal(lv.length, 4);
  assert.deepEqual(lv.flatMap((e) => (e.t === 'levelup' ? e.newChains : [])).sort(), ['drink', 'veg']);
  // Lv3 でウォーターサーバー、Lv5 で八百屋の木箱の部品がもらえる（2段目1個＋1段目2個＝合成すると1台）。受け取り枠に入る
  for (const key of ['waterserver', 'crate']) {
    const mine = (t: number) => p.inbox.filter((k) => k === kindOf(key, t)).length;
    assert.deepEqual([mine(1), mine(2), mine(GEN_WORK_TIER)], [2, 1, 0], key);
    assert.ok(![...w.items.values()].some((i) => i.kind === kindOf(key, 1)), '盤面にはまだ出ない');
  }
});

test('自分の発生器どうしは重ねて段階を上げられる', () => {
  const w = setup();
  const gen = [...w.items.values()].find((i) => i.owner === 'a')!;
  const g2 = put(w, kindOf('oven', GEN_WORK_TIER), 40, 40, { owner: 'a', charges: 12, chargesAt: T0 });
  apply(w, 'a', { t: 'grab', item: g2.id }, T0, rng);
  const r = apply(w, 'a', { t: 'drop', item: g2.id, cell: gen.cell }, T0, rng);
  assert.ok(r.ok);
  assert.equal(gen.kind, kindOf('oven', GEN_WORK_TIER + 1));
});

test('発生器の 1〜2 段目は部品: タップしても出ない。合成して 3 段目になると満タンで動く', () => {
  const w = setup();
  const a = put(w, kindOf('crate', 2), 40, 40, { owner: 'a' });
  const t = apply(w, 'a', { t: 'tap', gen: a.id }, T0, rng);
  assert.equal(!t.ok && t.reason, 'parts');
  // ダンボールから出た部品（持ち主なし）とも合成できる
  const b = put(w, kindOf('crate', 2), 41, 40);
  apply(w, 'a', { t: 'grab', item: b.id }, T0, rng);
  assert.ok(apply(w, 'a', { t: 'drop', item: b.id, cell: a.cell }, T0, rng).ok);
  assert.equal(a.kind, kindOf('crate', GEN_WORK_TIER));
  assert.equal(a.owner, 'a');
  assert.ok((a.charges ?? 0) > 0);
  w.players.get('a')!.level = 5;
  assert.ok(apply(w, 'a', { t: 'tap', gen: a.id }, T0, rng).ok);
});

test('ほこり付きは動かせないが、同じアイテムを重ねるときれいになって1段上がる', () => {
  const w = setup();
  const d = put(w, bread(2), 40, 40, { dusty: true });
  const x = put(w, bread(2), 41, 40);
  const g = apply(w, 'a', { t: 'grab', item: d.id }, T0, rng);
  assert.equal(!g.ok && g.reason, 'dusty');
  apply(w, 'a', { t: 'grab', item: x.id }, T0, rng);
  assert.ok(apply(w, 'a', { t: 'drop', item: x.id, cell: d.cell }, T0, rng).ok);
  assert.equal(d.kind, bread(3));
  assert.equal(d.dusty, undefined);
});

test('Lv1 はゴミ箱（0コイン）、Lv2 からはコイン化（Lv8 で 400）。発生器とプレゼント箱は消せない', () => {
  const w = setup();
  const p = w.players.get('a')!;
  const one = put(w, bread(1), 40, 40);
  const three = put(w, bread(3), 41, 40, { maker: 'b' });
  const eight = put(w, bread(8), 42, 40);
  const r1 = apply(w, 'a', { t: 'sell', item: one.id }, T0, rng);
  assert.ok(r1.ok && r1.events.some((e) => e.t === 'sold' && e.coins === 0 && e.kind === bread(1)));
  assert.equal(p.coins, 0);
  assert.ok(apply(w, 'a', { t: 'sell', item: three.id }, T0, rng).ok, 'だれが作った物でもコインにできる');
  assert.equal(p.coins, scrapCoins(bread(3)));
  assert.ok(apply(w, 'a', { t: 'sell', item: eight.id }, T0, rng).ok);
  assert.equal(scrapCoins(bread(8)), 400);
  assert.equal(scrapCoins(bread(2)), 1);
  const gen = [...w.items.values()].find((i) => i.owner === 'a')!;
  assert.equal((apply(w, 'a', { t: 'sell', item: gen.id }, T0, rng) as { reason: string }).reason, 'cannot-sell');
});

test('ゴミ箱・コイン化は5秒の間だけ元に戻せる（コインも返す）。ふさがっていたら近くのマスへ', () => {
  const w = setup();
  const p = w.players.get('a')!;
  const x = put(w, bread(4), 40, 40);
  assert.ok(apply(w, 'a', { t: 'sell', item: x.id }, T0, rng).ok);
  assert.equal(p.coins, scrapCoins(bread(4)));
  put(w, bread(1), 40, 40); // 同じマスに別の物
  const r = apply(w, 'a', { t: 'undoSell' }, T0 + 4000, rng);
  assert.ok(r.ok);
  const back = r.ok ? r.events.find((e) => e.t === 'unsold') : undefined;
  assert.ok(back && back.t === 'unsold');
  const it = w.items.get(back.id)!;
  assert.equal(it.kind, bread(4));
  assert.notEqual(it.cell, cellAt(40, 40));
  assert.equal(p.coins, 0);
  assert.equal((apply(w, 'a', { t: 'undoSell' }, T0 + 4100, rng) as { reason: string }).reason, 'no-undo', '2回は戻せない');
  const y = put(w, bread(2), 45, 40);
  assert.ok(apply(w, 'a', { t: 'sell', item: y.id }, T0, rng).ok);
  assert.equal((apply(w, 'a', { t: 'undoSell' }, T0 + 6000, rng) as { reason: string }).reason, 'no-undo', '5秒すぎたら戻せない');
});

test('図鑑: 盤面に出たアイテムは「見た」に入る（ダンボールの中は入らない）。古いセーブは盤面と倉庫から', () => {
  const w = setup();
  const p = w.players.get('a')!;
  const gen = [...w.items.values()].find((i) => i.owner === 'a')!;
  assert.ok(p.seen.includes(gen.kind), '最初の発生器は見ている');
  const a1 = put(w, bread(5), 40, 40);
  const a2 = put(w, bread(5), 41, 40);
  assert.ok(!p.seen.includes(bread(6)));
  assert.ok(apply(w, 'a', { t: 'grab', item: a1.id }, T0, rng).ok);
  assert.ok(apply(w, 'a', { t: 'drop', item: a1.id, cell: a2.cell }, T0, rng).ok);
  assert.ok(p.seen.includes(bread(6)), '合成でできた物');
  put(w, bread(7), 42, 40, { boxed: true });
  p.storage[0] = bread(8);
  const j = toJson(w);
  for (const q of j.players) delete (q as Partial<Player>).seen;
  const old = fromJson(JSON.parse(JSON.stringify(j))).players.get('a')!;
  assert.ok(old.seen.includes(bread(6)) && old.seen.includes(bread(8)));
  assert.ok(!old.seen.includes(bread(7)), 'ふたの閉まったダンボールの中は見ていない');
  assert.deepEqual(parseAction({ t: 'undoSell' }), { t: 'undoSell' });
});

test('新しい盤面は左下の 5×5 だけ開き、となりのシャッターに依頼が付く', () => {
  const w = createWorld(mulberry32(42));
  assert.equal([...w.blocks].filter((b) => b).length, 1);
  assert.equal(w.blocks[START_BLOCK], 1);
  assert.ok(isOpenCell(w, cellAt(0, 99)) && isOpenCell(w, cellAt(4, 95)) && !isOpenCell(w, cellAt(5, 99)));
  // 左下の 2×2 だけ空き、その右どなり1つが半開き（中身はいちばん下のパン）、残りはふたの閉まったダンボール
  for (const c of [cellAt(0, 99), cellAt(1, 99), cellAt(0, 98), cellAt(1, 98)]) assert.equal(w.cells[c], 0);
  const half = [...w.items.values()].filter((i) => i.dusty);
  assert.equal(half.length, 1);
  assert.equal(half[0]!.cell, cellAt(2, 99));
  assert.equal(half[0]!.kind, kindOf('bread', 1));
  assert.equal([...w.items.values()].filter((i) => i.boxed).length, 25 - 4 - 1);
  // 右と上のシャッター
  assert.deepEqual(w.worldOrders.map((o) => o.block).sort((a, b) => a - b), [START_BLOCK - 20, START_BLOCK + 1].sort((a, b) => a - b));
  assert.ok(w.worldOrders.every((o) => o.needs.length === 1 && o.needs[0]!.count >= 1));
  assert.deepEqual(openBlock(w, START_BLOCK, mulberry32(1)), []); // すでに開いている区画は何もしない
});

test('保存して読み込むと同じ盤面になる', () => {
  const w = createWorld(mulberry32(7));
  addPlayer(w, 'a', 'Aさん', T0);
  const back = fromJson(JSON.parse(JSON.stringify(toJson(w))));
  assert.deepEqual(toJson(back), toJson(w));
  assert.deepEqual([...back.cells], [...w.cells]);
});

test('1つの系列は、1つの発生器からだけ出る', () => {
  const from = new Map<string, string>();
  for (const c of CHAINS) {
    for (const row of c.gen?.produces ?? []) {
      assert.ok(!from.has(row.chain) || from.get(row.chain) === c.key, `${row.chain} が ${from.get(row.chain)} と ${c.key} の両方から出る`);
      from.set(row.chain, c.key);
    }
  }
  // アイテムの系列は全部、どれかの発生器から出る
  // （プレゼント箱は発生器から出ない）
  for (const c of CHAINS) if (!c.gen && !c.gift) assert.ok(from.has(c.key), `${c.key} を出す発生器がない`);
});

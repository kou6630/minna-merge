import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENERGY_MAX, ENERGY_REGEN_SEC, HOLD_MS, apply, addPlayer, cellAt, createWorld, emptyWorld, expireHolds,
  fromJson, isOpenCell, kindOf, mulberry32, openBlock, syncEnergy, toJson, xpToNext,
} from '../src/index.ts';
import type { Item, World } from '../src/index.ts';

const T0 = 1_000_000;

/** 中央 2×2 区画だけ開いた、何も置いていないワールド */
function bare(): World {
  const w = emptyWorld();
  for (const bx of [4, 5]) for (const by of [4, 5]) w.blocks[by * 10 + bx] = 1;
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
  assert.equal(gens[0]!.kind, kindOf('oven', 1));
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
  assert.equal(spawned.item.kind, bread(1)); // Lv1 ではパン系の段階1だけ（パン窯の段階1は段階アップなし）
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
  const gx = gen.cell % 100;
  const gy = Math.floor(gen.cell / 100);
  for (let y = gy - 3; y <= gy + 3; y++)
    for (let x = gx - 3; x <= gx + 3; x++) if (!w.cells[cellAt(x, y)]) put(w, bread(5), x, y);
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
  assert.deepEqual(lv.flatMap((e) => (e.t === 'levelup' ? e.newChains : [])), ['sweets', 'veg']);
  const crates = [...w.items.values()].filter((i) => i.owner === 'a' && i.kind === kindOf('crate', 1));
  assert.equal(crates.length, 1);
});

test('自分の発生器どうしは重ねて段階を上げられる', () => {
  const w = setup();
  const gen = [...w.items.values()].find((i) => i.owner === 'a')!;
  const g2 = put(w, kindOf('oven', 1), 40, 40, { owner: 'a', charges: 12, chargesAt: T0 });
  apply(w, 'a', { t: 'grab', item: g2.id }, T0, rng);
  const r = apply(w, 'a', { t: 'drop', item: g2.id, cell: gen.cell }, T0, rng);
  assert.ok(r.ok);
  assert.equal(gen.kind, kindOf('oven', 2));
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

test('売れるのは自分が最後に作ったアイテムだけ', () => {
  const w = setup();
  const mine = put(w, bread(3), 40, 40, { maker: 'a' });
  const theirs = put(w, bread(3), 41, 40, { maker: 'b' });
  const r = apply(w, 'a', { t: 'sell', item: theirs.id }, T0, rng);
  assert.equal(!r.ok && r.reason, 'cannot-sell');
  assert.ok(apply(w, 'a', { t: 'sell', item: mine.id }, T0, rng).ok);
  assert.equal(w.players.get('a')!.coins, 4);
});

test('新しいワールドは中央 2×2 区画が開き、ほこり付きアイテムがある', () => {
  const w = createWorld(mulberry32(42));
  assert.equal([...w.blocks].filter((b) => b).length, 4);
  const dusty = [...w.items.values()].filter((i) => i.dusty);
  assert.ok(dusty.length > 30);
  assert.ok(dusty.every((i) => isOpenCell(w, i.cell)));
  assert.equal(w.cells[cellAt(50, 50)], 0);
  assert.deepEqual(openBlock(w, 44, mulberry32(1)), []); // すでに開いている区画は何もしない
});

test('保存して読み込むと同じ盤面になる', () => {
  const w = createWorld(mulberry32(7));
  addPlayer(w, 'a', 'Aさん', T0);
  const back = fromJson(JSON.parse(JSON.stringify(toJson(w))));
  assert.deepEqual(toJson(back), toJson(w));
  assert.deepEqual([...back.cells], [...w.cells]);
});

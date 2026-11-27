// 見つかった不具合の再発防止
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeOrder, blockInPlay, START_BLOCK, frontierBlocks, SECOND_ITEM_TIER, producedChains, secondItemChance,
  CHAPTERS, ENERGY_MAX, GEN_WORK_TIER, LEVEL_UP_ENERGY, addPlayer, apply, applyOps, canOrder, cellAt, cloneWorld, createWorld, emptyWorld,
  chainOfKind, fromJson, halfEnergy, isGeneratorKind, kindOf, maxCharges, maxTierOfKind, mulberry32, ownedGeneratorKeys, toJson, xpToNext,
} from '../src/index.ts';
import type { Item, World } from '../src/index.ts';

const T0 = 1_000_000;
const rng = mulberry32(5);

function setup(): World {
  const w = emptyWorld();
  for (let bx = 8; bx < 12; bx++) for (let by = 8; by < 12; by++) w.blocks[by * 20 + bx] = 1;
  addPlayer(w, 'a', 'Aさん', T0);
  return w;
}
function put(w: World, kind: number, x: number, y: number, extra: Partial<Item> = {}): Item {
  const it: Item = { id: w.nextId++, kind, cell: cellAt(x, y), ...extra };
  w.items.set(it.id, it);
  w.cells[it.cell] = it.id;
  return it;
}

test('章クリアでレベルが上がると、レベルアップのスタミナ +20 も消えずに入る', () => {
  const r0 = mulberry32(1);
  const w = createWorld(r0);
  addPlayer(w, 'p', 'P', T0, r0);
  const p = w.players.get('p')!;
  p.level = 5;
  p.xp = xpToNext(5) - 1; // 章クリアの経験値で必ず上がる
  p.energy = ENERGY_MAX - 60;
  p.energyAt = T0;
  p.coins = 100000;
  for (const t of CHAPTERS[0]!.tasks) assert.ok(apply(w, 'p', { t: 'storyTask', taskId: t.id, choice: t.choices ? 0 : undefined }, T0, r0).ok);
  assert.equal(p.level, 6);
  // 先にレベルアップの +20（満タンまで）、そのあと報酬のスタミナ
  assert.equal(p.energy, ENERGY_MAX - 60 + halfEnergy(CHAPTERS[0]!) + LEVEL_UP_ENERGY + CHAPTERS[0]!.reward.energy);
});

test('発生器どうしの合成: どちらをどちらに重ねても、チャージは同じ（多い方を引きつぎ、時間で回復した分も数える）', () => {
  const results: number[] = [];
  for (const dir of [0, 1]) {
    const w = setup();
    const kind = kindOf('oven', GEN_WORK_TIER);
    const a = put(w, kind, 40, 40, { owner: 'a', charges: 1, chargesAt: T0 - 10_000_000 }); // 時間がたって満タンまで回復している
    const b = put(w, kind, 41, 40, { owner: 'a', charges: 0, chargesAt: T0 });
    const [from, to] = dir ? [a, b] : [b, a];
    assert.ok(apply(w, 'a', { t: 'grab', item: from.id }, T0, rng).ok);
    assert.ok(apply(w, 'a', { t: 'drop', item: from.id, cell: to.cell }, T0, rng).ok);
    results.push(w.items.get(to.id)!.charges!);
  }
  assert.equal(results[0], results[1]);
  assert.equal(results[0], maxCharges({ id: 0, cell: 0, kind: kindOf('oven', GEN_WORK_TIER) }));
});

test('注文: みんなのシャッターが高いレベルの物を待っていても、自分で作れない物は頼まれない', () => {
  const w = setup();
  const p = w.players.get('a')!;
  const hard = kindOf('cookware', 6);
  assert.equal(canOrder(p, hard), false);
  w.worldOrders = [{ id: 1, block: 0, owner: 'bread', needs: [{ kind: hard, count: 40, have: 0 }], contributors: {} }];
  for (let i = 0; i < 20; i++) {
    p.orders = [];
    addPlayer(w, 'a', 'Aさん', T0, mulberry32(i));
    for (const o of p.orders) for (const n of o.needs) assert.ok(canOrder(p, n.kind), `Lv${p.level} に ${n.kind} が頼まれた`);
  }
});

test('盤面のコピーは倉庫・受け取り枠を共有しない（予測の盤面をいじっても、確定の盤面は変わらない）', () => {
  const w = setup();
  const p = w.players.get('a')!;
  p.storage[0] = kindOf('bread', 2);
  p.inbox.push(kindOf('gift', 1));
  const c = cloneWorld(w);
  c.players.get('a')!.storage[0] = null;
  c.players.get('a')!.inbox.length = 0;
  assert.equal(p.storage[0], kindOf('bread', 2));
  assert.equal(p.inbox.length, 1);
  const back = fromJson(toJson(w));
  back.players.get('a')!.orders.length = 0;
  assert.ok(p.orders.length > 0);
});

test('中身の更新（update）が届いても、持っている印（hold）は消えない', () => {
  const w = setup();
  const x = put(w, kindOf('bread', 1), 40, 40);
  w.holds.set(x.id, { player: 'a', until: T0 + 5000 });
  applyOps(w, [{ t: 'update', item: { ...x, kind: kindOf('bread', 2) } }], T0);
  assert.equal(w.holds.get(x.id)?.player, 'a');
});

test('発生器の部品は、同じ種類の動く発生器があるときだけ消せる。動く発生器は消せない', () => {
  const w = setup();
  const reason = (id: number) => (apply(w, 'a', { t: 'sell', item: id }, T0, rng) as { reason?: string }).reason;
  const one = put(w, kindOf('crate', 1), 42, 40, { owner: 'a' });
  const two = put(w, kindOf('crate', 2), 44, 40, { owner: 'a' });
  // 動くダンボール発生器がない: 消せない
  assert.equal(reason(one.id), 'cannot-sell');
  assert.equal(reason(two.id), 'cannot-sell');
  // 動くダンボール発生器がある: 部品は消せるが、動く発生器は消せない
  const gen = put(w, kindOf('crate', GEN_WORK_TIER), 46, 40, { owner: 'a' });
  assert.equal(reason(one.id), undefined);
  assert.equal(reason(two.id), undefined);
  assert.equal(reason(gen.id), 'cannot-sell');
});

test('最高段階のアイテムは半開きにならず、古いセーブの最高段階の半開きは取り出した状態で読む', () => {
  const w = setup();
  const it = put(w, kindOf('bread', maxTierOfKind(kindOf('bread', 1))), 50, 50, { dusty: true });
  const box = put(w, kindOf('bread', 1), 51, 50, { boxed: true });
  const w2 = fromJson(toJson(w));
  assert.equal(w2.items.get(it.id)!.dusty, undefined);
  // となりの箱も、取り出したときと同じに半開きになる（奥の箱がずっと開かない、をなくす）
  assert.equal(w2.items.get(box.id)!.dusty, true);
});

test('2種類出る発生器は、Lv5 に育てると2種類目も出て、注文にも出る', () => {
  const w = setup();
  const p = w.players.get('a')!;
  for (const it of [...w.items.values()]) if (it.owner === 'a' && isGeneratorKind(it.kind)) { w.items.delete(it.id); w.cells[it.cell] = 0; }
  const g = put(w, kindOf('oven', GEN_WORK_TIER), 40, 40, { owner: 'a' });
  assert.deepEqual(producedChains(w, p).sort(), ['bread']);
  w.items.delete(g.id); w.cells[g.cell] = 0;
  put(w, kindOf('oven', SECOND_ITEM_TIER), 40, 40, { owner: 'a' });
  assert.deepEqual(producedChains(w, p).sort(), ['bread', 'pizza']);
});

test('2種類目の出る確率は、発生器 Lv5 で 30%、最高レベルで 50%', () => {
  assert.equal(secondItemChance(4, 9), 0);
  assert.equal(secondItemChance(5, 9), 0.3);
  assert.ok(Math.abs(secondItemChance(7, 9) - 0.4) < 1e-9);
  assert.equal(secondItemChance(9, 9), 0.5);
});

test('注文は、自分の発生器から今出る物だけ（パン窯 Lv3 ならパンだけ、Lv5 ならピザも）', () => {
  const p = { level: 30, nextOrderId: 1 } as Parameters<typeof makeOrder>[0];
  const chainsOf = (produced: string[]) => {
    const out = new Set<string>();
    for (let i = 0; i < 200; i++) for (const n of makeOrder(p, mulberry32(i), [], undefined, 2, new Set(), produced).needs) out.add(chainOfKind(n.kind).key);
    return [...out].sort();
  };
  assert.deepEqual(chainsOf(['bread']), ['bread']);
  assert.deepEqual(chainsOf(['bread', 'pizza']), ['bread', 'pizza']);
});

test('読み込むと、まだ取り出していない箱のピザなどは、作れる物に入れ替わる（取り出した物はそのまま）', () => {
  const w = setup();
  const boxed = put(w, kindOf('pizza', 2), 52, 50, { boxed: true });
  const out = put(w, kindOf('pizza', 2), 50, 50, { owner: 'a' });
  const w2 = fromJson(toJson(w));
  const k = w2.items.get(boxed.id)!.kind;
  assert.notEqual(chainOfKind(k).key, 'pizza');
  assert.equal(k % 100, 2);
  assert.equal(w2.items.get(out.id)!.kind, kindOf('pizza', 2));
});

test('遊べる範囲は左下の 10×10 区画（シャッター99枚）。外にはシャッターの依頼が出ない', () => {
  let n = 0;
  for (let i = 0; i < 400; i++) if (blockInPlay(i)) n++;
  assert.equal(n, 100);
  assert.ok(blockInPlay(START_BLOCK));
  assert.ok(!blockInPlay(START_BLOCK + 10));
  assert.ok(!blockInPlay(START_BLOCK - 20 * 10));
  const all = new Uint8Array(400).fill(1);
  for (let i = 0; i < 400; i++) if (!blockInPlay(i)) all[i] = 0;
  assert.deepEqual(frontierBlocks(all, new Set()), []);
});

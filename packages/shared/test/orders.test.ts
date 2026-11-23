import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_SLOTS, STORAGE_MAX, STORAGE_START, addPlayer, apply, cellAt, chainOfKind, emptyWorld, fromJson, kindOf,
  makeOrder, mulberry32, storageCost, toJson, unlockedChains,
} from '../src/index.ts';
import type { Item, Player, World } from '../src/index.ts';

const T0 = 1_000_000;
const rng = mulberry32(11);

function setup() {
  const w = emptyWorld();
  for (const bx of [4, 5]) for (const by of [4, 5]) w.blocks[by * 10 + bx] = 1;
  addPlayer(w, 'a', 'A', T0, mulberry32(1));
  addPlayer(w, 'b', 'B', T0, mulberry32(2));
  return w;
}

function put(w: World, kind: number, x: number, y: number, extra: Partial<Item> = {}): Item {
  const it: Item = { id: w.nextId++, kind, cell: cellAt(x, y), ...extra };
  w.items.set(it.id, it);
  w.cells[it.cell] = it.id;
  return it;
}

/** a の最初の注文を、決まった中身に置きかえる */
function fixOrder(w: World, needs: { kind: number; count: number }[]) {
  const p = w.players.get('a')!;
  const o = p.orders[0]!;
  o.needs = needs.map((n) => ({ ...n, have: 0 }));
  o.coins = 10;
  o.xp = 6;
  return { p, o };
}

test('参加すると注文が3つ来て、倉庫は6枠', () => {
  const w = setup();
  const p = w.players.get('a')!;
  assert.equal(p.orders.length, ORDER_SLOTS);
  assert.equal(p.storage.length, STORAGE_START);
  assert.ok(p.storage.every((s) => s === null));
});

test('注文は今のレベルで出せる系列から出る', () => {
  for (const level of [1, 3, 5, 10, 20]) {
    const p = { level, nextOrderId: 1 } as Player;
    const ok = new Set(unlockedChains(level));
    const r = mulberry32(level);
    for (let i = 0; i < 50; i++) {
      const o = makeOrder(p, r);
      assert.ok(o.needs.length >= 1);
      for (const n of o.needs) assert.ok(ok.has(chainOfKind(n.kind).key), `Lv${level}: ${n.kind}`);
      assert.ok(o.coins > 0 && o.xp > 0);
    }
  }
});

test('納品すると数が進み、そろうと報酬が入って新しい注文が来る', () => {
  const w = setup();
  const { p, o } = fixOrder(w, [{ kind: kindOf('bread', 2), count: 2 }]);
  const x = put(w, kindOf('bread', 2), 40, 40, { maker: 'b' });
  const y = put(w, kindOf('bread', 2), 41, 40);
  assert.ok(apply(w, 'a', { t: 'deliver', order: o.id, item: x.id }, T0, rng).ok);
  assert.equal(o.needs[0]!.have, 1);
  assert.equal(w.items.has(x.id), false);
  assert.equal(p.coins, 0);
  const r = apply(w, 'a', { t: 'deliver', order: o.id, item: y.id }, T0, rng);
  assert.ok(r.ok);
  assert.equal(p.coins, 10);
  assert.equal(p.xp, 6);
  assert.equal(p.orders.length, ORDER_SLOTS);
  assert.ok(!p.orders.includes(o));
  assert.ok(r.ok && r.events.some((e) => e.t === 'order' && e.coins === 10));
});

test('ちがうアイテム・ほこり付き・ほかの人が持っているアイテムは納品できない', () => {
  const w = setup();
  const { o } = fixOrder(w, [{ kind: kindOf('bread', 2), count: 1 }]);
  const wrong = put(w, kindOf('bread', 3), 40, 40);
  const dusty = put(w, kindOf('bread', 2), 41, 40, { dusty: true });
  const held = put(w, kindOf('bread', 2), 42, 40);
  apply(w, 'b', { t: 'grab', item: held.id }, T0, rng);
  const r1 = apply(w, 'a', { t: 'deliver', order: o.id, item: wrong.id }, T0, rng);
  const r2 = apply(w, 'a', { t: 'deliver', order: o.id, item: dusty.id }, T0, rng);
  const r3 = apply(w, 'a', { t: 'deliver', order: o.id, item: held.id }, T0, rng);
  const r4 = apply(w, 'a', { t: 'deliver', order: 9999, item: held.id }, T0, rng);
  assert.deepEqual([r1, r2, r3, r4].map((r) => !r.ok && r.reason), ['not-needed', 'dusty', 'held', 'no-order']);
  assert.equal(w.items.size, 3 + 2);
});

test('自分がつかんでいるアイテムはそのまま納品できる', () => {
  const w = setup();
  const { o } = fixOrder(w, [{ kind: kindOf('bread', 2), count: 1 }]);
  const x = put(w, kindOf('bread', 2), 40, 40);
  apply(w, 'a', { t: 'grab', item: x.id }, T0, rng);
  assert.ok(apply(w, 'a', { t: 'deliver', order: o.id, item: x.id }, T0, rng).ok);
  assert.equal(w.holds.size, 0);
});

test('倉庫に入れる・出す・倉庫から納品する', () => {
  const w = setup();
  const p = w.players.get('a')!;
  const x = put(w, kindOf('bread', 3), 40, 40, { maker: 'b' });
  assert.ok(apply(w, 'a', { t: 'store', item: x.id }, T0, rng).ok);
  assert.equal(w.items.has(x.id), false);
  assert.equal(p.storage[0], kindOf('bread', 3));

  // 埋まっているマスや閉じた区画には出せない
  const blocker = put(w, kindOf('bread', 1), 45, 45);
  assert.equal((apply(w, 'a', { t: 'unstore', slot: 0, cell: blocker.cell }, T0, rng) as { reason: string }).reason, 'occupied');
  assert.equal((apply(w, 'a', { t: 'unstore', slot: 0, cell: cellAt(0, 0) }, T0, rng) as { reason: string }).reason, 'locked');
  const r = apply(w, 'a', { t: 'unstore', slot: 0, cell: cellAt(46, 46) }, T0, rng);
  assert.ok(r.ok);
  const back = w.items.get(w.cells[cellAt(46, 46)]!)!;
  assert.equal(back.kind, kindOf('bread', 3));
  assert.equal(back.maker, 'a');
  assert.equal(p.storage[0], null);

  // 倉庫から納品
  const { o } = fixOrder(w, [{ kind: kindOf('bread', 3), count: 1 }]);
  apply(w, 'a', { t: 'store', item: back.id }, T0, rng);
  assert.ok(apply(w, 'a', { t: 'deliver', order: o.id, slot: 0 }, T0, rng).ok);
  assert.equal(p.storage[0], null);
  assert.equal(p.coins, 10);
});

test('倉庫がいっぱいなら入らない。コインで広げられる（上限あり）', () => {
  const w = setup();
  const p = w.players.get('a')!;
  for (let i = 0; i < STORAGE_START; i++) {
    const it = put(w, kindOf('bread', 1), 40 + i, 41);
    assert.ok(apply(w, 'a', { t: 'store', item: it.id }, T0, rng).ok);
  }
  const extra = put(w, kindOf('bread', 1), 40, 42);
  assert.equal((apply(w, 'a', { t: 'store', item: extra.id }, T0, rng) as { reason: string }).reason, 'storage-full');
  assert.equal((apply(w, 'a', { t: 'expand' }, T0, rng) as { reason: string }).reason, 'coins');
  p.coins = 10_000;
  while (p.storage.length < STORAGE_MAX) assert.ok(apply(w, 'a', { t: 'expand' }, T0, rng).ok);
  assert.equal((apply(w, 'a', { t: 'expand' }, T0, rng) as { reason: string }).reason, 'max-storage');
  let spent = 0;
  for (let n = STORAGE_START; n < STORAGE_MAX; n++) spent += storageCost(n);
  assert.equal(p.coins, 10_000 - spent);
  assert.ok(apply(w, 'a', { t: 'store', item: extra.id }, T0, rng).ok);
});

test('発生器は倉庫に入れられず、納品もできない', () => {
  const w = setup();
  const gen = [...w.items.values()].find((i) => i.owner === 'a')!;
  const o = w.players.get('a')!.orders[0]!;
  assert.equal((apply(w, 'a', { t: 'store', item: gen.id }, T0, rng) as { reason: string }).reason, 'not-needed');
  assert.equal((apply(w, 'a', { t: 'deliver', order: o.id, item: gen.id }, T0, rng) as { reason: string }).reason, 'not-needed');
});

test('古いセーブ（注文・倉庫なし）を読んでも、参加すると埋まる', () => {
  const w = setup();
  const j = toJson(w);
  for (const p of j.players) {
    const q = p as Partial<Player>;
    delete q.orders;
    delete q.storage;
    delete q.nextOrderId;
  }
  const back = fromJson(JSON.parse(JSON.stringify(j)));
  const p = back.players.get('a')!;
  assert.deepEqual(p.orders, []);
  assert.equal(p.storage.length, STORAGE_START);
  addPlayer(back, 'a', 'A', T0, rng);
  assert.equal(p.orders.length, ORDER_SLOTS);
});

test('3つの注文は、お客さんが重ならない', () => {
  for (let seed = 1; seed < 30; seed++) {
    const w = emptyWorld();
    w.blocks[44] = 1;
    addPlayer(w, 'x', 'X', T0, mulberry32(seed));
    const p = w.players.get('x')!;
    assert.equal(new Set(p.orders.map((o) => o.customer)).size, ORDER_SLOTS);
    assert.equal(new Set(p.orders.map((o) => o.id)).size, ORDER_SLOTS);
  }
});

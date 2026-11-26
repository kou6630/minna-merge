import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  START_BLOCK, addPlayer, apply, cellAt, commonCount, commonsFromJson, commonsToJson, createCommons, createWorld, ensureCommonOrders, kindOf, mulberry32,
  activeShutter, putItem, syncWorldToCommons, waitingShutters,
} from '../src/index.ts';

const T0 = 1_000_000;

test('みんなのシャッター: 最初は2段目のパンを40個。開けるほど量が増え、段階が上がると数は減る', () => {
  const c = createCommons();
  ensureCommonOrders(c, 1, mulberry32(3));
  assert.equal(c.orders.length, 2);
  for (const o of c.orders) assert.deepEqual(o.needs, [{ kind: kindOf('bread', 2), count: 40, have: 0 }]);
  assert.equal(commonCount(2, 1), 40);
  assert.equal(commonCount(3, 1), 20);
  assert.ok(commonCount(2, 11) > commonCount(2, 1));
  assert.ok(commonCount(7, 1) >= 3);
});

test('盤面をみんなのシャッターに合わせると、開けた区画が開き、依頼がそっくり同じになる', () => {
  const rng = mulberry32(5);
  const c = createCommons([START_BLOCK + 1]);
  ensureCommonOrders(c, 1, rng);
  const w = createWorld(rng);
  const ops = syncWorldToCommons(w, c, rng);
  assert.equal(w.shared, true);
  assert.equal(w.blocks[START_BLOCK + 1], 1);
  assert.ok(ops.some((o) => o.t === 'block' && o.idx === START_BLOCK + 1));
  assert.deepEqual(w.worldOrders, c.orders);
  // もう一度合わせても、差分はない
  assert.equal(syncWorldToCommons(w, c, rng).length, 0);
  const back = commonsFromJson(JSON.parse(JSON.stringify(commonsToJson(c))));
  assert.deepEqual([...back.blocks], [...c.blocks]);
  assert.deepEqual(back.orders, c.orders);
});

test('みんなのシャッターの盤面では、数がそろってもその盤面だけでは開かず、納品の知らせが出る', () => {
  const rng = mulberry32(7);
  const c = createCommons();
  ensureCommonOrders(c, 1, rng);
  const w = createWorld(rng);
  syncWorldToCommons(w, c, rng);
  addPlayer(w, 'a', 'Aさん', T0, rng);
  const p = w.players.get('a')!;
  const o = w.worldOrders[0]!;
  const kind = o.needs[0]!.kind;
  o.needs[0]!.have = o.needs[0]!.count - 1;
  w.worldOrders = [o];
  p.orders[0]!.needs = [{ kind, count: 1, have: 0 }];
  const cell = cellAt(3, 99);
  const old = w.cells[cell]!;
  if (old) {
    w.items.delete(old);
    w.cells[cell] = 0;
  }
  putItem(w, { id: w.nextId++, kind, cell });
  const r = apply(w, 'a', { t: 'deliver', order: p.orders[0]!.id, item: w.cells[cell]! }, T0, rng);
  assert.ok(r.ok);
  const give = r.events.find((e) => e.t === 'shutterGive');
  assert.ok(give && give.t === 'shutterGive');
  assert.equal(give.name, 'Aさん');
  assert.equal(give.have, give.count);
  assert.equal(w.blocks[o.block], 0, 'まだ開かない（開けるのはサーバー）');
  assert.ok(!r.events.some((e) => e.t === 'unlock'));
});

test('同じアイテムのシャッターは1枚ずつ進み、もう1枚は順番待ち。ちがうアイテムのシャッターはそれぞれ進む', () => {
  const o = (id: number, block: number, kind: number, have: number) => ({ id, block, owner: 'bread', needs: [{ kind, count: 40, have }], contributors: {} });
  const bread = kindOf('bread', 2);
  const veg = kindOf('veg', 2);
  // 並んだら、最初の区画に近い方から
  const near = START_BLOCK + 1;
  const far = START_BLOCK - 40;
  const orders = [o(1, far, bread, 0), o(2, near, bread, 0), o(3, far + 1, veg, 0)];
  assert.equal(activeShutter(orders, bread)?.id, 2);
  assert.deepEqual([...waitingShutters(orders)], [1]);
  // 進んでいる方が先（遠くても）
  orders[0]!.needs[0]!.have = 5;
  assert.equal(activeShutter(orders, bread)?.id, 1);
  assert.deepEqual([...waitingShutters(orders)], [2]);
  assert.equal(activeShutter(orders, veg)?.id, 3);
  // そろった方は数えない
  orders[0]!.needs[0]!.have = 40;
  assert.equal(activeShutter(orders, bread)?.id, 2);
  assert.deepEqual([...waitingShutters(orders)], []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKS_X, WORLD_ORDER_BONUS, blockOf, WORLD_ORDER_SLOTS, addPlayer, apply, applyOps, cellAt, chainOfKind, cloneWorld,
  createWorld, diffWorlds, ensureWorldOrders, fromJson, mulberry32, toJson, unlockedChains, worldOrderAtCell,
} from '../src/index.ts';
import type { Item, World } from '../src/index.ts';

const T0 = 1_000_000;

function setup(seed = 1) {
  const w = createWorld(mulberry32(seed));
  addPlayer(w, 'a', 'A', T0, mulberry32(2));
  addPlayer(w, 'b', 'B', T0, mulberry32(3));
  return w;
}

function put(w: World, kind: number, x: number, y: number): Item {
  const it: Item = { id: w.nextId++, kind, cell: cellAt(x, y) };
  w.items.set(it.id, it);
  w.cells[it.cell] = it.id;
  return it;
}

/** 空いている開いたマス */
function freeCells(w: World, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 40; y < 60 && out.length < n; y++)
    for (let x = 40; x < 60 && out.length < n; x++) if (!w.cells[cellAt(x, y)]) out.push([x, y]);
  return out;
}

const adjacentToOpen = (w: World, b: number) => {
  const bx = b % BLOCKS_X;
  const by = Math.floor(b / BLOCKS_X);
  return [[bx - 1, by], [bx + 1, by], [bx, by - 1], [bx, by + 1]].some(([x, y]) => w.blocks[y! * BLOCKS_X + x!] === 1);
};

test('新しいワールドには、開いた区画のとなりに「みんなの依頼」が2つある', () => {
  for (let seed = 1; seed < 10; seed++) {
    const w = createWorld(mulberry32(seed));
    assert.equal(w.worldOrders.length, WORLD_ORDER_SLOTS);
    const blocks = w.worldOrders.map((o) => o.block);
    assert.equal(new Set(blocks).size, blocks.length);
    for (const o of w.worldOrders) {
      assert.equal(w.blocks[o.block], 0);
      assert.ok(adjacentToOpen(w, o.block));
      assert.ok(o.needs.length >= 1);
      for (const n of o.needs) assert.ok(unlockedChains(1).includes(chainOfKind(n.kind).key));
    }
  }
});

test('みんなで納品すると進み、そろうと区画が開いて全員にボーナス', () => {
  const w = setup();
  const order = w.worldOrders[0]!;
  order.needs = [{ kind: 1 * 100 + 2, count: 2, have: 0 }]; // お菓子の段階2（あめ玉）を2つ
  const [c1, c2] = freeCells(w, 2);
  const x = put(w, order.needs[0]!.kind, ...c1!);
  const y = put(w, order.needs[0]!.kind, ...c2!);
  const rng = mulberry32(9);
  const pa = w.players.get('a')!;
  const pb = w.players.get('b')!;

  const r1 = apply(w, 'a', { t: 'contribute', order: order.id, item: x.id }, T0, rng);
  assert.ok(r1.ok);
  assert.equal(pa.coins, 2);
  assert.equal(w.blocks[order.block], 0);
  assert.ok(r1.ok && r1.ops.some((o) => o.t === 'worldOrder' && o.order.needs[0]!.have === 1));

  const before = w.items.size;
  const r2 = apply(w, 'b', { t: 'contribute', order: order.id, item: y.id }, T0, rng);
  assert.ok(r2.ok);
  assert.equal(w.blocks[order.block], 1, '区画が開く');
  assert.ok(!w.worldOrders.some((o) => o.id === order.id));
  assert.equal(w.worldOrders.length, WORLD_ORDER_SLOTS, '新しい依頼が足される');
  assert.ok(w.worldOrders.every((o) => o.block !== order.block && w.blocks[o.block] === 0));
  assert.equal(pa.coins, 2 + WORLD_ORDER_BONUS);
  assert.equal(pb.coins, 2 + WORLD_ORDER_BONUS);
  assert.ok(r2.ok && r2.changedPlayers.includes('a') && r2.changedPlayers.includes('b'));
  assert.ok(r2.ok && r2.events.some((e) => e.t === 'unlock' && e.block === order.block && e.contributors.length === 2));
  const newDusty = [...w.items.values()].filter((i) => i.dusty && blockOf(i.cell) === order.block);
  assert.ok(newDusty.length > 0, '開いた区画にほこり付きアイテムが置かれる');
  assert.ok(w.items.size > before);
});

test('ちがうアイテム・閉じた区画へのドロップは断る', () => {
  const w = setup();
  const order = w.worldOrders[0]!;
  order.needs = [{ kind: 2, count: 1, have: 0 }];
  const [c1] = freeCells(w, 1);
  const wrong = put(w, 3, ...c1!);
  const r = apply(w, 'a', { t: 'contribute', order: order.id, item: wrong.id }, T0, mulberry32(1));
  assert.equal(!r.ok && r.reason, 'not-needed');
  apply(w, 'a', { t: 'grab', item: wrong.id }, T0, mulberry32(1));
  const bx = (order.block % BLOCKS_X) * 10;
  const by = Math.floor(order.block / BLOCKS_X) * 10;
  const d = apply(w, 'a', { t: 'drop', item: wrong.id, cell: cellAt(bx + 1, by + 1) }, T0, mulberry32(1));
  assert.equal(!d.ok && d.reason, 'locked');
  assert.equal(worldOrderAtCell(w, cellAt(bx + 1, by + 1))?.id, order.id);
});

test('倉庫からも納品できる', () => {
  const w = setup();
  const order = w.worldOrders[0]!;
  order.needs = [{ kind: 2, count: 3, have: 0 }];
  const p = w.players.get('a')!;
  p.storage[2] = 2;
  assert.ok(apply(w, 'a', { t: 'contribute', order: order.id, slot: 2 }, T0, mulberry32(1)).ok);
  assert.equal(p.storage[2], null);
  assert.equal(order.needs[0]!.have, 1);
});

test('依頼の変化は ops と差分で同期でき、保存しても残る', () => {
  const w = setup();
  const client = cloneWorld(w);
  const order = w.worldOrders[0]!;
  order.needs = [{ kind: 2, count: 1, have: 0 }];
  const [c1] = freeCells(w, 1);
  const x = put(w, 2, ...c1!);
  // 手元にも同じアイテムがある状態にそろえる
  applyOps(client, [{ t: 'spawn', item: { ...x } }, { t: 'worldOrder', order: { ...order } }], T0);
  const r = apply(w, 'a', { t: 'contribute', order: order.id, item: x.id }, T0, mulberry32(4));
  assert.ok(r.ok);
  applyOps(client, r.ok ? r.ops : [], T0);
  assert.deepEqual(client.worldOrders, w.worldOrders);
  assert.deepEqual([...client.blocks], [...w.blocks]);
  assert.deepEqual(diffWorlds(client, w).filter((o) => o.t.startsWith('world')), []);

  const back = fromJson(JSON.parse(JSON.stringify(toJson(w))));
  assert.deepEqual(back.worldOrders, w.worldOrders);
  assert.equal(back.nextWorldOrderId, w.nextWorldOrderId);
});

test('古いセーブ（依頼なし）でも ensureWorldOrders で足される', () => {
  const w = setup();
  const j = toJson(w);
  delete j.worldOrders;
  delete j.nextWorldOrderId;
  const back = fromJson(JSON.parse(JSON.stringify(j)));
  assert.equal(back.worldOrders.length, 0);
  const ops = ensureWorldOrders(back, mulberry32(1));
  assert.equal(back.worldOrders.length, WORLD_ORDER_SLOTS);
  assert.equal(ops.filter((o) => o.t === 'worldOrder').length, WORLD_ORDER_SLOTS);
});

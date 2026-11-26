// シャッター（5×5）の依頼: お客さんの注文に同じアイテムを納品すると数が進み、そろうと開く
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK, BLOCKS_X, START_BLOCK, WORLD_ORDER_BONUS, addPlayer, apply, applyOps, cellAt, cloneWorld,
  createWorld, fromJson, mulberry32, toJson,
} from '../src/index.ts';
import type { Item, World } from '../src/index.ts';

const T0 = 1_000_000;

function setup(seed = 1) {
  const w = createWorld(mulberry32(seed));
  addPlayer(w, 'a', 'A', T0, mulberry32(seed + 1));
  return w;
}

/** 最初の 5×5 の空きマスに置く */
function put(w: World, kind: number): Item {
  for (let y = 95; y < 100; y++) {
    for (let x = 0; x < 5; x++) {
      const c = cellAt(x, y);
      if (w.cells[c]) continue;
      const it: Item = { id: w.nextId++, kind, cell: c, maker: 'a' };
      w.items.set(it.id, it);
      w.cells[c] = it.id;
      return it;
    }
  }
  throw new Error('空きがない');
}

/** シャッターが待っているアイテムを頼む注文を作って、そこへ納品する */
function deliverForShutter(w: World, kind: number, seed: number) {
  const p = w.players.get('a')!;
  p.orders[0] = { id: 9000 + seed, customer: 'boy', needs: [{ kind, count: 1, have: 0 }], coins: 1, xp: 1 };
  const it = put(w, kind);
  return apply(w, 'a', { t: 'deliver', order: 9000 + seed, item: it.id }, T0, mulberry32(seed));
}

test('シャッターは開いた所のとなりにだけ依頼があり、1種類のアイテムを待つ', () => {
  for (const seed of [1, 2, 3]) {
    const w = setup(seed);
    assert.ok(w.worldOrders.length >= 2);
    for (const o of w.worldOrders) {
      assert.equal(o.needs.length, 1);
      assert.equal(w.blocks[o.block], 0);
      const bx = o.block % BLOCKS_X; const by = Math.floor(o.block / BLOCKS_X);
      const open = [[bx - 1, by], [bx + 1, by], [bx, by - 1], [bx, by + 1]].some(([x, y]) => x! >= 0 && y! >= 0 && w.blocks[y! * BLOCKS_X + x!] === 1);
      assert.ok(open, 'となりが開いている');
    }
  }
});

test('注文に納品すると、同じアイテムを待つシャッターの数が進み、そろうと開いて次の依頼が付く', () => {
  const w = setup(4);
  const o = w.worldOrders[0]!;
  const kind = o.needs[0]!.kind;
  // ほかのシャッターは別のアイテムを待つことにする（このシャッターだけが進むように）
  for (const x of w.worldOrders) if (x !== o) x.needs = [{ kind: kind + 1, count: 9, have: 0 }];
  const count = o.needs[0]!.count;
  const coins0 = w.players.get('a')!.coins;
  for (let i = 0; i < count - 1; i++) {
    const r = deliverForShutter(w, kind, i);
    assert.ok(r.ok);
    assert.equal(w.worldOrders.find((x) => x.id === o.id)!.needs[0]!.have, i + 1);
  }
  const last = deliverForShutter(w, kind, 99);
  assert.ok(last.ok);
  assert.equal(w.blocks[o.block], 1, 'シャッターが開いた');
  assert.ok(!w.worldOrders.some((x) => x.id === o.id));
  assert.ok(last.ok && last.events.some((e) => e.t === 'unlock' && e.block === o.block));
  assert.ok(w.players.get('a')!.coins >= coins0 + WORLD_ORDER_BONUS);
  // 開いたシャッターのとなりにも依頼が付く
  const bx = o.block % BLOCKS_X; const by = Math.floor(o.block / BLOCKS_X);
  const next = [[bx + 1, by], [bx, by - 1]].map(([x, y]) => y! * BLOCKS_X + x!).filter((b) => b >= 0 && w.blocks[b] === 0);
  assert.ok(next.every((b) => w.worldOrders.some((x) => x.block === b)));
});

test('関係のないアイテムを納品しても、シャッターは進まない', () => {
  const w = setup(5);
  const before = JSON.stringify(w.worldOrders);
  const wanted = new Set(w.worldOrders.map((o) => o.needs[0]!.kind));
  let kind = 101;
  while (wanted.has(kind)) kind++;
  assert.ok(deliverForShutter(w, kind, 1).ok);
  assert.equal(JSON.stringify(w.worldOrders), before);
});

test('シャッターに直接アイテムを置くことはできない', () => {
  const w = setup(6);
  const o = w.worldOrders[0]!;
  const it = put(w, o.needs[0]!.kind);
  const cell = cellAt((o.block % BLOCKS_X) * BLOCK, Math.floor(o.block / BLOCKS_X) * BLOCK);
  assert.ok(apply(w, 'a', { t: 'grab', item: it.id }, T0, mulberry32(1)).ok);
  const r = apply(w, 'a', { t: 'drop', item: it.id, cell }, T0, mulberry32(1));
  assert.equal(!r.ok && r.reason, 'locked');
});

test('注文は、シャッターが待っているアイテムを多めに頼む', () => {
  const w = setup(7);
  const wanted = new Set(w.worldOrders.map((o) => o.needs[0]!.kind));
  let hit = 0;
  for (let i = 0; i < 40; i++) {
    const p = w.players.get('a')!;
    p.orders = [];
    addPlayer(w, 'a', 'A', T0, mulberry32(100 + i));
    if (p.orders.some((o) => o.needs.some((n) => wanted.has(n.kind)))) hit++;
  }
  assert.ok(hit >= 20, `シャッターのアイテムを頼む注文: ${hit}/40`);
});

test('8人の組でも、シャッターのアイテムを頼むのは3人まで（同じ物ばかりにならない）', () => {
  for (let i = 0; i < 20; i++) {
    const w = setup(7);
    const wanted = new Set(w.worldOrders.map((o) => o.needs[0]!.kind));
    const p = w.players.get('a')!;
    p.orderClears = 24;
    p.level = 12;
    p.orders = [];
    addPlayer(w, 'a', 'A', T0, mulberry32(300 + i));
    assert.equal(p.orders.length, 8);
    const n = p.orders.filter((o) => o.needs.some((x) => wanted.has(x.kind))).length;
    assert.ok(n <= 3, `シャッターのアイテムを頼む人: ${n}/8`);
  }
});

test('シャッターの依頼は、保存・読み込み・差分でもそのまま', () => {
  const w = setup(8);
  const client = cloneWorld(w);
  const o = w.worldOrders[0]!;
  const r = deliverForShutter(w, o.needs[0]!.kind, 1);
  assert.ok(r.ok);
  applyOps(client, r.ok ? r.ops : [], T0);
  assert.deepEqual(client.worldOrders, w.worldOrders);
  const back = fromJson(JSON.parse(JSON.stringify(toJson(w))));
  assert.deepEqual(back.worldOrders, w.worldOrders);
  assert.equal(back.blocks[START_BLOCK], 1);
});

test('同じアイテムを待つシャッターが2枚あっても、1つの納品で進むのは1枚だけ（いちばん開きそうな方）', () => {
  const w = setup(9);
  const [o1, o2] = w.worldOrders;
  const kind = o1!.needs[0]!.kind;
  o2!.needs = [{ kind, count: 5, have: 0 }];
  o1!.needs = [{ kind, count: 2, have: 0 }];
  assert.ok(deliverForShutter(w, kind, 1).ok);
  const h = (id: number) => w.worldOrders.find((x) => x.id === id)?.needs[0]!.have;
  assert.equal(h(o1!.id), 1);
  assert.equal(h(o2!.id), 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, cellAt, emptyWorld, kindOf, addPlayer, mulberry32 } from '@minna/shared';
import type { Item, World } from '@minna/shared';
import { matchOrders } from '../src/order-match.ts';

const T0 = 1_000_000;

function setup() {
  const w = emptyWorld();
  for (let bx = 8; bx < 12; bx++) for (let by = 8; by < 12; by++) w.blocks[by * 20 + bx] = 1;
  addPlayer(w, 'a', 'A', T0, mulberry32(1));
  const p = w.players.get('a')!;
  const bread = kindOf('bread', 2);
  const pizza = kindOf('pizza', 2);
  p.orders = [
    { id: 1, customer: 'momo', needs: [{ kind: bread, count: 1, have: 0 }, { kind: pizza, count: 1, have: 0 }], coins: 4, xp: 4 },
    { id: 2, customer: 'gorou', needs: [{ kind: bread, count: 1, have: 0 }], coins: 2, xp: 2 },
  ];
  return { w, p, bread, pizza };
}

function put(w: World, kind: number, x: number, y: number, extra: Partial<Item> = {}): Item {
  const it: Item = { id: w.nextId++, kind, cell: cellAt(x, y), ...extra };
  w.items.set(it.id, it);
  w.cells[it.cell] = it.id;
  return it;
}

test('盤面の1個は注文の1つにだけ数える。そろった注文は完了ボタンで渡すアイテムが決まる', () => {
  const { w, p, bread, pizza } = setup();
  const b1 = put(w, bread, 40, 40);
  let m = matchOrders(p, w, T0);
  // パン1個なら、まだそろわない注文1（パン＋ピザ）ではなく、今すぐ渡せる注文2（パンだけ）に使う
  assert.deepEqual(m.ready.get(1), [false, false]);
  assert.deepEqual(m.ready.get(2), [true]);
  assert.deepEqual([...m.items], [b1.id]);

  const pz = put(w, pizza, 41, 40);
  const b2 = put(w, bread, 42, 40);
  m = matchOrders(p, w, T0);
  assert.deepEqual(m.ready.get(1), [true, true]);
  assert.deepEqual(m.ready.get(2), [true]);
  assert.deepEqual(m.assign.get(1), [b1.id, pz.id]);
  assert.deepEqual(m.assign.get(2), [b2.id]);

  // 完了ボタン: 割り当てたアイテムを順に納品すると、注文が終わる
  for (const id of m.assign.get(1)!) assert.ok(apply(w, 'a', { t: 'deliver', order: 1, item: id! }, T0, mulberry32(2)).ok);
  assert.ok(!p.orders.some((o) => o.id === 1));
});

test('ダンボールの中・ほこり付き・発生器・シャッターの中・ほかの人が持っている物は数えない', () => {
  const { w, p, bread } = setup();
  put(w, bread, 40, 40, { boxed: true });
  put(w, bread, 41, 40, { dusty: true });
  put(w, bread, 2, 2); // シャッターの中
  const held = put(w, bread, 42, 40);
  w.holds.set(held.id, { player: 'b', until: T0 + 5000 });
  const m = matchOrders(p, w, T0);
  assert.equal(m.items.size, 0);
  // 持っていた人の時間が切れたら数える
  assert.equal(matchOrders(p, w, T0 + 6000).items.size, 1);
});

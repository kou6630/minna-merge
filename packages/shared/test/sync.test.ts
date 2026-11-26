import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addPlayer, apply, applyOps, cellAt, cloneWorld, createWorld, diffWorlds, mulberry32, toJson,
} from '../src/index.ts';

const T0 = 1_000_000;

test('サーバーの ops を当てると、サーバーと同じ盤面になる', () => {
  const server = createWorld(mulberry32(3));
  addPlayer(server, 'a', 'A', T0);
  const client = cloneWorld(server);
  const rng = mulberry32(9);
  const gen = [...server.items.values()].find((i) => i.owner === 'a')!;
  const all = [];
  for (let i = 0; i < 6; i++) {
    const r = apply(server, 'a', { t: 'tap', gen: gen.id }, T0 + i, rng);
    if (r.ok) all.push(...r.ops);
  }
  // 出たアイテムどうしを重ねる・入れ替える
  const mine = [...server.items.values()].filter((i) => i.maker === 'a' && !i.owner);
  const [x, y, z] = mine;
  for (const [a, b] of [[x, y], [z, gen]] as const) {
    if (!a || !b) continue;
    all.push(...(apply(server, 'a', { t: 'grab', item: a.id }, T0, rng) as { ops: [] }).ops);
    const r = apply(server, 'a', { t: 'drop', item: a.id, cell: b.cell }, T0, rng);
    all.push(...r.ops);
  }
  applyOps(client, all, T0);
  applyOps(client, all, T0); // 2回当てても同じ
  client.rev = server.rev;
  assert.deepEqual(toJson(client).items.sort((p, q) => p.id - q.id), toJson(server).items.sort((p, q) => p.id - q.id));
  assert.deepEqual([...client.cells], [...server.cells]);
});

test('2つの盤面の差を ops にして当てると、同じ盤面になる', () => {
  const a = createWorld(mulberry32(5));
  addPlayer(a, 'p', 'P', T0);
  const b = cloneWorld(a);
  const rng = mulberry32(1);
  const gen = [...b.items.values()].find((i) => i.owner === 'p')!;
  apply(b, 'p', { t: 'tap', gen: gen.id }, T0, rng);
  apply(b, 'p', { t: 'grab', item: gen.id }, T0, rng);
  apply(b, 'p', { t: 'drop', item: gen.id, cell: cellAt(4, 99) }, T0, rng);
  const some = [...b.items.values()].find((i) => i.owner !== 'p')!;
  b.items.delete(some.id);
  b.cells[some.cell] = 0;
  const ops = diffWorlds(a, b);
  applyOps(a, ops, T0);
  assert.deepEqual([...a.cells], [...b.cells]);
  assert.deepEqual(diffWorlds(a, b).filter((o) => o.t !== 'hold'), []);
});

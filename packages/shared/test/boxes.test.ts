// マスのダンボール: 半開きは動かせないが同じアイテムで合成でき、使えるようになると上下左右が半開きになる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, BLOCKS_X, addPlayer, apply, cellAt, createWorld, isGeneratorKind, kindOf, mulberry32, openBlock, START_BLOCK, tierOfKind } from '../src/index.ts';
import type { Item, World } from '../src/index.ts';

const T0 = 1_000_000;

function setup() {
  const w = createWorld(mulberry32(3));
  addPlayer(w, 'a', 'A', T0, mulberry32(4));
  return w;
}
const at = (w: World, x: number, y: number) => w.items.get(w.cells[cellAt(x, y)]!)!;
function put(w: World, kind: number, x: number, y: number): Item {
  const it: Item = { id: w.nextId++, kind, cell: cellAt(x, y), maker: 'a' };
  w.items.set(it.id, it);
  w.cells[it.cell] = it.id;
  return it;
}

test('ダンボールはつかめない。閉じた箱には重ねられない', () => {
  const w = setup();
  const half = at(w, 2, 99);
  const closed = at(w, 3, 99);
  assert.ok(half.dusty && closed.boxed);
  const r1 = apply(w, 'a', { t: 'grab', item: half.id }, T0, mulberry32(1));
  assert.equal(!r1.ok && r1.reason, 'dusty');
  const r2 = apply(w, 'a', { t: 'grab', item: closed.id }, T0, mulberry32(1));
  assert.equal(!r2.ok && r2.reason, 'boxed');
  // 閉じた箱の中身と同じアイテムでも、重ねられない
  const same = put(w, closed.kind, 1, 99);
  assert.ok(apply(w, 'a', { t: 'grab', item: same.id }, T0, mulberry32(1)).ok);
  const r3 = apply(w, 'a', { t: 'drop', item: same.id, cell: closed.cell }, T0, mulberry32(1));
  assert.equal(!r3.ok && r3.reason, 'boxed');
});

test('半開きに同じアイテムを重ねると合成されてそのマスが使え、上下左右の閉じた箱が半開きになる', () => {
  const w = setup();
  const half = at(w, 2, 99);
  const bread = put(w, kindOf('bread', 1), 1, 99);
  assert.ok(apply(w, 'a', { t: 'grab', item: bread.id }, T0, mulberry32(1)).ok);
  const r = apply(w, 'a', { t: 'drop', item: bread.id, cell: half.cell }, T0, mulberry32(1));
  assert.ok(r.ok);
  const got = at(w, 2, 99);
  assert.equal(got.kind, kindOf('bread', 2));
  assert.ok(!got.dusty && !got.boxed, '取り出せた');
  assert.ok(at(w, 3, 99).dusty && !at(w, 3, 99).boxed, '右が半開き');
  assert.ok(at(w, 2, 98).dusty, '上が半開き');
  assert.ok(at(w, 3, 98).boxed, 'ななめは閉じたまま');
  // 取り出したアイテムは動かせる
  assert.ok(apply(w, 'a', { t: 'grab', item: got.id }, T0, mulberry32(1)).ok);
});

test('新しく開いた区画は、使えるマスに面した箱だけ半開き', () => {
  const w = setup();
  // 最初の区画の右の列（x=4）を使えるマスにしてから、右の区画を開ける
  for (let y = 95; y < 100; y++) { const it = at(w, 4, y); w.items.delete(it.id); w.cells[it.cell] = 0; }
  openBlock(w, START_BLOCK + 1, mulberry32(9));
  for (let y = 95; y < 100; y++) assert.ok(at(w, 5, y).dusty, `(5,${y}) は半開き`);
  for (let y = 95; y < 100; y++) assert.ok(at(w, 6, y).boxed, `(6,${y}) は閉じている`);
});

test('1つの区画のダンボールの中身は、全部ちがうアイテム。近い箱ほど低い段階', () => {
  for (const seed of [1, 2, 3, 4]) {
    const w = createWorld(mulberry32(seed));
    const inStart = [...w.items.values()].filter((i) => i.boxed || i.dusty);
    assert.equal(inStart.length, 21);
    assert.equal(new Set(inStart.map((i) => i.kind)).size, 21, '最初の区画の21個は全部ちがう');
    // 2×2 のとなりの箱は、段階1か2
    for (const c of [cellAt(2, 98), cellAt(0, 97), cellAt(1, 97)]) assert.ok((w.items.get(w.cells[c]!)!.kind % 100) <= 2);
    // レベル2 になってから開けた区画は、25個全部ちがう
    addPlayer(w, 'a', 'A', T0, mulberry32(seed));
    w.players.get('a')!.level = 2;
    openBlock(w, START_BLOCK - 20, mulberry32(seed + 10));
    const bx = 0; const by = 90;
    const kinds: number[] = [];
    for (let y = by; y < by + 5; y++) for (let x = bx; x < bx + 5; x++) kinds.push(w.items.get(w.cells[cellAt(x, y)]!)!.kind);
    assert.equal(new Set(kinds).size, 25, '次の区画の25個は全部ちがう');
  }
});

test('右上（外側）の区画ほど、ダンボールの中身の段階が高い。どの区画の中も全部ちがう物', () => {
  const avgTier = (bx: number, byFromBottom: number, lv: number) => {
    const w = createWorld(mulberry32(11));
    addPlayer(w, 'a', 'A', T0, mulberry32(12));
    w.players.get('a')!.level = lv;
    const by = 19 - byFromBottom;
    openBlock(w, by * BLOCKS_X + bx, mulberry32(13));
    const kinds: number[] = [];
    for (let y = by * BLOCK; y < by * BLOCK + BLOCK; y++) for (let x = bx * BLOCK; x < bx * BLOCK + BLOCK; x++) kinds.push(w.items.get(w.cells[cellAt(x, y)]!)!.kind);
    assert.equal(new Set(kinds).size, 25, `(${bx},${byFromBottom}) の25個は全部ちがう`);
    const items = kinds.filter((k) => !isGeneratorKind(k));
    return items.reduce((s, k) => s + tierOfKind(k), 0) / items.length;
  };
  // 同じレベルでも、外側ほど高い
  const near = avgTier(1, 0, 10);
  const mid = avgTier(8, 8, 10);
  const far = avgTier(19, 19, 10);
  assert.ok(near < mid && mid < far, `${near} < ${mid} < ${far}`);
  assert.ok(far >= 6);
});

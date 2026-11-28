import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENERGY_MAX, GEM_ENERGY_AMOUNT, GEM_ENERGY_COST, LEVEL_UP_ENERGY, addPlayer, apply, emptyWorld, genRefillCost, grantXp, kindOf, makeOrder,
  maxCharges, mulberry32, orderCoins, parseAction, xpToNext,
} from '../src/index.ts';

const T0 = 1_000_000;
const rng = mulberry32(5);

function setup() {
  const w = emptyWorld();
  for (let bx = 8; bx < 12; bx++) for (let by = 8; by < 12; by++) w.blocks[by * 20 + bx] = 1;
  addPlayer(w, 'a', 'A', T0, mulberry32(1));
  addPlayer(w, 'b', 'B', T0, mulberry32(2));
  const p = w.players.get('a')!;
  const gen = [...w.items.values()].find((i) => i.owner === 'a')!;
  return { w, p, gen };
}

test('ジェムでスタミナ回復: 35ジェムで +50（満タンをこえてもよい）。足りなければできない', () => {
  assert.equal(GEM_ENERGY_COST, 35);
  assert.equal(GEM_ENERGY_AMOUNT, 50);
  const { w, p } = setup();
  p.gems = 2 * GEM_ENERGY_COST + 5;
  p.energy = 3;
  const r = apply(w, 'a', { t: 'buyEnergy' }, T0, rng);
  assert.ok(r.ok && r.events.some((e) => e.t === 'gemUse' && e.what === 'energy' && e.gems === GEM_ENERGY_COST));
  assert.equal(p.energy, 3 + GEM_ENERGY_AMOUNT);
  assert.equal(p.gems, GEM_ENERGY_COST + 5);
  assert.ok(apply(w, 'a', { t: 'buyEnergy' }, T0, rng).ok);
  assert.ok(p.energy > ENERGY_MAX);
  const no = apply(w, 'a', { t: 'buyEnergy' }, T0, rng);
  assert.equal(!no.ok && no.reason, 'gems');
  assert.equal(p.gems, 5);
});

test('ジェムで発生器をすぐ満タン: 使い切ったときだけ（10回ごとに1ジェム）。1回でも残っている・ほかの人の発生器はできない', () => {
  const { w, p, gen } = setup();
  const max = maxCharges(gen);
  p.gems = 100;
  // 満タンのときも、1回でも残っているときも使えない
  let r = apply(w, 'a', { t: 'refillGen', gen: gen.id }, T0, rng);
  assert.equal(!r.ok && r.reason, 'not-empty');
  gen.charges = 1;
  gen.chargesAt = T0;
  r = apply(w, 'a', { t: 'refillGen', gen: gen.id }, T0, rng);
  assert.equal(!r.ok && r.reason, 'not-empty');
  p.gems = 0;
  // 使い切って休んでいる
  gen.charges = 0;
  gen.chargesAt = T0;
  assert.equal((apply(w, 'a', { t: 'tap', gen: gen.id }, T0, rng) as { reason: string }).reason, 'no-charge');
  r = apply(w, 'a', { t: 'refillGen', gen: gen.id }, T0, rng);
  assert.equal(!r.ok && r.reason, 'gems');
  p.gems = 10;
  const cost = genRefillCost(max);
  r = apply(w, 'a', { t: 'refillGen', gen: gen.id }, T0, rng);
  assert.ok(r.ok && r.events.some((e) => e.t === 'gemUse' && e.what === 'gen' && e.gen === gen.id));
  assert.equal(gen.charges, max);
  assert.equal(p.gems, 10 - cost);
  assert.ok(r.ok && r.ops.some((o) => o.t === 'update' && o.item.id === gen.id && o.item.charges === max));
  // すぐまたタップで出せる
  assert.ok(apply(w, 'a', { t: 'tap', gen: gen.id }, T0, rng).ok);
  // ほかの人の発生器
  const other = [...w.items.values()].find((i) => i.owner === 'b')!;
  other.charges = 0;
  assert.equal((apply(w, 'a', { t: 'refillGen', gen: other.id }, T0, rng) as { reason: string }).reason, 'not-yours');
  assert.equal(genRefillCost(1), 5);
  assert.equal(genRefillCost(12), 5);
  assert.equal(genRefillCost(50), 5);
});

test('ジェムの操作は通信で届く形になっている', () => {
  assert.deepEqual(parseAction({ t: 'buyEnergy' }), { t: 'buyEnergy' });
  assert.deepEqual(parseAction({ t: 'refillGen', gen: 3 }), { t: 'refillGen', gen: 3 });
  assert.equal(parseAction({ t: 'refillGen', gen: 'x' }), null);
});

test('レベルが上がるとスタミナ +20（満タンまで）。満タン回復ではない', () => {
  const { w, p } = setup();
  p.energy = 10;
  const r = grantXp(w, 'a', xpToNext(1), T0);
  assert.equal(p.level, 2);
  assert.equal(p.energy, 10 + LEVEL_UP_ENERGY);
  assert.ok(r.events.some((e) => e.t === 'levelup' && e.energy === LEVEL_UP_ENERGY));
  // 満タン近くなら満タンまで
  p.energy = 95;
  grantXp(w, 'a', xpToNext(2), T0);
  assert.equal(p.energy, ENERGY_MAX);
  // 満タンをこえているときは減らさない
  p.energy = 150;
  const r2 = grantXp(w, 'a', xpToNext(3), T0);
  assert.equal(p.energy, 150);
  assert.ok(r2.events.some((e) => e.t === 'levelup' && e.energy === 0));
});

test('注文のコイン: 段階3から1段ごとに +30%（高い段階ほど1つあたりがお得）', () => {
  const b = (t: number) => kindOf('bread', t);
  assert.equal(orderCoins(b(1)), 2);
  assert.equal(orderCoins(b(2)), 4);
  assert.equal(orderCoins(b(3)), Math.round(8 * 1.3));
  assert.equal(orderCoins(b(5)), Math.round(32 * 1.9));
  // 段階1換算あたりのコインが、段階が上がるほど増える
  const per = (t: number) => orderCoins(b(t)) / 2 ** (t - 1);
  for (let t = 3; t <= 7; t++) assert.ok(per(t) > per(t - 1));
  const p = { level: 12, nextOrderId: 1 } as Parameters<typeof makeOrder>[0];
  const o = makeOrder(p, mulberry32(3), [], 'momo', 2);
  assert.equal(o.coins, o.needs.reduce((s, n) => s + orderCoins(n.kind, n.count), 0));
});

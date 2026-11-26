import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GEN_WORK_TIER, addPlayer, apply, cellAt, emptyWorld, fromJson, grantXp, isGiftKind, kindOf, maxCharges, mulberry32, parseAction, toJson, xpToNext,
} from '../src/index.ts';
import type { Player } from '../src/index.ts';

const T0 = 1_000_000;
const rng = mulberry32(9);

function setup() {
  const w = emptyWorld();
  for (let bx = 8; bx < 12; bx++) for (let by = 8; by < 12; by++) w.blocks[by * 20 + bx] = 1;
  addPlayer(w, 'a', 'A', T0, mulberry32(1));
  return { w, p: w.players.get('a')! };
}

test('報酬は盤面に出ず受け取り枠にたまり、タップするともらった順に1個ずつ出る', () => {
  const { w, p } = setup();
  const before = w.items.size;
  grantXp(w, 'a', xpToNext(1) + xpToNext(2), T0); // Lv3: 白・青（Lv2）、白・赤（Lv3）、ウォーターサーバーの部品
  assert.equal(w.items.size, before, '盤面は変わらない');
  assert.ok(p.inbox.length >= 5);
  const order = [...p.inbox];
  const out: number[] = [];
  let x = 40;
  while (p.inbox.length) {
    const r = apply(w, 'a', { t: 'takeReward', cell: cellAt(x++, 40) }, T0, rng);
    assert.ok(r.ok && r.events.some((e) => e.t === 'rewardTaken'));
    const sp = r.ok ? r.ops.find((o) => o.t === 'spawn') : undefined;
    assert.ok(sp && sp.t === 'spawn');
    out.push(sp.item.kind);
  }
  assert.deepEqual(out, order);
  assert.ok(out.some(isGiftKind));
  const empty = apply(w, 'a', { t: 'takeReward', cell: cellAt(x, 40) }, T0, rng);
  assert.equal(!empty.ok && empty.reason, 'empty-inbox');
});

test('受け取り枠から出した発生器は自分の物。動く段階ならチャージ満タン', () => {
  const { w, p } = setup();
  p.inbox = [kindOf('crate', 1), kindOf('crate', GEN_WORK_TIER)];
  const r1 = apply(w, 'a', { t: 'takeReward', cell: cellAt(40, 40) }, T0, rng);
  const r2 = apply(w, 'a', { t: 'takeReward', cell: cellAt(41, 40) }, T0, rng);
  assert.ok(r1.ok && r2.ok);
  const part = w.items.get(w.cells[cellAt(40, 40)]!)!;
  const gen = w.items.get(w.cells[cellAt(41, 40)]!)!;
  assert.equal(part.owner, 'a');
  assert.equal(gen.owner, 'a');
  assert.equal(gen.charges, maxCharges(gen));
});

test('ふさがったマス・開いていない区画には出せず、枠の中身は減らない', () => {
  const { w, p } = setup();
  p.inbox = [kindOf('gift', 1)];
  const gen = [...w.items.values()].find((i) => i.owner === 'a')!;
  assert.equal((apply(w, 'a', { t: 'takeReward', cell: gen.cell }, T0, rng) as { reason: string }).reason, 'occupied');
  assert.equal((apply(w, 'a', { t: 'takeReward', cell: cellAt(2, 2) }, T0, rng) as { reason: string }).reason, 'locked');
  assert.equal(p.inbox.length, 1);
});

test('受け取り枠は保存・読み込みで残る。古いセーブにはからの枠ができる', () => {
  const { w, p } = setup();
  p.inbox = [kindOf('gift', 2), kindOf('oven', 1)];
  const back = fromJson(JSON.parse(JSON.stringify(toJson(w))));
  assert.deepEqual(back.players.get('a')!.inbox, p.inbox);
  const j = toJson(w);
  for (const q of j.players) delete (q as Partial<Player>).inbox;
  assert.deepEqual(fromJson(JSON.parse(JSON.stringify(j))).players.get('a')!.inbox, []);
  assert.deepEqual(parseAction({ t: 'takeReward', cell: 5 }), { t: 'takeReward', cell: 5 });
  assert.equal(parseAction({ t: 'takeReward' }), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOpenCell,
  CHAPTERS, GIFTS, STORY_CLEAR_GIFTS, STORY_HALF_GIFTS, addPlayer, apply, cellAt, chainOfKind, emptyWorld, grantXp,
  isGeneratorKind, isGiftKind, kindOf, levelGiftTiers, mulberry32, ownedGeneratorKeys, tierOfKind, unlockedChains, xpToNext,
} from '../src/index.ts';
import type { Item, World } from '../src/index.ts';

const T0 = 1_000_000;
const gift = (t: number) => kindOf('gift', t);

function setup(): World {
  const w = emptyWorld();
  for (let bx = 8; bx < 12; bx++) for (let by = 8; by < 12; by++) w.blocks[by * 20 + bx] = 1;
  addPlayer(w, 'a', 'Aさん', T0);
  return w;
}

function put(w: World, kind: number, x: number, y: number): Item {
  const it: Item = { id: w.nextId++, kind, cell: cellAt(x, y), maker: 'a' };
  w.items.set(it.id, it);
  w.cells[it.cell] = it.id;
  return it;
}

test('プレゼント箱は同じ色どうしでも合成できず、入れ替わる。売れない', () => {
  const rng = mulberry32(3);
  const w = setup();
  const x = put(w, gift(1), 40, 40);
  const y = put(w, gift(1), 41, 40);
  apply(w, 'a', { t: 'grab', item: x.id }, T0, rng);
  assert.ok(apply(w, 'a', { t: 'drop', item: x.id, cell: y.cell }, T0, rng).ok);
  assert.equal(w.items.get(y.id)!.kind, gift(1));
  assert.equal(x.cell, cellAt(41, 40));
  assert.equal(apply(w, 'a', { t: 'sell', item: x.id }, T0, rng).ok, false);
});

test('タップごとに1個出る。白・青は5回、赤・紫は3回まで必ず残り、そのあとは約半分で消える', () => {
  for (let t = 1; t <= 4; t++) {
    const def = GIFTS[t - 1]!;
    let survivedAfterSafe = 0;
    let brokeAfterSafe = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rng = mulberry32(seed);
      const w = setup();
      w.players.get('a')!.level = 12;
      const g = put(w, gift(t), 45, 45);
      for (let i = 1; i <= def.safe; i++) {
        const r = apply(w, 'a', { t: 'openGift', item: g.id }, T0, rng);
        assert.ok(r.ok);
        if (r.ok) assert.equal(r.ops.filter((o) => o.t === 'spawn').length, 1);
        assert.ok(w.items.has(g.id), `${t}色目 ${i}回目で消えた`);
      }
      const r = apply(w, 'a', { t: 'openGift', item: g.id }, T0, rng);
      assert.ok(r.ok);
      if (r.ok) assert.equal(r.ops.filter((o) => o.t === 'spawn').length, 1); // 消える回も1個は出る
      if (w.items.has(g.id)) survivedAfterSafe++;
      else brokeAfterSafe++;
    }
    assert.ok(brokeAfterSafe > 15 && survivedAfterSafe > 15, `${t}色目: 消えた ${brokeAfterSafe} / 残った ${survivedAfterSafe}`);
  }
});

test('中身: 白は段階2〜3・青は2〜5の作れる子アイテム、赤は今のレベルでもらえる発生器の段階1〜2、紫は2〜4', () => {
  const rng = mulberry32(9);
  for (let t = 1; t <= 4; t++) {
    const def = GIFTS[t - 1]!;
    const w = setup();
    const p = w.players.get('a')!;
    p.level = 12;
    const chains = new Set(unlockedChains(p.level));
    const mine = new Set(ownedGeneratorKeys(p.level));
    for (let n = 0; n < 16; n++) {
      const g = put(w, gift(t), 41 + (n % 4) * 5, 41 + Math.floor(n / 4) * 5);
      const r = apply(w, 'a', { t: 'openGift', item: g.id }, T0, rng);
      assert.ok(r.ok);
      if (!r.ok) continue;
      const sp = r.ops.find((o) => o.t === 'spawn');
      assert.ok(sp && sp.t === 'spawn');
      const k = sp.item.kind;
      assert.equal(isGiftKind(k), false);
      if (def.from === 'child') {
        assert.equal(isGeneratorKind(k), false);
        assert.ok(chains.has(chainOfKind(k).key));
      } else {
        assert.equal(isGeneratorKind(k), true);
        assert.ok(mine.has(chainOfKind(k).key));
        assert.equal(sp.item.owner, 'a');
      }
      assert.ok(tierOfKind(k) >= def.minTier && tierOfKind(k) <= def.maxTier, `${t}色目 ${k}`);
    }
  }
});

test('まわりに空きがないとタップできない（回数も増えない）', () => {
  const rng = mulberry32(5);
  const w = setup();
  const g = put(w, gift(1), 45, 45);
  for (let c = 0; c < w.cells.length; c++) if (!w.cells[c] && isOpenCell(w, c)) put(w, kindOf('bread', 1), c % 100, Math.floor(c / 100));
  const r = apply(w, 'a', { t: 'openGift', item: g.id }, T0, rng);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'no-space');
  assert.equal(w.items.get(g.id)!.taps, undefined);
});

test('レベルアップ: 毎回白、2の倍数で青、3の倍数で赤、5の倍数で紫', () => {
  assert.deepEqual(levelGiftTiers(7), [1]);
  assert.deepEqual(levelGiftTiers(2), [1, 2]);
  assert.deepEqual(levelGiftTiers(3), [1, 3]);
  assert.deepEqual(levelGiftTiers(5), [1, 4]);
  assert.deepEqual(levelGiftTiers(30), [1, 2, 3, 4]);
  const w = setup();
  const r = grantXp(w, 'a', xpToNext(1), T0);
  const lu = r.events.find((e) => e.t === 'levelup');
  assert.ok(lu && lu.t === 'levelup');
  assert.deepEqual(lu.gifts, [gift(1), gift(2)]); // Lv2
  assert.equal([...w.items.values()].filter((i) => isGiftKind(i.kind)).length, 0); // 盤面にはまだ出ない
  assert.deepEqual(w.players.get('a')!.inbox.filter(isGiftKind), [gift(1), gift(2)]); // 受け取り枠に入る
});

test('ストーリー: 決まった章の 50% で白か青、クリアで赤', () => {
  const rng = mulberry32(2);
  const w = setup();
  const p = w.players.get('a')!;
  p.coins = 10_000_000;
  const half: Record<number, number> = {};
  const clear: Record<number, number> = {};
  for (const ch of CHAPTERS) {
    for (const task of ch.tasks) {
      const r = apply(w, 'a', { t: 'storyTask', taskId: task.id, choice: task.choices ? 0 : undefined }, T0, rng);
      assert.ok(r.ok);
      if (r.ok) for (const e of r.events) {
        if (e.t === 'chapterHalf' && e.gift) half[e.chapter] = tierOfKind(e.gift);
        if (e.t === 'chapterClear' && e.gift) clear[e.chapter] = tierOfKind(e.gift);
      }
    }
  }
  // 盤面が埋まって置けなかった分は届かないので、届いた分が表のとおりかを見る
  for (const [c, t] of Object.entries(half)) assert.equal(STORY_HALF_GIFTS[Number(c)], t);
  for (const [c, t] of Object.entries(clear)) assert.equal(STORY_CLEAR_GIFTS[Number(c)], t);
  assert.equal(half[2], 1);
  assert.equal(clear[3], 3);
  assert.equal(half[1], undefined);
});

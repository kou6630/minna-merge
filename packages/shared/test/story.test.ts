import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAPTERS, addPlayer, halfEnergy, kindOf, apply, createWorld, mulberry32, xpToNext } from '../src/index.ts';

test('チャプター1のタスクを順にコインで進め、3択の着せ替えとクリア報酬（経験値・スタミナ・ダイヤ）がもらえる', () => {
  const rng = mulberry32(42);
  const w = createWorld(rng);
  addPlayer(w, 'p1', 'レイナ', 1000, rng);
  const p = w.players.get('p1')!;
  const ch1 = CHAPTERS[0]!;

  // 順番を飛ばすと断られる
  const skip = apply(w, 'p1', { t: 'storyTask', taskId: ch1.tasks[1]!.id, choice: 0 }, 1000, rng);
  assert.equal(skip.ok, false);
  if (!skip.ok) assert.equal(skip.reason, 'task-locked');

  // コイン不足だと断られる
  const poor = apply(w, 'p1', { t: 'storyTask', taskId: ch1.tasks[0]!.id }, 1000, rng);
  assert.equal(poor.ok, false);
  if (!poor.ok) assert.equal(poor.reason, 'coins');

  // コインを渡して全5タスクを実行
  p.coins = 500;
  let clearEvent = null;
  for (let i = 0; i < ch1.tasks.length; i++) {
    const task = ch1.tasks[i]!;
    const r = apply(w, 'p1', { t: 'storyTask', taskId: task.id, choice: task.choices ? i % 3 : undefined }, 1000, rng);
    assert.equal(r.ok, true);
    if (r.ok) {
      const ev = r.events.find((e) => e.t === 'chapterClear');
      if (ev) clearEvent = ev;
    }
  }
  assert.ok(clearEvent && clearEvent.t === 'chapterClear');
  // おまけに、もらった発生器（Lv1 ならパン窯）の 2 段目の部品が盤面に置かれる
  assert.equal(clearEvent.part, kindOf('oven', 2));
  assert.ok(p.inbox.includes(kindOf('oven', 2)));
  assert.equal(p.gems, ch1.reward.gems);
  assert.ok(p.energy >= 100 + ch1.reward.energy || p.level > 1);
  assert.equal(p.story.claimed.includes(1), true);

  // 設置済みアイテムの3択デザイン変更（無料）
  const beforeCoins = p.coins;
  const restyle = apply(w, 'p1', { t: 'storyStyle', taskId: 'ch1_gate', choice: 2 }, 1000, rng);
  assert.equal(restyle.ok, true);
  assert.equal(p.story.choices['ch1_gate'], 2);
  assert.equal(p.coins, beforeCoins);

  // フェーズ2未完了の状態でフェーズ3をやろうとすると断られる
  p.coins = 10_000_000;
  const skipP3 = apply(w, 'p1', { t: 'storyTask', taskId: 'ch3_floor' }, 1000, rng);
  assert.equal(skipP3.ok, false);
  if (!skipP3.ok) assert.equal(skipP3.reason, 'task-locked');

  // フェーズ2・フェーズ3も順番に進めて全クリア報酬をもらえる（新タスク ch2_street_decor 含む）
  const ch2 = CHAPTERS[1]!;
  assert.ok(ch2.tasks.some((t) => t.id === 'ch2_street_decor' && t.choices?.length === 3));
  for (const ch of CHAPTERS.slice(1)) {
    for (const task of ch.tasks) {
      const r = apply(w, 'p1', { t: 'storyTask', taskId: task.id, choice: task.choices ? 1 : undefined }, 1000, rng);
      assert.equal(r.ok, true);
    }
    assert.equal(p.story.claimed.includes(ch.id), true);
  }
  // フェーズ2のベンチ＆飾りタスクも無料で3択着せ替えできる
  const restyleBench = apply(w, 'p1', { t: 'storyStyle', taskId: 'ch2_street_decor', choice: 2 }, 1000, rng);
  assert.equal(restyleBench.ok, true);
  assert.equal(p.story.choices['ch2_street_decor'], 2);
  assert.equal(p.gems, CHAPTERS.reduce((s, c) => s + c.reward.gems, 0));
});

test('50% のプレゼント: 半分おわった時に1回だけ、スタミナ（中）と部品レベル1。経験値とジェムはなし', () => {
  const rng = mulberry32(7);
  const w = createWorld(rng);
  addPlayer(w, 'p1', 'レイナ', 1000, rng);
  const p = w.players.get('p1')!;
  p.coins = 10_000_000;
  for (const ch of CHAPTERS) {
    const halfAt = Math.ceil(ch.tasks.length / 2) - 1;
    for (let i = 0; i < ch.tasks.length; i++) {
      const task = ch.tasks[i]!;
      const before = { xp: p.xp, level: p.level, gems: p.gems };
      const r = apply(w, 'p1', { t: 'storyTask', taskId: task.id, choice: task.choices ? 0 : undefined }, 1000, rng);
      assert.equal(r.ok, true);
      if (!r.ok) continue;
      const half = r.events.filter((e) => e.t === 'chapterHalf');
      assert.equal(half.length, i === halfAt ? 1 : 0, `第${ch.id}章 ${i + 1}個目`);
      const h = half[0];
      if (h && h.t === 'chapterHalf') {
        assert.equal(h.energy, halfEnergy(ch));
        assert.ok(h.energy < ch.reward.energy);
        // 部品はクリア報酬と同じ発生器のレベル1
        // 部品はレベル1（盤面に空きがあれば置かれる）
        if (h.part !== undefined) assert.equal(h.part % 100, 1);
        if (ch.id === 1) assert.equal(h.part, kindOf('oven', 1));
        if (i < ch.tasks.length - 1) {
          assert.equal(p.gems, before.gems);
          assert.equal(p.xp, before.xp);
        }
      }
    }
    assert.equal(p.story.half.includes(ch.id), true);
  }
});

test('章クリアの経験値はだれでも同じ。マージをほとんどしていなくても、上がるのは多くても1レベル', () => {
  for (const level of [1, 2, 5, 12, 30]) {
    for (const frac of [0, 0.5, 0.95]) {
      const rng = mulberry32(level * 10 + frac * 100);
      const w = createWorld(rng);
      addPlayer(w, 'p1', 'レイナ', 1000, rng);
      const p = w.players.get('p1')!;
      p.level = level;
      p.xp = Math.floor(xpToNext(level) * frac);
      p.coins = 10_000_000;
      let got = -1;
      for (const task of CHAPTERS[0]!.tasks) {
        const r = apply(w, 'p1', { t: 'storyTask', taskId: task.id, choice: task.choices ? 0 : undefined }, 1000, rng);
        assert.ok(r.ok);
        const ev = r.ok ? r.events.find((e) => e.t === 'chapterClear') : undefined;
        if (ev && ev.t === 'chapterClear') got = ev.xp;
      }
      assert.ok(p.level <= level + 1, `Lv${level}・${frac * 100}% から Lv${p.level} になった`);
      // ふつうのレベルなら、決まった量がそのまま入る
      if (level >= 5) assert.equal(got, CHAPTERS[0]!.reward.xp);
    }
  }
  // 決まった量は、章が進むほど多い
  for (let i = 1; i < CHAPTERS.length; i++) assert.ok(CHAPTERS[i]!.reward.xp > CHAPTERS[i - 1]!.reward.xp);
});

// ストーリーで使う絵が、全部そろっているか（3択の絵・章の絵・話す人の立ち絵・マップに立つ店主・型紙の家具の置き方）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAPTERS, SHOPS_11, portraitSrc } from '../../../packages/shared/src/index.ts';
import type { SpeakerId } from '../../../packages/shared/src/index.ts';

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const file = (src: string) => join(PUB, src.split('?')[0]!);

test('ストーリーの3択の絵と、章の絵が全部ある', () => {
  const missing: string[] = [];
  for (const ch of CHAPTERS) {
    if (!existsSync(file(ch.baseImg))) missing.push(`${ch.id}章 ${ch.baseImg}`);
    for (const t of ch.tasks) for (const c of t.choices ?? []) if (!existsSync(file(c.stageImg))) missing.push(`${t.id} ${c.stageImg}`);
  }
  assert.deepEqual(missing, []);
});

test('会話に出てくる人の立ち絵と、マップに立つ店主の絵が全部ある', () => {
  const speakers = new Set<SpeakerId>();
  for (const ch of CHAPTERS) {
    for (const l of [...ch.intro, ...ch.outro, ...ch.tasks.flatMap((t) => t.after)]) {
      if (l.speaker) speakers.add(l.speaker);
      if (l.other) speakers.add(l.other.speaker);
    }
  }
  const missing = [...speakers].map((s) => portraitSrc(s)).filter((src) => !existsSync(file(src)));
  for (const s of SHOPS_11) if (!existsSync(join(PUB, 'assets', 'story', 'iso', `mini_${s.owner}.png`))) missing.push(`mini_${s.owner}`);
  assert.deepEqual(missing, []);
});

test('11〜20章の型紙の家具は、置き方のデータ（box-meta）があり、角度テストに合格している', () => {
  const meta = JSON.parse(readFileSync(join(PUB, 'assets', 'story', 'iso', 'box-meta.json'), 'utf-8')) as Record<string, unknown>;
  const keep = new Set(JSON.parse(readFileSync(join(PUB, '..', '..', '..', 'tools', 'assets', 'angle_keep.json'), 'utf-8')) as string[]);
  const spec = JSON.parse(readFileSync(join(PUB, '..', '..', '..', 'tools', 'assets', 'r5_spec.json'), 'utf-8')) as { sheets: Record<string, [string][]>; plates: Record<string, [string][]> };
  const names = [...Object.entries(spec.sheets), ...Object.entries(spec.plates)].filter(([n]) => n.startsWith('r21-')).flatMap(([, items]) => items.map((it) => it[0]));
  // 床板の型紙で作り直した物は、箱の型紙の物と同じ名前のことがある（どちらかが合格していればよい）
  const bad = [...new Set(names)].filter((n) => !meta[n] || !keep.has(n));
  assert.deepEqual(bad, []);
});

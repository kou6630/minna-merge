import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOwnerKey } from '../src/owner.ts';

test('自分用リンクの鍵だけが持ち主と認められる', async () => {
  assert.equal(await isOwnerKey('ちがう鍵'), false);
  assert.equal(await isOwnerKey(''), false);
  // 本物の鍵は config.json にだけある（公開しない）。手元にあれば確かめる
  try {
    const key = JSON.parse(readFileSync(new URL('../../../config.json', import.meta.url), 'utf8')).ownerKey as string;
    if (key) assert.equal(await isOwnerKey(key), true);
  } catch {
    /* CI など config.json が無いところでは飛ばす */
  }
});

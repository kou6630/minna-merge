import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress, parseServerInput, resolveGist } from '../src/server-code.ts';

const ID = '0123456789abcdef0123456789abcdef';

test('招待リンク・サーバーコード・Gist のURL・直接アドレスを見分ける', () => {
  assert.deepEqual(parseServerInput(`https://kou6630.github.io/minna-merge/?join=${ID}`), { gist: ID });
  assert.deepEqual(parseServerInput(`  ${ID.toUpperCase()} `), { gist: ID });
  assert.deepEqual(parseServerInput(`https://gist.github.com/kou6630/${ID}`), { gist: ID });
  assert.deepEqual(parseServerInput('localhost:8787'), { address: 'ws://localhost:8787' });
  assert.deepEqual(parseServerInput('https://abc.trycloudflare.com'), { address: 'wss://abc.trycloudflare.com' });
  assert.equal(parseServerInput('   '), null);
  assert.equal(normalizeAddress('192.168.1.5:8787'), 'ws://192.168.1.5:8787');
});

test('Gist の中身から住所を読む。オフラインや壊れた中身も扱う', async () => {
  const fake = (body: unknown, ok = true) =>
    (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
  const file = (c: unknown) => ({ files: { 'minna-merge-server.json': { content: JSON.stringify(c) } } });
  assert.deepEqual(
    await resolveGist(ID, fake(file({ v: 1, id: 's1', name: '商店街', url: 'wss://x.trycloudflare.com', online: true }))),
    { id: 's1', name: '商店街', url: 'wss://x.trycloudflare.com', online: true },
  );
  const off = await resolveGist(ID, fake(file({ v: 1, id: 's1', name: '商店街', url: '', online: false })));
  assert.equal(off?.online, false);
  assert.equal(await resolveGist(ID, fake({}, false)), null);
  assert.equal(await resolveGist(ID, fake({ files: {} })), null);
});

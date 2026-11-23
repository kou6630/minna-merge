import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTunnelUrl, toWs } from '../src/publish.ts';

test('cloudflared の出力からトンネルのURLを取り出す', () => {
  const out = `2026-11-24T01:00:00Z INF +--------------------------------------------------------------------------------------------+
2026-11-24T01:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-11-24T01:00:00Z INF |  https://mild-river-cats-example.trycloudflare.com                                          |`;
  assert.equal(findTunnelUrl(out), 'https://mild-river-cats-example.trycloudflare.com');
  assert.equal(findTunnelUrl('INF Starting tunnel'), null);
  assert.equal(toWs('https://a-b.trycloudflare.com'), 'wss://a-b.trycloudflare.com');
});

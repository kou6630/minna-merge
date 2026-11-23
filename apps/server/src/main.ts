// サーバーの起動: node apps/server/src/main.ts [--tunnel]
//   --tunnel: cloudflared の一時トンネルで外から入れるようにし、住所を GitHub Gist に書く
import { join, dirname, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig } from './config.ts';
import { ghReady, startTunnel, toWs, writeGist } from './publish.ts';
import type { GistContent, Tunnel } from './publish.ts';
import { Room } from './room.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// MINNA_HOME を指定すると、設定とセーブをそこに置く（試験用）
const HOME = process.env.MINNA_HOME ? resolve(ROOT, process.env.MINNA_HOME) : ROOT;
const CONFIG = join(HOME, 'config.json');
const CLOUDFLARED = join(ROOT, 'tools', 'bin', 'cloudflared.exe');
const useTunnel = process.argv.includes('--tunnel');

mkdirSync(HOME, { recursive: true });
const cfg = await loadConfig(CONFIG);
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);
const room = new Room(cfg, join(HOME, 'save', 'world.json'), log);
const port = await room.start();

console.log('');
console.log(`  みんなでマージ サーバー「${cfg.serverName}」を起動しました`);
console.log(`  このPCから:   localhost:${port}`);
console.log(`  合言葉:       ${cfg.password}`);
console.log('  止めるときは、この画面で Ctrl+C を押すか、画面を閉じてください');
console.log('');

let tunnel: Tunnel | null = null;
let gistOk = false;
let stopping = false;

const gistContent = (url: string, online: boolean): GistContent => ({
  v: 1,
  id: cfg.serverId,
  name: cfg.serverName,
  url,
  online,
  updated: new Date().toISOString(),
});

async function openTunnel(): Promise<void> {
  if (!existsSync(CLOUDFLARED)) {
    console.log(`  外から入れるようにするには ${CLOUDFLARED} が必要です（README を見てください）`);
    return;
  }
  try {
    tunnel = await startTunnel(CLOUDFLARED, port, (code) => {
      if (stopping) return;
      log(`トンネルが止まりました（${code}）。5秒後につなぎ直します`);
      tunnel = null;
      setTimeout(() => void openTunnel(), 5000);
    });
  } catch (e) {
    log(`トンネルを開けませんでした: ${(e as Error).message}。10秒後にもう一度試します`);
    setTimeout(() => void openTunnel(), 10_000);
    return;
  }
  const ws = toWs(tunnel.url);
  console.log(`  外からの直接アドレス: ${ws}`);
  if (gistOk) {
    try {
      const id = await writeGist(cfg.gistId, gistContent(ws, true));
      if (id !== cfg.gistId) {
        cfg.gistId = id;
        saveConfig(CONFIG, cfg);
      }
      console.log('');
      console.log('  ★ 友達にはこの招待リンクを送ってください（ずっと同じです）');
      console.log(`     ${cfg.pagesUrl}?join=${id}`);
      console.log(`     サーバーコード: ${id}`);
      console.log('');
    } catch (e) {
      log(`Gist に書けませんでした: ${(e as Error).message}。直接アドレスを友達に送ってください`);
    }
  }
}

if (useTunnel) {
  gistOk = await ghReady();
  if (!gistOk) console.log('  GitHub CLI にログインしていないので、招待リンクは作りません。直接アドレスを送ってください');
  await openTunnel();
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('保存して止めています…');
  await room.stop();
  if (tunnel && gistOk && cfg.gistId) {
    // 「オフライン」にしておく（待ちすぎない）
    await Promise.race([
      writeGist(cfg.gistId, gistContent('', false)).catch(() => {}),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
  }
  tunnel?.proc.kill();
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(sig, () => void shutdown());

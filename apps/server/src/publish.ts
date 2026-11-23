// 外から入れるようにする: cloudflared の一時トンネルを開き、その回の住所を GitHub Gist に書く。
import { spawn, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export const GIST_FILE = 'minna-merge-server.json';

/** Gist に書く中身（ゲーム画面はこれを読んでつなぐ） */
export type GistContent = {
  v: 1;
  id: string;
  name: string;
  url: string;
  online: boolean;
  updated: string;
};

/** cloudflared の出力から一時トンネルのURLを取り出す */
export function findTunnelUrl(text: string): string | null {
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  return m ? m[0] : null;
}

export function toWs(httpsUrl: string): string {
  return httpsUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

export type Tunnel = { url: string; proc: ChildProcess };

/** 一時トンネルを開く。URL が出るまで待つ */
export function startTunnel(bin: string, port: number, onExit: (code: number | null) => void): Promise<Tunnel> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let done = false;
    let buf = '';
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      proc.kill();
      reject(new Error('トンネルのURLが30秒たっても出ませんでした'));
    }, 30_000);
    const onData = (d: Buffer) => {
      if (done) return;
      buf += d.toString();
      const url = findTunnelUrl(buf);
      if (url) {
        done = true;
        clearTimeout(timer);
        resolve({ url, proc });
      }
      if (buf.length > 100_000) buf = buf.slice(-10_000);
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
    proc.on('exit', (code) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(new Error(`cloudflared が止まりました（${code}）`));
        return;
      }
      onExit(code);
    });
  });
}

function gh(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = execFile('gh', args, { windowsHide: true, maxBuffer: 1024 * 1024, timeout: 20_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve(stdout);
    });
    if (input !== undefined) {
      p.stdin?.end(input);
    }
  });
}

/** GitHub CLI が使えてログイン済みか */
export async function ghReady(): Promise<boolean> {
  try {
    await gh(['auth', 'status']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gist に今の住所を書く。gistId が無い・消されていたら新しく作る（公開一覧には出ない「シークレット」Gist）。
 * 戻り値は Gist の ID。
 */
export async function writeGist(gistId: string | undefined, content: GistContent): Promise<string> {
  const files = { [GIST_FILE]: { content: JSON.stringify(content, null, 2) } };
  if (gistId) {
    try {
      await gh(['api', '--method', 'PATCH', `/gists/${gistId}`, '--input', '-'], JSON.stringify({ files }));
      return gistId;
    } catch (e) {
      if (!/404|Not Found/i.test(String(e))) throw e;
    }
  }
  const out = await gh(
    ['api', '--method', 'POST', '/gists', '--input', '-'],
    JSON.stringify({ description: 'みんなでマージ サーバーの住所（自動で更新）', public: false, files }),
  );
  return (JSON.parse(out) as { id: string }).id;
}

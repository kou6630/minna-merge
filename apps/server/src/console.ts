// 黒い画面まわりの小さな道具
import { spawn } from 'node:child_process';

/**
 * Ctrl+C を1回押しただけでは止めない。windowMs 以内にもう一度押したら止める。
 * 戻り値の関数は、押されるたびに 'warn'（まだ止めない）か 'stop'（止める）を返す。
 */
export function makeInterruptGuard(windowMs: number, now: () => number = Date.now) {
  let last = -Infinity;
  return (): 'warn' | 'stop' => {
    const t = now();
    if (t - last <= windowMs) return 'stop';
    last = t;
    return 'warn';
  };
}

/** クリップボードに文字を入れる（Windows だけ。失敗しても何もしない） */
export function copyToClipboard(text: string): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const p = spawn('clip', [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
      p.on('error', () => resolve(false));
      p.on('exit', (code) => resolve(code === 0));
      p.stdin.end(text);
    } catch {
      resolve(false);
    }
  });
}

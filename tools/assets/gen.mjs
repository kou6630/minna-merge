// Codex CLI（GPT-6-Luna / 推論 max）で素材画像を作る。
// 使い方: node tools/assets/gen.mjs [名前...]   名前を省くと、まだ無いものを全部作る。
//   --force を付けると、既にあるものも作り直す。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOBS } from './jobs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'assets-src', 'raw');
const MODEL = 'gpt-6-luna';
const EFFORT = 'max';
const PARALLEL = 3;

function findCodex() {
  const base = join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin');
  const found = readdirSync(base)
    .map((d) => join(base, d, 'codex.exe'))
    .filter((p) => existsSync(p))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!found.length) throw new Error(`codex.exe が見つかりません: ${base}`);
  return found[0];
}

function runOne(codex, name, prompt) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    for (const k of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'CODEX_HOME']) delete env[k];
    const args = ['-m', MODEL, '-c', `model_reasoning_effort=${EFFORT}`, '-a', 'never', 'exec',
      '--sandbox', 'read-only', '--ignore-user-config', '--skip-git-repo-check', '--', prompt];
    const p = spawn(codex, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => {
      const sid = out.match(/session id:\s*(\S+)/)?.[1];
      const dir = sid && join(homedir(), '.codex', 'generated_images', sid);
      const pngs = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : [];
      if (!pngs.length) {
        console.log(`✗ ${name}（code ${code}）画像なし\n${out.slice(-600)}`);
        return resolve(false);
      }
      const latest = pngs.map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
      copyFileSync(latest, join(RAW, `${name}.png`));
      console.log(`✓ ${name}`);
      resolve(true);
    });
  });
}

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const names = argv.filter((a) => !a.startsWith('--'));
const todo = (names.length ? names : Object.keys(JOBS)).filter((n) => {
  if (!JOBS[n]) throw new Error(`知らない名前: ${n}`);
  return force || !existsSync(join(RAW, `${n}.png`));
});

mkdirSync(RAW, { recursive: true });
const codex = findCodex();
console.log(`${todo.length}件を作ります（${MODEL} / ${EFFORT}、同時${PARALLEL}件）`);
let ok = 0;
const queue = [...todo];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (queue.length) {
      const n = queue.shift();
      if (await runOne(codex, n, JOBS[n])) ok++;
    }
  }),
);
console.log(`完了: ${ok}/${todo.length}`);

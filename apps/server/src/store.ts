// save/world.json の読み書き。書くときは一時ファイル → 置き換えで、途中で落ちても壊れない。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorldJson } from '@minna/shared';

export type Account = {
  playerId: string;
  name: string;
  /** 参加証のハッシュ（端末ごとに1つ） */
  tokenHashes: string[];
};

export type SaveData = { v: 1; world: WorldJson; accounts: Account[] };

export function readSave(path: string): SaveData | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as SaveData;
}

export function writeSave(path: string, data: SaveData) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), 'utf8');
  renameSync(tmp, path);
}

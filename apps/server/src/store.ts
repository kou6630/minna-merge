// save/world.json の読み書き。書くときは一時ファイル → 置き換えで、途中で落ちても壊れない。
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommonsJson, WorldJson } from '@minna/shared';

export type Account = {
  playerId: string;
  name: string;
  /** 参加証のハッシュ（端末ごとに1つ） */
  tokenHashes: string[];
};

/** v2: 1人1枚の盤面（プレイヤー id → 盤面）と、みんなのシャッター（commons）。v1（みんなで1枚）は読まない */
export type SaveData = { v: 2; worlds: Record<string, WorldJson>; commons?: CommonsJson; accounts: Account[] } | { v: 1; world: WorldJson; accounts: Account[] };

/**
 * セーブを読む。こわれていたら、書きかけの一時ファイル（.tmp）を試す。
 * どちらも読めなければ、こわれたファイルは別の名前で残して、新しく始める（上書きで消さない）
 */
export function readSave(path: string, log: (m: string) => void = console.log): SaveData | null {
  const tryRead = (p: string): SaveData | null => {
    if (!existsSync(p)) return null;
    try {
      const d = JSON.parse(readFileSync(p, 'utf8')) as SaveData;
      return d && typeof d === 'object' && 'accounts' in d ? d : null;
    } catch {
      return null;
    }
  };
  const main = tryRead(path);
  if (main) return main;
  const tmp = tryRead(`${path}.tmp`);
  if (tmp) {
    log('セーブがこわれていたので、直前に書きかけていた分から読みました');
    return tmp;
  }
  if (existsSync(path)) {
    const keep = `${path}.broken-${Date.now()}`;
    try {
      renameSync(path, keep);
      log(`セーブが読めませんでした。こわれたファイルは ${keep} に残して、新しく始めます`);
    } catch {
      log('セーブが読めませんでした。新しく始めます');
    }
  }
  return null;
}

export function writeSave(path: string, data: SaveData) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), 'utf8');
  try {
    renameSync(tmp, path);
  } catch {
    // Windows で置き換えられないとき（ウイルス対策ソフトなどが開いている）: 中身を写してから一時ファイルを消す
    copyFileSync(tmp, path);
    try {
      unlinkSync(tmp);
    } catch {
      /* 次の保存で上書きされる */
    }
  }
}

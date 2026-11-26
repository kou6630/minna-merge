// サーバーとブラウザのあいだのメッセージ（WebSocket、JSON）
import type { Action, GameEvent, Op, Player, RejectReason, WorldJson } from './engine.ts';

/** 通信の形を変えたら上げる。合わないとつながらない */
export const PROTOCOL = 4;

export type C2S =
  | { t: 'hello'; protocol: number }
  | { t: 'join'; name: string; password: string }
  | { t: 'resume'; token: string }
  | { t: 'act'; s: number; a: Action }
  | { t: 'keep'; item: number }
  /** カーソルの位置（マス単位）。d はドラッグ中のアイテム */
  | { t: 'cursor'; x: number; y: number; d?: number }
  | { t: 'resync' }
  | { t: 'ping'; at: number };

export type DeniedReason = 'protocol' | 'password' | 'token' | 'rate' | 'name' | 'bad';

export type ServerInfo = { id: string; name: string; online: number; protocol: number };

/** ほかの人のカーソル。gone はいなくなった */
/** g: 光っている（ぶつかるとスタミナがもらえる） */
export type CursorInfo = { p: string; x: number; y: number; d?: number; gone?: boolean; g?: 1 };

export type Batch = {
  t: 'batch';
  /** この差分を当てる前の版。手元の版と違えば取り直す */
  rev0: number;
  rev: number;
  ops: Op[];
  events: GameEvent[];
  players: Player[];
  /** 自分の操作のうち、確定したもの */
  acks: number[];
  rejects: { s: number; reason: RejectReason }[];
  /** 参加中のプレイヤー（変わったときだけ） */
  online?: string[];
  /** 動いたカーソル */
  cursors?: CursorInfo[];
};

export type S2C =
  | ({ t: 'server' } & ServerInfo)
  | { t: 'denied'; reason: DeniedReason; text: string }
  | { t: 'joined'; playerId: string; token?: string }
  | { t: 'welcome'; now: number; world: WorldJson; online: string[] }
  | Batch
  | { t: 'pong'; at: number; now: number };

export const DENIED_TEXT: Record<DeniedReason, string> = {
  protocol: 'サーバーとゲームの版が合いません。サーバーを更新してください',
  password: '合言葉がちがいます',
  token: 'もう一度、名前と合言葉を入れてください',
  rate: '入力ミスが多すぎます。1分ほど待ってください',
  name: '名前は1〜12文字で入れてください',
  bad: 'うまく通信できませんでした',
};

const ACTIONS = new Set([
  'grab', 'drop', 'release', 'tap', 'sell', 'undoSell', 'openGift', 'buyEnergy', 'refillGen', 'takeReward', 'deliver', 'store', 'unstore', 'expand', 'contribute',
  'storyTask', 'storyStyle', 'storySeen',
]);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

/** 届いた操作の形を確かめる（おかしなものは null） */
export function parseAction(a: unknown): Action | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  if (typeof o.t !== 'string' || !ACTIONS.has(o.t)) return null;
  switch (o.t) {
    case 'grab':
    case 'release':
      return isInt(o.item) ? { t: o.t, item: o.item } : null;
    case 'sell':
      if (isInt(o.item) && o.slot === undefined) return { t: 'sell', item: o.item };
      if (isInt(o.slot) && o.item === undefined) return { t: 'sell', slot: o.slot };
      return null;
    case 'drop':
      return isInt(o.item) && isInt(o.cell) ? { t: 'drop', item: o.item, cell: o.cell } : null;
    case 'tap':
      return isInt(o.gen) ? { t: 'tap', gen: o.gen } : null;
    case 'openGift':
      return isInt(o.item) ? { t: 'openGift', item: o.item } : null;
    case 'buyEnergy':
      return { t: 'buyEnergy' };
    case 'undoSell':
      return { t: 'undoSell' };
    case 'refillGen':
      return isInt(o.gen) ? { t: 'refillGen', gen: o.gen } : null;
    case 'takeReward':
      return isInt(o.cell) ? { t: 'takeReward', cell: o.cell } : null;
    case 'store':
      return isInt(o.item) ? { t: 'store', item: o.item } : null;
    case 'unstore':
      return isInt(o.slot) && isInt(o.cell) ? { t: 'unstore', slot: o.slot, cell: o.cell } : null;
    case 'expand':
      return { t: 'expand' };
    case 'deliver':
    case 'contribute': {
      if (!isInt(o.order)) return null;
      if (isInt(o.item) && o.slot === undefined) return { t: o.t, order: o.order, item: o.item };
      if (isInt(o.slot) && o.item === undefined) return { t: o.t, order: o.order, slot: o.slot };
      return null;
    }
    case 'storyTask':
      if (!isStr(o.taskId)) return null;
      if (o.choice !== undefined && !isInt(o.choice)) return null;
      return o.choice === undefined ? { t: 'storyTask', taskId: o.taskId } : { t: 'storyTask', taskId: o.taskId, choice: o.choice };
    case 'storyStyle':
      return isStr(o.taskId) && isInt(o.choice) ? { t: 'storyStyle', taskId: o.taskId, choice: o.choice } : null;
    case 'storySeen':
      return isInt(o.chapter) ? { t: 'storySeen', chapter: o.chapter } : null;
  }
  return null;
}

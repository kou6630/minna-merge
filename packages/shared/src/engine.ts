// 盤面のルール。DOM にも通信にも依存しない。
// P0 ではブラウザの中で、P1 からはサーバーで、同じコードを動かす。
import {
  CHAIN_BY_KEY, CUSTOMERS, ENERGY_MAX, LEVEL_UP_ENERGY, orderCoins, GEM_ENERGY_AMOUNT, GEM_ENERGY_COST, genRefillCost, GEN_WORK_TIER, ENERGY_REGEN_SEC, HOLD_MS, LEVEL_GRANTS, LEVEL_TIER_UP, MAX_LEVEL,
  OWNER_OF_CHAIN, orderCustomerCount, orderDoubleCount, SPAWN_RADIUS, WORLD_ORDER_BONUS, WORLD_ORDER_SLOTS, START_COINS, STORAGE_MAX, STORAGE_START, chainOfKind, isGeneratorKind, kindOf,
  GIFTS, secondItemChance, STORY_CLEAR_GIFTS, STORY_HALF_GIFTS, UNDO_SELL_MS, cappedClearXp, commonCount, isGiftKind, levelGiftTiers, maxTierOfKind, mergeXp, scrapCoins, sellCoins, storageCost, tierOfKind, xpToNext,
} from './defs.ts';
import { copyStory, defaultStory, findStoryTask, getChapter, halfEnergy, isChapterComplete, isChapterHalf } from './story.ts';
import type { StoryProgress } from './story.ts';

export const W = 100;
export const H = 100;
/** シャッター1枚の大きさ（マス） */
export const BLOCK = 5;
export const BLOCKS_X = W / BLOCK;
export const BLOCKS_Y = H / BLOCK;
/** 最初に開いている区画（左下の 5×5） */
export const START_BLOCK = (BLOCKS_Y - 1) * BLOCKS_X;
/**
 * 遊べる範囲: 左下の PLAY_BLOCKS×PLAY_BLOCKS 区画（50×50マス）。右と上は使わない。
 * マスの番号は 100×100 のままなので、前のセーブもそのまま読める
 */
export const PLAY_BLOCKS = 10;
/** 遊べる範囲のマスの数（1辺） */
export const PLAY_CELLS = PLAY_BLOCKS * BLOCK;
/** 遊べる範囲のいちばん上の行（マス） */
export const PLAY_Y0 = H - PLAY_CELLS;
export function blockInPlay(idx: number): boolean {
  const bx = idx % BLOCKS_X;
  const up = BLOCKS_Y - 1 - Math.floor(idx / BLOCKS_X);
  return bx < PLAY_BLOCKS && up < PLAY_BLOCKS && idx >= 0 && idx < BLOCKS_X * BLOCKS_Y;
}
/** 区画の数がもとの 400 から減った分、シャッターの難しさの上がり方を早める（4倍だと前と同じ。少しやさしく3倍） */
const SHUTTER_PACE = 3;

export type Item = {
  id: number;
  kind: number;
  cell: number;
  /** 発生器の持ち主 */
  owner?: string;
  /** 最終作成者（売れる人） */
  maker?: string;
  /** 半開きのダンボール（中のアイテムが見える）。動かせないが、同じアイテムを重ねると合成でき、そのマスが使えるようになる */
  dusty?: boolean;
  /** ふたの閉まったダンボール（中は見えない）。となりのマスが使えるようになると半開きになる */
  boxed?: boolean;
  /** 発生器のチャージ */
  charges?: number;
  chargesAt?: number;
  /** プレゼント箱をタップした回数 */
  taps?: number;
};

export type Player = {
  id: string;
  name: string;
  level: number;
  xp: number;
  energy: number;
  energyAt: number;
  coins: number;
  /** ジェム（チャプタークリア報酬など） */
  gems: number;
  /** 商店街復興ストーリーの進行 */
  story: StoryProgress;
  /** 注文（ウェーブ式: 全部納品すると、次の組がまとめて来る） */
  orders: Order[];
  nextOrderId: number;
  /** 並んだ注文を全部クリアした回数（人数と2個注文がふえる） */
  orderClears: number;
  /** 倉庫。入っているアイテムの kind（null は空き） */
  storage: (number | null)[];
  /** 倉庫の同じ枠の物の状態（プレゼント箱の開封回数・発生器のチャージ）。出したときに元にもどす */
  storageMeta?: (StoredMeta | null)[];
  /** 受け取り枠: 報酬でもらったアイテム（もらった順）。タップで先頭から1個ずつ盤面に出す */
  inbox: number[];
  /** 一度でも盤面に出たことのあるアイテムの kind（図鑑で絵と名前が見える） */
  seen: number[];
  /** 直前にゴミ箱・コイン化したアイテム（少しの間だけ元に戻せる。盤面なら cell、倉庫なら slot） */
  lastSold?: { kind: number; cell?: number; slot?: number; coins: number; at: number };
};

export type OrderNeed = { kind: number; count: number; have: number };

/** 倉庫に入れた物の状態 */
export type StoredMeta = { taps?: number; charges?: number; chargesAt?: number };

export type Order = {
  id: number;
  /** お客さんの key（CUSTOMERS） */
  customer: string;
  needs: OrderNeed[];
  coins: number;
  xp: number;
};

export type Hold = { player: string; until: number };

export type World = {
  rev: number;
  nextId: number;
  items: Map<number, Item>;
  /** マス → item id（0は空き） */
  cells: Int32Array;
  holds: Map<number, Hold>;
  /** 区画（シャッター）: 1=開いている */
  blocks: Uint8Array;
  /** この盤面の持ち主（1人1枚の盤面）。ほかの人の情報は名前の表示用 */
  players: Map<string, Player>;
  /** シャッターの依頼（開いた所のとなりのシャッター1枚ずつ） */
  worldOrders: WorldOrder[];
  nextWorldOrderId: number;
  /**
   * みんなのシャッター（サーバー）。true のときは、数がそろってもこの盤面では開けない。
   * サーバーが参加している全員の盤面で同時に開ける（commons.ts）
   */
  shared?: boolean;
};

/** シャッターの依頼。お客さんの注文で同じアイテムを納品すると数が進み、そろうと block のシャッターが開く */
export type WorldOrder = {
  id: number;
  block: number;
  /** 店主の key（OWNERS） */
  owner: string;
  needs: OrderNeed[];
  /** 納品した人 → 個数 */
  contributors: Record<string, number>;
};

export type Op =
  | { t: 'spawn'; item: Item; from?: number }
  | { t: 'move'; id: number; cell: number }
  | { t: 'remove'; id: number }
  | { t: 'update'; item: Item }
  | { t: 'hold'; id: number; player: string }
  | { t: 'unhold'; id: number }
  | { t: 'block'; idx: number; open: boolean }
  | { t: 'worldOrder'; order: WorldOrder }
  | { t: 'worldOrderDone'; id: number };

export type GameEvent =
  | { t: 'merge'; player: string; id: number; kind: number; xp: number }
  | { t: 'levelup'; player: string; level: number; newChains: string[]; granted: string[]; energy: number; gifts?: number[] }
  /** ゴミ箱・コイン化した（coins 0 はゴミ箱）。少しの間 undoSell で元に戻せる */
  | { t: 'sold'; player: string; coins: number; kind: number }
  /** ゴミ箱・コイン化を元に戻した（盤面なら id、倉庫なら slot） */
  | { t: 'unsold'; player: string; id?: number; slot?: number; kind: number; coins: number }
  | { t: 'order'; player: string; customer: string; coins: number; xp: number }
  /** 並んだ注文を全部クリアした。newCustomer: 次から来る人 / moreDouble: 2個注文の人がふえた */
  | { t: 'ordersCleared'; player: string; clears: number; newCustomer?: string; moreDouble?: boolean }
  | { t: 'contrib'; player: string; coins: number; xp: number }
  /** みんなの依頼がそろって区画が開いた（全員に届く） */
  | { t: 'unlock'; block: number; owner: string; contributors: string[]; bonus: number }
  /** ストーリーのタスクを完了した */
  | { t: 'storyTask'; player: string; chapter: number; taskId: string; choice?: number }
  /** チャプタークリア報酬をもらった */
  | { t: 'chapterClear'; player: string; chapter: number; xp: number; energy: number; gems: number; part?: number; gift?: number }
  /** チャプターの 50% のプレゼントをもらった（スタミナ（中）と発生器の部品レベル1） */
  | { t: 'chapterHalf'; player: string; chapter: number; energy: number; part?: number; gift?: number }
  /** プレゼント箱をタップした（出た物は spawn で届く）。broke: 箱が消えた */
  | { t: 'giftTap'; player: string; id: number; kind: number; cell: number; taps: number; broke: boolean }
  /** 自分のカーソルが、クールダウンが明けてまた光った */
  | { t: 'glow'; player: string }
  /** 光っているカーソル同士で from の人とぶつかって、スタミナをもらった（2人ともに届く） */
  | { t: 'bump'; player: string; from: string; energy: number }
  /** 受け取り枠からアイテムを出した（id が盤面に出たアイテム） */
  | { t: 'rewardTaken'; player: string; id: number; kind: number; cell: number }
  /** ジェムを使った。what: energy = スタミナ回復 / gen = 発生器をすぐ満タン（gen はその発生器の id） */
  | { t: 'gemUse'; player: string; what: 'energy' | 'gen'; gems: number; energy?: number; gen?: number }
  /** みんなのシャッターに1個納品した（ほかの参加者にも届く）。have / count はそのあとの数 */
  | { t: 'shutterGive'; player: string; name: string; order: number; block: number; kind: number; have: number; count: number };

export type Action =
  | { t: 'grab'; item: number }
  | { t: 'drop'; item: number; cell: number }
  | { t: 'release'; item: number }
  | { t: 'tap'; gen: number }
  /** ゴミ箱・コイン化する。盤面のアイテム（item）か倉庫の枠（slot）のどちらか */
  | { t: 'sell'; item?: number; slot?: number }
  | { t: 'undoSell' }
  | { t: 'openGift'; item: number }
  /** ジェムでスタミナを回復する */
  | { t: 'buyEnergy' }
  /** ジェムで発生器をすぐ満タンにする */
  | { t: 'refillGen'; gen: number }
  /** 受け取り枠の先頭のアイテムを、cell に出す */
  | { t: 'takeReward'; cell: number }
  /** 注文に納品する。盤面のアイテム（item）か倉庫の枠（slot）のどちらか */
  | { t: 'deliver'; order: number; item?: number; slot?: number }
  | { t: 'store'; item: number }
  | { t: 'unstore'; slot: number; cell: number }
  | { t: 'expand' }
  /** みんなの依頼に納品する */
  | { t: 'contribute'; order: number; item?: number; slot?: number }
  /** ストーリーのタスクをコインで実行する */
  | { t: 'storyTask'; taskId: string; choice?: number }
  /** 設置済みストーリー装飾の見た目を変える */
  | { t: 'storyStyle'; taskId: string; choice: number }
  /** チャプターの導入会話を見た */
  | { t: 'storySeen'; chapter: number };

export type RejectReason =
  | 'no-item' | 'held' | 'not-yours' | 'locked' | 'dusty' | 'energy' | 'no-charge'
  | 'no-space' | 'not-generator' | 'cannot-sell' | 'no-player' | 'nothing'
  | 'no-order' | 'not-needed' | 'storage-full' | 'empty-slot' | 'coins' | 'max-storage' | 'occupied'
  | 'no-task' | 'task-done' | 'task-locked' | 'bad-choice' | 'boxed' | 'parts' | 'not-gift' | 'gems' | 'full' | 'empty-inbox' | 'no-undo' | 'not-empty' | 'last-part';

export const REJECT_TEXT: Record<RejectReason, string> = {
  'no-item': 'アイテムが見つかりません',
  held: 'ほかの人が持っています',
  'not-yours': 'ほかの人の発生器です',
  locked: 'まだ開いていない区画です',
  dusty: '半開きのダンボールは動かせません。同じアイテムを重ねると取り出せます',
  boxed: 'ふたの閉まったダンボールです。となりのマスを使えるようにすると開きます',
  energy: 'スタミナが足りません。ジェムで回復できます',
  'no-charge': '発生器が休んでいます。ジェムですぐ満タンにできます',
  gems: 'ジェムが足りません。ストーリーをクリアするともらえます',
  full: 'もう満タンです',
  'empty-inbox': '受け取るアイテムがありません',
  'no-undo': 'もう元に戻せません',
  'not-empty': '発生器を使い切ったら、ジェムですぐ満タンにできます',
  'no-space': 'まわりに空きマスがありません',
  'not-generator': '発生器ではありません',
  parts: 'まだ部品です。同じ部品を合成して組み立てると動きだします',
  'not-gift': 'プレゼント箱ではありません',
  'cannot-sell': '発生器・プレゼント箱・ダンボールの中の物は消せません（部品は、同じ種類の動く発生器があるときだけ消せます）',
  'last-part': 'この発生器の最後の部品なので消せません',
  'no-player': 'プレイヤーが見つかりません',
  nothing: 'まだ何も出せません',
  'no-order': 'その注文はもうありません',
  'not-needed': 'その注文には使えません',
  'storage-full': '倉庫がいっぱいです',
  'empty-slot': 'その枠は空です',
  coins: 'コインが足りません',
  'max-storage': '倉庫はこれ以上広げられません',
  occupied: 'そこには置けません',
  'no-task': 'そのストーリータスクは見つかりません',
  'task-done': 'もう完了しているタスクです',
  'task-locked': '前のタスクを先に終わらせてください',
  'bad-choice': '選べないデザインです',
};

export type Result =
  | { ok: true; ops: Op[]; events: GameEvent[]; changedPlayers: string[] }
  | { ok: false; reason: RejectReason; ops: Op[] };

// ---------- 乱数 ----------

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 座標 ----------

export const cellX = (cell: number) => cell % W;
export const cellY = (cell: number) => Math.floor(cell / W);
export const cellAt = (x: number, y: number) => y * W + x;
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
export const blockOf = (cell: number) =>
  Math.floor(cellY(cell) / BLOCK) * BLOCKS_X + Math.floor(cellX(cell) / BLOCK);

export function isOpenCell(world: World, cell: number): boolean {
  return cell >= 0 && cell < W * H && world.blocks[blockOf(cell)] === 1;
}

// ---------- 作る・読む・書く ----------

export function emptyWorld(): World {
  return {
    rev: 0,
    nextId: 1,
    items: new Map(),
    cells: new Int32Array(W * H),
    holds: new Map(),
    blocks: new Uint8Array(BLOCKS_X * BLOCKS_Y),
    players: new Map(),
    worldOrders: [],
    nextWorldOrderId: 1,
  };
}

/** 新しい盤面（1人分）。左下の 5×5 だけ開け、となりのシャッターに依頼を付ける */
export function createWorld(rng: Rng): World {
  const w = emptyWorld();
  openBlock(w, START_BLOCK, rng);
  ensureWorldOrders(w, rng);
  return w;
}

/** 最初から使えるマス（左下の 2×2） */
export const isStartCell = (cell: number) => cellX(cell) < 2 && cellY(cell) >= H - 2;
/** 最初に半開きのダンボール（2×2 の右どなり） */
export const FIRST_HALF_OPEN = cellAt(2, H - 1);

/** そのマスが使えるか（開いた区画で、ダンボールがないマス） */
export function isUsableCell(world: World, cell: number): boolean {
  if (!isOpenCell(world, cell)) return false;
  const id = world.cells[cell];
  const it = id ? world.items.get(id) : undefined;
  return !it || (!it.boxed && !it.dusty);
}

const neighbors4 = (cell: number): number[] => {
  const x = cellX(cell); const y = cellY(cell);
  return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => inBounds(a!, b!)).map(([a, b]) => cellAt(a!, b!));
};

/** マスが使えるようになったとき: 上下左右の、ふたの閉まったダンボールを半開きにする */
function openNeighborBoxes(world: World, cell: number, ops: Op[]) {
  for (const n of neighbors4(cell)) {
    if (!isOpenCell(world, n)) continue;
    const id = world.cells[n];
    const it = id ? world.items.get(id) : undefined;
    if (!it || !it.boxed) continue;
    delete it.boxed;
    // 最高段階は重ねて取り出せないので、半開きにせず取り出し、そのとなりの箱も半開きにする
    if (tierOfKind(it.kind) < maxTierOfKind(it.kind)) it.dusty = true;
    ops.push({ t: 'update', item: { ...it } });
    if (!it.dusty) openNeighborBoxes(world, n, ops);
  }
}

/** 区画が、左下（最初の区画）から右上へどれだけ外側か。0（左下）〜 1（右上の角） */
export function blockOuterness(idx: number): number {
  const x = idx % BLOCKS_X;
  const y = BLOCKS_Y - 1 - Math.floor(idx / BLOCKS_X);
  return Math.min(1, Math.hypot(x, y) / Math.hypot(PLAY_BLOCKS - 1, PLAY_BLOCKS - 1));
}

/**
 * 区画の n 個のダンボールの中身。同じ区画の中は全部ちがう物（足りないときだけ同じ物が出る）。
 * 右上（外側）の区画ほど、高い段階の物が入る。低い段階から順に並べて返す（近いマスほど簡単な物にするため）。
 */
function boxContents(world: World, idx: number, n: number, rng: Rng): number[] {
  // 最初の区画と、最初のシャッターの区画は、パンだけ（パン窯だけで取り出せるように）。近い箱ほど低い段階
  if (openCount(world) <= EARLY_BREAD_BLOCKS) return earlyBread(n);
  const lv = worldLevel(world);
  const now = new Set(unlockedChains(lv));
  // 次の3つの発生器で出る物も、遠くの箱に入れる（発生器のもらえるレベルは間が空いているので、レベルではなく発生器の数で見る。
  // 2種類目（ピザなど）は入れないので、3つ先まで見ないと1区画25個が全部ちがう物にならない）
  const nextLv = Object.keys(LEVEL_GRANTS).map(Number).filter((l) => l > lv).sort((a, b) => a - b)[2] ?? MAX_LEVEL;
  const soon = unlockedChains(nextLv).filter((c) => !now.has(c));
  // ねらう段階: 左下は 1、右上の角は 7（外側ほど高い）
  const target = 1 + blockOuterness(idx) * 6;
  const scored: { k: number; r: number; e: number }[] = [];
  for (const c of [...now, ...soon]) {
    const max = maxTierOfKind(kindOf(c, 1));
    const later = now.has(c) ? 0 : 1;
    for (let t = 1; t <= max; t++) {
      const jitter = rng() * 0.9;
      // r: 選ぶ順（ねらう段階に近い・今作れる物ほど先）。e: 箱に置く順（低い段階ほど手前）
      // まだ作れない系統の物は、遠くの箱に置く（取り出すには同じ物が要るので、近くは今作れる物だけ）
      scored.push({ k: kindOf(c, t), r: Math.abs(t - target) + later * 1.5 + jitter, e: t + later * 5 + jitter });
    }
  }
  const sorted = scored.sort((a, b) => a.r - b.r);
  const out = sorted.slice(0, n);
  while (out.length < n) out.push(sorted[out.length % Math.max(1, sorted.length)] ?? { k: kindOf('bread', 1), r: 0, e: 0 });
  const kinds = out.sort((a, b) => a.e - b.e).map((x) => x.k);
  // もらった発生器の 1 段目の部品を、いちばん遠い箱に1つ（2つ目の発生器を作ったり、育てたりする用）
  const gens = ownedGeneratorKeys(lv);
  if (n >= 10 && gens.length && rng() < 0.7) kinds[n - 1] = kindOf(gens[Math.floor(rng() * gens.length)]!, 1);
  return kinds;
}

/** 最初の区画と、最初のシャッターの区画（開いた数がここまでのとき）は、箱の中身をパンだけにする */
const EARLY_BREAD_BLOCKS = 2;

/** パンだけの箱の中身: 段階1〜4 を、近い箱ほど低くなるように */
function earlyBread(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(kindOf('bread', 1 + Math.floor((i * 4) / Math.max(1, n))));
  return out;
}

/** そのレベルまでにもらえる発生器 */
export function ownedGeneratorKeys(level: number): string[] {
  return Object.entries(LEVEL_GRANTS).filter(([l]) => Number(l) <= level).flatMap(([, keys]) => keys);
}

/**
 * 発生器を消してよいか。動く発生器は消せない。部品は、同じ種類の動く発生器を持っているときだけ消せる
 * （持っていないのに消すと、うっかり発生器をなくすので。持っていれば、増えすぎた部品で盤面が埋まらないように）
 */
export function canTrashGenPart(world: World, playerId: string, kind: number): boolean {
  if (!isGeneratorKind(kind)) return true;
  if (tierOfKind(kind) >= GEN_WORK_TIER) return false;
  const p = world.players.get(playerId);
  if (!p) return false;
  const key = chainOfKind(kind).key;
  const working = (k: number | null | undefined) =>
    k !== null && k !== undefined && isGeneratorKind(k) && chainOfKind(k).key === key && tierOfKind(k) >= GEN_WORK_TIER;
  for (const it of world.items.values()) if (it.owner === p.id && working(it.kind)) return true;
  return p.storage.some(working) || (p.inbox ?? []).some(working);
}

/** 発生器の部品を消すと、その発生器を動く段階まで育てられなくなるか（レベルでもらった発生器だけ。なくすと、注文の品が二度と作れなくなる）。
 *  残りの部品を全部重ねても動く段階に届かない（段階1=1・段階2=2 として合計が 2^(動く段階-1) 未満）なら、消せない */
export function isLastGenPart(world: World, p: Player, kind: number, skip: { id?: number; slot?: number }): boolean {
  if (!isGeneratorKind(kind) || tierOfKind(kind) >= GEN_WORK_TIER) return false;
  const key = chainOfKind(kind).key;
  if (!ownedGeneratorKeys(p.level).includes(key)) return false;
  let value = 0;
  // 同じ発生器の物なら数える。動く発生器があれば true（もう大丈夫）
  const add = (k: number | null | undefined): boolean => {
    if (k === null || k === undefined || !isGeneratorKind(k) || chainOfKind(k).key !== key) return false;
    if (tierOfKind(k) >= GEN_WORK_TIER) return true;
    value += 2 ** (tierOfKind(k) - 1);
    return false;
  };
  for (const it of world.items.values()) if (it.id !== skip.id && it.owner === p.id && add(it.kind)) return false;
  for (let i = 0; i < p.storage.length; i++) if (i !== skip.slot && add(p.storage[i])) return false;
  for (const k of p.inbox ?? []) if (add(k)) return false;
  return value < 2 ** (GEN_WORK_TIER - 1);
}

/** 区画（シャッター）を開け、マスを1つずつダンボールで埋める。使えるマスのとなりは半開き */
export function openBlock(world: World, idx: number, rng: Rng): Op[] {
  if (world.blocks[idx] === 1) return [];
  world.blocks[idx] = 1;
  const ops: Op[] = [{ t: 'block', idx, open: true }];
  const bx = (idx % BLOCKS_X) * BLOCK;
  const by = Math.floor(idx / BLOCKS_X) * BLOCK;
  const cells: number[] = [];
  for (let y = by; y < by + BLOCK; y++) {
    for (let x = bx; x < bx + BLOCK; x++) {
      const cell = cellAt(x, y);
      if (world.cells[cell] || isStartCell(cell)) continue;
      cells.push(cell);
    }
  }
  // 使えるマスに近いダンボールほど、低い段階の物（最初の区画は 2×2 から、ほかの区画は開いている所から）
  const usable: number[] = [];
  if (idx === START_BLOCK) for (const c of cells.concat([cellAt(0, H - 1), cellAt(1, H - 1), cellAt(0, H - 2), cellAt(1, H - 2)])) { if (isStartCell(c)) usable.push(c); }
  else for (const it of world.items.values()) if (!it.boxed && !it.dusty) usable.push(it.cell);
  const distTo = (c: number) => {
    if (!usable.length) return 0;
    let d = Infinity;
    for (const u of usable) d = Math.min(d, Math.abs(cellX(u) - cellX(c)) + Math.abs(cellY(u) - cellY(c)));
    return d;
  };
  // 開いた区画のとなりの使えるマス（空きマスも含む）からの距離も見る
  const nearOpen = (c: number) => Math.min(distTo(c), ...neighbors4(c).filter((n) => cellBlock(n) !== idx && isUsableCell(world, n)).map(() => 1));
  cells.sort((a, b) => nearOpen(a) - nearOpen(b) || rng() - 0.5);
  const kinds = boxContents(world, idx, cells.length, rng);
  const placed: Item[] = [];
  cells.forEach((cell, i) => {
    const item: Item = { id: world.nextId++, kind: kinds[i]!, cell, boxed: true };
    putItem(world, item);
    placed.push(item);
  });
  // 最初の区画: 2×2 の右どなりだけ半開き（中身はいちばん下のパン）。ほかの区画: すでに使えるマスに面したところが半開き
  for (const it of placed) {
    const half = idx === START_BLOCK
      ? it.cell === FIRST_HALF_OPEN
      : neighbors4(it.cell).some((n) => cellBlock(n) !== idx && isUsableCell(world, n));
    if (half) {
      delete it.boxed;
      if (tierOfKind(it.kind) < maxTierOfKind(it.kind)) it.dusty = true;
      // 最初の半開きは、いちばん下のパン（中身はほかの箱と入れかえて、全部ちがう物のままにする）
      const first = kindOf('bread', 1);
      if (idx === START_BLOCK && it.kind !== first) {
        const other = placed.find((x) => x.kind === first);
        if (other) other.kind = it.kind;
        it.kind = first;
      }
    }
  }
  for (const it of placed) ops.push({ t: 'spawn', item: { ...it } });
  // 最高段階で半開きにしなかった物は、取り出した物と同じに、となりの箱を半開きにする（置いた知らせのあとに）
  for (const it of placed) if (!it.boxed && !it.dusty && tierOfKind(it.kind) >= maxTierOfKind(it.kind)) openNeighborBoxes(world, it.cell, ops);
  world.rev++;
  return ops;
}

const cellBlock = (cell: number) => blockOf(cell);

export type WorldJson = {
  /** 2: 1人1枚・マスごとのダンボール / 3: 1つの系列は1つの発生器から / 4: 発生器の 1〜2 段目が部品 */
  v: 1 | 2 | 3 | 4;
  rev: number;
  nextId: number;
  items: Item[];
  blocks: number[];
  players: Player[];
  worldOrders?: WorldOrder[];
  nextWorldOrderId?: number;
};

export function toJson(world: World): WorldJson {
  return {
    v: 4,
    rev: world.rev,
    nextId: world.nextId,
    items: [...world.items.values()],
    blocks: [...world.blocks],
    players: [...world.players.values()],
    worldOrders: world.worldOrders,
    nextWorldOrderId: world.nextWorldOrderId,
  };
}

/**
 * まだ最初のシャッターまでしか開いていない盤面: 取り出していない箱（ふた付き・半開き）の中身を、
 * 同じ段階（1〜4）のパンにする（パン窯だけで取り出せるように）
 */
function breadEarlyBoxes(w: World) {
  if (openCount(w) > EARLY_BREAD_BLOCKS) return;
  for (const it of w.items.values()) {
    if (!(it.boxed || it.dusty) || isGeneratorKind(it.kind) || isGiftKind(it.kind)) continue;
    if (chainOfKind(it.kind).key === 'bread' && tierOfKind(it.kind) <= 4) continue;
    it.kind = kindOf('bread', Math.min(4, Math.max(1, tierOfKind(it.kind))));
  }
}

/**
 * まだ取り出していない箱（ふた付き・半開き）の中の、育てた発生器でしか出ない物（ピザなど）を、
 * 同じ段階の作れる物に入れ替える（取り出すには同じ物を重ねるので、作れないと区画を広げられない）。
 * 同じ区画の箱と、なるべく同じ物にならないようにする
 */
function swapGrownBoxes(w: World) {
  const grown = new Set<string>();
  for (const c of CHAIN_BY_KEY.values()) for (const r of c.gen?.produces ?? []) if (r.minTier) grown.add(r.chain);
  const chains = unlockedChains(Math.max(1, worldLevel(w)));
  const blockOf = (cell: number) => Math.floor(cellY(cell) / BLOCK) * BLOCKS_X + Math.floor(cellX(cell) / BLOCK);
  const used = new Map<number, Set<number>>();
  const usedIn = (b: number) => {
    let s = used.get(b);
    if (!s) used.set(b, (s = new Set()));
    return s;
  };
  for (const it of w.items.values()) if (it.boxed || it.dusty) usedIn(blockOf(it.cell)).add(it.kind);
  for (const it of w.items.values()) {
    if (!(it.boxed || it.dusty) || isGeneratorKind(it.kind) || isGiftKind(it.kind)) continue;
    if (!grown.has(chainOfKind(it.kind).key)) continue;
    const u = usedIn(blockOf(it.cell));
    const t = tierOfKind(it.kind);
    // 最高段階にすると半開きのまま取り出せなくなるので、1つ下まで
    const cand = chains.map((c) => kindOf(c, Math.max(1, Math.min(t, maxTierOfKind(kindOf(c, 1)) - 1))));
    const free = cand.filter((k) => !u.has(k));
    const list = free.length ? free : cand;
    if (!list.length) continue;
    const k = list[it.id % list.length]!;
    u.add(k);
    it.kind = k;
  }
}

export function fromJson(j: WorldJson): World {
  const w = emptyWorld();
  w.rev = j.rev;
  w.nextId = j.nextId;
  w.blocks.set(j.blocks);
  // 最高段階の半開き（重ねて取り出せず、ずっと残っていた物）は、取り出した状態にし、となりの箱も半開きにする
  const freed: number[] = [];
  for (const it of j.items) {
    const stuck = !!it.dusty && tierOfKind(it.kind) >= maxTierOfKind(it.kind);
    putItem(w, stuck ? { ...it, dusty: undefined } : { ...it });
    if (stuck) freed.push(it.cell);
  }
  for (const p of j.players) {
    const fresh = !p.seen;
    // 深くコピーする（倉庫・注文・ストーリーなどの配列を、元の盤面と共有しない。予測の盤面が確定の盤面をこわさないように）
    const q = fillPlayer(JSON.parse(JSON.stringify(p)) as Player);
    w.players.set(p.id, q);
    // 図鑑ができる前のセーブ: 今の盤面と倉庫にある物は見たことにする
    if (fresh) seeWorld(w, q);
  }
  w.worldOrders = (j.worldOrders ?? []).map(copyWorldOrder);
  w.nextWorldOrderId = j.nextWorldOrderId ?? 1;
  for (const c of freed) openNeighborBoxes(w, c, []);
  swapGrownBoxes(w);
  breadEarlyBoxes(w);
  return w;
}

/** 古いセーブにない項目を埋める */
export function fillPlayer(p: Player): Player {
  p.gems ??= 0;
  p.story = p.story ? copyStory(p.story) : defaultStory();
  p.orders ??= [];
  p.nextOrderId ??= 1;
  p.orderClears ??= 0;
  // 前のお客さん（ゆうたくんなど）の注文は、新しい顔ぶれで出しなおす
  if (p.orders.some((o) => !CUSTOMERS.some((c) => c.key === o.customer))) p.orders = [];
  p.storage ??= Array.from({ length: STORAGE_START }, () => null);
  p.inbox ??= [];
  p.seen ??= [];
  return p;
}

/** 盤面に見えているアイテム（ダンボールの中は除く）と倉庫の物を、図鑑の「見た」に入れる。ふえたら true */
export function seeWorld(world: World, p: Player): boolean {
  const seen = new Set(p.seen);
  const n = seen.size;
  for (const it of world.items.values()) if (!it.boxed) seen.add(it.kind);
  for (const k of p.storage) if (k !== null) seen.add(k);
  if (seen.size === n) return false;
  p.seen = [...seen].sort((a, b) => a - b);
  return true;
}

/** 盤面に出た（spawn / update）アイテムを、図鑑の「見た」に入れる */
function seeOps(p: Player, ops: Op[]) {
  for (const op of ops) {
    if ((op.t === 'spawn' || op.t === 'update') && !op.item.boxed && !p.seen.includes(op.item.kind)) {
      p.seen.push(op.item.kind);
      p.seen.sort((a, b) => a - b);
    }
  }
}

export function putItem(world: World, item: Item) {
  world.items.set(item.id, item);
  world.cells[item.cell] = item.id;
}

export function removeItem(world: World, item: Item) {
  world.items.delete(item.id);
  if (world.cells[item.cell] === item.id) world.cells[item.cell] = 0;
  world.holds.delete(item.id);
}

// ---------- 時間で回復するもの ----------

export function syncEnergy(p: Player, now: number) {
  if (p.energy >= ENERGY_MAX) {
    p.energyAt = now;
    return;
  }
  const step = ENERGY_REGEN_SEC * 1000;
  const gained = Math.floor((now - p.energyAt) / step);
  if (gained > 0) {
    p.energy = Math.min(ENERGY_MAX, p.energy + gained);
    p.energyAt = p.energy >= ENERGY_MAX ? now : p.energyAt + gained * step;
  }
}

/** 次のエネルギーが回復するまでのミリ秒（満タンなら0） */
export function nextEnergyMs(p: Player, now: number): number {
  if (p.energy >= ENERGY_MAX) return 0;
  return Math.max(0, p.energyAt + ENERGY_REGEN_SEC * 1000 - now);
}

export function maxCharges(gen: Item): number {
  const def = chainOfKind(gen.kind).gen;
  return def ? def.charges[tierOfKind(gen.kind)] ?? 0 : 0;
}

export function syncCharges(gen: Item, now: number) {
  const def = chainOfKind(gen.kind).gen;
  if (!def) return;
  const max = maxCharges(gen);
  if (gen.charges === undefined || gen.chargesAt === undefined) {
    gen.charges = max;
    gen.chargesAt = now;
    return;
  }
  if (gen.charges >= max) {
    gen.charges = max;
    gen.chargesAt = now;
    return;
  }
  const step = def.chargeSec * 1000;
  const gained = Math.floor((now - gen.chargesAt) / step);
  if (gained > 0) {
    gen.charges = Math.min(max, gen.charges + gained);
    gen.chargesAt = gen.charges >= max ? now : gen.chargesAt + gained * step;
  }
}

// ---------- 置き場所を探す ----------

/** center から近い順に、開いていて空いているマスを探す */
export function findEmptyNear(world: World, center: number, radius: number): number {
  const cx = cellX(center);
  const cy = cellY(center);
  for (let d = 1; d <= radius; d++) {
    let best = -1;
    let bestDist = Infinity;
    for (let y = cy - d; y <= cy + d; y++) {
      for (let x = cx - d; x <= cx + d; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== d) continue;
        if (!inBounds(x, y)) continue;
        const c = cellAt(x, y);
        if (world.cells[c] || !isOpenCell(world, c)) continue;
        const dist = (x - cx) ** 2 + (y - cy) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** 最初の発生器を置く所（左下の 2×2 の、いちばん左下） */
const MAP_CENTER = cellAt(0, H - 1);

// ---------- みんなの依頼 ----------

export function copyWorldOrder(o: WorldOrder): WorldOrder {
  return { ...o, needs: o.needs.map((n) => ({ ...n })), contributors: { ...o.contributors } };
}

/** いちばん進んでいる人のレベル（みんなの依頼の難しさに使う） */
export function worldLevel(world: World): number {
  let lv = 1;
  for (const p of world.players.values()) lv = Math.max(lv, p.level);
  return lv;
}

function openCount(world: World) {
  let n = 0;
  for (const b of world.blocks) n += b;
  return n;
}

/** 開いた区画のとなりにある、まだ閉じていて依頼もない区画 */
function candidateBlocks(world: World): number[] {
  return frontierBlocks(world.blocks, new Set(world.worldOrders.map((o) => o.block)));
}

/** blocks で開いている所のとなりの、閉じた区画（taken は除く） */
export function frontierBlocks(blocks: Uint8Array, taken: Set<number>): number[] {
  const out: number[] = [];
  const isOpen = (x: number, y: number) => x >= 0 && y >= 0 && x < BLOCKS_X && y < BLOCKS_Y && blocks[y * BLOCKS_X + x] === 1;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i] || taken.has(i) || !blockInPlay(i)) continue;
    const bx = i % BLOCKS_X;
    const by = Math.floor(i / BLOCKS_X);
    if (isOpen(bx - 1, by) || isOpen(bx + 1, by) || isOpen(bx, by - 1) || isOpen(bx, by + 1)) out.push(i);
  }
  return out;
}

/**
 * シャッターに要るアイテムと数（練習でもサーバーでも同じ）。
 * level: いちばん進んでいる人のレベル / opened: 開いている区画の数（最初は1）
 * 最初のシャッターは、だれでも作れる2段目のパンを COMMON_FIRST_COUNT 個
 */
export function shutterNeed(level: number, opened: number, rng: Rng, avoid: Set<number> = new Set()): { kind: number; count: number } {
  let kind: number;
  // 区画が99枚になったので、開いた数を SHUTTER_PACE 倍にして、最後のシャッターの難しさを前に近づける
  const pace = 1 + (opened - 1) * SHUTTER_PACE;
  if (opened <= 1) {
    kind = kindOf('bread', 2);
  } else {
    const chains = unlockedChains(level);
    const maxT = Math.min(7, 2 + Math.floor(level / 3) + Math.floor(pace / 15));
    const minT = Math.max(2, Math.min(maxT, 2 + Math.floor(pace / 25)));
    const pick = () => {
      const chain = chains[Math.floor(rng() * chains.length)] ?? 'bread';
      const tier = Math.min(minT + Math.floor(rng() * rng() * (maxT - minT + 1)), maxTierOfKind(kindOf(chain, 1)));
      return kindOf(chain, tier);
    };
    // ほかのシャッターと同じ物はなるべく頼まない
    kind = pick();
    for (let i = 0; i < 12 && avoid.has(kind); i++) kind = pick();
  }
  return { kind, count: commonCount(kind % 100, pace) };
}

export function makeWorldOrder(world: World, block: number, rng: Rng): WorldOrder {
  const avoid = new Set(world.worldOrders.flatMap((o) => o.needs.map((n) => n.kind)));
  const { kind, count } = shutterNeed(worldLevel(world), openCount(world), rng, avoid);
  const owner = OWNER_OF_CHAIN[chainOfKind(kind).key] ?? 'bread';
  return { id: world.nextWorldOrderId++, block, owner, needs: [{ kind, count, have: 0 }], contributors: {} };
}

/** 開いた所のとなりのシャッター全部に、依頼を付ける */
export function ensureWorldOrders(world: World, rng: Rng): Op[] {
  const ops: Op[] = [];
  // 開いてしまった区画と、遊べる範囲の外の依頼は消す
  for (const o of [...world.worldOrders]) {
    if (world.blocks[o.block] || !blockInPlay(o.block)) {
      world.worldOrders = world.worldOrders.filter((x) => x !== o);
      ops.push({ t: 'worldOrderDone', id: o.id });
    }
  }
  for (const block of candidateBlocks(world).sort((a, b) => blockDist(a) - blockDist(b))) {
    const o = makeWorldOrder(world, block, rng);
    world.worldOrders.push(o);
    ops.push({ t: 'worldOrder', order: copyWorldOrder(o) });
  }
  if (ops.length) world.rev++;
  return ops;
}

function shutterGive(p: Player, o: WorldOrder, need: OrderNeed): GameEvent {
  return { t: 'shutterGive', player: p.id, name: p.name, order: o.id, block: o.block, kind: need.kind, have: need.have, count: need.count };
}

/**
 * kind を納品したときに進むシャッター。同じアイテムを待っているシャッターは1枚ずつ進む
 * （いちばん開きそうな1枚。並んだら最初の区画に近い方）。ちがうアイテムのシャッターはそれぞれ進む
 */
export function activeShutter(orders: WorldOrder[], kind: number): WorldOrder | undefined {
  const left = (o: WorldOrder) => o.needs.reduce((s, n) => s + Math.max(0, n.count - n.have), 0);
  let best: WorldOrder | undefined;
  for (const o of orders) {
    if (!o.needs.some((n) => n.kind === kind && n.have < n.count)) continue;
    if (!best || left(o) - left(best) < 0 || (left(o) === left(best) && blockDist(o.block) < blockDist(best.block))) best = o;
  }
  return best;
}

/** 同じアイテムのシャッターが先に進んでいるので、順番を待っているシャッター */
export function waitingShutters(orders: WorldOrder[]): Set<number> {
  const out = new Set<number>();
  for (const o of orders) {
    for (const n of o.needs) {
      if (n.have >= n.count) continue;
      const a = activeShutter(orders, n.kind);
      if (a && a.id !== o.id) out.add(o.id);
    }
  }
  return out;
}

/** お客さんの注文に kind を1つ納品したとき: 同じアイテムを待っているシャッター1枚（activeShutter）の数を1つ進め、そろったら開ける */
function creditShutters(world: World, p: Player, kind: number, rng: Rng, ops: Op[], events: GameEvent[]) {
  let opened = false;
  const active = activeShutter(world.worldOrders, kind);
  for (const o of active ? [active] : []) {
    const need = o.needs.find((n) => n.kind === kind && n.have < n.count);
    if (!need) continue;
    need.have++;
    o.contributors[p.id] = (o.contributors[p.id] ?? 0) + 1;
    if (world.shared) {
      // みんなのシャッター: ここでは数を進めるだけ。開けるのはサーバー（全員の盤面で）
      ops.push({ t: 'worldOrder', order: copyWorldOrder(o) });
      events.push(shutterGive(p, o, need));
      continue;
    }
    if (o.needs.every((n) => n.have >= n.count)) {
      world.worldOrders = world.worldOrders.filter((x) => x !== o);
      ops.push({ t: 'worldOrderDone', id: o.id });
      ops.push(...openBlock(world, o.block, rng));
      p.coins += WORLD_ORDER_BONUS;
      events.push({ t: 'unlock', block: o.block, owner: o.owner, contributors: [p.id], bonus: WORLD_ORDER_BONUS });
      opened = true;
    } else {
      ops.push({ t: 'worldOrder', order: copyWorldOrder(o) });
    }
  }
  if (opened) ops.push(...ensureWorldOrders(world, rng));
}

/** 左下（最初の区画）からの近さ */
export function blockDist(i: number) {
  const x = i % BLOCKS_X;
  const y = BLOCKS_Y - 1 - Math.floor(i / BLOCKS_X);
  return x * x + y * y;
}

/** マスの区画にかかっている、みんなの依頼 */
export function worldOrderAtCell(world: World, cell: number): WorldOrder | undefined {
  const b = blockOf(cell);
  return world.worldOrders.find((o) => o.block === b);
}

// ---------- プレイヤー ----------

/** 参加。初めての人ならプレイヤーを作り、最初の発生器を渡す */
export function addPlayer(world: World, id: string, name: string, now: number, rng: Rng = Math.random): Op[] {
  const ops: Op[] = [];
  let p = world.players.get(id);
  const fresh = !p;
  if (!p) {
    p = fillPlayer({
      id, name, level: 1, xp: 0, energy: ENERGY_MAX, energyAt: now, coins: START_COINS,
    } as Player);
    world.players.set(id, p);
    // 最初のパン窯は、すぐ遊べるように動く段階で渡す
    for (const key of LEVEL_GRANTS[1] ?? []) ops.push(...grantGenerator(world, p, key, now, GEN_WORK_TIER));
    seeWorld(world, p);
  } else {
    p.name = name;
    fillPlayer(p);
    const q = p;
    // 自分で作れない物を頼んでいる組（まだ何も渡していない）は、出しなおす
    const made = producedChains(world, q);
    const stuck = q.orders.some((o) => o.needs.some((n) => n.have < n.count && !canOrder(q, n.kind, made)));
    const untouched = q.orders.every((o) => o.needs.every((n) => n.have === 0));
    if (stuck && untouched) q.orders = [];
  }
  topUpOrders(p, rng, world);
  // はじめての人の最初の注文は「パン生地1個」（チュートリアルで、パン窯を2回押して合体すれば渡せる）
  const first = fresh ? p.orders[0] : undefined;
  if (first) {
    const kind = kindOf('bread', 2);
    first.needs = [{ kind, count: 1, have: 0 }];
    first.coins = orderCoins(kind, 1);
    first.xp = tierOfKind(kind) * 2;
  }
  if (ops.length) world.rev++;
  return ops;
}

// ---------- 注文 ----------

/**
 * 注文をひとつ作る。今のレベルで出せる系列から、アイテム nNeeds 個（それぞれ1個ずつ・ちがう物）。
 * want があれば、その中から1つ頼むことが多い（シャッターを開けるため）。使った分は want から抜く。
 * avoid: ほかの注文で頼んでいる物（なるべく重ねない）
 */
/** p のレベルで注文に出してよいアイテムか（その系列の発生器があり、頼まれる段階の中） */
/** 自分の動く発生器から出る系統（育てたときだけ出る2種類目も、育っていれば入る） */
export function producedChains(world: World, p: Player): string[] {
  const out = new Set<string>();
  const add = (k: number | null | undefined) => {
    if (k === null || k === undefined || !isGeneratorKind(k) || tierOfKind(k) < GEN_WORK_TIER) return;
    for (const r of chainOfKind(k).gen?.produces ?? []) if (r.minLevel <= p.level && (r.minTier ?? 1) <= tierOfKind(k)) out.add(r.chain);
  };
  for (const it of world.items.values()) if (it.owner === p.id) add(it.kind);
  p.storage.forEach(add);
  (p.inbox ?? []).forEach(add);
  return [...out];
}

/**
 * 注文に出してよい系統。動く発生器を持っていれば、その発生器から今出る物だけ（2種類目は発生器 Lv5 から）。
 * 1台も動いていなければ（盤面のない計算など）、レベルで決まる系統
 */
function orderChains(p: Player, produced: string[]): string[] {
  return produced.length ? produced : unlockedChains(p.level);
}

export function canOrder(p: Player, kind: number, produced: string[] = []): boolean {
  const chains = orderChains(p, produced);
  const maxT = Math.min(7, 3 + Math.floor(p.level / 2));
  return chains.includes(chainOfKind(kind).key) && tierOfKind(kind) >= 2 && tierOfKind(kind) <= Math.min(maxT, maxTierOfKind(kind));
}

const ORDER_TOP_LEVEL = 30;
const ORDER_TOP_CHANCE = 0.06;

export function makeOrder(p: Player, rng: Rng, want: number[] = [], customer = CUSTOMERS[0]!.key, nNeeds = 1, avoid: Set<number> = new Set(), produced: string[] = []): Order {
  // 自分の発生器から今出る物だけを頼まれる（作れない物の注文で止まらないように）
  const chains = orderChains(p, produced);
  const maxT = Math.min(7, 3 + Math.floor(p.level / 2));
  const minT = Math.max(2, maxT - 3);
  const needs: OrderNeed[] = [];
  const pickFree = (gen: () => number) => {
    let kind = gen();
    for (let i = 0; i < 8 && (needs.some((n) => n.kind === kind) || avoid.has(kind)); i++) kind = gen();
    return needs.some((n) => n.kind === kind) ? 0 : kind;
  };
  const random = () => {
    const chain = chains[Math.floor(rng() * chains.length)] ?? 'bread';
    // 低い段階ほど出やすく
    let tier = minT + Math.floor(rng() * rng() * (maxT - minT + 1));
    // Lv30 から、まれに最高段階（Lv8）を頼まれる
    if (p.level >= ORDER_TOP_LEVEL && rng() < ORDER_TOP_CHANCE) tier = 8;
    return kindOf(chain, Math.min(tier, maxTierOfKind(kindOf(chain, 1))));
  };
  for (let i = 0; i < nNeeds * 4 && needs.length < nNeeds; i++) {
    const fromWant = want.length && rng() < 0.65 && !needs.some((n) => want.includes(n.kind));
    if (fromWant) {
      const at = Math.floor(rng() * want.length);
      needs.push({ kind: want[at]!, count: 1, have: 0 });
      want.splice(at, 1);
      continue;
    }
    const kind = pickFree(random);
    if (kind) needs.push({ kind, count: 1, have: 0 });
  }
  const coins = needs.reduce((s, n) => s + orderCoins(n.kind, n.count), 0);
  const xp = needs.reduce((s, n) => s + n.count * tierOfKind(n.kind) * 2, 0);
  return { id: p.nextOrderId++, customer, needs, coins, xp };
}

/**
 * 注文がひとつもなければ、次の組をまとめて出す（ウェーブ式）。
 * 来るのは CUSTOMERS の先頭から orderCustomerCount 人。そのうち orderDoubleCount 人が2個注文
 */
function topUpOrders(p: Player, rng: Rng, world?: World) {
  const extra = world ? producedChains(world, p) : [];
  if (p.orders.length) return;
  // シャッターが待っているアイテム（まだ足りない数だけ）。1組のうち、頼むのは3人に1人くらいまで。
  // みんなのシャッターは、いちばん進んでいる人に合わせて出るので、自分で作れる物だけにする
  const want = world
    ? world.worldOrders.flatMap((o) => o.needs.flatMap((n) => Array<number>(Math.max(0, n.count - n.have)).fill(n.kind))).filter((k) => canOrder(p, k, extra))
    : [];
  const n = orderCustomerCount(p.orderClears);
  let wantLeft = Math.max(1, Math.round(n / 3));
  const people = CUSTOMERS.slice(0, n);
  // 2個注文の人は、毎回ちがう人になるように選ぶ
  const order = people.map((c) => ({ c, r: rng() })).sort((x, y) => x.r - y.r).map((x) => x.c.key);
  const doubles = new Set(order.slice(0, orderDoubleCount(p.orderClears)));
  const avoid = new Set<number>();
  for (const c of people) {
    const before = want.length;
    const o = makeOrder(p, rng, wantLeft > 0 ? want : [], c.key, doubles.has(c.key) ? 2 : 1, avoid, extra);
    if (want.length < before) wantLeft--;
    for (const nd of o.needs) avoid.add(nd.kind);
    p.orders.push(o);
  }
}

/** 報酬のアイテムを受け取り枠に入れる（盤面にはまだ置かない） */
function giveReward(p: Player, kind: number): number {
  p.inbox.push(kind);
  return kind;
}

/** 発生器（部品）を盤面に置く。tier 1〜2 は部品 */
function grantGenerator(world: World, p: Player, key: string, now: number, tier = 1): Op[] {
  return grantItem(world, p, kindOf(key, tier), now, true);
}

/** もらった物を盤面に置く（自分の発生器の近く）。owned: 発生器のように持ち主を付ける */
function grantItem(world: World, p: Player, kind: number, now: number, owned: boolean): Op[] {
  // 自分のほかの発生器の近く。なければ地図の中央の近く
  const mine = [...world.items.values()].find((i) => i.owner === p.id);
  const center = mine ? mine.cell : MAP_CENTER;
  let cell = world.cells[center] ? findEmptyNear(world, center, 60) : center;
  if (cell < 0 || !isOpenCell(world, cell)) cell = findEmptyNear(world, MAP_CENTER, 60);
  const ops: Op[] = [];
  if (cell < 0) {
    // 空きマスがないときは、いちばん近いダンボールをどけてそこに置く（どけたマスのまわりは半開きに）
    let best = -1; let bd = Infinity;
    for (const it of world.items.values()) {
      if (!it.boxed && !it.dusty) continue;
      const d = (cellX(it.cell) - cellX(center)) ** 2 + (cellY(it.cell) - cellY(center)) ** 2;
      if (d < bd) { bd = d; best = it.id; }
    }
    const box = best >= 0 ? world.items.get(best) : undefined;
    if (!box) return [];
    cell = box.cell;
    removeItem(world, box);
    ops.push({ t: 'remove', id: box.id });
    openNeighborBoxes(world, cell, ops);
  }
  const item: Item = { id: world.nextId++, kind, cell, maker: p.id, ...(owned ? { owner: p.id } : {}) };
  syncCharges(item, now);
  putItem(world, item);
  return [...ops, { t: 'spawn', item: { ...item } }];
}

/** 今のレベルで出せる系列 */
export function unlockedChains(level: number, withGrown = false): string[] {
  const out = new Set<string>();
  for (const c of CHAIN_BY_KEY.values()) {
    // 発生器を育てたときだけ出る物（minTier）は、ふつうは入れない（注文は、育っていれば producedChains で足す）。
    // ダンボールの中身（withGrown）には入れる
    for (const row of c.gen?.produces ?? []) if (row.minLevel <= level && (withGrown || !row.minTier)) out.add(row.chain);
  }
  return [...out];
}

function gainXp(world: World, p: Player, amount: number, now: number, ops: Op[], events: GameEvent[]) {
  p.xp += amount;
  while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
    const before = new Set(unlockedChains(p.level));
    p.xp -= xpToNext(p.level);
    p.level++;
    // スタミナ +LEVEL_UP_ENERGY（満タンまで）
    syncEnergy(p, now);
    const energy = Math.max(0, Math.min(LEVEL_UP_ENERGY, ENERGY_MAX - p.energy));
    p.energy += energy;
    if (p.energy >= ENERGY_MAX) p.energyAt = now;
    const granted = LEVEL_GRANTS[p.level] ?? [];
    // 新しい発生器は部品で渡す（2段目1個＋1段目2個。全部合成すると動く発生器になる）
    for (const key of granted) for (const t of [2, 1, 1]) giveReward(p, kindOf(key, t));
    // プレゼント箱: 毎回 白、2の倍数で 青、3の倍数で 赤、5の倍数で 紫
    const gifts: number[] = [];
    for (const t of levelGiftTiers(p.level)) {
      gifts.push(giveReward(p, kindOf('gift', t)));
    }
    const newChains = unlockedChains(p.level).filter((c) => !before.has(c));
    events.push({ t: 'levelup', player: p.id, level: p.level, newChains, granted, energy, ...(gifts.length ? { gifts } : {}) });
  }
}

/** 経験値を足す（依頼の報酬・おためし用）。レベルが上がれば発生器ももらえる */
export function grantXp(world: World, playerId: string, amount: number, now: number): { ops: Op[]; events: GameEvent[] } {
  const ops: Op[] = [];
  const events: GameEvent[] = [];
  const p = world.players.get(playerId);
  if (!p) return { ops, events };
  gainXp(world, p, amount, now, ops, events);
  if (ops.length) world.rev++;
  return { ops, events };
}

// ---------- 操作 ----------

export function apply(world: World, playerId: string, action: Action, now: number, rng: Rng): Result {
  const p = world.players.get(playerId);
  if (!p) return { ok: false, reason: 'no-player', ops: [] };
  const r = applyInner(world, p, action, now, rng);
  if (r.ok) seeOps(p, r.ops);
  if (r.ok && r.ops.length) world.rev++;
  return r;
}

function reject(reason: RejectReason, ops: Op[] = []): Result {
  return { ok: false, reason, ops };
}

function heldByOther(world: World, id: number, playerId: string, now: number): boolean {
  const h = world.holds.get(id);
  return !!h && h.player !== playerId && h.until > now;
}

function applyInner(world: World, p: Player, a: Action, now: number, rng: Rng): Result {
  const ops: Op[] = [];
  const events: GameEvent[] = [];
  const done = (): Result => ({ ok: true, ops, events, changedPlayers: [p.id] });

  switch (a.t) {
    case 'grab': {
      const it = world.items.get(a.item);
      if (!it) return reject('no-item');
      if (it.boxed) return reject('boxed');
      if (it.dusty) return reject('dusty');
      if (it.owner && it.owner !== p.id) return reject('not-yours');
      if (heldByOther(world, it.id, p.id, now)) return reject('held');
      world.holds.set(it.id, { player: p.id, until: now + HOLD_MS });
      ops.push({ t: 'hold', id: it.id, player: p.id });
      return done();
    }

    case 'release': {
      const h = world.holds.get(a.item);
      if (!h || h.player !== p.id) return done();
      world.holds.delete(a.item);
      ops.push({ t: 'unhold', id: a.item });
      return done();
    }

    case 'drop': {
      const it = world.items.get(a.item);
      if (!it) return reject('no-item');
      const h = world.holds.get(it.id);
      if (!h || h.player !== p.id || h.until <= now) {
        if (heldByOther(world, it.id, p.id, now)) return reject('held');
        // 予約が切れていても、ほかに誰も持っていなければそのまま続ける
        if (it.boxed) return reject('boxed');
        if (it.dusty) return reject('dusty');
        if (it.owner && it.owner !== p.id) return reject('not-yours');
      }
      const releaseOps = (): Op[] => {
        if (!world.holds.has(it.id)) return [];
        world.holds.delete(it.id);
        return [{ t: 'unhold', id: it.id }];
      };
      if (a.cell === it.cell) {
        ops.push(...releaseOps());
        return done();
      }
      if (!isOpenCell(world, a.cell)) return reject('locked', releaseOps());
      const targetId = world.cells[a.cell]!;
      const target = targetId ? world.items.get(targetId) : undefined;

      if (!target) {
        world.cells[it.cell] = 0;
        it.cell = a.cell;
        world.cells[a.cell] = it.id;
        ops.push(...releaseOps(), { t: 'move', id: it.id, cell: it.cell });
        return done();
      }
      if (heldByOther(world, target.id, p.id, now)) return reject('held', releaseOps());
      // ふたの閉まったダンボールには何もできない（中身は見えない）
      if (target.boxed) return reject('boxed', releaseOps());

      const sameKind = target.kind === it.kind;
      const canGrow = tierOfKind(target.kind) < maxTierOfKind(target.kind);
      // 発生器: 自分の物どうし（ダンボールやストーリーで出た部品は持ち主なし）
      const genOk = !isGeneratorKind(target.kind) || ((!target.owner || target.owner === p.id) && (!it.owner || it.owner === p.id));

      if (sameKind && canGrow && genOk && !isGiftKind(target.kind)) {
        const kind = target.kind + 1;
        const wasHalfOpen = !!target.dusty;
        // 発生器どうし: 合成する前の段階で両方のチャージを今に合わせ、多い方を引きつぐ（どちらをどちらに重ねても同じ）
        let carry: { charges: number; chargesAt: number } | undefined;
        if (isGeneratorKind(target.kind)) {
          syncCharges(target, now);
          syncCharges(it, now);
          const best = (it.charges ?? 0) > (target.charges ?? 0) ? it : target;
          carry = { charges: best.charges ?? 0, chargesAt: best.chargesAt ?? now };
        }
        target.kind = kind;
        target.dusty = undefined;
        target.maker = p.id;
        if (isGeneratorKind(kind)) {
          target.owner = p.id;
          if (tierOfKind(kind) === GEN_WORK_TIER) {
            // 部品から組み立てて動きだしたときは、満タンから
            target.charges = maxCharges(target);
            target.chargesAt = now;
          } else if (carry) {
            // 段階が上がった分だけ、チャージの上限は増える（回数はそのまま。そこから回復していく）
            target.charges = carry.charges;
            target.chargesAt = carry.chargesAt;
            syncCharges(target, now);
          }
        }
        ops.push(...releaseOps());
        removeItem(world, it);
        ops.push({ t: 'remove', id: it.id }, { t: 'update', item: { ...target } });
        // 半開きのダンボールから取り出した: そのマスが使えるようになり、上下左右のダンボールが半開きになる
        if (wasHalfOpen) openNeighborBoxes(world, target.cell, ops);
        const xp = mergeXp(kind);
        events.push({ t: 'merge', player: p.id, id: target.id, kind, xp });
        gainXp(world, p, xp, now, ops, events);
        return done();
      }

      // 入れ替え
      if (target.dusty) return reject('dusty', releaseOps());
      if (target.owner && target.owner !== p.id) return reject('not-yours', releaseOps());
      const from = it.cell;
      it.cell = target.cell;
      target.cell = from;
      world.cells[it.cell] = it.id;
      world.cells[target.cell] = target.id;
      ops.push(...releaseOps(), { t: 'move', id: it.id, cell: it.cell }, { t: 'move', id: target.id, cell: target.cell });
      return done();
    }

    case 'tap': {
      const g = world.items.get(a.gen);
      if (!g) return reject('no-item');
      const def = chainOfKind(g.kind).gen;
      if (!def) return reject('not-generator');
      if (g.owner !== p.id) return reject('not-yours');
      if (tierOfKind(g.kind) < GEN_WORK_TIER) return reject('parts');
      if (heldByOther(world, g.id, p.id, now)) return reject('held');
      syncEnergy(p, now);
      syncCharges(g, now);
      if (p.energy < def.energyCost) return reject('energy');
      if ((g.charges ?? 0) <= 0) return reject('no-charge');
      // レベルと、発生器の段階で出る物が増える
      const rows = def.produces.filter((r) => r.minLevel <= p.level && (r.minTier ?? 1) <= tierOfKind(g.kind));
      if (!rows.length) return reject('nothing');
      const cell = findEmptyNear(world, g.cell, SPAWN_RADIUS);
      if (cell < 0) return reject('no-space');

      // 2種類目（育てたときだけ出る物）は、発生器 Lv5 で 30%、育つほど増えて最高レベルで 50%
      const main = rows.filter((x) => !x.minTier);
      const subs = rows.filter((x) => x.minTier);
      const pick = (list: typeof rows) => {
        let r = rng() * list.reduce((s, x) => s + x.weight, 0);
        return list.find((x) => (r -= x.weight) < 0) ?? list[0]!;
      };
      const row = subs.length && main.length
        ? (rng() < secondItemChance(tierOfKind(g.kind), maxTierOfKind(g.kind)) ? pick(subs) : pick(main))
        : pick(rows);
      const upChance =
        (def.tierUp[tierOfKind(g.kind)] ?? 0) +
        LEVEL_TIER_UP.filter((l) => l.minLevel <= p.level).reduce((s, l) => s + l.add, 0);
      let tier = 1;
      while (tier < def.maxOutTier && rng() < upChance) tier++;

      p.energy -= def.energyCost;
      g.charges = (g.charges ?? 0) - 1;
      const item: Item = { id: world.nextId++, kind: kindOf(row.chain, tier), cell, maker: p.id };
      putItem(world, item);
      ops.push({ t: 'spawn', item: { ...item }, from: g.cell }, { t: 'update', item: { ...g } });
      return done();
    }

    case 'buyEnergy': {
      syncEnergy(p, now);
      if (p.gems < GEM_ENERGY_COST) return reject('gems');
      p.gems -= GEM_ENERGY_COST;
      p.energy += GEM_ENERGY_AMOUNT;
      if (p.energy >= ENERGY_MAX) p.energyAt = now;
      events.push({ t: 'gemUse', player: p.id, what: 'energy', gems: GEM_ENERGY_COST, energy: GEM_ENERGY_AMOUNT });
      return done();
    }

    case 'refillGen': {
      const g = world.items.get(a.gen);
      if (!g) return reject('no-item');
      if (!chainOfKind(g.kind).gen) return reject('not-generator');
      if (g.owner !== p.id) return reject('not-yours');
      if (tierOfKind(g.kind) < GEN_WORK_TIER) return reject('parts');
      syncCharges(g, now);
      const max = maxCharges(g);
      // 使い切って休んでいるときだけ（1回でも残っていればまだ使えない）
      if ((g.charges ?? max) > 0) return reject('not-empty');
      const cost = genRefillCost(max);
      if (p.gems < cost) return reject('gems');
      p.gems -= cost;
      g.charges = max;
      g.chargesAt = now;
      ops.push({ t: 'update', item: { ...g } });
      events.push({ t: 'gemUse', player: p.id, what: 'gen', gems: cost, gen: g.id });
      return done();
    }

    case 'openGift': {
      // プレゼント箱をタップ: 中身が1個出る。safe 回をこえると、タップのたびに消えることがある
      const g = world.items.get(a.item);
      if (!g) return reject('no-item');
      if (!isGiftKind(g.kind)) return reject('not-gift');
      if (g.boxed) return reject('boxed');
      if (g.dusty) return reject('dusty');
      if (heldByOther(world, g.id, p.id, now)) return reject('held');
      const def = GIFTS[tierOfKind(g.kind) - 1]!;
      const pick = <T>(list: T[]): T => list[Math.floor(rng() * list.length)]!;
      const tier = def.minTier + Math.floor(rng() * (def.maxTier - def.minTier + 1));
      let kind: number;
      if (def.from === 'child') {
        // 今のレベルで作れる子アイテム
        const chains = unlockedChains(p.level);
        if (!chains.length) return reject('nothing');
        const chain = pick(chains);
        kind = kindOf(chain, Math.min(tier, maxTierOfKind(kindOf(chain, 1))));
      } else {
        // 今のレベルでもらえる発生器から選ぶ（盤面にある物だけを見ると、ほかを倉庫に入れて狙い撃ちでき、
        // なくした発生器はもう出なくなる）
        const keys = ownedGeneratorKeys(p.level);
        if (!keys.length) return reject('nothing');
        kind = kindOf(pick(keys), tier);
      }
      const cell = findEmptyNear(world, g.cell, SPAWN_RADIUS);
      if (cell < 0) return reject('no-space');
      const item: Item = { id: world.nextId++, kind, cell, maker: p.id, ...(isGeneratorKind(kind) ? { owner: p.id } : {}) };
      if (isGeneratorKind(kind)) {
        syncCharges(item, now);
        if (tierOfKind(kind) >= GEN_WORK_TIER) { item.charges = maxCharges(item); item.chargesAt = now; }
      }
      putItem(world, item);
      ops.push({ t: 'spawn', item: { ...item }, from: g.cell });
      g.taps = (g.taps ?? 0) + 1;
      const broke = g.taps > def.safe && rng() < def.breakChance;
      if (broke) {
        removeItem(world, g);
        ops.push({ t: 'remove', id: g.id });
      } else {
        ops.push({ t: 'update', item: { ...g } });
      }
      events.push({ t: 'giftTap', player: p.id, id: g.id, kind: g.kind, cell: g.cell, taps: g.taps, broke });
      return done();
    }

    case 'sell': {
      if (a.slot !== undefined) {
        if (a.slot < 0 || a.slot >= p.storage.length) return reject('empty-slot');
        const kind = p.storage[a.slot];
        if (kind === null || kind === undefined) return reject('empty-slot');
        // 盤面と同じルール: プレゼント箱・動く発生器は消せない（Lv1 や発生器の部品はゴミ箱、Lv2〜はコイン化）
        if (isGiftKind(kind)) return reject('cannot-sell');
        if (!canTrashGenPart(world, p.id, kind)) return reject('cannot-sell');
        if (isLastGenPart(world, p, kind, { slot: a.slot })) return reject('last-part');
        const coins = isGeneratorKind(kind) ? 0 : scrapCoins(kind);
        p.storage[a.slot] = null;
        if (p.storageMeta && a.slot < p.storageMeta.length) p.storageMeta[a.slot] = null;
        p.coins += coins;
        p.lastSold = { kind, slot: a.slot, coins, at: now };
        events.push({ t: 'sold', player: p.id, coins, kind });
        return done();
      }
      if (a.item === undefined) return reject('no-item');
      const it = world.items.get(a.item);
      if (!it) return reject('no-item');
      // Lv1 はゴミ箱（0 コイン）、Lv2 からはコイン化。発生器・プレゼント箱は消せない
      if (it.dusty || it.boxed || isGiftKind(it.kind)) return reject('cannot-sell');
      // 発生器は、まだ部品のうちだけゴミ箱にできる（動く発生器は消せない）
      if (!canTrashGenPart(world, p.id, it.kind)) return reject('cannot-sell');
      if (it.owner && it.owner !== p.id) return reject('not-yours');
      if (heldByOther(world, it.id, p.id, now)) return reject('held');
      if (isLastGenPart(world, p, it.kind, { id: it.id })) return reject('last-part');
      const coins = isGeneratorKind(it.kind) ? 0 : scrapCoins(it.kind);
      removeItem(world, it);
      p.coins += coins;
      p.lastSold = { kind: it.kind, cell: it.cell, coins, at: now };
      ops.push({ t: 'remove', id: it.id });
      events.push({ t: 'sold', player: p.id, coins, kind: it.kind });
      return done();
    }

    case 'undoSell': {
      const ls = p.lastSold;
      if (!ls || now - ls.at > UNDO_SELL_MS) return reject('no-undo');
      if (p.coins < ls.coins) return reject('coins');
      // 倉庫から売った場合は元の枠（埋まっていれば空き枠）へ戻す。倉庫がいっぱいなら盤面の空きマスへ
      if (ls.slot !== undefined) {
        const slot = ls.slot >= 0 && ls.slot < p.storage.length && p.storage[ls.slot] === null
          ? ls.slot : p.storage.indexOf(null);
        if (slot >= 0) {
          p.storage[slot] = ls.kind;
          if (p.storageMeta && slot < p.storageMeta.length) p.storageMeta[slot] = null;
          p.coins -= ls.coins;
          delete p.lastSold;
          events.push({ t: 'unsold', player: p.id, slot, kind: ls.kind, coins: ls.coins });
          return done();
        }
        const cell = findEmptyNear(world, MAP_CENTER, Math.max(W, H));
        if (cell < 0) return reject('no-space');
        const item: Item = { id: world.nextId++, kind: ls.kind, cell, maker: p.id, ...(isGeneratorKind(ls.kind) ? { owner: p.id } : {}) };
        putItem(world, item);
        p.coins -= ls.coins;
        delete p.lastSold;
        ops.push({ t: 'spawn', item: { ...item } });
        events.push({ t: 'unsold', player: p.id, id: item.id, kind: item.kind, coins: ls.coins });
        return done();
      }
      // 元のマスがふさがっていたら、近くの空きマスへ
      const orig = ls.cell ?? MAP_CENTER;
      const cell = isOpenCell(world, orig) && !world.cells[orig] ? orig : findEmptyNear(world, orig, 30);
      if (cell < 0) return reject('no-space');
      const item: Item = { id: world.nextId++, kind: ls.kind, cell, maker: p.id, ...(isGeneratorKind(ls.kind) ? { owner: p.id } : {}) };
      putItem(world, item);
      p.coins -= ls.coins;
      delete p.lastSold;
      ops.push({ t: 'spawn', item: { ...item } });
      events.push({ t: 'unsold', player: p.id, id: item.id, kind: item.kind, coins: ls.coins });
      return done();
    }

    case 'deliver': {
      const order = p.orders.find((o) => o.id === a.order);
      if (!order) return reject('no-order');
      let kind: number;
      let it: Item | undefined;
      if (a.item !== undefined) {
        it = world.items.get(a.item);
        if (!it) return reject('no-item');
        if (it.boxed) return reject('boxed');
        if (it.dusty) return reject('dusty');
        if (isGeneratorKind(it.kind)) return reject('not-needed');
        if (heldByOther(world, it.id, p.id, now)) return reject('held');
        kind = it.kind;
      } else if (a.slot !== undefined) {
        const k = p.storage[a.slot];
        if (k === null || k === undefined) return reject('empty-slot');
        kind = k;
      } else {
        return reject('no-item');
      }
      const need = order.needs.find((n) => n.kind === kind && n.have < n.count);
      if (!need) return reject('not-needed');
      need.have++;
      if (it) {
        removeItem(world, it);
        ops.push({ t: 'remove', id: it.id });
      } else {
        p.storage[a.slot!] = null;
        if (p.storageMeta) p.storageMeta[a.slot!] = null;
      }
      // 同じアイテムを待っているシャッターも進む
      creditShutters(world, p, kind, rng, ops, events);
      if (order.needs.every((n) => n.have >= n.count)) {
        p.orders = p.orders.filter((o) => o !== order);
        p.coins += order.coins;
        events.push({ t: 'order', player: p.id, customer: order.customer, coins: order.coins, xp: order.xp });
        gainXp(world, p, order.xp, now, ops, events);
        if (!p.orders.length) {
          // 全部クリア: 回数を数えて、次の組を出す
          const before = { n: orderCustomerCount(p.orderClears), d: orderDoubleCount(p.orderClears) };
          p.orderClears++;
          const n = orderCustomerCount(p.orderClears);
          const newCustomer = n > before.n ? CUSTOMERS[n - 1]!.key : undefined;
          const moreDouble = orderDoubleCount(p.orderClears) > before.d;
          events.push({ t: 'ordersCleared', player: p.id, clears: p.orderClears, ...(newCustomer ? { newCustomer } : {}), ...(moreDouble ? { moreDouble } : {}) });
          topUpOrders(p, rng, world);
        }
      }
      return done();
    }

    case 'store': {
      const it = world.items.get(a.item);
      if (!it) return reject('no-item');
      if (it.boxed) return reject('boxed');
      if (it.dusty) return reject('dusty');
      if (it.owner && it.owner !== p.id) return reject('not-yours');
      if (heldByOther(world, it.id, p.id, now)) return reject('held');
      const slot = p.storage.indexOf(null);
      if (slot < 0) return reject('storage-full');
      p.storage[slot] = it.kind;
      // 発生器（部品も）やプレゼント箱も入れられる。開封回数やチャージは覚えておく（出し入れで増やせない）
      const meta: StoredMeta = {};
      if (it.taps) meta.taps = it.taps;
      if (it.charges !== undefined) {
        syncCharges(it, now);
        meta.charges = it.charges;
        meta.chargesAt = it.chargesAt;
      }
      p.storageMeta ??= [];
      p.storageMeta[slot] = Object.keys(meta).length ? meta : null;
      removeItem(world, it);
      ops.push({ t: 'remove', id: it.id });
      return done();
    }

    case 'unstore': {
      const kind = p.storage[a.slot];
      if (kind === null || kind === undefined) return reject('empty-slot');
      if (!isOpenCell(world, a.cell)) return reject('locked');
      if (world.cells[a.cell]) return reject('occupied');
      p.storage[a.slot] = null;
      const meta = p.storageMeta?.[a.slot] ?? null;
      if (p.storageMeta) p.storageMeta[a.slot] = null;
      const item: Item = { id: world.nextId++, kind, cell: a.cell, maker: p.id, ...(isGeneratorKind(kind) ? { owner: p.id } : {}) };
      if (meta?.taps) item.taps = meta.taps;
      if (meta?.charges !== undefined) {
        item.charges = meta.charges;
        item.chargesAt = meta.chargesAt;
      }
      // チャージは入れていた間も回復する（覚えていなければ満タン。古いセーブの倉庫の物）
      syncCharges(item, now);
      putItem(world, item);
      ops.push({ t: 'spawn', item: { ...item } });
      return done();
    }

    case 'takeReward': {
      const kind = p.inbox[0];
      if (kind === undefined) return reject('empty-inbox');
      if (!isOpenCell(world, a.cell)) return reject('locked');
      if (world.cells[a.cell]) return reject('occupied');
      p.inbox.shift();
      const item: Item = { id: world.nextId++, kind, cell: a.cell, maker: p.id, ...(isGeneratorKind(kind) ? { owner: p.id } : {}) };
      // 動く発生器はチャージ満タンで出す
      syncCharges(item, now);
      putItem(world, item);
      ops.push({ t: 'spawn', item: { ...item } });
      events.push({ t: 'rewardTaken', player: p.id, id: item.id, kind, cell: a.cell });
      return done();
    }

    case 'expand': {
      if (p.storage.length >= STORAGE_MAX) return reject('max-storage');
      const cost = storageCost(p.storage.length);
      if (p.coins < cost) return reject('coins');
      p.coins -= cost;
      p.storage.push(null);
      return done();
    }

    case 'contribute': {
      const order = world.worldOrders.find((o) => o.id === a.order);
      if (!order) return reject('no-order');
      let kind: number;
      let it: Item | undefined;
      if (a.item !== undefined) {
        it = world.items.get(a.item);
        if (!it) return reject('no-item');
        if (it.boxed) return reject('boxed');
        if (it.dusty) return reject('dusty');
        if (isGeneratorKind(it.kind)) return reject('not-needed');
        if (heldByOther(world, it.id, p.id, now)) return reject('held');
        kind = it.kind;
      } else if (a.slot !== undefined) {
        const k = p.storage[a.slot];
        if (k === null || k === undefined) return reject('empty-slot');
        kind = k;
      } else {
        return reject('no-item');
      }
      const need = order.needs.find((n) => n.kind === kind && n.have < n.count);
      if (!need) return reject('not-needed');
      need.have++;
      order.contributors[p.id] = (order.contributors[p.id] ?? 0) + 1;
      if (it) {
        removeItem(world, it);
        ops.push({ t: 'remove', id: it.id });
      } else {
        p.storage[a.slot!] = null;
        if (p.storageMeta) p.storageMeta[a.slot!] = null;
      }
      // 1つ納品するごとに、売値ぶんのコインと経験値
      const coins = sellCoins(kind);
      const xp = tierOfKind(kind) * 2;
      p.coins += coins;
      events.push({ t: 'contrib', player: p.id, coins, xp });
      gainXp(world, p, xp, now, ops, events);
      const changed = new Set([p.id]);
      if (world.shared) {
        ops.push({ t: 'worldOrder', order: copyWorldOrder(order) });
        events.push(shutterGive(p, order, need));
      } else if (order.needs.every((n) => n.have >= n.count)) {
        world.worldOrders = world.worldOrders.filter((o) => o !== order);
        ops.push({ t: 'worldOrderDone', id: order.id });
        ops.push(...openBlock(world, order.block, rng));
        const who = Object.keys(order.contributors);
        for (const id of who) {
          const q = world.players.get(id);
          if (!q) continue;
          q.coins += WORLD_ORDER_BONUS;
          changed.add(id);
        }
        events.push({ t: 'unlock', block: order.block, owner: order.owner, contributors: who, bonus: WORLD_ORDER_BONUS });
        ops.push(...ensureWorldOrders(world, rng));
      } else {
        ops.push({ t: 'worldOrder', order: copyWorldOrder(order) });
      }
      return { ok: true, ops, events, changedPlayers: [...changed] };
    }

    case 'storySeen': {
      if (!getChapter(a.chapter)) return reject('no-task');
      if (!p.story.seenIntro.includes(a.chapter)) p.story.seenIntro.push(a.chapter);
      return done();
    }

    case 'storyTask': {
      const found = findStoryTask(a.taskId);
      if (!found) return reject('no-task');
      const { chapter, task, index } = found;
      if (p.story.done.includes(task.id)) return reject('task-done');
      const prevCh = chapter.id > 1 ? getChapter(chapter.id - 1) : undefined;
      if (prevCh && !isChapterComplete(prevCh, p.story)) return reject('task-locked');
      if (index > 0 && !p.story.done.includes(chapter.tasks[index - 1]!.id)) return reject('task-locked');
      let chosen: number | undefined;
      if (task.choices?.length) {
        chosen = a.choice ?? 0;
        if (!Number.isInteger(chosen) || chosen < 0 || chosen >= task.choices.length) return reject('bad-choice');
      }
      if (p.coins < task.cost) return reject('coins');
      p.coins -= task.cost;
      p.story.done.push(task.id);
      if (chosen !== undefined) p.story.choices[task.id] = chosen;
      events.push({ t: 'storyTask', player: p.id, chapter: chapter.id, taskId: task.id, choice: chosen });
      // そのチャプターの発生器（もらった発生器から、チャプターごとに順番に）
      const gens = ownedGeneratorKeys(p.level);
      const partKey = gens.length ? gens[chapter.id % gens.length]! : undefined;
      // 50% のプレゼント: スタミナ（中）と、その発生器の部品レベル1（経験値とジェムはなし）
      if (isChapterHalf(chapter, p.story) && !p.story.half.includes(chapter.id) && !p.story.claimed.includes(chapter.id)) {
        p.story.half.push(chapter.id);
        const energy = halfEnergy(chapter);
        syncEnergy(p, now);
        p.energy += energy;
        if (p.energy >= ENERGY_MAX) p.energyAt = now;
        const part = partKey ? giveReward(p, kindOf(partKey, 1)) : undefined;
        // 決まった章だけ、白か青のプレゼント箱
        const halfTier = STORY_HALF_GIFTS[chapter.id];
        const gift = halfTier ? giveReward(p, kindOf('gift', halfTier)) : undefined;
        events.push({ t: 'chapterHalf', player: p.id, chapter: chapter.id, energy, ...(part ? { part } : {}), ...(gift ? { gift } : {}) });
      }
      // 100%: 経験値・ジェム・スタミナ（大）と、その発生器の部品レベル2
      if (isChapterComplete(chapter, p.story) && !p.story.claimed.includes(chapter.id)) {
        p.story.claimed.push(chapter.id);
        const rw = chapter.reward;
        syncEnergy(p, now);
        p.gems += rw.gems;
        const part = partKey ? giveReward(p, kindOf(partKey, 2)) : undefined;
        // 決まった章だけ、赤のプレゼント箱
        const clearTier = STORY_CLEAR_GIFTS[chapter.id];
        const gift = clearTier ? giveReward(p, kindOf('gift', clearTier)) : undefined;
        // 経験値はだれでも同じ。ただし1回で上がるのは1レベルまで（止まったときは、実際に入った分を知らせる）
        const xp = cappedClearXp(p.level, p.xp, rw.xp);
        events.push({ t: 'chapterClear', player: p.id, chapter: chapter.id, xp, energy: rw.energy, gems: rw.gems, ...(part ? { part } : {}), ...(gift ? { gift } : {}) });
        // 先に経験値（レベルアップのスタミナ +20 が、報酬のスタミナで満タンをこえて消えないように）
        gainXp(world, p, xp, now, ops, events);
        p.energy += rw.energy;
        if (p.energy >= ENERGY_MAX) p.energyAt = now;
      }
      return done();
    }

    case 'storyStyle': {
      const found = findStoryTask(a.taskId);
      if (!found || !found.task.choices?.length) return reject('no-task');
      if (!p.story.done.includes(found.task.id)) return reject('task-locked');
      if (!Number.isInteger(a.choice) || a.choice < 0 || a.choice >= found.task.choices.length) return reject('bad-choice');
      p.story.choices[found.task.id] = a.choice;
      return done();
    }
  }
}

/** 期限切れの予約を外す */
export function expireHolds(world: World, now: number): Op[] {
  const ops: Op[] = [];
  for (const [id, h] of world.holds) {
    if (h.until <= now) {
      world.holds.delete(id);
      ops.push({ t: 'unhold', id });
    }
  }
  if (ops.length) world.rev++;
  return ops;
}

/** 予約を延ばす（ドラッグ中に呼ぶ） */
export function extendHold(world: World, playerId: string, id: number, now: number) {
  const h = world.holds.get(id);
  if (h && h.player === playerId) h.until = now + HOLD_MS;
}

// 定義表。数値を変えるだけで調整できるようにする。
// kind = 系列番号 * 100 + 段階（段階は1から）

export type ProduceRow = { minLevel: number; chain: string; weight: number };

export type GeneratorDef = {
  energyCost: number;
  /** 発生器の段階ごとのチャージ上限（添字=段階） */
  charges: number[];
  /** チャージ1回分の回復秒数 */
  chargeSec: number;
  produces: ProduceRow[];
  /** 発生器の段階ごとの「出る段階が1つ上がる」確率（添字=段階） */
  tierUp: number[];
  /** 出る段階の上限 */
  maxOutTier: number;
};

export type ChainDef = {
  index: number;
  key: string;
  name: string;
  tiers: string[];
  gen?: GeneratorDef;
};

const GEN_CHARGES = [0, 12, 16, 20, 26, 32];
const GEN_TIER_UP = [0, 0, 0.06, 0.12, 0.18, 0.25];

export const CHAINS: ChainDef[] = [
  { index: 0, key: 'bread', name: 'パン', tiers: ['小麦粉の袋', 'パン生地', 'ロールパン', 'クロワッサン', '食パン', 'バゲットのかご', 'パンの詰め合わせ', 'パンのタワー'] },
  { index: 1, key: 'sweets', name: 'お菓子', tiers: ['砂糖', 'あめ玉', 'クッキー', 'ドーナツ', 'プリン', 'ショートケーキ', 'ホールケーキ', 'ウェディングケーキ'] },
  { index: 2, key: 'veg', name: '野菜', tiers: ['野菜の種', 'ポットの苗', 'にんじん', 'トマト', 'キャベツ', '野菜かご', '野菜の木箱', '野菜の山盛り'] },
  { index: 3, key: 'flower', name: '花', tiers: ['花の種袋', '新芽', 'つぼみ', 'チューリップ', 'ひまわり', '花束', '花かご', '花のアーチ'] },
  { index: 4, key: 'fish', name: '魚', tiers: ['小魚', 'アジ', 'サバ', 'タイ', 'マグロ', '刺身の盛り合わせ', '寿司げた', '豪華な舟盛り'] },
  { index: 5, key: 'goods', name: '雑貨', tiers: ['ボタン', '糸巻き', 'ハンカチ', 'マグカップ', 'ランプ', '置き時計', '招き猫', 'からくり時計'] },
  { index: 6, key: 'tools', name: '道具', tiers: ['くぎ', 'ねじ回し', 'かなづち', 'のこぎり', 'ペンキ缶', 'はしご', '作業台', '新しい看板'] },

  {
    index: 10, key: 'oven', name: 'パン窯',
    tiers: ['小さなパン窯', 'レンガのパン窯', '大きなパン窯', '二段のパン窯', 'パン工房の窯'],
    gen: {
      energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3,
      produces: [{ minLevel: 1, chain: 'bread', weight: 10 }, { minLevel: 3, chain: 'sweets', weight: 6 }],
    },
  },
  {
    index: 11, key: 'crate', name: '八百屋の木箱',
    tiers: ['空の小さな木箱', '野菜の入った木箱', '二段の野菜棚', '屋台の木箱', '八百屋の荷車'],
    gen: {
      energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3,
      produces: [{ minLevel: 5, chain: 'veg', weight: 10 }, { minLevel: 8, chain: 'flower', weight: 3 }],
    },
  },
  {
    index: 12, key: 'bucket', name: '花屋のバケツ',
    tiers: ['ブリキのバケツ', '花のバケツ', '花の台', '花の屋台', '花のワゴン'],
    gen: {
      energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3,
      produces: [{ minLevel: 10, chain: 'flower', weight: 10 }],
    },
  },
  {
    index: 13, key: 'fishbox', name: '魚屋のトロ箱',
    tiers: ['小さなトロ箱', '氷のトロ箱', '大きなトロ箱', '魚の屋台', '魚屋のショーケース'],
    gen: {
      energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3,
      produces: [{ minLevel: 13, chain: 'fish', weight: 10 }],
    },
  },
  {
    index: 14, key: 'shelf', name: '雑貨屋の棚',
    tiers: ['小さな棚', '木の棚', 'ガラスの棚', '大きな飾り棚', '雑貨屋の陳列台'],
    gen: {
      energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3,
      produces: [{ minLevel: 16, chain: 'goods', weight: 10 }],
    },
  },
  {
    index: 15, key: 'toolbox', name: '工具箱',
    tiers: ['古い工具箱', '木の工具箱', '鉄の工具箱', '大きな道具箱', '職人の作業ワゴン'],
    gen: {
      energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3,
      produces: [{ minLevel: 20, chain: 'tools', weight: 10 }],
    },
  },
];

/** レベルで「出る段階が1つ上がる」確率に足す値 */
export const LEVEL_TIER_UP: { minLevel: number; add: number }[] = [
  { minLevel: 8, add: 0.05 },
  { minLevel: 12, add: 0.05 },
  { minLevel: 18, add: 0.05 },
  { minLevel: 25, add: 0.05 },
];

/** このレベルに上がったときにもらえる発生器（系列key） */
export const LEVEL_GRANTS: Record<number, string[]> = {
  1: ['oven'],
  5: ['crate'],
  10: ['bucket'],
  13: ['fishbox'],
  16: ['shelf'],
  20: ['toolbox'],
};

export const MAX_LEVEL = 30;

/** レベル l から l+1 に必要な経験値 */
export function xpToNext(level: number): number {
  return Math.round(10 + 6 * Math.pow(level - 1, 1.35));
}

export const ENERGY_MAX = 100;
export const ENERGY_REGEN_SEC = 60;
export const START_COINS = 0;
/** 発生器から出したアイテムを置く範囲（マス） */
export const SPAWN_RADIUS = 3;
/** つかみの予約が切れるまでのミリ秒 */
export const HOLD_MS = 15_000;

// ---- 引きやすくするための表 ----

export const CHAIN_BY_KEY = new Map(CHAINS.map((c) => [c.key, c]));
export const CHAIN_BY_INDEX = new Map(CHAINS.map((c) => [c.index, c]));

export function kindOf(chainKey: string, tier: number): number {
  const c = CHAIN_BY_KEY.get(chainKey);
  if (!c) throw new Error(`unknown chain ${chainKey}`);
  return c.index * 100 + tier;
}

export function chainOfKind(kind: number): ChainDef {
  const c = CHAIN_BY_INDEX.get(Math.floor(kind / 100));
  if (!c) throw new Error(`unknown kind ${kind}`);
  return c;
}

export function tierOfKind(kind: number): number {
  return kind % 100;
}

export function maxTierOfKind(kind: number): number {
  return chainOfKind(kind).tiers.length;
}

export function itemName(kind: number): string {
  return chainOfKind(kind).tiers[tierOfKind(kind) - 1] ?? '?';
}

export function isGeneratorKind(kind: number): boolean {
  return !!chainOfKind(kind).gen;
}

export function mergeXp(resultKind: number): number {
  return tierOfKind(resultKind);
}

export function sellCoins(kind: number): number {
  return 2 ** (tierOfKind(kind) - 1);
}

/** すべての kind（絵の読み込みなどに使う） */
export function allKinds(): number[] {
  return CHAINS.flatMap((c) => c.tiers.map((_, i) => c.index * 100 + i + 1));
}

// ---- 注文と倉庫 ----

/** 注文をくれるお客さん（絵は public/assets/customers/<key>.png） */
export const CUSTOMERS: { key: string; name: string; line: string }[] = [
  { key: 'boy', name: 'ゆうたくん', line: 'おなかすいたー！' },
  { key: 'student', name: 'みさきさん', line: '部活のあとに食べたいな' },
  { key: 'mother', name: 'はるかさん', line: '今夜のごはんに使いたいの' },
  { key: 'salaryman', name: '田中さん', line: '会社のみんなに差し入れを' },
  { key: 'grandma', name: 'キヨさん', line: '孫が遊びに来るのよ' },
  { key: 'grandpa', name: '源さん', line: '昔はこの通りもにぎやかでなあ' },
];

/** 同時に持てる注文の数 */
export const ORDER_SLOTS = 3;
export const STORAGE_START = 6;
export const STORAGE_MAX = 12;

/** 倉庫を size 枠から1枠広げるのに必要なコイン */
export function storageCost(size: number): number {
  return 20 * (size - STORAGE_START + 1);
}

// ---- みんなの依頼 ----

/** 店主（絵は public/assets/owners/<key>.png）。系列ごとに担当がいる */
export const OWNERS: Record<string, { name: string; line: string }> = {
  bread: { name: 'パン屋のゴロウさん', line: 'またみんなに焼きたてを届けたいんだ' },
  veg: { name: '八百屋のトメさん', line: '店先を野菜でいっぱいにしたいねえ' },
  flower: { name: '花屋のさくらさん', line: '通りを花で明るくしたいな' },
  fish: { name: '魚屋の辰さん', line: '威勢のいい声を通りに戻すぞ！' },
  goods: { name: '雑貨屋の文吉さん', line: 'わしの店も、もう一度開けたいのう' },
  tools: { name: '棟梁の健さん', line: 'シャッターなんざ、すぐ直してやるさ' },
};

/** 系列 → その店主 */
export const OWNER_OF_CHAIN: Record<string, string> = {
  bread: 'bread', sweets: 'bread', veg: 'veg', flower: 'flower', fish: 'fish', goods: 'goods', tools: 'tools',
  oven: 'bread', crate: 'veg', bucket: 'flower', fishbox: 'fish', shelf: 'goods', toolbox: 'tools',
};

/** 同時に出ている「みんなの依頼」の数 */
export const WORLD_ORDER_SLOTS = 2;
/** みんなの依頼がそろったとき、納品した人全員にあげるコイン */
export const WORLD_ORDER_BONUS = 20;

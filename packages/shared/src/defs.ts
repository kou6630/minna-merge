// 定義表。数値を変えるだけで調整できるようにする。
// kind = 系列番号 * 100 + 段階（段階は1から）

/** minTier: 発生器の段階がこれ以上のときだけ出る（発生器を合成して育てると、出る物が増える） */
export type ProduceRow = { minLevel: number; chain: string; weight: number; minTier?: number };

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
  /** プレゼント箱（合成できない。タップで開ける） */
  gift?: boolean;
};

/** 発生器は 1〜2 段目が部品（まだ動かない）。合成して 3 段目になると動きだす */
export const GEN_WORK_TIER = 3;
/** 2種類のアイテムを出す発生器は、このレベルまで育てると2種類目も出る */
export const SECOND_ITEM_TIER = 5;
/** 2種類目が出る確率: 発生器 Lv5 で 30%、レベルが上がるごとに増えて、最高レベルで 50% */
export function secondItemChance(genTier: number, maxTier: number): number {
  if (genTier < SECOND_ITEM_TIER) return 0;
  const k = Math.min(1, (genTier - SECOND_ITEM_TIER) / Math.max(1, maxTier - SECOND_ITEM_TIER));
  return 0.3 + 0.2 * k;
}
const GEN_CHARGES = [0, 0, 0, 12, 16, 20, 26, 32, 40, 50];
const GEN_TIER_UP = [0, 0, 0, 0, 0.06, 0.12, 0.18, 0.25, 0.3, 0.36];

export const CHAINS: ChainDef[] = [
  // ---- アイテムの系列（1つの系列は、1つの発生器からだけ出る。発生器と見分けがつくよう、建物や設備の形にはしない） ----
  { index: 0, key: 'bread', name: 'パン', tiers: ['小麦粉の袋', 'パン生地', 'ロールパン', 'クロワッサン', '食パン', 'バゲットのかご', 'パンの詰め合わせ', 'パンのタワー'] },
  { index: 1, key: 'sweets', name: 'お菓子', tiers: ['砂糖', 'あめ玉', 'クッキー', 'ドーナツ', 'プリン', 'ショートケーキ', 'ホールケーキ', 'ウェディングケーキ'] },
  { index: 2, key: 'veg', name: '野菜', tiers: ['野菜の種', 'ポットの苗', 'にんじん', 'トマト', 'キャベツ', '野菜かご', '野菜のサラダボウル', '野菜の山盛り'] },
  { index: 3, key: 'flower', name: '花', tiers: ['花の種袋', '新芽', 'つぼみ', 'チューリップ', 'ひまわり', '花束', '花かご', '花のアーチ'] },
  { index: 4, key: 'fish', name: '魚', tiers: ['小魚', 'アジ', 'サバ', 'タイ', 'マグロ', '刺身の盛り合わせ', '寿司げた', '豪華な舟盛り'] },
  { index: 5, key: 'goods', name: '雑貨', tiers: ['ボタン', '糸巻き', 'ハンカチ', 'マグカップ', 'ランプ', '置き時計', '招き猫', 'からくり時計'] },
  { index: 6, key: 'tools', name: '工具', tiers: ['くぎ', 'ねじ回し', 'かなづち', 'のこぎり', 'ペンキ缶', 'はしご', '作業台', '新しい看板'] },
  { index: 7, key: 'drink', name: 'ジュース', tiers: ['水のコップ', '氷水', 'レモン水', 'りんごジュース', 'オレンジジュース', 'ミックスジュース', 'フルーツソーダ', 'ジュースのピッチャーセット'] },
  { index: 8, key: 'snack', name: '駄菓子', tiers: ['ガム', 'ラムネ菓子', 'チョコ棒', 'おせんべい', 'わたあめ', '駄菓子の詰め合わせ', '駄菓子の大きな缶', 'くじ引きの駄菓子セット'] },
  { index: 9, key: 'fruit', name: '果物', tiers: ['さくらんぼ', 'いちご', 'りんご', 'みかん', 'もも', 'メロン', 'フルーツかご', 'フルーツの山盛り'] },
  { index: 30, key: 'pizza', name: 'ピザ', tiers: ['ピザ生地', 'トマトソースの生地', 'チーズピザ', 'マルゲリータ', 'ペパロニピザ', 'シーフードピザ', 'ピザのパーティーセット', 'ピザの大皿パーティー'] },
  { index: 31, key: 'coffee', name: 'コーヒー', tiers: ['コーヒー豆', 'コーヒーミル', 'ドリップコーヒー', 'カフェラテ', 'カプチーノ', 'コーヒーゼリー', 'コーヒーとケーキのセット', '喫茶店のコーヒーセット'] },
  { index: 32, key: 'tea', name: '紅茶', tiers: ['茶葉', 'ティーバッグ', '紅茶のカップ', 'ミルクティー', 'レモンティー', 'ティーポット', 'アフタヌーンティーのスタンド', '英国風のティーセット'] },
  { index: 33, key: 'shellfish', name: '甲殻類', tiers: ['小エビ', '小さなカニ', '甘エビ', 'ワタリガニ', '伊勢エビ', 'ズワイガニ', 'エビとカニの盛り合わせ', '豪華な甲殻類の大皿'] },
  { index: 34, key: 'cookware', name: '調理器具', tiers: ['木べら', 'おたま', 'フライパン', '片手なべ', 'やかん', '土鍋', 'せいろ', 'ピカピカの調理器具セット'] },

  // ---- 発生器（1〜2段目は部品、3段目から動く。もらえるレベルは LEVEL_GRANTS） ----
  {
    index: 10, key: 'oven', name: 'パン窯',
    tiers: ['レンガの山', '組みかけのパン窯', '小さなパン窯', 'レンガのパン窯', '大きなパン窯', '二段のパン窯', 'パン工房の窯', '石窯のパン工房', '町いちばんのベーカリー窯'],
    gen: { energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3, produces: [{ minLevel: 1, chain: 'bread', weight: 10 }, { minLevel: 1, minTier: SECOND_ITEM_TIER, chain: 'pizza', weight: 7 }] },
  },
  {
    index: 16, key: 'waterserver', name: 'ウォーターサーバー',
    tiers: ['空のペットボトル', '組みかけのサーバー', '小さなウォーターサーバー', 'ボトル2本のウォーターサーバー', 'ジュースサーバー', 'ドリンクバー', 'カフェのドリンクスタンド', '大きなドリンクカウンター', '町いちばんのジューススタンド'],
    gen: { energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3, produces: [{ minLevel: 3, chain: 'drink', weight: 10 }] },
  },
  {
    index: 17, key: 'coffeemaker', name: '喫茶のコーヒーメーカー',
    tiers: ['金属の部品', '組みかけのコーヒーメーカー', '小さなコーヒーメーカー', 'エスプレッソマシン', '大きなエスプレッソマシン', '喫茶店のカウンター', 'レトロな喫茶店の厨房', '喫茶店の店先', '町いちばんの喫茶店'],
    gen: { energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3, produces: [{ minLevel: 8, chain: 'coffee', weight: 10 }, { minLevel: 8, minTier: SECOND_ITEM_TIER, chain: 'tea', weight: 8 }] },
  },
  {
    index: 18, key: 'snackbasket', name: '駄菓子屋のかご',
    tiers: ['竹ひごの束', '編みかけのかご', '駄菓子の小さなかご', '駄菓子のかご', '駄菓子の箱', '駄菓子のワゴン', '駄菓子屋の棚', '駄菓子屋の店先', '町いちばんの駄菓子屋'],
    gen: { energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3, produces: [{ minLevel: 11, chain: 'snack', weight: 10 }] },
  },
  {
    index: 11, key: 'crate', name: '八百屋の木箱',
    tiers: ['木の板の束', '組みかけの木箱', '空の小さな木箱', '野菜の入った木箱', '二段の野菜棚', '屋台の木箱', '八百屋の荷車', '八百屋の店先', '大きな青果市場の台'],
    gen: { energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3, produces: [{ minLevel: 5, chain: 'veg', weight: 10 }, { minLevel: 5, minTier: SECOND_ITEM_TIER, chain: 'fruit', weight: 8 }] },
  },
  {
    index: 19, key: 'cakeoven', name: 'ケーキ屋のオーブン',
    tiers: ['オーブンの部品', '組みかけのオーブン', '小さなケーキ型', 'ケーキのオーブン', 'パティシエのオーブン', 'ケーキのショーケース', 'ケーキ屋の厨房', 'パティスリーの店先', '町いちばんのケーキ屋'],
    gen: { energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3, produces: [{ minLevel: 14, chain: 'sweets', weight: 10 }] },
  },
  {
    index: 12, key: 'bucket', name: '花屋のバケツ',
    tiers: ['ブリキの板', '組みかけのバケツ', 'ブリキのバケツ', '花のバケツ', '花の台', '花の屋台', '花のワゴン', '花屋の店先', '花でいっぱいの温室'],
    gen: { energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3, produces: [{ minLevel: 17, chain: 'flower', weight: 10 }] },
  },
  {
    index: 13, key: 'fishbox', name: '魚屋のトロ箱',
    tiers: ['発泡スチロールの板', '組みかけのトロ箱', '小さなトロ箱', '氷のトロ箱', '大きなトロ箱', '魚の屋台', '魚屋のショーケース', '魚屋の店先', '大漁の魚市場'],
    gen: { energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3, produces: [{ minLevel: 20, chain: 'fish', weight: 10 }, { minLevel: 20, minTier: SECOND_ITEM_TIER, chain: 'shellfish', weight: 7 }] },
  },
  {
    index: 14, key: 'shelf', name: '雑貨屋の棚',
    tiers: ['棚板の束', '組みかけの棚', '小さな棚', '木の棚', 'ガラスの棚', '大きな飾り棚', '雑貨屋の陳列台', '雑貨屋の店先', 'なんでもそろう百貨店の棚'],
    gen: { energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3, produces: [{ minLevel: 24, chain: 'goods', weight: 10 }, { minLevel: 24, minTier: SECOND_ITEM_TIER, chain: 'cookware', weight: 8 }] },
  },
  {
    index: 15, key: 'toolbox', name: '工具箱',
    tiers: ['取っ手と金具', '組みかけの工具箱', '古い工具箱', '木の工具箱', '鉄の工具箱', '大きな道具箱', '職人の作業ワゴン', '大工の作業小屋', '棟梁の工房'],
    gen: { energyCost: 1, charges: GEN_CHARGES, chargeSec: 20, tierUp: GEN_TIER_UP, maxOutTier: 3, produces: [{ minLevel: 28, chain: 'tools', weight: 10 }] },
  },
];

/** プレゼント箱。合成できず、タップで開けると中身がまわりに出る。段階 1=白 < 2=青 < 3=赤 < 4=紫 */
CHAINS.push({ index: 40, key: 'gift', name: 'プレゼント', tiers: ['白いプレゼント', '青いプレゼント', '赤いプレゼント', '紫のプレゼント'], gift: true });

/**
 * 箱の中身。タップするたびに1個出る。safe 回までは必ず残り、そのあとはタップのたびに breakChance で消える（その回の分は出る）。
 * from: 'child' = 今のレベルで作れる子アイテム / 'gen' = 自分が持っている発生器そのもの（段階 minTier〜maxTier）
 */
export type GiftDef = { safe: number; breakChance: number; from: 'child' | 'gen'; minTier: number; maxTier: number };
export const GIFTS: GiftDef[] = [
  { safe: 5, breakChance: 0.5, from: 'child', minTier: 2, maxTier: 3 }, // 白
  { safe: 5, breakChance: 0.5, from: 'child', minTier: 2, maxTier: 5 }, // 青
  { safe: 3, breakChance: 0.5, from: 'gen', minTier: 1, maxTier: 2 }, // 赤
  { safe: 3, breakChance: 0.5, from: 'gen', minTier: 2, maxTier: 4 }, // 紫
];

/** レベルアップでもらえる箱（段階の一覧）。毎回 白、2の倍数で 青、3の倍数で 赤、5の倍数で 紫 */
export function levelGiftTiers(level: number): number[] {
  const out = [1];
  if (level % 2 === 0) out.push(2);
  if (level % 3 === 0) out.push(3);
  if (level % 5 === 0) out.push(4);
  return out;
}

/** ストーリーでもらえる箱（章の番号 → 箱の段階）。50% は白か青、クリアは赤 */
export const STORY_HALF_GIFTS: Record<number, number> = { 2: 1, 4: 2, 6: 1, 8: 2, 10: 2, 12: 2, 14: 2, 16: 2, 18: 2 };
export const STORY_CLEAR_GIFTS: Record<number, number> = { 3: 3, 6: 3, 9: 3, 12: 3, 15: 3, 18: 3, 20: 4 };

/** レベルで「出る段階が1つ上がる」確率に足す値 */
export const LEVEL_TIER_UP: { minLevel: number; add: number }[] = [
  { minLevel: 6, add: 0.05 },
  { minLevel: 12, add: 0.05 },
  { minLevel: 20, add: 0.05 },
  { minLevel: 30, add: 0.05 },
];

/** このレベルに上がったときにもらえる発生器（系列key） */
export const LEVEL_GRANTS: Record<number, string[]> = {
  1: ['oven'],
  3: ['waterserver'],
  5: ['crate'],
  8: ['coffeemaker'],
  11: ['snackbasket'],
  14: ['cakeoven'],
  17: ['bucket'],
  20: ['fishbox'],
  24: ['shelf'],
  28: ['toolbox'],
};

export const MAX_LEVEL = 80;

/**
 * レベル l から l+1 に必要な経験値。1年くらいかけて上限に届くように、上のレベルほど重くする
 * （試算: 3章で Lv8、7章で Lv15、20章で Lv37、上限 Lv80 まで経験値およそ70万＝スタミナ約18万）
 */
export function xpToNext(level: number): number {
  return Math.round(12 + 20 * Math.pow(level - 1, 1.62));
}

/** レベルが上がったときにもらえるスタミナ（満タンまで）。満タン回復にすると序盤が待ちなしで回り続けるので小さめ */
export const LEVEL_UP_ENERGY = 20;
/**
 * 章クリアの経験値を足したあとのレベルが、多くても1つ上までになるように、足す量を止める。
 * （ふつうに遊んでいれば止まることはない。マージをほとんどせずにストーリーだけ進めたときだけ）
 */
export function cappedClearXp(level: number, xp: number, amount: number): number {
  return Math.max(0, Math.min(amount, xpToNext(level) - xp + xpToNext(level + 1) - 1));
}

/** 注文のコイン: 段階1換算1つにつき2コイン。段階3から、1段上がるごとに +30%（高い段階を作る手間が報われる） */
export function orderCoins(kind: number, count = 1): number {
  const t = kind % 100;
  return Math.round(count * 2 * 2 ** (t - 1) * (1 + 0.3 * Math.max(0, t - 2)));
}

export const ENERGY_MAX = 100;
export const ENERGY_REGEN_SEC = 60;

// ---- ジェムの使い道 ----
/**
 * スタミナ回復: GEM_ENERGY_COST ジェムで +GEM_ENERGY_AMOUNT（上限をこえてもよい）。
 * 試算: ジェムを全部スタミナに使うと、待ち時間がおよそ半分になる値段（それより安いと待ちがなくなる）
 */
export const GEM_ENERGY_COST = 25;
export const GEM_ENERGY_AMOUNT = 50;
/** 発生器をすぐ満タンにする: 足りない回数 GEM_PER_CHARGES 回ごとに1ジェム（最低1） */
export const GEM_PER_CHARGES = 10;
export function genRefillCost(missing: number): number {
  return Math.max(1, Math.ceil(missing / GEM_PER_CHARGES));
}
/** 光るカーソル: カーソルはふだん光っている。光っている同士がぶつかると2人ともスタミナ、2人とも15分光らない */
export const GLOW_COOLDOWN_MS = 15 * 60_000;
export const GLOW_ENERGY = 20;
/** ぶつかったとみなす近さ（マス） */
export const GLOW_HIT_R = 1;
export const START_COINS = 0;
/** 発生器から出したアイテムを置く範囲（マス） */
/** 発生器が物を出す範囲（近い順に探す。空いていれば開いている所のどこにでも出す） */
export const SPAWN_RADIUS = 100;
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

export function isGiftKind(kind: number): boolean {
  return !!chainOfKind(kind).gift;
}

/** 動く発生器か（発生器の 1〜2 段目は部品で、まだ何も出せない） */
export function isWorkingGenerator(kind: number): boolean {
  return isGeneratorKind(kind) && tierOfKind(kind) >= GEN_WORK_TIER;
}

export function mergeXp(resultKind: number): number {
  return tierOfKind(resultKind);
}

/** レベルごとのコイン化の値段（Lv1 はゴミ箱で 0）。最高段階の Lv8 は作ったごほうびとして高め */
const SCRAP_COINS = [0, 0, 1, 2, 4, 6, 10, 14, 400];
export function scrapCoins(kind: number): number {
  return SCRAP_COINS[Math.min(SCRAP_COINS.length - 1, tierOfKind(kind))]!;
}
/** ゴミ箱・コイン化のあと、元に戻せる時間 */
export const UNDO_SELL_MS = 5000;

export function sellCoins(kind: number): number {
  return 2 ** (tierOfKind(kind) - 1);
}

/** すべての kind（絵の読み込みなどに使う） */
export function allKinds(): number[] {
  return CHAINS.flatMap((c) => c.tiers.map((_, i) => c.index * 100 + i + 1));
}

// ---- 注文と倉庫 ----

/**
 * 注文をくれる人。ストーリーの登場人物（レイナとリョウジ以外）を、ストーリーに出てくる順に。
 * key はストーリーの話し手 id（顔は assets/story/<key>_smile.png）
 */
export const CUSTOMERS: { key: string; name: string; line: string }[] = [
  { key: 'momo', name: 'モモ', line: 'ママ、これほしい！' },
  { key: 'gorou', name: 'ゴロウさん', line: '店に並べる分が足りなくてな' },
  { key: 'takumi', name: 'タクミ', line: '揚げ物に使いたいんすよ！' },
  { key: 'misaki', name: 'ミサキ', line: 'ケーキの飾りにぴったり' },
  { key: 'yuri', name: 'ユリさん', line: 'お店に飾りたいのよ' },
  { key: 'haruto', name: 'ハルト', line: '喫茶店のメニューに使いたくて' },
  { key: 'kiyo', name: 'キヨさん', line: '孫が遊びに来るのよ' },
  { key: 'daigo', name: 'ダイゴ', line: 'トレーニングのあとに食いたい！' },
];

/** 注文: 最初は2人。並んだ注文を全部クリアするたびに数えて、2回ごとに1人ふえる（最大8人） */
export const ORDER_START_CUSTOMERS = 2;
export const CLEARS_PER_CUSTOMER = 2;
/** 全部クリア3回ごとに、2個注文（アイテム2つ）の人が1人ふえる。最後は8人全員が2個注文 */
export const CLEARS_PER_DOUBLE = 3;

/** 全部クリアの回数 → 注文をくれる人数 */
export function orderCustomerCount(clears: number): number {
  return Math.min(CUSTOMERS.length, ORDER_START_CUSTOMERS + Math.floor(clears / CLEARS_PER_CUSTOMER));
}

/** 全部クリアの回数 → 2個注文の人数（その回に来る人数まで） */
export function orderDoubleCount(clears: number): number {
  return Math.min(orderCustomerCount(clears), Math.floor(clears / CLEARS_PER_DOUBLE));
}
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
  drink: 'bread', snack: 'goods', fruit: 'veg', pizza: 'bread', coffee: 'bread', tea: 'bread', shellfish: 'fish', cookware: 'goods',
  waterserver: 'bread', coffeemaker: 'bread', snackbasket: 'goods', cakeoven: 'bread',
  oven: 'bread', crate: 'veg', bucket: 'flower', fishbox: 'fish', shelf: 'goods', toolbox: 'tools',
};

/** 同時に出ている「みんなの依頼」の数 */
export const WORLD_ORDER_SLOTS = 2;
/** みんなの依頼がそろったとき、納品した人全員にあげるコイン */
export const WORLD_ORDER_BONUS = 20;

/** みんなのシャッター（サーバーで遊ぶとき）: 最初のシャッターに要る数（2段目のアイテム） */
export const COMMON_FIRST_COUNT = 40;
/** シャッターを1枚開けるごとに、要る量が増える割合 */
export const COMMON_GROWTH = 0.08;

/**
 * みんなのシャッターに要る数。opened: 開いている区画の数（最初は1）。
 * 段階が1つ上がると値うちが2倍なので、数は半分に（20個以上は5の倍数にそろえる）
 */
export function commonCount(tier: number, opened: number): number {
  const value = COMMON_FIRST_COUNT * 2 * (1 + COMMON_GROWTH * Math.max(0, opened - 1));
  const n = value / 2 ** (tier - 1);
  return n >= 20 ? Math.round(n / 5) * 5 : Math.max(3, Math.round(n));
}

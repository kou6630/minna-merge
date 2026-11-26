// 商店街マップ（PixiJS・2:1 ダイメトリック 26.6°）
// ・通り（gx 方向）の両側に 4×3 マスの建物がすき間なく並ぶ。左=gy 小（画面上）、右=gy 大（画面手前）
// ・お店は屋根なしの部品組み立て（床タイル＋奥の壁＋手前の腰壁）。家具・飾りは型紙の箱で作った素材を
//   box-meta.json（足元の角と拡大率）でマスにピッタリ置く
// ・未解放の区画はマス単位の小さな雲で隠し、区画が開くと手前から順に晴れる
// ・ゴミの山の撤去・床の張り替えは、揺れ→破片とほこり→沈む→キラキラ／タイルが1枚ずつ裏返って光る演出
import { AnimatedSprite, Application, Assets, Container, Graphics, Matrix, Rectangle, Sprite, Texture } from 'pixi.js';
import { CHAPTERS, SHOPS_11, STORY_ASSET_V, isChapterComplete } from '@minna/shared';
import type { StoryProgress } from '@minna/shared';

const TILE_W = 128;
const TILE_H = 64;
const WALK_FRAMES = 6;

export function isoPos(gx: number, gy: number): { x: number; y: number } {
  return { x: (gx + gy) * (TILE_W / 2), y: (gy - gx) * (TILE_H / 2) };
}
const depthOf = (gx: number, gy: number, bias = 0) => (gy - gx) * 100 + bias;

type BoxMeta = { ax: number; ay: number; s: number; W: number; D: number };
type AnimType = 'remove' | 'pop' | 'drop';
type Anim = { type: AnimType; t: number; dur: number; onMid?: () => void; mid?: boolean };
/** 選んだあとの絵（家具や飾りの3択 _0〜_2）は、使うときに読み込む（全部だと 400MB をこえる） */
function isLazyKey(path: string): boolean {
  return /_[012]\.png$/.test(path) && !/^iso\/(walk_|sw_|town_|gate_)/.test(path);
}

type Prop = {
  id: string; gx: number; gy: number; c: Container; sp: Sprite;
  /** 今出したい絵（あとから読み込む絵のとき、読み終わったら貼る） / 幅指定で置いた物の幅 */
  want?: string; tw?: number;
  /** 人が通れない物（花壇・ベンチ・家具など）。fw×fh は床の大きさ（マス） */
  block?: boolean; fw?: number; fh?: number;
  sx: number; sy: number;
  /** 箱置き（足元の角の位置）。null なら targetW 置き */
  box: { cx: number; cy: number } | null;
  dirtyKey?: string; cleanKey?: string;
  anim?: Anim; occ?: boolean; need?: number; fade: number;
  /** 左右反転して置く（向きが gx 方向から gy 方向に変わる） */
  flip?: boolean;
  /** 床や壁に貼る平らな絵（ラグ・壁の絵）。floor: 床の長方形 gx0..gx0+w, gy0..gy0+h。wallx: gy=gy0 の壁に gx0..gx0+w、wally: gx=gx0 の壁に gy0..gy0+w。z0..z1 は床からの高さ px */
  flat?: { kind: 'floor' | 'wallx' | 'wally'; gx0: number; gy0: number; w: number; h: number; z0: number; z1: number; inner: Container };
};
type Tile = { gx: number; gy: number; sp: Sprite; dirtyKey: string; cleanKey: string; t: number; flipping: boolean; swapped: boolean };
type Walker = {
  id: string; c: Container; idle: Sprite; walkDr: AnimatedSprite; walkUr: AnimatedSprite;
  gx: number; gy: number; path: { gx: number; gy: number }[]; speed: number;
  baseScale: number; walkScale: number; facingLeft: boolean; walking: boolean;
};
type Cloud = { sp: Sprite; bx: number; by: number; ph: number; unit: number; clearing: boolean; t: number; delay: number; a: number; s0: number };
type Particle = { g: Graphics; vx: number; vy: number; grav: number; vr: number; life: number; max: number; grow: number; a0: number };
type Pile = { prop: Prop; cells: [number, number][] };

/** お店の区画（ox, oy = 左上のマス。SW×SD マス）。入口は真ん中の2マス（ox+3, ox+4） */
const SW = 8;
const SD = 6;
const doorCol = (s: { ox: number }, x: number) => x === s.ox + 3 || x === s.ox + 4;
type ShopKey = 'bakery' | 'fry' | 'cake' | 'cloth' | 'cafe' | 'dagashi' | 'gym' | (typeof SHOPS_11)[number]['key'];
type ShopDef = { ox: number; oy: number; side: 'L' | 'R'; pre: string; floor: [string, string]; unit: number; mirror?: { mx: number; my: number } };
const SHOPS = {
  bakery: { ox: 5, oy: -1, side: 'L', pre: 'b', floor: ['bfloor_dirty', 'bfloor_clean'], unit: 2 },
  fry: { ox: 5, oy: 11, side: 'R', pre: 'fry', floor: ['old_floor_dirty', 'fry_floor_clean'], unit: 4 },
  cake: { ox: 13, oy: -1, side: 'L', pre: 'cake', floor: ['old_floor_dirty', 'cake_floor_clean'], unit: 5 },
  cloth: { ox: 13, oy: 11, side: 'R', pre: 'cloth', floor: ['old_floor_dirty', 'cloth_floor_clean'], unit: 6 },
  // 神社の参道（広場から左上へのびる道）のお店。入口を道に向けるため、通りのお店を左右反転した形にする。
  // ローカルの (lx, ly)（通りのお店と同じ。lx 0〜7 が間口、ly 0〜5 が奥行き）が、マップの (mx - ly, my - lx) になる
  cafe: { ox: 0, oy: 0, side: 'L', pre: 'cafe', floor: ['old_floor_dirty', 'cafe_floor_clean'], unit: 8, mirror: { mx: 34, my: 4 } },
  dagashi: { ox: 0, oy: 0, side: 'R', pre: 'dagashi', floor: ['old_floor_dirty', 'dagashi_floor_clean'], unit: 9, mirror: { mx: 20, my: -4 } },
  gym: { ox: 0, oy: 0, side: 'L', pre: 'gym', floor: ['old_floor_dirty', 'gym_floor_clean'], unit: 10, mirror: { mx: 34, my: -5 } },
} as Record<ShopKey, ShopDef>;
// 11〜20章のお店。北の道（広場から右上へのびる gx 方向の道）は通りのお店と同じ向き（左=gy -1〜4、右=gy 11〜16）、
// 西の道（広場から右下へのびる gy 方向の道）は参道のお店と同じ反転した向き
for (const s of SHOPS_11) {
  SHOPS[s.key] = 'ox' in s
    ? { ox: s.ox, oy: s.side === 'L' ? -1 : 11, side: s.side, pre: s.key, floor: ['old_floor_dirty', `${s.key}_floor_clean`], unit: s.ch }
    : { ox: 0, oy: 0, side: s.side, pre: s.key, floor: ['old_floor_dirty', `${s.key}_floor_clean`], unit: s.ch, mirror: { mx: s.mx, my: s.my } };
}
/** 北の道の区切り（片付けの章ごと）: [gx の始め, 終わり, 章] */
const NORTH_ROAD: [number, number, number][] = [[32, 37, 11], [38, 43, 12], [44, 47, 13], [48, 51, 17], [52, 55, 18], [56, 59, 19]];
/** 西の道の区切り: [gy の始め, 終わり, 章] */
const WEST_ROAD: [number, number, number][] = [[15, 19, 14], [20, 23, 15], [24, 30, 16]];
/** 西の道のマスの章。gy 20〜27 は道の左右で分ける（左 gx 21〜24 は写真館の前で15章、右 gx 25〜28 は銭湯の前で16章） */
const westSeg = (x: number, y: number): number => {
  if (y >= 20 && y <= 27) return x <= 24 ? 15 : 16;
  return WEST_ROAD.find(([a, b]) => y >= a && y <= b)?.[2] ?? 0;
};
/** 北の道のおくの夏祭りの広場（ストーリー20） */
const FEST = { x0: 60, x1: 73, y0: 0, y1: 15 };
const inFest = (x: number, y: number) => x >= FEST.x0 && x <= FEST.x1 && y >= FEST.y0 && y <= FEST.y1;
/** お店のローカル座標 → マップの座標 */
const shopAt = (s: ShopDef, lx: number, ly: number): [number, number] => (s.mirror ? [s.mirror.mx - ly, s.mirror.my - lx] : [s.ox + lx, s.oy + ly]);
/** マップのマス → お店のローカル座標 */
const shopLocal = (s: ShopDef, x: number, y: number): [number, number] => (s.mirror ? [s.mirror.my - y, s.mirror.mx - x] : [x - s.ox, y - s.oy]);
const inShopCell = (s: ShopDef, x: number, y: number) => {
  const [lx, ly] = shopLocal(s, x, y);
  return lx >= 0 && lx < SW && ly >= 0 && ly < SD;
};
/** 壁の帯がある列（入口の2マスは帯なし）。奥の壁は右の店、手前の腰壁は左の店に入口がある */
const wallTiles = (s: ShopKey, part: 'gx' | 'low') => {
  const door = (part === 'gx') === (SHOPS[s].side === 'R');
  return Array.from({ length: SW }, (_, i) => i).filter((i) => !door || (i !== 3 && i !== 4));
};

/** 解放の単位: この章をクリアすると、その区画の雲が晴れる */
const UNIT_OPENED_BY: Record<number, number> = { 2: 1, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9, 11: 10, 12: 11, 13: 12, 14: 13, 15: 14, 16: 15, 17: 16, 18: 17, 19: 18, 20: 19 };
/** 円形広場の中心と半径（マス） */
const PLAZA = { cx: 24.5, cy: 7.5, r: 5 };

/** ゴミの山（2×2 マスの左上マス） */
const PILES: Record<string, { x: number; y: number; tex: string }[]> = {
  // ゴミの山は 2×2 マス（x-0.5〜x+1.5, y-0.5〜y+1.5）。門の柱（gx 0.9 まで）や花壇・ベンチに重ねない
  p1: [{ x: 2, y: 6, tex: 'pile_rubble' }, { x: 3, y: 8, tex: 'pile_bags' }, { x: 1, y: 8, tex: 'pile_wood' }],
  p2: [{ x: 6, y: 7, tex: 'pile_bags' }, { x: 9, y: 8, tex: 'pile_rubble' }, { x: 11, y: 6, tex: 'pile_wood' }],
  p4: [{ x: 6, y: 13, tex: 'pile_wood' }, { x: 8, y: 14, tex: 'pile_bags' }, { x: 9, y: 12, tex: 'pile_rubble' }],
  p5: [{ x: 14, y: 7, tex: 'pile_rubble' }, { x: 17, y: 8, tex: 'pile_bags' }, { x: 15, y: 1, tex: 'pile_wood' }, { x: 17, y: 2, tex: 'pile_bags' }],
  p6: [{ x: 14, y: 13, tex: 'pile_wood' }, { x: 16, y: 14, tex: 'pile_bags' }, { x: 17, y: 12, tex: 'pile_rubble' }],
  // 円形広場（中心 24.5, 7.5・半径 5）。噴水（gx 22.5〜26.5, gy 5.5〜9.5）やベンチ・街灯・道しるべの場所はあける
  p7: [{ x: 21, y: 7, tex: 'pile_rubble' }, { x: 27, y: 4, tex: 'pile_bags' }, { x: 24, y: 11, tex: 'pile_wood' }],
  // 神社の参道（gx 21〜28）。お店の入口の前（カフェ gy 0〜1・ジム gy -9〜-8 の gx 28、駄菓子屋 gy -8〜-7 の gx 21）はあける
  p8: [{ x: 23, y: -2, tex: 'pile_rubble' }, { x: 25, y: 0, tex: 'pile_bags' }],
  p9: [{ x: 23, y: -11, tex: 'pile_wood' }, { x: 24, y: -6, tex: 'pile_bags' }],
  p10: [{ x: 26, y: -12, tex: 'pile_rubble' }, { x: 23, y: -13, tex: 'pile_wood' }],
  // 北の道（gy 5〜10）。お店の入口の前（入口の2列）はあける
  p11: [{ x: 33, y: 6, tex: 'pile_rubble' }, { x: 35, y: 8, tex: 'pile_bags' }],
  p12: [{ x: 41, y: 8, tex: 'pile_wood' }, { x: 42, y: 6, tex: 'pile_bags' }],
  p13: [{ x: 44, y: 6, tex: 'pile_rubble' }, { x: 46, y: 8, tex: 'pile_wood' }],
  p17: [{ x: 49, y: 8, tex: 'pile_bags' }, { x: 50, y: 6, tex: 'pile_rubble' }],
  p18: [{ x: 53, y: 6, tex: 'pile_wood' }, { x: 54, y: 8, tex: 'pile_bags' }],
  p19: [{ x: 57, y: 8, tex: 'pile_rubble' }, { x: 58, y: 6, tex: 'pile_wood' }],
  // 西の道（gx 21〜28）
  p14: [{ x: 23, y: 17, tex: 'pile_rubble' }, { x: 25, y: 18, tex: 'pile_bags' }],
  p15: [{ x: 22, y: 21, tex: 'pile_wood' }, { x: 23, y: 23, tex: 'pile_rubble' }],
  p16: [{ x: 25, y: 25, tex: 'pile_bags' }, { x: 25, y: 28, tex: 'pile_wood' }],
  // 夏祭りの広場（やぐら gx 65.5〜67.5・gy 6.5〜8.5 と屋台・入口のゲートの場所はあける）
  p20: [{ x: 62, y: 2, tex: 'pile_rubble' }, { x: 69, y: 11, tex: 'pile_wood' }, { x: 63, y: 12, tex: 'pile_bags' }],
};

/** 店内の家具1つずつの作業の場所（カメラ・歩く先・3択の置き場所） */
function shopItemFx(): Record<string, Fx> {
  const out: Record<string, Fx> = {};
  const list: [ShopKey, string][] = [['bakery', 'ch3'], ['fry', 'ch4'], ['cake', 'ch5'], ['cloth', 'ch6'], ['cafe', 'ch8'], ['dagashi', 'ch9'], ['gym', 'ch10'],
    ...SHOPS_11.map((s) => [s.key, `ch${s.ch}`] as [ShopKey, string])];
  for (const [k, ch] of list) {
    const s = SHOPS[k];
    const L = s.side === 'L';
    // [何, カメラの x, y（相対）, 歩く先 x, y（相対）]
    const spots: [string, number, number, number, number][] = L
      ? [['shelf', 5.7, 0.0, 3.6, 1.2], ['side', 6.9, 1.6, 5.2, 2.0], ['table', 0.8, 2.8, 2.0, 3.4], ['plant', 0.1, 4.9, 1.2, 4.6], ['corner', 6.7, 4.9, 5.4, 4.6], ['rug', 1.0, 3.0, 2.8, 3.0], ['art', 3.5, -0.4, 3.5, 1.0], ['sign', 4.8, 6.2, 3.0, 6.6]]
      : [['shelf', 0.6, 0.0, 2.0, 1.2], ['side', 6.9, 2.3, 5.4, 2.4], ['table', 5.4, 3.8, 4.0, 3.2], ['plant', 0.1, 4.9, 1.2, 4.6], ['corner', 6.7, 4.9, 5.2, 4.2], ['rug', 5.4, 3.7, 3.8, 3.7], ['art', 7.3, 4.5, 5.8, 4.6], ['sign', 4.8, -1.2, 3.2, -1.9]];
    for (const [what, fx, fy, wx, wy] of spots) {
      out[`${ch}_${what}`] = { focus: [...shopAt(s, fx, fy), 1.35], walk: shopAt(s, wx, wy), choice: `${k}_${what}` };
    }
  }
  return out;
}

/** 参道のお店の章の作業（片付け・壁と床・大きな家具2つ・店先）の場所。ローカル座標から決める */
function shopFx(k: ShopKey, ch: string, road: string, [a, b]: [string, string]): Record<string, Fx> {
  const s = SHOPS[k];
  const L = s.side === 'L';
  const at = (lx: number, ly: number) => shopAt(s, lx, ly);
  const [fx, fy] = at(3.5, L ? 7.5 : -2.5);
  return {
    [`${ch}_clean`]: { focus: [fx, fy, 1.0], walk: at(3.5, L ? 6.8 : -1.8), remove: [`p${ch.slice(2)}`], tiles: [road] },
    [`${ch}_repair`]: { focus: [...at(3.5, 2.5), 1.0], walk: at(3.5, 3.0), tiles: [`${k}Floor`], swap: [`${k}Walls`] },
    [`${ch}_${a}`]: { focus: [...(L ? at(0.8, 0.4) : at(5.7, -0.2)), 1.3], walk: L ? at(1.0, 1.8) : at(5.4, 1.5), choice: `${k}A` },
    [`${ch}_${b}`]: { focus: [...(L ? at(5.7, 3.0) : at(0.7, 2.6)), 1.2], walk: L ? at(3.6, 2.6) : at(2.6, 2.8), choice: `${k}B` },
    [`${ch}_front`]: { focus: [...(L ? at(0.8, 6.2) : at(0.8, -1.4)), 1.3], walk: L ? at(1.0, 7.4) : at(1.2, -2.6), choice: `${k}Deco` },
  };
}

type Fx = {
  focus: [number, number, number]; walk: [number, number];
  remove?: string[]; tiles?: string[]; swap?: string[]; choice?: string;
};
const FX: Record<string, Fx> = {
  ch1_garbage: { focus: [2.5, 7.5, 1.15], walk: [2.6, 7.2], remove: ['p1'] },
  ch1_polish: { focus: [2.5, 7.5, 1.15], walk: [2.4, 7.6], tiles: ['plaza'], swap: ['plazaProps', 'lamps1'] },
  ch1_gate: { focus: [1.4, 7.5, 1.05], walk: [2.2, 7.5], choice: 'gate' },
  ch2_clean: { focus: [8.5, 7.5, 1.0], walk: [8.5, 7.5], remove: ['p2'], tiles: ['street2'], swap: ['lamps2'] },
  ch2_exterior: { focus: [8.5, 3.5, 1.0], walk: [8.5, 6.0], swap: ['bakeryLow'] },
  ch2_street_decor: { focus: [5.8, 5.2, 1.3], walk: [6.0, 6.4], choice: 'bakeryDeco' },
  ch2_terrace: { focus: [11.0, 5.0, 1.3], walk: [10.0, 6.4], choice: 'terrace' },
  ch3_floor: { focus: [8.5, 1.5, 1.0], walk: [8.5, 2.5], tiles: ['bakeryFloor'], swap: ['bakeryWalls'] },
  ch3_oven: { focus: [5.8, -0.6, 1.3], walk: [6.0, 0.8], choice: 'oven' },
  ch3_counter: { focus: [11.4, 2.0, 1.3], walk: [9.6, 2.2], choice: 'counter' },
  ch4_clean: { focus: [8.5, 12.5, 1.0], walk: [8.5, 9.6], remove: ['p4'] },
  ch4_repair: { focus: [8.5, 13.5, 1.0], walk: [8.5, 12.0], tiles: ['fryFloor'], swap: ['fryWalls'] },
  ch4_counter: { focus: [11.5, 11.4, 1.3], walk: [9.6, 12.2], choice: 'fryA' },
  ch4_seat: { focus: [5.8, 13.9, 1.15], walk: [7.6, 14.3], choice: 'fryB' },
  ch4_front: { focus: [5.8, 9.6, 1.3], walk: [6.2, 8.0], choice: 'fryDeco' },
  ch5_clean: { focus: [16.5, 5.0, 0.95], walk: [16.5, 7.0], remove: ['p5'], tiles: ['street5'], swap: ['lamps5'] },
  ch5_repair: { focus: [16.5, 1.5, 1.0], walk: [16.5, 2.5], tiles: ['cakeFloor'], swap: ['cakeWalls'] },
  ch5_case: { focus: [13.8, -0.6, 1.3], walk: [14.0, 0.8], choice: 'cakeA' },
  ch5_seat: { focus: [18.5, 2.4, 1.15], walk: [16.6, 1.6], choice: 'cakeB' },
  ch5_front: { focus: [13.8, 5.2, 1.3], walk: [14.0, 6.4], choice: 'cakeDeco' },
  ch6_clean: { focus: [16.5, 12.5, 1.0], walk: [16.5, 9.6], remove: ['p6'] },
  ch6_repair: { focus: [16.5, 13.5, 1.0], walk: [16.5, 12.0], tiles: ['clothFloor'], swap: ['clothWalls'] },
  ch6_rack: { focus: [18.4, 11.4, 1.1], walk: [16.6, 13.0], choice: 'clothA' },
  ch6_fit: { focus: [13.8, 13.9, 1.3], walk: [15.6, 14.3], choice: 'clothB' },
  ch6_front: { focus: [13.8, 9.6, 1.3], walk: [14.2, 8.0], choice: 'clothDeco' },
  ...shopItemFx(),
  ...shopFx('cafe', 'ch8', 'road8', ['counter', 'seat']),
  ...shopFx('dagashi', 'ch9', 'road9', ['rack', 'game']),
  ...shopFx('gym', 'ch10', 'road10', ['rack', 'machine']),
  ...Object.assign({}, ...SHOPS_11.map((s) => shopFx(s.key, `ch${s.ch}`, `road${s.ch}`, [s.a, s.b]))),
  // 夏祭り（ストーリー20）
  ch20_clean: { focus: [66.5, 7.5, 0.8], walk: [61.5, 7.5], remove: ['p20'], tiles: ['fest20'] },
  ch20_lanterns: { focus: [66.5, 7.5, 0.75], walk: [62.5, 6.5], choice: 'festLamps' },
  ch20_yagura: { focus: [66.5, 7.0, 1.0], walk: [64.0, 9.5], choice: 'festYagura' },
  ch20_stall: { focus: [66.0, 3.5, 0.95], walk: [66.0, 5.0], choice: 'festStall' },
  ch20_mikoshi: { focus: [64.5, 10.0, 1.1], walk: [62.5, 10.5], choice: 'festMikoshi' },
  ch7_clean: { focus: [24.5, 7.5, 0.9], walk: [23.0, 10.2], remove: ['p7'] },
  ch7_paving: { focus: [24.5, 7.5, 0.85], walk: [21.5, 9.2], tiles: ['plaza7'], swap: ['lamps7', 'plaza7Swap'] },
  ch7_fountain: { focus: [24.5, 7.2, 1.1], walk: [23.0, 10.3], choice: 'fountain' },
  ch7_seat: { focus: [24.0, 7.0, 0.95], walk: [24.5, 10.3], choice: 'plazaSeat' },
  ch7_signs: { focus: [25.0, 7.5, 0.8], walk: [21.0, 8.0], choice: 'plazaSign' },
};
const CHAPTER_FOCUS: Record<number, [number, number, number]> = {
  1: [3.0, 7.0, 0.85], 2: [8.5, 5.5, 0.8], 3: [8.5, 1.8, 0.95], 4: [8.5, 12.5, 0.9], 5: [16.5, 4.0, 0.8], 6: [16.5, 12.5, 0.9], 7: [24.5, 7.5, 0.85],
  8: [29.0, 0.5, 0.85], 9: [19.5, -7.5, 0.85], 10: [29.0, -8.5, 0.85],
  20: [66.5, 7.5, 0.75],
};
// 11〜19章: そのお店のまん中
for (const s of SHOPS_11) CHAPTER_FOCUS[s.ch] = [...shopAt(SHOPS[s.key], 3.5, s.side === 'L' ? 3.5 : 2.5), 0.85];

/** 選んで置く物（3択）。keys[i] が i 番目、dirty は選ぶ前に出しておくボロ版 */
type Slot = { prop: Prop; keys: string[]; dirty?: string; taskId: string; extra?: Prop[] };

/** 素材の背が高すぎる小物の縮小 */
const PROP_SCALE: Record<string, number> = { post: 0.6 };

const CAM = { minX: -180, maxX: 5900, minY: -2500, maxY: 1100 };

export type PreviewPick = { taskId: string; choice: number } | null;

/** ストーリーの絵を、裏で少しずつ読んでおく（商店街を開いたとき、すぐ映るように）。読んだ数を返す */
let preloaded = 0;
let preloadTotal = 0;
export function storyPreloadProgress(): { done: number; total: number } {
  return { done: preloaded, total: preloadTotal };
}
export async function preloadStoryAssets(): Promise<void> {
  if (preloadTotal) return;
  const keys = (StoryIsoMap.prototype as unknown as { assetKeys(): string[] }).assetKeys().filter((k) => !isLazyKey(k));
  preloadTotal = keys.length;
  for (let i = 0; i < keys.length; i += 6) {
    await Promise.all(keys.slice(i, i + 6).map((k) =>
      Assets.load<Texture>(`assets/story/${k}?v=${STORY_ASSET_V}`).catch(() => undefined).then(() => { preloaded++; })));
  }
}

export class StoryIsoMap {
  private app: Application | null = null;
  private host: HTMLElement | null = null;
  private mountPromise: Promise<void> | null = null;
  private root = new Container();
  private groundLayer = new Container();
  private worldLayer = new Container();
  private fxLayer = new Container();
  private cloudLayer = new Container();
  private tex = new Map<string, Texture>();
  private meta: Record<string, BoxMeta> = {};

  private props: Prop[] = [];
  /** 門は横に長いので、縦の細い帯に分けて、帯ごとに前後を決めて描く（奥のゴミや人に柱が隠されないように） */
  private gate: Prop | null = null;
  private gateStrips: Prop[] = [];
  /** お店の壁の帯（前後を fixWallDepths で決め直す） */
  private wallStrips: Prop[] = [];
  /** いま3択で選んでいる家具など。手前の建物がこれを隠すときは建物を半透明にする */
  private focusProps: Prop[] = [];
  /** 円形広場の床（ボロボロ → きれい）。target は「きれい」の濃さの目標 */
  private plazaFloor: { dirty: Sprite; clean: Sprite; target: number } | null = null;
  private groups = new Map<string, Prop[]>();
  private tileZones = new Map<string, Tile[]>();
  private piles = new Map<string, Pile[]>();
  private slots = new Map<string, Slot>();
  private clouds: Cloud[] = [];
  private particles: Particle[] = [];
  private flashes: { g: Graphics; t: number }[] = [];
  private delayed: { t: number; fn: () => void }[] = [];

  private reina: Walker | null = null;
  private momo: Walker | null = null;
  private visitors: (Walker & { wait: number })[] = [];
  private npcs = new Map<string, { prop: Prop; afterCh: number }>();

  private last = new Map<string, number | boolean>();
  private progress: StoryProgress | null = null;
  private focusPt: { gx: number; gy: number } | null = null;

  private camX = 0; private camY = 0; private camZoom = 1;
  private tCamX = 0; private tCamY = 0; private tCamZoom = 1;
  private camAnimating = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0; private pinchZoom = 1;
  /** 2本指で動かしている（指をすべてはなして、次に1本で押すまで。そのあいだのタップは押したことにしない） */
  private gestured = false;
  private dragStart: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private ready = false;
  private time = 0;

  onRestyleClick: (taskId: string) => void = () => {};

  isReady(): boolean {
    return this.ready;
  }

  mount(host: HTMLElement): Promise<void> {
    this.host = host;
    if (this.ready) return Promise.resolve();
    if (this.mountPromise) return this.mountPromise;
    this.mountPromise = this.mountInner(host).catch((err) => {
      this.mountPromise = null;
      throw err;
    });
    return this.mountPromise;
  }

  private async mountInner(host: HTMLElement) {
    const app = new Application();
    await app.init({
      resizeTo: host, background: '#8d8a84', antialias: true,
      resolution: Math.min(1.5, window.devicePixelRatio || 1), autoDensity: true,
    });
    this.app = app;
    host.appendChild(app.canvas);
    try {
      this.meta = await (await fetch(`assets/story/iso/box-meta.json?v=${STORY_ASSET_V}`)).json();
    } catch { this.meta = {}; }
    await Promise.all(this.assetKeys().filter((k) => !isLazyKey(k)).map(async (k) => {
      try { this.tex.set(k, await Assets.load<Texture>(`assets/story/${k}?v=${STORY_ASSET_V}`)); } catch { /* 無い素材は白 */ }
    }));
    this.worldLayer.sortableChildren = true;
    this.root.addChild(this.groundLayer, this.worldLayer, this.fxLayer, this.cloudLayer);
    app.stage.addChild(this.root);
    this.buildScene();
    this.bindInput(app.canvas);
    this.ready = true;
    this.syncSize();
    this.fitEntrance(false);
    app.ticker.add((tk) => this.tick(Math.min(0.05, tk.deltaMS / 1000)));
  }

  /** 表示/非表示を切り替える。非表示中のリサイズで 0×0 になっても再開時に戻し、裏での無駄な描画も止める */
  setVisible(visible: boolean) {
    if (!this.ready || !this.app) return;
    if (visible) {
      this.app.ticker.start();
      this.syncSize();
    } else {
      this.pointers.clear();
      this.dragStart = null;
      this.pinchDist = 0;
      this.app.ticker.stop();
    }
  }

  /** ホストの表示サイズに合わせてキャンバスとカメラを確実に同期する（0×0 回避） */
  syncSize() {
    if (!this.ready || !this.app || !this.host) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.app.resize();
    this.applyCamera();
  }

  private assetKeys(): string[] {
    const iso = (n: string) => `iso/${n}.png`;
    const k = new Set<string>();
    const add = (...n: string[]) => n.forEach((x) => k.add(iso(x)));
    add('tile_dirty', 'tile_clean', 'tile_walk', 'tile_asphalt', 'tile_concrete', 'tile_plaza_stone',
      'bfloor_dirty', 'bfloor_clean', 'old_floor_dirty', 'fry_floor_clean', 'cake_floor_clean', 'cloth_floor_clean',
      'gate_dirty', 'gate_0', 'gate_1', 'gate_2', 'lamp_dirty', 'lamp_clean', 'pile_rubble', 'pile_wood', 'pile_bags',
      'plaza_fountain', 'bench_dirty', 'bench_clean', 'planter_dirty', 'planter_clean', 'vending', 'post',
      'oven_0', 'oven_1', 'oven_2', 'counter_0', 'counter_1', 'counter_2', 'terrace_0', 'terrace_1', 'terrace_2',
      'mini_reina', 'mini_momo', 'mini_gorou', 'mini_takumi', 'mini_misaki', 'mini_yuri', 'mini_haruto', 'mini_kiyo', 'mini_daigo',
      'cafe_floor_clean', 'dagashi_floor_clean', 'gym_floor_clean',
      'fountain_dirty', 'fountain_0', 'fountain_1', 'fountain_2', 'plaza_seat_0', 'plaza_seat_1', 'plaza_seat_2', 'plaza_bed', 'plaza_bed_dirty',
      'sign_dirty', 'sign_0', 'sign_1', 'sign_2', 'plaza_junk_a', 'plaza_junk_b', 'plaza_junk_c', 'plaza_junk_d', 'plaza_dirty', 'plaza_clean');
    for (let i = 0; i < 12; i++) add(`town_h${i}`);
    // 店内の家具・ラグ・壁の絵・看板（それぞれ3択）
    for (const p of ['bk', 'fr', 'ck', 'cl', 'cf', 'dg', 'gm']) {
      for (const w of ['shelf', 'side', 'table', 'plant', 'corner', 'rug', 'art', 'sign']) {
        if (p === 'fr' && w === 'art') continue; // 揚げ物屋には壁の絵がない
        add(`${p}_${w}_0`, `${p}_${w}_1`, `${p}_${w}_2`);
      }
    }
    for (const k of ['bk_shelf', 'bk_table', 'bk_plant', 'bk_sack', 'fr_shelf', 'fr_cooler', 'fr_plant', 'fr_stand', 'ck_shelf', 'ck_table', 'ck_plant', 'ck_cabinet', 'cl_shelf', 'cl_table', 'cl_mannequin', 'cl_mirror', 'jk_shelf', 'jk_boxes', 'jk_plant', 'jk_crates']) add(k);
    for (const s of Object.keys(SHOPS) as ShopKey[]) {
      for (const st of ['dirty', 'clean']) {
        for (const i of wallTiles(s, 'gx')) add(`sw_${s}_gx_${st}_${i}`);
        for (const i of wallTiles(s, 'low')) add(`sw_${s}_low_${st}_${i}`);
        for (let j = 0; j < SD; j++) add(`sw_${s}_gy_${st}_${j}`);
      }
    }
    for (const p of ['street_deco', 'fry_deco', 'cake_deco', 'cloth_deco', 'cafe_deco', 'dagashi_deco', 'gym_deco']) add(`${p}_dirty`, `${p}_0`, `${p}_1`, `${p}_2`);
    for (const p of ['fry_counter', 'fry_seat', 'cake_case', 'cake_seat', 'cloth_rack', 'cloth_fit', 'cafe_counter', 'cafe_seat', 'dagashi_rack', 'dagashi_game', 'gym_rack', 'gym_machine']) add(`${p}_0`, `${p}_1`, `${p}_2`);
    // 11〜20章のお店（家具・飾り・床・店主）と夏祭り
    for (const n of SHOPS_11) {
      for (const w of ['shelf', 'side', 'table', 'plant', 'corner', 'rug', 'art', 'sign']) add(`${n.p}_${w}_0`, `${n.p}_${w}_1`, `${n.p}_${w}_2`);
      for (const slot of [n.a, n.b]) add(`${n.key}_${slot}_0`, `${n.key}_${slot}_1`, `${n.key}_${slot}_2`);
      add(`${n.key}_deco_dirty`, `${n.key}_deco_0`, `${n.key}_deco_1`, `${n.key}_deco_2`, `${n.key}_floor_clean`, `mini_${n.owner}`);
    }
    for (const w of ['yagura', 'stall', 'mikoshi']) add(`fest_${w}_0`, `fest_${w}_1`, `fest_${w}_2`);
    add('fest_lamp');
    for (const w of ['reina', 'momo', 'visitor']) for (const d of ['dr', 'ur']) for (let i = 0; i < WALK_FRAMES; i++) add(`walk_${w}_${d}_${i}`);
    for (let i = 0; i < 4; i++) k.add(`cloud_${i}.png`);
    return [...k];
  }

  private texPath(name: string): string {
    return name.includes('/') || name.startsWith('cloud_') ? name : `iso/${name}.png`;
  }

  private getTex(name: string): Texture {
    return this.tex.get(this.texPath(name)) ?? Texture.WHITE;
  }

  /** あとから読み込む絵を読む（同じ絵は1回だけ） */
  private lazyLoads = new Map<string, Promise<void>>();
  private loadLazy(path: string): Promise<void> {
    let p = this.lazyLoads.get(path);
    if (!p) {
      p = Assets.load<Texture>(`assets/story/${path}?v=${STORY_ASSET_V}`)
        .then((t) => { this.tex.set(path, t); })
        .catch(() => { this.tex.set(path, Texture.WHITE); });
      this.lazyLoads.set(path, p);
    }
    return p;
  }

  private group(name: string): Prop[] {
    let g = this.groups.get(name);
    if (!g) { g = []; this.groups.set(name, g); }
    return g;
  }

  // ---------- 置き方 ----------

  /** 型紙の箱の素材を、足元の角（gx 最小・gy 最大の角）に合わせて置く */
  private addBox(id: string, key: string, ex0: number, ey1: number, bias = 0, flip = false): Prop {
    const c = new Container();
    const sp = new Sprite(this.getTex(key));
    c.addChild(sp);
    const m = this.meta[key] as { W: number; D: number; center?: number; round?: number } | undefined;
    const W = flip ? (m?.D ?? 1) : (m?.W ?? 1);
    const D = flip ? (m?.W ?? 1) : (m?.D ?? 1);
    // 足元の点: ふつうは手前の角。道しるべのような細い柱は床の真ん中、丸い噴水は円のいちばん手前
    const p = m?.center || m?.round ? isoPos(ex0 + W / 2, ey1 - D / 2) : isoPos(ex0, ey1);
    c.position.set(p.x, p.y + (m?.round ? m.round * 45.255 : 0));
    c.zIndex = depthOf(ex0 + W / 2, ey1 - D / 2, bias);
    this.worldLayer.addChild(c);
    const prop: Prop = { id, gx: ex0 + W / 2, gy: ey1 - D / 2, c, sp, sx: 1, sy: 1, box: { cx: ex0, cy: ey1 }, fade: 1, block: true, fw: W, fh: D, flip };
    this.applyTex(prop, key);
    this.props.push(prop);
    return prop;
  }

  /** 幅指定で置く（以前からある部品用） */
  private addProp(id: string, key: string, gx: number, gy: number, targetW: number, anchorY = 0.88, bias = 0): Prop {
    const c = new Container();
    const p = isoPos(gx, gy);
    c.position.set(p.x, p.y);
    c.zIndex = depthOf(gx, gy, bias);
    const sp = new Sprite(this.getTex(key));
    sp.anchor.set(0.5, anchorY);
    const s = targetW / Math.max(1, sp.texture.width);
    sp.scale.set(s);
    c.addChild(sp);
    this.worldLayer.addChild(c);
    const prop: Prop = { id, gx, gy, c, sp, sx: s, sy: s, box: null, fade: 1, tw: targetW };
    if (!this.tex.has(this.texPath(key))) this.applyTex(prop, key);
    this.props.push(prop);
    return prop;
  }

  private applyTex(p: Prop, key: string) {
    p.want = key;
    const path = this.texPath(key);
    if (!this.tex.has(path) && isLazyKey(path)) {
      // まだ読んでいない絵: 読み終わるまで隠しておき、読めたら貼る
      p.sp.visible = false;
      // 置いた直後に隠される物（まだ選んでいない家具など）は読まない
      setTimeout(() => {
        if (p.want !== key || !p.c.visible) return;
        void this.loadLazy(path).then(() => { if (p.want === key) this.applyTex(p, key); });
      }, 0);
      return;
    }
    p.sp.visible = true;
    const tex = this.getTex(key);
    if (p.flat) {
      // 絵の四角を、床や壁の面にぴったり合う平行四辺形に変形して貼る
      const f = p.flat;
      p.sp.texture = tex;
      const W = Math.max(1, tex.width); const H = Math.max(1, tex.height);
      let m: Matrix;
      if (f.kind === 'floor') {
        const o = isoPos(f.gx0, f.gy0);
        m = new Matrix((64 * f.w) / W, (-32 * f.w) / W, (64 * f.h) / H, (32 * f.h) / H, o.x, o.y);
      } else {
        const o = isoPos(f.gx0, f.gy0);
        const dy = f.kind === 'wallx' ? -32 : 32;
        m = new Matrix((64 * f.w) / W, (dy * f.w) / W, 0, (f.z1 - f.z0) / H, o.x, o.y - f.z1);
      }
      f.inner.setFromMatrix(m);
      p.sx = 1; p.sy = 1;
      p.sp.scale.set(1, 1);
      return;
    }
    if (p.box) {
      const m = this.meta[key];
      p.sp.texture = tex;
      p.sp.anchor.set(m?.ax ?? 0.5, m?.ay ?? 0.95);
      let s = m?.s ?? 0.5;
      let ax = m?.ax ?? 0.5;
      if (m && !(m as { fixed?: number }).fixed && !(m as { round?: number }).round) {
        // 足元の測りがおかしいときは、足元の幅から決め直す
        const want = 64 * (m.W + m.D);
        const r = (tex.width * s) / want;
        if (r < 0.75 || r > 1.35) { s = (want * 1.05) / tex.width; ax = m.D / (m.W + m.D); }
      }
      s *= PROP_SCALE[key] ?? 1;
      p.sp.anchor.set(ax, m?.ay ?? 0.95);
      p.sx = p.flip ? -s : s; p.sy = s;
      // 通れない範囲も、いま表示している物の大きさにする
      if (m && p.fw !== undefined && p.fw > 0) { p.fw = p.flip ? m.D : m.W; p.fh = p.flip ? m.W : m.D; }
      if (p === this.gate) { p.sp.scale.set(p.sx, p.sy); this.buildGateStrips(); }
    } else {
      const w = p.tw ?? Math.abs(p.sx) * Math.max(1, p.sp.texture.width);
      p.sp.texture = tex;
      const s = w / Math.max(1, tex.width);
      p.sx = s; p.sy = s;
    }
    p.sp.scale.set(p.sx, p.sy);
  }

  /** 門の絵を画面で幅 32px の縦の帯に切り、帯ごとに「門の線（gx 0.5）のその位置」の前後の深さを付ける */
  private buildGateStrips() {
    const g = this.gate;
    if (!g) return;
    for (const st of this.gateStrips) {
      const sub = st.sp.texture;
      st.c.destroy({ children: true });
      sub.destroy(false); // 元の絵（source）は残す
      this.props.splice(this.props.indexOf(st), 1);
    }
    this.gateStrips = [];
    g.sp.renderable = false;
    const tex = g.sp.texture;
    const w = tex.width; const h = tex.height; const s = g.sx;
    const ax = g.sp.anchor.x; const ay = g.sp.anchor.y;
    const left = -ax * w * s; const right = (1 - ax) * w * s;
    const STEP = 32;
    for (let a = left; a < right - 0.5; a += STEP) {
      const b = Math.min(right, a + STEP);
      const fx = Math.floor((a - left) / s); const fx1 = Math.min(w, Math.ceil((b - left) / s));
      if (fx1 <= fx) continue;
      const sub = new Texture({ source: tex.source, frame: new Rectangle(tex.frame.x + fx, tex.frame.y, fx1 - fx, h) });
      const c = new Container();
      c.position.copyFrom(g.c.position);
      const sp = new Sprite(sub);
      sp.anchor.set((ax * w - fx) / (fx1 - fx), ay);
      sp.scale.set(s);
      c.addChild(sp);
      const X = g.c.position.x + (a + b) / 2;
      c.zIndex = depthOf(0.5, X / 64 - 0.5, 70);
      this.worldLayer.addChild(c);
      const st: Prop = { id: `gate_strip_${this.gateStrips.length}`, gx: 0.5, gy: X / 64 - 0.5, c, sp, sx: s, sy: s, box: null, fade: 1, occ: true, need: 450, block: false };
      this.clickable(st, 'ch1_gate');
      this.props.push(st);
      this.gateStrips.push(st);
    }
  }

  /** ラグや壁の絵（平らな物）を置く */
  private addFlat(id: string, key: string, flat: Omit<NonNullable<Prop['flat']>, 'inner'>, z: number): Prop {
    const c = new Container();
    const inner = new Container();
    const sp = new Sprite(this.getTex(key));
    inner.addChild(sp);
    c.addChild(inner);
    c.zIndex = z;
    this.worldLayer.addChild(c);
    const prop: Prop = { id, gx: flat.gx0, gy: flat.gy0, c, sp, sx: 1, sy: 1, box: null, fade: 1, block: false, flat: { ...flat, inner } };
    this.applyTex(prop, key);
    this.props.push(prop);
    return prop;
  }

  private clickable(p: Prop, taskId: string) {
    p.sp.eventMode = 'static';
    p.sp.cursor = 'pointer';
    p.sp.on('pointertap', () => {
      if (this.gestured) return;
      if ((!this.dragStart || !this.dragStart.moved) && this.progress?.done.includes(taskId)) this.onRestyleClick(taskId);
    });
  }

  // ---------- 街を組み立てる ----------

  private buildScene() {
    this.buildGround();
    this.buildTown();
    this.buildEntrance();
    for (const s of Object.keys(SHOPS) as ShopKey[]) this.buildShop(s);
    this.buildPiles();
    this.buildPlaza();
    this.buildFestival();
    this.buildChars();
    this.buildClouds();
    this.fixWallDepths();
    this.fixArtDepths();
    this.pruneClouds();
  }

  /**
   * お店の壁の帯（1マス幅の薄い壁）の前後を、まわりの物から決め直す。
   * 物はふつう床のまん中の深さで並べるが、薄くて長い壁のそばに長い家具（壁ぎわの棚など）があると、まん中どうしの比べ方では
   * 壁が家具の前に描かれてしまう。そこで、画面で重なりうる物を床の位置で「壁より手前」「壁より奥」に分け、
   * 壁の深さを「奥の物より手前、手前の物より奥」の間に入れる
   */
  private fixWallDepths() {
    const e = 0.05;
    const fp = (p: Prop) => {
      const w = p.fw ?? 0; const h = p.fh ?? 0;
      return { x0: p.gx - w / 2, x1: p.gx + w / 2, y0: p.gy - h / 2, y1: p.gy + h / 2 };
    };
    const walls = new Set(this.wallStrips);
    const others = this.props.filter((p) => !walls.has(p) && !p.flat);
    let conflicts = 0;
    for (const w of this.wallStrips) {
      const W = fp(w);
      // 画面の横の範囲（マスの単位。x = gx + gy）が重ならない物は、前後を気にしなくてよい
      const sx0 = W.x0 + W.y0; const sx1 = W.x1 + W.y1;
      let lo = -Infinity; let hi = Infinity;
      for (const o of others) {
        const O = fp(o);
        // 絵は床の大きさより少しはみ出すことがあるので、0.6 マスぶん広めに見る
        if (O.x1 + O.y1 <= sx0 - 0.6 || O.x0 + O.y0 >= sx1 + 0.6) continue;
        const behind = O.y1 <= W.y0 + e || O.x0 >= W.x1 - e;
        const front = O.y0 >= W.y1 - e || O.x1 <= W.x0 + e;
        if (behind === front) continue;
        if (behind) lo = Math.max(lo, o.c.zIndex);
        else hi = Math.min(hi, o.c.zIndex);
      }
      if (lo >= hi) { conflicts++; continue; }
      const z = w.c.zIndex;
      if (z <= lo || z >= hi) w.c.zIndex = Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : Number.isFinite(lo) ? lo + 0.5 : hi - 0.5;
    }
    if (conflicts) console.warn(`壁の前後が決められない帯: ${conflicts}`);
  }

  private buildGround() {
    const zone = (name: string) => {
      let z = this.tileZones.get(name);
      if (!z) { z = []; this.tileZones.set(name, z); }
      return z;
    };
    for (let gx = -14; gx <= 76; gx++) {
      for (let gy = -14; gy <= 34; gy++) {
        let d = 'tile_concrete'; let c = d; let z = '';
        const street = gy >= 5 && gy <= 10;
        const inShop = (Object.keys(SHOPS) as ShopKey[]).find((k) => inShopCell(SHOPS[k], gx, gy));
        // 広場から北と南へのびる道（幅8マス）。東の通りと同じ、汚れた商店街の石畳
        const nsRoad = gx >= 21 && gx <= 28 && (gy <= 4 || gy >= 11);
        // 広場を直すと、いっしょにきれいな商店街の床になる範囲: 円とそのふち、3本の道の入口（道しるべの立つ所の先で、道幅いっぱいにまっすぐ区切る）
        const inCircle = gx >= 21 && (Math.hypot(gx - PLAZA.cx, gy - PLAZA.cy) <= PLAZA.r + 0.9
          || (nsRoad && gy >= 1 && gy <= 14) || (street && gx <= 31));
        if (inShop) {
          const s = SHOPS[inShop];
          d = s.floor[0]; c = s.floor[1]; z = `${inShop}Floor`;
        } else if (inCircle) {
          d = 'tile_dirty'; c = 'tile_clean'; z = 'plaza7';
        } else if (inFest(gx, gy) || (street && gx > FEST.x1)) {
          // 夏祭りの広場（と、その先の道）
          d = 'tile_dirty'; c = 'tile_clean'; z = 'fest20';
        } else if (street && gx >= 32 && gx < FEST.x0) {
          // 北の道: お店の章ごとに、手前から順にきれいにする
          const seg = NORTH_ROAD.find(([a, b]) => gx >= a && gx <= b);
          d = 'tile_dirty'; c = 'tile_clean'; z = seg ? `road${seg[2]}` : '';
          if (!seg) c = d;
        } else if (nsRoad && gy >= 15) {
          // 西の道
          const seg = westSeg(gx, gy);
          d = 'tile_dirty'; c = 'tile_clean'; z = seg ? `road${seg}` : '';
          if (!seg) c = d;
        } else if (nsRoad && gy <= 0) {
          // 神社の参道: お店ごとの章で、手前から順にきれいにする
          d = 'tile_dirty'; c = 'tile_clean'; z = gy >= -4 ? 'road8' : gy >= -10 ? 'road9' : 'road10';
        } else if (nsRoad) {
          d = c = 'tile_dirty';
        } else if (street && gx >= 1 && gx <= 4) {
          d = 'tile_dirty'; c = 'tile_clean'; z = 'plaza';
        } else if (street && gx >= 5 && gx <= 20) {
          d = 'tile_dirty'; c = 'tile_clean'; z = gx <= 12 ? 'street2' : 'street5';
        } else if (street && gx > 20) {
          d = c = 'tile_dirty';
        } else if (street) {
          d = c = gy === 5 || gy === 10 ? 'tile_walk' : 'tile_asphalt';
        } else if (gy === -2) {
          d = c = 'tile_asphalt';
        }
        const sp = new Sprite(this.getTex(d));
        sp.anchor.set(0.5);
        sp.width = TILE_W + 2; sp.height = TILE_H + 1;
        const p = isoPos(gx, gy);
        sp.position.set(p.x, p.y);
        this.groundLayer.addChild(sp);
        if (z) zone(z).push({ gx, gy, sp, dirtyKey: d, cleanKey: c, t: 0, flipping: false, swapped: false });
      }
    }
    // 円形広場の床: 真上から見た丸い石畳の絵を、そのまま 2:1 の床に貼る（正方形 = gx 19.5〜29.5, gy 2.5〜12.5）
    const floor = (key: string) => {
      const sp = new Sprite(this.getTex(key));
      const S = Math.max(1, sp.texture.width);
      const n = PLAZA.r * 2;
      const gx0 = PLAZA.cx - PLAZA.r; const gy0 = PLAZA.cy - PLAZA.r;
      sp.setFromMatrix(new Matrix((64 * n) / S, (-32 * n) / S, (64 * n) / S, (32 * n) / S, (gx0 + gy0) * 64, (gy0 - gx0) * 32));
      this.groundLayer.addChild(sp);
      return sp;
    };
    this.plazaFloor = { dirty: floor('plaza_dirty'), clean: floor('plaza_clean'), target: 0 };
    this.plazaFloor.clean.alpha = 0;
  }

  /** 街の建物（4×3 マス）を、お店と広場以外の区画にすき間なく並べる */
  private buildTown() {
    const special = (x: number, y: number) =>
      // お店（8×6 マス）・円形広場・門の内側の左右の小さな広場
      (x >= 5 && x <= 20 && (y === -1 || y === 2 || y === 11 || y === 14)) || (x === 21 || x === 25) || (x === 1 && (y === -1 || y === 2 || y === 11 || y === 14))
      // 神社の参道のお店（駄菓子屋 gx 15〜20・gy -11〜-4、カフェとジム gx 29〜34・gy -12〜4）。駄菓子屋はケーキ屋の高い奥の壁に隠れないよう、1マスあけて奥に
      || ((x === 13 || x === 17) && y >= -13 && y <= -4) || ((x === 29 || x === 33) && y >= -13 && y <= 2)
      // 駄菓子屋のすぐ手前（左下）の列も、屋根で店の中が隠れるので建てない
      || (x === 9 && y >= -10 && y <= -4);
    // 種類ごとの建物。裏通りの向こうの列（y=17）と門の横は、通りを隠さない平屋だけ
    // 建物は build_town.py で正確な箱と屋根に組み立てたもの（AI に建物ごと描かせると屋根や面の角度がずれる）
    const low = ['town_h3', 'town_h7', 'town_h10'];
    const tall = [0, 1, 2, 4, 5, 6, 8, 9, 11].map((i) => `town_h${i}`);
    const TINTS = [0xffffff, 0xfff3e6, 0xeef0ff, 0xf3fff0, 0xffecee, 0xf7f7f7];
    const placed = new Map<string, string>();
    let n = 0;
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // 建物（x〜x+3, y〜y+2）が、お店・北と西の道・祭りの広場にかかるか
    const taken = (x: number, y: number) => {
      for (let gx = x; gx <= x + 3; gx++) {
        for (let gy = y; gy <= y + 2; gy++) {
          if ((Object.keys(SHOPS) as ShopKey[]).some((k) => inShopCell(SHOPS[k], gx, gy))) return true;
          if (gx >= 30 && gy >= 5 && gy <= 10) return true;
          if (gx >= 21 && gx <= 28 && gy >= 11) return true;
          if (inFest(gx, gy)) return true;
        }
      }
      return false;
    };
    for (let x = -15; x <= 77; x += 4) {
      for (const y of [-13, -10, -7, -4, -1, 2, 11, 14, 17, 20, 23, 26, 29]) {
        if (special(x, y)) continue;
        if (x > 33 && y <= -4) continue; // 北の道のお店の奥（画面の上の外）には建てない
        if (taken(x, y)) continue;
        // 右側のお店のすぐ裏は、建物を建てずに裏通りにする（屋根でお店の中が隠れないように）
        // 裏通りと、門のすぐ下の区画（建物を建てると広場が隠れる）は、自販機・花壇・ベンチだけ
        if (y === 17 || (x === -3 && (y === 11 || y === 14))) {
          if (y === 17) this.addBox(`alley_${x}`, 'planter_clean', x + 1.5, y + 1.6, 0);
          continue;
        }
        // 西の道のお店（写真館）のすぐ手前は、店の中が隠れるので建てない
        if (x >= 9 && x <= 20 && y >= 26) continue;
        // 通りの右側の列（y=11, 14）と裏通りの向こう（y=20）、西の道のお店の手前（y≥17）は、通りやお店を隠さない平屋だけ
        const lowOnly = y === 11 || y === 14 || y === 20 || (x >= 1 && x <= 37 && y >= 17);
        const pool = lowOnly ? low : tall;
        // 左と上の隣と同じ建物にならないように選ぶ
        let key = pool[Math.floor(rnd() * pool.length)]!;
        for (let t = 0; t < 8 && (key === placed.get(`${x - 4},${y}`) || key === placed.get(`${x},${y - 3}`) || key === placed.get(`${x + 4},${y - 3}`) || key === placed.get(`${x - 4},${y - 3}`)); t++) {
          key = pool[Math.floor(rnd() * pool.length)]!;
        }
        placed.set(`${x},${y}`, key);
        n++;
        const p = this.addBox(`town_${x}_${y}`, key, x - 0.5, y + 2.5, -20);
        p.block = false;
        p.sp.tint = TINTS[Math.floor(rnd() * TINTS.length)]!;
        // 奥の人や選んでいる物を隠すときだけ半透明にする（建物が手前にあるときだけ）
        p.occ = true;
      }
    }
  }

  /** 円形広場（ストーリー7）: 丸い石畳・噴水・ベンチ・花壇・街灯・4つの道の道しるべ */
  private buildPlaza() {
    const { cx, cy } = PLAZA;
    // 噴水（丸い水盤の半径 2 マス）
    const f = this.addBox('fountain', 'fountain_dirty', cx - 2, cy + 2, 0);
    this.slots.set('fountain', { prop: f, keys: ['fountain_0', 'fountain_1', 'fountain_2'], dirty: 'fountain_dirty', taskId: 'ch7_fountain' });
    this.clickable(f, 'ch7_fountain');
    // ベンチ: 北の道の入口の両側に、噴水のほう（手前右）を向けて置く。南西は服屋の壁の陰で見えないので置かない
    // 噴水とのあいだ（gy 5 の列）は、神社の参道へ歩いて行けるようにあけておく
    const seats: [string, number, number, boolean][] = [['pseat_nw', 21.5, 4.5, false], ['pseat_ne', 25.6, 4.5, false]];
    seats.forEach(([id, ex0, ey1, flip], i) => {
      const p = this.addBox(id, 'plaza_seat_0', ex0, ey1, 8, flip);
      p.c.visible = false;
      this.clickable(p, 'ch7_seat');
      if (i === 0) this.slots.set('plazaSeat', { prop: p, keys: ['plaza_seat_0', 'plaza_seat_1', 'plaza_seat_2'], taskId: 'ch7_seat' });
      else (this.slots.get('plazaSeat')!.extra ??= []).push(p);
    });
    // 花壇（南東）
    const bed = this.addBox('plaza_bed', 'plaza_bed_dirty', 26.45, 11.5, 4);
    bed.dirtyKey = 'plaza_bed_dirty'; bed.cleanKey = 'plaza_bed';
    this.group('plaza7Swap').push(bed);
    // 街灯（北と南の道の入口の両わき）
    for (const [x, y] of [[22.3, 3.2], [26.7, 3.2], [22.3, 11.8], [26.7, 11.8]] as const) {
      const p = this.addProp(`lamp7_${x}_${y}`, 'lamp_dirty', x, y, 58, 0.96, 6);
      p.dirtyKey = 'lamp_dirty'; p.cleanKey = 'lamp_clean'; p.block = true; p.fw = 0; p.fh = 0;
      this.group('lamps7').push(p);
    }
    // 道しるべ（北・東・南の新しい道の入口）。西の入口は北のベンチに重なって見えるので置かない。柱の位置 = 床の真ん中
    const signs: [string, number, number][] = [['sign_n', 27.0, 2.4], ['sign_e', 29.8, 4.9], ['sign_s', 27.0, 12.8]];
    signs.forEach(([id, px, py], i) => {
      const p = this.addBox(id, 'sign_dirty', px - 0.3, py + 0.3, 10);
      this.clickable(p, 'ch7_signs');
      if (i === 0) this.slots.set('plazaSign', { prop: p, keys: ['sign_0', 'sign_1', 'sign_2'], dirty: 'sign_dirty', taskId: 'ch7_signs' });
      else (this.slots.get('plazaSign')!.extra ??= []).push(p);
    });
    // 片付けるガラクタ（ガレキの山 p7 といっしょに消える）
    const list = this.piles.get('p7') ?? [];
    for (const [id, key, ex0, ey1] of [['pj_a', 'plaza_junk_a', 22.6, 4.9], ['pj_b', 'plaza_junk_b', 21.2, 11.0], ['pj_c', 'plaza_junk_c', 26.8, 7.3], ['pj_d', 'plaza_junk_d', 27.6, 9.1]] as const) {
      const p = this.addBox(id, key, ex0, ey1, 20);
      p.block = false;
      const cells: [number, number][] = [];
      for (let x = Math.round(ex0 + 0.01); x <= Math.round(ex0 + (p.fw ?? 1) - 0.01); x++) {
        for (let y = Math.round(ey1 - (p.fh ?? 1) + 0.01); y <= Math.round(ey1 - 0.01); y++) cells.push([x, y]);
      }
      list.push({ prop: p, cells });
    }
    this.piles.set('p7', list);
  }

  /** 北の道のおくの夏祭りの広場（ストーリー20）: やぐら・屋台・入口のゲート・ちょうちんの柱 */
  private buildFestival() {
    // やぐら（2×2）: 広場のまん中
    const y = this.addBox('fest_yagura', 'fest_yagura_0', 65.5, 8.5, 8);
    y.c.visible = false;
    this.clickable(y, 'ch20_yagura');
    this.slots.set('festYagura', { prop: y, keys: ['fest_yagura_0', 'fest_yagura_1', 'fest_yagura_2'], taskId: 'ch20_yagura' });
    // 屋台（3×1）: 奥のふち（gy 1.5〜2.5）に2つ、手前のふち（gy 12.5〜13.5）に1つ
    const stalls: [number, number][] = [[61.5, 2.5], [69.0, 2.5], [65.0, 13.5]];
    stalls.forEach(([ex0, ey1], i) => {
      const p = this.addBox(`fest_stall_${i}`, 'fest_stall_0', ex0, ey1, 8);
      p.c.visible = false;
      this.clickable(p, 'ch20_stall');
      if (i === 0) this.slots.set('festStall', { prop: p, keys: ['fest_stall_0', 'fest_stall_1', 'fest_stall_2'], taskId: 'ch20_stall' });
      else (this.slots.get('festStall')!.extra ??= []).push(p);
    });
    // お神輿（2×1）: やぐらの手前の左（和菓子屋の右の壁に隠れないよう、壁から離す）
    const m = this.addBox('fest_mikoshi', 'fest_mikoshi_0', 63.5, 10.5, 8);
    m.c.visible = false;
    this.clickable(m, 'ch20_mikoshi');
    this.slots.set('festMikoshi', { prop: m, keys: ['fest_mikoshi_0', 'fest_mikoshi_1', 'fest_mikoshi_2'], taskId: 'ch20_mikoshi' });
    // ちょうちんの柱: 広場の四隅と、奥・手前のふちのまん中
    const lamps: [number, number][] = [[60.6, 0.9], [73.0, 0.9], [60.6, 15.0], [73.0, 15.0], [66.6, 0.9], [72.9, 7.9]];
    lamps.forEach(([ex0, ey1], i) => {
      const p = this.addBox(`fest_lamp_${i}`, 'fest_lamp', ex0, ey1, 6);
      p.c.visible = false; p.block = true;
      if (i === 0) this.slots.set('festLamps', { prop: p, keys: ['fest_lamp', 'fest_lamp', 'fest_lamp'], taskId: 'ch20_lanterns' });
      else (this.slots.get('festLamps')!.extra ??= []).push(p);
    });
  }

  private buildEntrance() {
    // 門は広場の入口（gx 0.5）に。柱の足元が gy 4.6 と 10.4 に来る
    // 柱の床の大きさ（gate_* の絵で測った値）: 左の柱 gx 0.15〜0.9・gy 4.55〜5.35、右の柱 gx 0.15〜0.9・gy 10.55〜11.35。
    // 左の柱は隣の建物（gy 4.5 まで）に、右の柱は通りの外の空き地に、めり込まないように置く
    const gate = this.addBox('gate', 'gate_dirty', 0.15, 5.35, 0);
    gate.block = false;
    this.gate = gate;
    this.buildGateStrips();
    this.slots.set('gate', { prop: gate, keys: ['gate_0', 'gate_1', 'gate_2'], dirty: 'gate_dirty', taskId: 'ch1_gate' });
    // 押せるのは描いている帯のほう（buildGateStrips）

    // 広場の花壇・ベンチ（フェーズ1で磨く）
    const pp = this.group('plazaProps');
    const planter = (id: string, x: number, y: number) => {
      const p = this.addBox(id, 'planter_dirty', x - 0.5, y + 0.5, 4);
      p.dirtyKey = 'planter_dirty'; p.cleanKey = 'planter_clean'; pp.push(p);
    };
    planter('pl_a', 3, 5); planter('pl_b', 4, 5);
    // 門の内側の左右の区画は、建物を建てずに広場の一角（花壇とベンチ）にする。パン屋や広場が隠れないように
    for (let i = 1; i <= 4; i++) { planter(`pl_n${i}`, i, -1); planter(`pl_s${i}`, i, 16); }
    planter('pl_n5', 1, 2); planter('pl_n6', 4, 2); planter('pl_s5', 1, 13); planter('pl_s6', 4, 13);
    for (const [id, ey1] of [['bench_n', 1.3], ['bench_s', 14.3]] as const) {
      const b = this.addBox(id, 'bench_dirty', 1.5, ey1, 4);
      b.dirtyKey = 'bench_dirty'; b.cleanKey = 'bench_clean'; pp.push(b);
    }
    const bench = this.addBox('bench_a', 'bench_dirty', 2.5, 10.4, 4);
    bench.dirtyKey = 'bench_dirty'; bench.cleanKey = 'bench_clean'; pp.push(bench);

    // 街灯（その場所を掃除すると新品に）
    const lamp = (grp: string, x: number, y: number) => {
      const p = this.addProp(`lamp_${x}_${y}`, 'lamp_dirty', x, y, 58, 0.96, 6);
      p.dirtyKey = 'lamp_dirty'; p.cleanKey = 'lamp_clean'; p.block = true; p.fw = 0; p.fh = 0;
      this.group(grp).push(p);
    };
    lamp('lamps1', 4.8, 5.3); lamp('lamps1', 4.8, 9.7);
    lamp('lamps2', 12.5, 5.3); lamp('lamps2', 12.5, 9.7);
    lamp('lamps5', 20.5, 5.3); lamp('lamps5', 20.5, 9.7);

    // 門の外の自販機とポスト
    this.addBox('vending', 'vending', -3.2, 5.4, 4);
    this.addBox('post', 'post', -1.3, 10.3, 4);
  }

  private buildShop(key: ShopKey) {
    const s = SHOPS[key];
    const mir = !!s.mirror;
    const walls = this.group(`${key}Walls`);
    const low = key === 'bakery' ? this.group('bakeryLow') : walls;
    const occ = s.side === 'R';
    // 置き場所はお店のローカル座標（lx: 間口 -0.5〜7.5、ly: 奥行き -0.5〜5.5）。反転したお店は、絵も左右反転する
    const box = (id: string, tex: string, lx: number, ly: number, bias: number, flip = false) =>
      this.addBox(id, tex, ...shopAt(s, lx, ly), bias, flip !== mir);
    // 平らな物（ラグ・壁の絵）も、反転したお店では面ごと入れかえる
    type Flat = Omit<NonNullable<Prop['flat']>, 'inner'>;
    const flat = (f: Flat): Flat => {
      if (!s.mirror) return { ...f, gx0: s.ox + f.gx0, gy0: s.oy + f.gy0 };
      const { mx, my } = s.mirror;
      if (f.kind === 'floor') return { ...f, gx0: mx - f.gy0 - f.h, gy0: my - f.gx0 - f.w, w: f.h, h: f.w };
      if (f.kind === 'wallx') return { ...f, kind: 'wally', gx0: mx - f.gy0, gy0: my - f.gx0 - f.w };
      return { ...f, kind: 'wallx', gx0: mx - f.gy0 - f.w, gy0: my - f.gx0 };
    };
    // 壁は build_shops.py で正確に組み立てた帯を、各マスの足元の点に置く（角や床の端がぴったり合う）
    const strip = (part: string, i: number, lx: number, ly: number, bias: number, grp: Prop[], fade: boolean) => {
      const d = `sw_${key}_${part}_dirty_${i}`;
      const p = box(`${key}_${part}_${i}`, d, lx, ly, bias);
      p.block = false;
      this.wallStrips.push(p);
      p.dirtyKey = d; p.cleanKey = `sw_${key}_${part}_clean_${i}`; p.occ = fade; grp.push(p);
    };
    // 奥の壁（gx 方向、ly = -0.5）
    for (const i of wallTiles(key, 'gx')) strip('gx', i, -0.5 + i, -0.5, -15, walls, false);
    // 右奥の壁（gy 方向、lx = SW-0.5）
    for (let j = 0; j < SD; j++) strip('gy', j, SW - 0.5, 0.5 + j, -15, walls, occ);
    // 手前の腰壁（gx 方向、ly = SD-0.5）
    for (const i of wallTiles(key, 'low')) strip('low', i, -0.5 + i, SD - 0.5, 35, low, false);

    // 店内の配置。家具・ラグ・壁の絵・看板は、どれもそれぞれ別の作業の3択で、1つずつ変わる
    // 店の中は x: -0.5〜7.5、y: -0.5〜5.5（ローカル）。入口から奥への真ん中2列（x 2.5〜4.5）は通り道としてあける。
    // 手前右（+gy）を向く家具は奥の壁ぎわか部屋の中、手前左（-gx）を向く家具（side）は右の壁ぎわ。手前の壁ぎわは向きのない物だけ。
    const cfg = ({
      bakery: { a: ['oven', 'ch3_oven', 'oven'], b: ['counter', 'ch3_counter', 'counter'], d: 'ch2_street_decor', p: 'bk', ch: 'ch3', art: true },
      fry: { a: ['fryA', 'ch4_counter', 'fry_counter'], b: ['fryB', 'ch4_seat', 'fry_seat'], d: 'ch4_front', p: 'fr', ch: 'ch4', art: false },
      cake: { a: ['cakeA', 'ch5_case', 'cake_case'], b: ['cakeB', 'ch5_seat', 'cake_seat'], d: 'ch5_front', p: 'ck', ch: 'ch5', art: true },
      cloth: { a: ['clothA', 'ch6_rack', 'cloth_rack'], b: ['clothB', 'ch6_fit', 'cloth_fit'], d: 'ch6_front', p: 'cl', ch: 'ch6', art: true },
      cafe: { a: ['cafeA', 'ch8_counter', 'cafe_counter'], b: ['cafeB', 'ch8_seat', 'cafe_seat'], d: 'ch8_front', p: 'cf', ch: 'ch8', art: true },
      dagashi: { a: ['dagashiA', 'ch9_rack', 'dagashi_rack'], b: ['dagashiB', 'ch9_game', 'dagashi_game'], d: 'ch9_front', p: 'dg', ch: 'ch9', art: true },
      gym: { a: ['gymA', 'ch10_rack', 'gym_rack'], b: ['gymB', 'ch10_machine', 'gym_machine'], d: 'ch10_front', p: 'gm', ch: 'ch10', art: true },
    } as Record<string, { a: string[]; b: string[]; d: string; p: string; ch: string; art: boolean }>)[key] ?? (() => {
      const n = SHOPS_11.find((x) => x.key === key)!;
      return { a: [`${key}A`, `ch${n.ch}_${n.a}`, `${key}_${n.a}`], b: [`${key}B`, `ch${n.ch}_${n.b}`, `${key}_${n.b}`], d: `ch${n.ch}_front`, p: n.p, ch: `ch${n.ch}`, art: true };
    })();
    const L = s.side === 'L';
    // [何, lx, ly, 改装前のガラクタ]
    const place: [string, number, number, string?][] = L
      ? [['A', -0.3, 0.65], ['shelf', 4.7, 0.25, 'jk_shelf'], ['side', 6.55, 2.6], ['B', 4.7, 4.0], ['table', 0.3, 3.3, 'jk_boxes'], ['plant', -0.2, 5.25, 'jk_plant'], ['corner', 6.2, 5.25, 'jk_crates']]
      : [['A', 4.7, 0.65], ['shelf', -0.35, 0.25, 'jk_shelf'], ['side', 6.55, 3.3], ['B', -0.3, 3.6], ['table', 4.9, 4.3, 'jk_boxes'], ['plant', -0.2, 5.25, 'jk_plant'], ['corner', 6.2, 5.25, 'jk_crates']];
    const keys3 = (p: string) => [`${p}_0`, `${p}_1`, `${p}_2`];
    for (const [what, lx, ly, junk] of place) {
      if (what === 'A' || what === 'B') {
        const [slot, taskId, pre] = what === 'A' ? cfg.a : cfg.b;
        const p = box(`${key}_${slot}`, `${pre}_0`, lx, ly, 8);
        p.c.visible = false;
        this.clickable(p, taskId!);
        this.slots.set(slot!, { prop: p, keys: keys3(pre!), taskId: taskId! });
        continue;
      }
      const pre = `${cfg.p}_${what}`; const taskId = `${cfg.ch}_${what}`;
      const p = box(`${key}_${what}`, junk ?? `${pre}_0`, lx, ly, 6);
      if (!junk) p.c.visible = false;
      this.clickable(p, taskId);
      this.slots.set(`${key}_${what}`, { prop: p, keys: keys3(pre), dirty: junk, taskId });
    }
    // ラグ（床に貼る）: テーブルの下
    const rug = flat(L ? { kind: 'floor', gx0: -0.2, gy0: 1.6, w: 2.5, h: 2.9, z0: 0, z1: 0 } : { kind: 'floor', gx0: 4.4, gy0: 2.6, w: 2.0, h: 2.3, z0: 0, z1: 0 });
    const rp = this.addFlat(`${key}_rug`, `${cfg.p}_rug_0`, rug, -100000);
    rp.c.visible = false;
    this.clickable(rp, `${cfg.ch}_rug`);
    this.slots.set(`${key}_rug`, { prop: rp, keys: keys3(`${cfg.p}_rug`), taskId: `${cfg.ch}_rug` });
    // 壁の絵: 左の店は奥の壁の真ん中（通り道の突き当たり）、右の店は右の壁
    if (cfg.art) {
      const wall = flat(L
        ? { kind: 'wallx', gx0: 2.9, gy0: -0.5, w: 1.6, h: 0, z0: 72, z1: 136 }
        : { kind: 'wally', gx0: SW - 0.5, gy0: 3.7, w: 1.6, h: 0, z0: 72, z1: 136 });
      const cx = wall.kind === 'wallx' ? wall.gx0 + wall.w / 2 : wall.gx0;
      const cy = wall.kind === 'wallx' ? wall.gy0 : wall.gy0 + wall.w / 2;
      const ap = this.addFlat(`${key}_art`, `${cfg.p}_art_0`, wall, depthOf(cx, cy, -5));
      ap.c.visible = false; ap.occ = wall.kind === 'wally';
      this.clickable(ap, `${cfg.ch}_art`);
      this.slots.set(`${key}_art`, { prop: ap, keys: keys3(`${cfg.p}_art`), taskId: `${cfg.ch}_art` });
    }
    // 看板: 入口の右、通りの側
    const sg = box(`${key}_sign`, `${cfg.p}_sign_0`, 4.5, L ? 6.35 : -1.0, 12);
    sg.c.visible = false;
    this.clickable(sg, `${cfg.ch}_sign`);
    this.slots.set(`${key}_sign`, { prop: sg, keys: keys3(`${cfg.p}_sign`), taskId: `${cfg.ch}_sign` });
    // 店先: 入口の左にベンチの飾り。パン屋は入口の右にテラス席も
    const deco = (slot: string, taskId: string, pre: string, lx: number, ly: number) => {
      const p = box(`${key}_${slot}`, `${pre}_dirty`, lx, ly, 12);
      this.slots.set(slot, { prop: p, keys: keys3(pre), dirty: `${pre}_dirty`, taskId });
      this.clickable(p, taskId);
      if (s.side === 'R') p.occ = false;
    };
    const decoY = L ? SD + 0.6 : -1.6;
    if (key === 'bakery') {
      deco('bakeryDeco', cfg.d, 'street_deco', 0.3, decoY);
      const t = this.addBox('terrace', 'terrace_0', s.ox + 5.3, 5.6, 8);
      // テラスは店の腰壁（gy 4.5）のすぐ手前に置くので、腰壁より前に描く
      t.c.zIndex = depthOf(s.ox + 5.3, 4.5, 60);
      t.c.visible = false;
      this.slots.set('terrace', { prop: t, keys: keys3('terrace'), taskId: 'ch2_terrace' });
      this.clickable(t, 'ch2_terrace');
    } else {
      // 参道のカフェは、店先の飾りが広場のふち（gy 3.5 より手前）に出ないよう、少し入口側へ
      deco(`${key}Deco`, cfg.d, `${key}_deco`, mir && L ? 0.7 : 0.3, decoY);
    }
  }

  private buildPiles() {
    for (const [grp, list] of Object.entries(PILES)) {
      this.piles.set(grp, list.map((pl, i) => {
        const prop = this.addBox(`${grp}_${i}`, pl.tex, pl.x - 0.5, pl.y + 1.5, 20);
        prop.block = false;
        return { prop, cells: [[pl.x, pl.y], [pl.x + 1, pl.y], [pl.x, pl.y + 1], [pl.x + 1, pl.y + 1]] as [number, number][] };
      }));
    }
  }

  private buildChars() {
    this.reina = this.addWalker('reina', -1.2, 7.4, 'mini_reina', 'walk_reina', 112, 2.8);
    this.momo = this.addWalker('momo', -1.8, 7.9, 'mini_momo', 'walk_momo', 80, 2.6);
    for (let i = 0; i < 2; i++) {
      const v = this.addWalker(`visitor_${i}`, -2, 7 + i, 'walk_visitor_dr_0', 'walk_visitor', 110, 1.5);
      v.c.visible = false;
      this.visitors.push({ ...v, wait: 1 + i * 2 });
    }
    const npc = (id: string, key: string, gx: number, gy: number, afterCh: number) => {
      const p = this.addProp(id, key, gx, gy, 56, 0.95, 28);
      const fi = this.charFit(key, 112);
      p.sp.anchor.set(0.5, fi.ay); p.sp.scale.set(fi.s); p.sx = fi.s; p.sy = fi.s;
      p.c.visible = false; p.block = true;
      this.npcs.set(id, { prop: p, afterCh });
    };
    npc('gorou', 'mini_gorou', 9.9, 6.2, 1);
    npc('takumi', 'mini_takumi', 10.0, 9.2, 3);
    npc('misaki', 'mini_misaki', 17.9, 6.2, 4);
    npc('yuri', 'mini_yuri', 18.0, 9.2, 5);
    // 参道のお店の店主（店の入口の横、道の上）
    npc('haruto', 'mini_haruto', ...shopAt(SHOPS.cafe, 4.9, 7.2), 7);
    npc('kiyo', 'mini_kiyo', ...shopAt(SHOPS.dagashi, 5.0, -1.8), 8);
    npc('daigo', 'mini_daigo', ...shopAt(SHOPS.gym, 4.9, 7.2), 9);
    // 11〜19章の店主（店の入口の横、道の上）。その章の区画が開いたら立つ
    for (const s of SHOPS_11) {
      // 右側の店は、店の前の道にその章のゴミ山があるので、入口の左（店先の飾りとのあいだ）に立つ
      npc(s.owner, `mini_${s.owner}`, ...shopAt(SHOPS[s.key], s.side === 'L' ? 4.9 : 2.75, s.side === 'L' ? 7.2 : -2.0), s.ch - 1);
    }
  }

  /** 物がどのお店の物か（お店の物でなければ ''） */
  private shopOfCache = new Map<Prop, string>();
  private shopOf(p: Prop): string {
    let s = this.shopOfCache.get(p);
    if (s === undefined) {
      const t = p.id.split('_');
      s = t[0]! in SHOPS ? t[0]! : t[1] !== undefined && t[1] in SHOPS ? t[1] : '';
      this.shopOfCache.set(p, s);
    }
    return s;
  }

  /** 壁の絵は、かけている壁の帯より必ず前に描く（帯の前後は fixWallDepths で決めたあと） */
  private fixArtDepths() {
    for (const [name, sl] of this.slots) {
      if (!name.endsWith('_art')) continue;
      const ap = sl.prop;
      const key = name.slice(0, -4);
      const was = ap.c.visible;
      ap.c.visible = true;
      const a = ap.c.getBounds();
      ap.c.visible = was;
      let z = -Infinity;
      for (const w of this.wallStrips) {
        if (!w.id.startsWith(`${key}_`)) continue;
        const b = w.c.getBounds();
        if (b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y) z = Math.max(z, w.c.zIndex);
      }
      if (z >= ap.c.zIndex) ap.c.zIndex = z + 0.01;
    }
  }

  /** 雲のうち、先に開く章の物（お店・3択の物・ゴミ山）にかかる雲は置かない（その章のあいだ、ずっと邪魔になるので） */
  private pruneClouds() {
    const shopCh: Record<string, number> = { bakery: 3, fry: 4, cake: 5, cloth: 6, cafe: 8, dagashi: 9, gym: 10 };
    for (const s of SHOPS_11) shopCh[s.key] = s.ch;
    const rects: { ch: number; x0: number; y0: number; x1: number; y1: number }[] = [];
    const add = (o: Container, ch: number) => {
      const was = o.visible;
      o.visible = true;
      const b = o.getBounds();
      o.visible = was;
      if (!b.width || !b.height) return;
      const a = this.worldLayer.toLocal({ x: b.x, y: b.y });
      const c = this.worldLayer.toLocal({ x: b.x + b.width, y: b.y + b.height });
      rects.push({ ch, x0: a.x, y0: a.y, x1: c.x, y1: c.y });
    };
    for (const sl of this.slots.values()) {
      const ch = Number(/^ch(\d+)_/.exec(sl.taskId)?.[1] ?? 0);
      if (ch) for (const p of [sl.prop, ...(sl.extra ?? [])]) add(p.c, ch);
    }
    for (const [g, list] of this.piles) for (const pl of list) add(pl.prop.c, Number(g.slice(1)));
    for (const p of this.props) { const ch = shopCh[this.shopOf(p)]; if (ch) add(p.c, ch); }
    this.clouds = this.clouds.filter((c) => {
      if (c.unit > 20) return true;
      const w = c.sp.width; const h = c.sp.height;
      const x0 = c.bx - w * 0.32; const x1 = c.bx + w * 0.32; const y0 = c.by - h * 0.42; const y1 = c.by + h * 0.22;
      const hit = rects.some((r) => r.ch < c.unit && r.x0 < x1 && r.x1 > x0 && r.y0 < y1 && r.y1 > y0);
      if (hit) c.sp.destroy();
      return !hit;
    });
  }

  /** 11〜20章の区画の雲の単位（その章の1つ前の章をクリアすると晴れる）。区画でなければ 0 */
  private newAreaUnit(x: number, y: number): number {
    for (const s of SHOPS_11) if (inShopCell(SHOPS[s.key], x, y)) return s.ch;
    if (x >= FEST.x0 && y >= -2 && y <= 17) return 20;
    if (x >= 32 && y >= 5 && y <= 10) {
      const seg = NORTH_ROAD.find(([a, b]) => x >= a && x <= b);
      return !seg ? 20 : seg[2] <= 12 ? 11 : seg[2] <= 17 ? 13 : 18;
    }
    // 西の道とそのお店のまわり（服屋より奥）。八百屋のすぐ横の列（gx 35）も、北の道より先に見る
    if (x >= 15 && x <= 35 && y >= 15 && y <= 31) return westSeg(x, y) || 16;
    if (x >= 29 && x <= 35 && y >= 11 && y <= 14) return 14;
    // 北の道のお店とお店のあいだ・まわり
    if (x >= 35 && y >= -2 && y <= 17) return x < 44 ? 11 : x < 52 ? 13 : 18;
    return 0;
  }

  /** 未解放の区画を、マス単位の小さな雲で覆う（建物の高さのぶん上にも重ねる） */
  private buildClouds() {
    // 11〜20章の区画（北の道・西の道・祭りの広場）: 区画ごとに雲で覆い、その章が始まると晴れる
    const h2 = (x: number, y: number) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
    for (let x = 15; x <= 75; x++) {
      for (let y = -2; y <= 31; y++) {
        const unit = this.newAreaUnit(x, y);
        if (!unit) continue;
        const k = 0.62 + h2(x, y) * 0.3;
        const layers = k > 0.75 ? 2 : 1;
        for (let l = 0; l < layers; l++) {
          const sp = new Sprite(this.getTex(`cloud_${(x * 3 + y * 7 + l) & 3}.png`));
          sp.anchor.set(0.5, 0.6);
          const w = (110 + 70 * k) * (0.85 + h2(x + l, y) * 0.35);
          sp.scale.set(w / Math.max(1, sp.texture.width));
          const p = isoPos(x + (h2(x, y + l) - 0.5) * 0.8, y + (h2(y, x + l) - 0.5) * 0.8);
          const bx = p.x;
          const by = p.y - 20 - l * 60 - k * 30;
          sp.position.set(bx, by);
          const a = 0.18 + 0.72 * k;
          sp.alpha = a;
          this.cloudLayer.addChild(sp);
          // 晴れる順は、その区画の真ん中から外へ（マップの端の区画でも、すぐ晴れ始める）
          const f = CHAPTER_FOCUS[unit];
          const delay = Math.min(1.0, 0.048 * (f ? Math.hypot(x - f[0], y - f[1]) : Math.hypot(x - 30, y - 8)));
          this.clouds.push({ sp, bx, by, ph: (x * 0.7 + y * 1.3 + l) % 6, unit, clearing: false, t: 0, delay, a, s0: sp.scale.x });
        }
      }
    }
    // お店の区画には雲をかけない。円形広場（ストーリー6のクリアで晴れる）と、その先の3本の道（先へ行くほど濃く・厚く）
    const hash = (x: number, y: number) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
    for (let x = 13; x <= 40; x++) {
      for (let y = -14; y <= 26; y++) {
        const out = Math.hypot(x - PLAZA.cx, y - PLAZA.cy) - (PLAZA.r + 0.4);
        const inPlaza = out <= 0;
        // 神社の参道（広場の北）とそのお店（カフェ・駄菓子屋・ジム）: ストーリー7のクリアで晴れる。
        // ケーキ屋のすぐ横・裏の雲は、高く浮いてケーキ屋にかかるのでかけない
        const shrine = !inPlaza && x <= 37 && ((x >= 24 && y <= 1) || (x >= 29 && y <= 4) || y <= -4);
        // ケーキ屋・パン屋の裏の雲は、いちばん上ではなく街の物と同じ前後の順で描く（手前のお店の高い壁が雲を隠す）
        const behindShops = shrine && x <= 23;
        // ケーキ屋・服屋のすぐ横の2列には、広場の外の雲をかけない（雲は高く浮くので、お店にかかってしまう）
        // 東の道の雲も、参道のカフェのすぐ手前（gy 6 まで）にはかけない
        if (!inPlaza && !shrine && (x <= 23 && (y <= 4 || y >= 10) || x < 21 || (x >= 29 && x <= 37 && y <= 6))) continue;
        // 北の道・西の道（11〜20章）の区画の雲は buildClouds の前半で作る。ここでは広場・その床のふち・参道だけ
        const paved = x >= 21 && (Math.hypot(x - PLAZA.cx, y - PLAZA.cy) <= PLAZA.r + 0.9 || (x <= 28 && y >= 1 && y <= 14) || (y >= 5 && y <= 10 && x <= 31));
        if (this.newAreaUnit(x, y) || (!inPlaza && !shrine && !paved)) continue;
        let k: number;
        if (inPlaza) k = 0.55;
        else if (shrine) k = 0.62 + hash(x, y) * 0.3;
        else {
          const t = out / 7 + (hash(x, y) - 0.5) * 0.35;
          if (t < 0.05 || (t < 0.35 && hash(y, x) > t * 2.2)) continue;
          k = Math.min(1, t);
        }
        const layers = k > 0.75 ? 2 : 1;
        for (let l = 0; l < layers; l++) {
          const sp = new Sprite(this.getTex(`cloud_${(x * 3 + y * 7 + l) & 3}.png`));
          sp.anchor.set(0.5, 0.6);
          const w = (110 + 70 * k) * (0.85 + hash(x + l, y) * 0.35);
          sp.scale.set(w / Math.max(1, sp.texture.width));
          const p = isoPos(x + (hash(x, y + l) - 0.5) * 0.8, y + (hash(y, x + l) - 0.5) * 0.8);
          const bx = p.x;
          const by = p.y - 20 - l * 60 - k * 30;
          sp.position.set(bx, by);
          const a = inPlaza ? 0.85 : 0.18 + 0.72 * k;
          sp.alpha = a;
          if (behindShops) { sp.zIndex = depthOf(x, y, 40 + l); this.worldLayer.addChild(sp); } else this.cloudLayer.addChild(sp);
          const d = Math.hypot(x - PLAZA.cx, y - PLAZA.cy);
          // 広場を直すといっしょにきれいになる床（円のふち・3本の道の入口）の上の雲も、ストーリー7で晴れる
          const nsRoad = x >= 21 && x <= 28 && (y <= 4 || y >= 11);
          const street = y >= 5 && y <= 10;
          const paved7 = x >= 21 && (Math.hypot(x - PLAZA.cx, y - PLAZA.cy) <= PLAZA.r + 0.9 || (nsRoad && y >= 1 && y <= 14) || (street && x <= 31));
          this.clouds.push({ sp, bx, by, ph: (x * 0.7 + y * 1.3 + l) % 6, unit: inPlaza || paved7 ? 7 : shrine ? 8 : 99, clearing: false, t: 0, delay: d * 0.12, a, s0: sp.scale.x });
        }
      }
    }
  }

  // ---------- 歩く人 ----------

  /** 人の絵を、絵の中の人の背の高さが h px になる拡大率と、足元の位置 */
  private charFit(key: string, h: number): { s: number; ay: number } {
    const ch = (this.meta[key] as { ch?: { top: number; bot: number } } | undefined)?.ch ?? { top: 0, bot: 1 };
    const t = this.getTex(key);
    return { s: h / Math.max(1, t.height * (ch.bot - ch.top)), ay: ch.bot };
  }

  private addWalker(id: string, gx: number, gy: number, idleKey: string, walk: string, h: number, speed: number): Walker {
    const idleW = h * 0.45;
    const c = new Container();
    const p = isoPos(gx, gy);
    c.position.set(p.x, p.y);
    c.zIndex = depthOf(gx, gy, 28);
    const sh = new Graphics();
    sh.ellipse(0, 0, idleW * 0.27, idleW * 0.11).fill({ color: 0x22160c, alpha: 0.24 });
    c.addChild(sh);
    const idle = new Sprite(this.getTex(idleKey));
    const fi = this.charFit(idleKey, h);
    idle.anchor.set(0.5, fi.ay);
    const baseScale = fi.s;
    idle.scale.set(baseScale);
    c.addChild(idle);
    const mk = (d: string) => {
      const a = new AnimatedSprite(Array.from({ length: WALK_FRAMES }, (_, i) => this.getTex(`${walk}_${d}_${i}`)));
      a.anchor.set(0.5, this.charFit(`${walk}_${d}_0`, h).ay);
      a.animationSpeed = 0.19;
      a.visible = false;
      c.addChild(a);
      return a;
    };
    const walkDr = mk('dr');
    const walkUr = mk('ur');
    const walkScale = this.charFit(`${walk}_dr_0`, h).s;
    walkDr.scale.set(walkScale); walkUr.scale.set(walkScale);
    this.worldLayer.addChild(c);
    return { id, c, idle, walkDr, walkUr, gx, gy, path: [], speed, baseScale, walkScale, facingLeft: false, walking: false };
  }

  /** 見えている家具・花壇・ベンチなどが床をふさいでいるマス（1マスの2割以上が重なっていたら通れない） */
  private blockedCells(): Set<string> {
    const out = new Set<string>();
    for (const p of this.props) {
      if (!p.block || !p.c.visible) continue;
      const x0 = p.box ? p.box.cx : p.gx - 0.25; const x1 = p.box ? p.box.cx + (p.fw ?? 1) : p.gx + 0.25;
      const y1 = p.box ? p.box.cy : p.gy + 0.25; const y0 = p.box ? p.box.cy - (p.fh ?? 1) : p.gy - 0.25;
      for (let x = Math.round(x0); x <= Math.round(x1); x++) {
        for (let y = Math.round(y0); y <= Math.round(y1); y++) {
          const ox = Math.min(x + 0.5, x1) - Math.max(x - 0.5, x0);
          const oy = Math.min(y + 0.5, y1) - Math.max(y - 0.5, y0);
          if (ox > 0 && oy > 0 && (ox * oy > 0.2 || (p.box === null && ox > 0 && oy > 0))) out.add(`${x},${y}`);
        }
      }
    }
    return out;
  }

  private blockedByPile(x: number, y: number): boolean {
    for (const list of this.piles.values()) {
      for (const pl of list) if (pl.prop.c.visible && !pl.prop.anim && pl.cells.some(([a, b]) => a === x && b === y)) return true;
    }
    return false;
  }

  private shopOpen(k: ShopKey): boolean {
    const ch = UNIT_OPENED_BY[SHOPS[k].unit];
    return !!this.progress && !!ch && this.chapterDone(ch);
  }

  private walkable(x: number, y: number): boolean {
    if (this.blockedByPile(x, y)) return false;
    if (this.blocked?.has(`${x},${y}`)) return false;
    if (y >= 5 && y <= 10) {
      if (x < -10) return false;
      if (x <= 4) return true;
      if (x <= 12) return this.unitOpen(2);
      if (x <= 20) return this.unitOpen(5);
      if (x <= 31) return this.unitOpen(7);
      if (x < FEST.x0) {
        const seg = NORTH_ROAD.find(([a, b]) => x >= a && x <= b);
        // 北の道は、ストーリー11の区画（gx 32〜43）、13の区画（44〜51）、18の区画（52〜59）の順に開く
        const ch = !seg ? 11 : seg[2] <= 12 ? 11 : seg[2] <= 17 ? 13 : 18;
        return this.unitOpen(ch);
      }
      if (x <= FEST.x1) return this.unitOpen(20);
      return false;
    }
    if (inFest(x, y)) return this.unitOpen(20);
    // 西の道（gx 21〜28）。広場のすぐ先（gy 11〜14）は広場といっしょに開く
    if (x >= 21 && x <= 28 && y >= 11 && y <= 30) {
      if (y <= 14) return this.unitOpen(7);
      const seg = westSeg(x, y);
      return seg ? this.unitOpen(seg) : false;
    }
    if (Math.hypot(x - PLAZA.cx, y - PLAZA.cy) <= PLAZA.r - 0.3) return this.unitOpen(7);
    for (const k of Object.keys(SHOPS) as ShopKey[]) {
      if (inShopCell(SHOPS[k], x, y)) return this.shopOpen(k);
    }
    // 神社の参道（広場の北）
    if (x >= 21 && x <= 28 && y >= -13 && y <= 4) return this.unitOpen(8);
    return false;
  }

  private canStep(cx: number, cy: number, nx: number, ny: number): boolean {
    // 門の柱（gx 0↔1 の gy 5 と 10）は通れない
    if ((cx === 0 && nx === 1) || (cx === 1 && nx === 0)) return cy !== 5 && cy !== 10;
    // お店の出入りは入口の2マスだけ（L: 手前の腰壁、R: 奥の壁。反転したお店も、ローカル座標で同じ）
    for (const s of Object.values(SHOPS)) {
      const a = inShopCell(s, cx, cy); const b = inShopCell(s, nx, ny);
      if (a === b) continue;
      const [ilx, ily] = a ? shopLocal(s, cx, cy) : shopLocal(s, nx, ny);
      const [olx, oly] = a ? shopLocal(s, nx, ny) : shopLocal(s, cx, cy);
      const inRow = s.side === 'L' ? SD - 1 : 0; const outRow = s.side === 'L' ? SD : -1;
      return (ilx === 3 || ilx === 4) && ily === inRow && olx === ilx && oly === outRow;
    }
    return true;
  }

  private blocked: Set<string> | null = null;

  private findPath(sx: number, sy: number, tx: number, ty: number) {
    this.blocked = this.blockedCells();
    const s = [Math.round(sx), Math.round(sy)] as const;
    let t = [Math.round(tx), Math.round(ty)] as [number, number];
    // 行き先が家具などでふさがっていたら、いちばん近い空いているマスにする
    if (!this.walkable(t[0], t[1])) {
      let best: [number, number] | null = null; let bd = 99;
      for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
        const d = Math.hypot(dx, dy);
        if (d < bd && this.walkable(t[0] + dx, t[1] + dy)) { bd = d; best = [t[0] + dx, t[1] + dy]; }
      }
      if (best) { t = best; tx = best[0]; ty = best[1]; }
    }
    if (s[0] === t[0] && s[1] === t[1]) return [{ gx: tx, gy: ty }];
    const key = (x: number, y: number) => `${x},${y}`;
    const prev = new Map<string, [number, number] | null>([[key(s[0], s[1]), null]]);
    const q: [number, number][] = [[s[0], s[1]]];
    let ok = false;
    while (q.length) {
      const [cx, cy] = q.shift()!;
      if (cx === t[0] && cy === t[1]) { ok = true; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx; const ny = cy + dy;
        const k = key(nx, ny);
        if (prev.has(k)) continue;
        if (!this.walkable(nx, ny)) continue;
        if (!this.canStep(cx, cy, nx, ny)) continue;
        prev.set(k, [cx, cy]);
        q.push([nx, ny]);
      }
    }
    if (!ok) return [];
    const pts: { gx: number; gy: number }[] = [];
    let cur: [number, number] | null = [t[0], t[1]];
    while (cur) { pts.push({ gx: cur[0], gy: cur[1] }); cur = prev.get(key(cur[0], cur[1])) ?? null; }
    pts.reverse();
    if (pts.length > 1) pts.shift();
    pts[pts.length - 1] = { gx: tx, gy: ty };
    return pts;
  }

  private walkPair(gx: number, gy: number) {
    const r = this.freeNear(gx, gy);
    if (this.reina) {
      this.reina.path = this.findPath(this.reina.gx, this.reina.gy, r[0], r[1]);
      if (!this.reina.path.length) this.teleport(this.reina, r[0], r[1]);
    }
    const ghost = { gx: r[0], gy: r[1] } as Walker;
    const m = this.freeNear(r[0] - 0.6, r[1] + 0.5, ghost);
    if (this.momo) {
      this.momo.path = this.findPath(this.momo.gx, this.momo.gy, m[0], m[1]);
      if (!this.momo.path.length) this.teleport(this.momo, m[0], m[1]);
    }
  }

  /** 人が (gx, gy) に立ったとき、足元（半径 0.25 マス）が家具・花壇・人などに重ならないか */
  private pointFree(gx: number, gy: number, avoid?: Walker | null): boolean {
    const r = 0.25;
    for (const p of this.props) {
      if (!p.block || !p.c.visible) continue;
      const x0 = p.box ? p.box.cx : p.gx - 0.25; const x1 = p.box ? p.box.cx + (p.fw ?? 1) : p.gx + 0.25;
      const y1 = p.box ? p.box.cy : p.gy + 0.25; const y0 = p.box ? p.box.cy - (p.fh ?? 1) : p.gy - 0.25;
      if (gx + r > x0 && gx - r < x1 && gy + r > y0 && gy - r < y1) return false;
    }
    if (avoid && Math.hypot(avoid.gx - gx, avoid.gy - gy) < 0.55) return false;
    return true;
  }

  /** (gx, gy) がふさがっていたら、いちばん近い、足元の空いているマスの中心を返す */
  private freeNear(gx: number, gy: number, avoid?: Walker | null): [number, number] {
    this.blocked = this.blockedCells();
    const x = Math.round(gx); const y = Math.round(gy);
    if (this.walkable(x, y) && this.pointFree(gx, gy, avoid)) return [gx, gy];
    let best: [number, number] = [gx, gy]; let bd = 99;
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
      const d = Math.hypot(x + dx - gx, y + dy - gy);
      if (d < bd && this.walkable(x + dx, y + dy) && this.pointFree(x + dx, y + dy, avoid)) { bd = d; best = [x + dx, y + dy]; }
    }
    return best;
  }

  private teleport(w: Walker, gx: number, gy: number, avoid?: Walker | null) {
    [gx, gy] = this.freeNear(gx, gy, avoid);
    w.gx = gx; w.gy = gy; w.path = [];
    const p = isoPos(gx, gy);
    w.c.position.set(p.x, p.y);
    w.c.zIndex = depthOf(gx, gy, 28);
  }

  private updateWalker(w: Walker, dt: number) {
    if (w.path.length) {
      const nx = w.path[0]!;
      const dx = nx.gx - w.gx; const dy = nx.gy - w.gy;
      const dist = Math.hypot(dx, dy);
      if (dist <= 0.05) { w.gx = nx.gx; w.gy = nx.gy; w.path.shift(); }
      else {
        const st = Math.min(dist, dt * w.speed);
        const vx = dx / dist; const vy = dy / dist;
        w.gx += vx * st; w.gy += vy * st;
        w.facingLeft = vx + vy < -0.05;
        const back = vy - vx < -0.05;
        const a = back ? w.walkUr : w.walkDr;
        const o = back ? w.walkDr : w.walkUr;
        w.idle.visible = false; o.visible = false; o.stop();
        a.visible = true;
        a.scale.set(w.facingLeft ? -w.walkScale : w.walkScale, w.walkScale);
        if (!a.playing) a.play();
        w.walking = true;
      }
      const p = isoPos(w.gx, w.gy);
      w.c.position.set(p.x, p.y);
      w.c.zIndex = depthOf(w.gx, w.gy, 28);
    } else if (w.walking) {
      w.walking = false;
      w.walkDr.visible = false; w.walkUr.visible = false; w.walkDr.stop(); w.walkUr.stop();
      w.idle.visible = true;
      w.idle.scale.set(w.facingLeft ? -w.baseScale : w.baseScale, w.baseScale);
    } else {
      w.idle.position.y = -Math.abs(Math.sin(this.time * 3 + w.gx) * 1.8);
    }
  }

  private updateVisitors(dt: number) {
    for (const v of this.visitors) {
      v.c.visible = this.chapterDone(1);
      if (!v.c.visible) continue;
      this.updateWalker(v, dt);
      if (v.path.length) continue;
      v.wait -= dt;
      if (v.wait > 0) continue;
      v.wait = 2 + Math.random() * 3;
      const maxX = this.unitOpen(20) ? FEST.x1 : this.unitOpen(18) ? 59 : this.unitOpen(13) ? 51 : this.unitOpen(11) ? 43
        : this.unitOpen(7) ? 29 : this.unitOpen(5) ? 20 : this.unitOpen(2) ? 12 : 4;
      const tx = -3 + Math.floor(Math.random() * (maxX + 4));
      const ty = 5 + Math.floor(Math.random() * 6);
      this.blocked = this.blockedCells();
      if (this.walkable(tx, ty)) v.path = this.findPath(v.gx, v.gy, tx, ty);
    }
  }

  // ---------- 進み具合を画面に反映 ----------

  private chapterDone(id: number): boolean {
    const ch = CHAPTERS.find((c) => c.id === id);
    return !!ch && !!this.progress && isChapterComplete(ch, this.progress);
  }

  private unitOpen(unit: number): boolean {
    const ch = UNIT_OPENED_BY[unit];
    return !!ch && this.chapterDone(ch);
  }

  syncState(prog: StoryProgress, preview: PreviewPick, animate: boolean) {
    if (!this.ready) return;
    this.progress = prog;
    const pk = preview ? FX[preview.taskId]?.choice : undefined;
    const sl = pk ? this.slots.get(pk) : undefined;
    this.focusProps = sl ? [sl.prop, ...(sl.extra ?? [])] : [];
    for (const ch of CHAPTERS) {
      for (const task of ch.tasks) {
        const fx = FX[task.id];
        if (!fx) continue;
        const done = prog.done.includes(task.id);
        if (fx.choice) {
          const c = preview?.taskId === task.id ? preview.choice : done ? (prog.choices[task.id] ?? 0) : -1;
          const was = this.last.get(task.id);
          if (was === c && animate) continue;
          const anim = animate && c >= 0 && was !== undefined && was !== c;
          this.applyChoice(fx.choice, c, anim);
          if (anim) this.goTo(fx);
          this.last.set(task.id, c);
        } else {
          const was = this.last.get(task.id);
          if (was === done && animate) continue;
          const anim = animate && done && was === false;
          for (const g of fx.remove ?? []) this.applyRemove(g, done, anim);
          for (const z of fx.tiles ?? []) this.applyTiles(z, done, anim, fx.walk);
          for (const g of fx.swap ?? []) this.applySwap(g, done, anim);
          if (anim) this.goTo(fx);
          this.last.set(task.id, done);
        }
      }
    }
    // 登場人物
    for (const { prop, afterCh } of this.npcs.values()) prop.c.visible = this.chapterDone(afterCh);
    // 雲
    for (const c of this.clouds) {
      const open = c.unit !== 99 && this.unitOpen(c.unit);
      const was = this.last.get(`cloud${c.unit}`);
      if (open && !c.sp.visible) continue;
      if (open && animate && was === false) { c.clearing = true; c.t = -c.delay; }
      else if (open && !c.clearing) c.sp.visible = false;
      else if (!open) { c.sp.visible = true; c.sp.alpha = c.a; c.clearing = false; c.sp.position.set(c.bx, c.by); c.sp.scale.set(c.s0); }
    }
    for (const u of [2, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) this.last.set(`cloud${u}`, this.unitOpen(u));
    // 円形広場の床
    if (this.plazaFloor) {
      this.plazaFloor.target = prog.done.includes('ch7_paving') ? 1 : 0;
      if (!animate) this.plazaFloor.clean.alpha = this.plazaFloor.target;
    }
    if (!animate) this.placeWalkersFor(prog);
  }

  /** 読み込み直後など: いまの進み具合の場所にレイナとモモを立たせる */
  private placeWalkersFor(prog: StoryProgress) {
    let spot: [number, number] = [-1.2, 7.4];
    for (const ch of CHAPTERS) for (const t of ch.tasks) if (prog.done.includes(t.id) && FX[t.id]) spot = FX[t.id]!.walk;
    if (this.reina && !this.reina.path.length) this.teleport(this.reina, spot[0], spot[1]);
    if (this.momo && !this.momo.path.length) this.teleport(this.momo, spot[0] - 0.6, spot[1] + 0.5, this.reina);
  }

  private goTo(fx: Fx) {
    this.walkPair(fx.walk[0], fx.walk[1]);
    this.focusGrid(fx.focus[0], fx.focus[1], fx.focus[2]);
  }

  private applyChoice(slotName: string, c: number, anim: boolean) {
    const slot = this.slots.get(slotName);
    if (!slot) return;
    [slot.prop, ...(slot.extra ?? [])].forEach((p, i) => {
      if (c < 0) {
        p.anim = undefined;
        p.sp.position.y = 0;
        if (slot.dirty) { p.c.visible = true; this.applyTex(p, slot.dirty); } else p.c.visible = false;
        return;
      }
      p.c.visible = true;
      this.applyTex(p, slot.keys[c] ?? slot.keys[0]!);
      if (anim && p.flat) { p.anim = undefined; this.sparkleAt(p, 14); return; }
      if (anim) {
        p.anim = { type: 'drop', t: -i * 0.18, dur: 0.55, onMid: () => this.sparkleAt(p, 14) };
      } else { p.anim = undefined; p.sp.position.y = 0; p.sp.scale.set(p.sx, p.sy); }
    });
  }

  private applyRemove(grp: string, done: boolean, anim: boolean) {
    const list = this.piles.get(grp) ?? [];
    list.forEach((pl, i) => {
      const p = pl.prop;
      if (!done) { p.c.visible = true; p.anim = undefined; p.sp.alpha = 1; p.sp.position.set(0, 0); p.sp.scale.set(p.sx, p.sy); return; }
      if (!anim) { p.c.visible = false; p.anim = undefined; return; }
      p.anim = { type: 'remove', t: -0.35 - i * 0.32, dur: 0.95 };
    });
  }

  private applySwap(grp: string, done: boolean, anim: boolean) {
    (this.groups.get(grp) ?? []).forEach((p, i) => {
      const key = done ? p.cleanKey : p.dirtyKey;
      if (!key) return;
      if (!anim) { p.anim = undefined; this.applyTex(p, key); p.sp.position.y = 0; return; }
      p.anim = { type: 'pop', t: -0.5 - i * 0.07, dur: 0.5, onMid: () => { this.applyTex(p, key); this.sparkleAt(p, 6); } };
    });
  }

  private applyTiles(zone: string, done: boolean, anim: boolean, from: [number, number]) {
    for (const t of this.tileZones.get(zone) ?? []) {
      if (!done || !anim) {
        t.flipping = false; t.t = 0; t.swapped = done;
        t.sp.texture = this.getTex(done ? t.cleanKey : t.dirtyKey);
        t.sp.height = TILE_H + 1;
        t.sp.position.y = isoPos(t.gx, t.gy).y;
        continue;
      }
      // 歩いて行った場所から波のように広がる
      const d = Math.hypot(t.gx - from[0], t.gy - from[1]);
      t.flipping = true; t.swapped = false; t.t = -(0.55 + d * 0.085);
    }
  }

  // ---------- 演出 ----------

  private worldPt(p: Prop, up = 30): { x: number; y: number } {
    return { x: p.c.position.x, y: p.c.position.y - up };
  }

  /** その物の、ワールドの中での四角（平らな物は内側の入れ物で動かしているので、実際に描かれている所で測る） */
  private propRect(p: Prop) {
    if (p.flat) {
      const g = p.sp.getBounds();
      const a = this.worldLayer.toLocal({ x: g.x, y: g.y });
      const b = this.worldLayer.toLocal({ x: g.x + g.width, y: g.y + g.height });
      return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
    }
    const b = p.sp.getLocalBounds();
    return {
      x0: p.c.position.x + Math.min(b.x * p.sx, (b.x + b.width) * p.sx),
      x1: p.c.position.x + Math.max(b.x * p.sx, (b.x + b.width) * p.sx),
      y0: p.c.position.y + b.y * p.sy,
      y1: p.c.position.y + (b.y + b.height) * p.sy,
    };
  }

  private sparkleAt(p: Prop, n: number) {
    const r = this.propRect(p);
    const w = r.x1 - r.x0;
    const pt = { x: (r.x0 + r.x1) / 2, y: r.y0 + (r.y1 - r.y0) * 0.55 };
    for (let i = 0; i < n; i++) this.star(pt.x + (Math.random() - 0.5) * w * 0.7, pt.y + (Math.random() - 0.5) * 40);
  }

  private star(x: number, y: number) {
    const g = new Graphics();
    const r = 5 + Math.random() * 6;
    g.poly([0, -r, r * 0.28, -r * 0.28, r, 0, r * 0.28, r * 0.28, 0, r, -r * 0.28, r * 0.28, -r, 0, -r * 0.28, -r * 0.28])
      .fill({ color: Math.random() < 0.5 ? 0xfff6b0 : 0xffffff });
    g.position.set(x, y);
    this.fxLayer.addChild(g);
    this.particles.push({ g, vx: (Math.random() - 0.5) * 40, vy: -40 - Math.random() * 60, grav: 0, vr: (Math.random() - 0.5) * 6, life: 0, max: 0.6 + Math.random() * 0.5, grow: 0.4, a0: 1 });
  }

  private debris(x: number, y: number, n: number) {
    const cols = [0x6b5a48, 0x8a7a66, 0x4a4038, 0x9c8b70, 0x3b3b3b, 0x7d6347];
    for (let i = 0; i < n; i++) {
      const g = new Graphics();
      const w = 4 + Math.random() * 9; const h = 3 + Math.random() * 6;
      g.rect(-w / 2, -h / 2, w, h).fill({ color: cols[i % cols.length]! });
      g.position.set(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 20);
      this.fxLayer.addChild(g);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 130 + Math.random() * 170;
      this.particles.push({ g, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, grav: 520, vr: (Math.random() - 0.5) * 14, life: 0, max: 0.7 + Math.random() * 0.4, grow: 0, a0: 1 });
    }
  }

  private dust(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const g = new Graphics();
      g.circle(0, 0, 14 + Math.random() * 12).fill({ color: 0xd8cfc2 });
      g.position.set(x + (Math.random() - 0.5) * 110, y + (Math.random() - 0.5) * 36);
      g.alpha = 0.55;
      this.fxLayer.addChild(g);
      this.particles.push({ g, vx: (Math.random() - 0.5) * 50, vy: -18 - Math.random() * 25, grav: 0, vr: 0, life: 0, max: 0.9 + Math.random() * 0.5, grow: 1.6, a0: 0.55 });
    }
  }

  private tileFlash(t: Tile) {
    const g = new Graphics();
    g.poly([0, -TILE_H / 2, TILE_W / 2, 0, 0, TILE_H / 2, -TILE_W / 2, 0]).fill({ color: 0xffffff });
    const p = isoPos(t.gx, t.gy);
    g.position.set(p.x, p.y);
    g.alpha = 0.75;
    this.fxLayer.addChild(g);
    this.flashes.push({ g, t: 0 });
  }

  private tick(dt: number) {
    this.time += dt;
    if (this.camAnimating) {
      const k = Math.min(1, dt * 6);
      this.camX += (this.tCamX - this.camX) * k;
      this.camY += (this.tCamY - this.camY) * k;
      this.camZoom += (this.tCamZoom - this.camZoom) * k;
      if (Math.abs(this.tCamX - this.camX) < 0.8 && Math.abs(this.tCamY - this.camY) < 0.8 && Math.abs(this.tCamZoom - this.camZoom) < 0.004) {
        this.camX = this.tCamX; this.camY = this.tCamY; this.camZoom = this.tCamZoom; this.camAnimating = false;
      }
      this.applyCamera();
    }

    // 床タイル: 1枚ずつ持ち上がって裏返り、光って新品に
    for (const zone of this.tileZones.values()) {
      for (const t of zone) {
        if (!t.flipping) continue;
        t.t += dt;
        if (t.t < 0) continue;
        const u = Math.min(1, t.t / 0.42);
        const base = isoPos(t.gx, t.gy).y;
        t.sp.position.y = base - Math.sin(u * Math.PI) * 12;
        t.sp.height = (TILE_H + 1) * Math.max(0.06, Math.abs(Math.cos(u * Math.PI)));
        if (u >= 0.5 && !t.swapped) {
          t.swapped = true;
          t.sp.texture = this.getTex(t.cleanKey);
          this.tileFlash(t);
          if (Math.random() < 0.45) this.star(isoPos(t.gx, t.gy).x, base - 8);
        }
        if (u >= 1) { t.flipping = false; t.sp.height = TILE_H + 1; t.sp.position.y = base; }
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.t += dt;
      f.g.alpha = Math.max(0, 0.75 * (1 - f.t / 0.4));
      if (f.t >= 0.4) { f.g.destroy(); this.flashes.splice(i, 1); }
    }

    for (const p of this.props) {
      const a = p.anim;
      if (a) {
        a.t += dt;
        if (a.t < 0) continue;
        const u = Math.min(1, a.t / a.dur);
        if (a.type === 'remove') {
          // 揺れる → 破片とほこりが飛ぶ → つぶれて沈む → キラキラ
          if (u < 0.3) {
            p.sp.position.x = Math.sin(a.t * 70) * 4;
            const s = 1 + Math.sin(a.t * 40) * 0.03;
            p.sp.scale.set(p.sx * s, p.sy * s);
          } else {
            if (!a.mid) {
              a.mid = true;
              const w = this.worldPt(p, 45);
              this.debris(w.x, w.y, 18);
              this.dust(w.x, w.y + 25, 9);
            }
            const v = (u - 0.3) / 0.7;
            p.sp.position.set(0, v * 18);
            p.sp.scale.set(p.sx * (1 + v * 0.15), p.sy * (1 - v * v));
            p.sp.alpha = 1 - v * v;
          }
          if (u >= 1) {
            p.c.visible = false; p.anim = undefined;
            p.sp.alpha = 1; p.sp.position.set(0, 0); p.sp.scale.set(p.sx, p.sy);
            this.sparkleAt(p, 9);
          }
        } else if (a.type === 'pop') {
          if (u >= 0.45 && !a.mid) { a.mid = true; a.onMid?.(); }
          const b = 1 + Math.sin(u * Math.PI) * 0.16;
          p.sp.scale.set(p.sx * b, p.sy * b);
          p.sp.position.y = -Math.sin(u * Math.PI) * 12;
          if (u >= 1) { p.anim = undefined; p.sp.scale.set(p.sx, p.sy); p.sp.position.y = 0; }
        } else {
          if (u < 0.45) {
            const f = u / 0.45;
            p.sp.position.y = -(1 - f * f) * 160;
            p.sp.scale.set(p.sx * 0.92, p.sy * 1.1);
          } else {
            if (!a.mid) { a.mid = true; a.onMid?.(); const w = this.worldPt(p, 0); this.dust(w.x, w.y, 5); }
            const b = (u - 0.45) / 0.55;
            const sq = Math.sin(b * Math.PI * 2.5) * Math.exp(-b * 4) * 0.2;
            p.sp.position.y = 0;
            p.sp.scale.set(p.sx * (1 + sq), p.sy * (1 - sq));
          }
          if (u >= 1) { p.anim = undefined; p.sp.position.y = 0; p.sp.scale.set(p.sx, p.sy); }
        }
      }
    }

    // 円形広場の床は、直すとゆっくり明るい石畳に変わる
    if (this.plazaFloor) { const f = this.plazaFloor; f.clean.alpha += (f.target - f.clean.alpha) * Math.min(1, dt * 1.2); }
    if (this.gate) for (const st of this.gateStrips) { st.sp.scale.copyFrom(this.gate.sp.scale); st.sp.position.copyFrom(this.gate.sp.position); st.sp.alpha = this.gate.sp.alpha; }
    if (this.reina) this.updateWalker(this.reina, dt);
    if (this.momo) this.updateWalker(this.momo, dt);
    this.updateVisitors(dt);
    this.updateOccluders(dt);

    for (const c of this.clouds) {
      if (!c.sp.visible) continue;
      if (c.clearing) {
        c.t += dt;
        if (c.t < 0) continue;
        const u = Math.min(1, c.t / 1.1);
        c.sp.alpha = c.a * (1 - u);
        c.sp.position.set(c.bx + u * 60, c.by - u * 70);
        c.sp.scale.set(c.sp.scale.x * (1 + dt * 0.3));
        if (u >= 1) { c.sp.visible = false; c.clearing = false; }
      } else {
        c.sp.position.set(c.bx + Math.sin(this.time * 0.6 + c.ph) * 5, c.by + Math.cos(this.time * 0.5 + c.ph) * 3);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i]!;
      pt.life += dt;
      if (pt.life >= pt.max) { pt.g.destroy(); this.particles.splice(i, 1); continue; }
      pt.vy += pt.grav * dt;
      pt.g.position.x += pt.vx * dt;
      pt.g.position.y += pt.vy * dt;
      pt.g.rotation += pt.vr * dt;
      const k = pt.life / pt.max;
      pt.g.scale.set(1 + pt.grow * k);
      pt.g.alpha = pt.a0 * (1 - k);
    }
  }

  /** 手前の建物や門が、奥の人や見ている場所を隠すときは半透明にする */
  private updateOccluders(dt: number) {
    const pts: { x: number; y: number; d: number; need: number; rx: number; ry: number; town?: boolean }[] = [];
    // 3択で選んでいる物: それを隠している手前の街の建物だけ半透明にする（門やお店の壁はそのまま）
    for (const f of this.focusProps) {
      if (!f.c.visible) continue;
      const b = f.c.getBounds();
      const tl = this.worldLayer.toLocal({ x: b.x, y: b.y }); const br = this.worldLayer.toLocal({ x: b.x + b.width, y: b.y + b.height });
      pts.push({ x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2, rx: (br.x - tl.x) / 2, ry: (br.y - tl.y) / 2, d: f.c.zIndex, need: 100, town: true });
    }
    for (const w of [this.reina, this.momo, ...this.visitors]) {
      if (!w || !w.c.visible) continue;
      const p = isoPos(w.gx, w.gy);
      pts.push({ x: p.x, y: p.y - 30, d: depthOf(w.gx, w.gy), need: 150, rx: 0, ry: 0 });
    }
    const fShop = this.focusProps.length ? this.shopOf(this.focusProps[0]!) : null;
    for (const p of this.props) {
      if (!p.c.visible) continue;
      // 3択の物と別のお店の物（壁・家具）は、手前で隠していれば半透明にする
      const other = fShop !== null && !p.flat && this.shopOf(p) !== '' && (this.shopOf(p) !== fShop || this.wallStrips.includes(p));
      if (!p.occ && !other && p.fade === 1) continue;
      const { x0, x1, y0, y1 } = this.propRect(p);
      const ownWall = fShop !== null && this.shopOf(p) === fShop && this.wallStrips.includes(p);
      const hide = pts.some((q) => (q.town ? p.id.startsWith('town_') || other : !!p.occ) && q.x + q.rx > x0 && q.x - q.rx < x1 && q.y + q.ry > y0 && q.y - q.ry < y1
        && p.c.zIndex - q.d > (q.town && ownWall ? 1 : Math.max(q.need, p.need ?? 0)));
      const target = hide ? 0.4 : 1;
      p.fade += (target - p.fade) * Math.min(1, dt * 8);
      p.c.alpha = p.fade;
    }
  }

  // ---------- カメラ ----------

  private minZoom(): number {
    if (!this.ready || !this.app || !this.app.screen) return 0.5;
    return Math.max(0.45, this.app.screen.width / (CAM.maxX - CAM.minX), this.app.screen.height / (CAM.maxY - CAM.minY));
  }

  private clampCamera() {
    if (!this.ready || !this.app || !this.app.screen) return;
    this.camZoom = Math.max(this.minZoom(), Math.min(2.4, this.camZoom));
    const p = this.clampPoint(this.camX, this.camY, this.camZoom);
    this.camX = p.x;
    this.camY = p.y;
  }

  /** カメラの中心が、マップの外を映さない範囲。上は HUD の裏に隠れないよう、その分だけ上まで動ける */
  private clampPoint(x: number, y: number, zoom: number) {
    if (!this.ready || !this.app || !this.app.screen) return { x, y };
    const hw = this.app.screen.width / (2 * zoom);
    const hh = this.app.screen.height / (2 * zoom);
    const rect = document.querySelector('.story-hud-top')?.getBoundingClientRect();
    const hudTop = (rect && rect.bottom > 0 ? rect.bottom : 60) / zoom;
    const minY = CAM.minY + hh - hudTop;
    return {
      x: Math.max(CAM.minX + hw, Math.min(CAM.maxX - hw, x)),
      y: Math.max(minY, Math.min(CAM.maxY - hh, y)),
    };
  }

  fitEntrance(smooth = true) {
    if (!this.ready) return;
    const f = CHAPTER_FOCUS[1]!;
    this.focusGrid(f[0], f[1], f[2], smooth);
  }

  focusChapter(chapterId: number, smooth = true) {
    if (!this.ready) return;
    const f = CHAPTER_FOCUS[chapterId] ?? CHAPTER_FOCUS[1]!;
    this.focusGrid(f[0], f[1], f[2], smooth);
  }

  focusGrid(gx: number, gy: number, zoomMul = 1.2, smooth = true) {
    if (!this.ready) return;
    this.focusPt = { gx, gy };
    const p = isoPos(gx, gy);
    const base = Math.min(window.innerWidth / 980, window.innerHeight / 620);
    this.setCamera(p.x, p.y - 30, Math.max(0.6, Math.min(2.0, base * zoomMul)), smooth);
  }

  private setCamera(x: number, y: number, zoom: number, smooth: boolean) {
    if (!this.ready) return;
    this.tCamZoom = Math.max(this.minZoom(), Math.min(2.4, zoom));
    const t = this.clampPoint(x, y, this.tCamZoom);
    x = t.x; y = t.y;
    this.tCamX = x; this.tCamY = y;
    if (smooth) this.camAnimating = true;
    else { this.camX = x; this.camY = y; this.camZoom = this.tCamZoom; this.camAnimating = false; this.applyCamera(); }
  }

  private applyCamera() {
    if (!this.ready || !this.app || !this.app.screen) return;
    if (this.app.screen.width <= 0 || this.app.screen.height <= 0) return;
    this.clampCamera();
    this.root.scale.set(this.camZoom);
    this.root.position.set(this.app.screen.width / 2 - this.camX * this.camZoom, this.app.screen.height / 2 - this.camY * this.camZoom);
  }

  private bindInput(canvas: HTMLCanvasElement) {
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      this.camAnimating = false;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.dragStart = { x: e.clientX, y: e.clientY, cx: this.camX, cy: this.camY, moved: false };
        this.gestured = false;
      } else if (this.pointers.size === 2) {
        this.gestured = true;
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        this.pinchZoom = this.camZoom;
        this.dragStart = null;
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (this.pinchDist > 10) { this.camZoom = this.pinchZoom * (d / this.pinchDist); this.applyCamera(); }
      } else if (this.pointers.size === 1 && this.dragStart) {
        const dx = e.clientX - this.dragStart.x; const dy = e.clientY - this.dragStart.y;
        if (Math.hypot(dx, dy) > 6) { this.dragStart.moved = true; this.focusPt = null; }
        this.camX = this.dragStart.cx - dx / this.camZoom;
        this.camY = this.dragStart.cy - dy / this.camZoom;
        this.applyCamera();
      }
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      canvas.style.cursor = 'grab';
      if (this.pointers.size < 2) this.pinchDist = 0;
      if (this.pointers.size === 1) {
        const [o] = [...this.pointers.values()];
        this.dragStart = { x: o!.x, y: o!.y, cx: this.camX, cy: this.camY, moved: true };
      } else this.dragStart = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camAnimating = false;
      this.camZoom *= e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.applyCamera();
    }, { passive: false });
    addEventListener('resize', () => {
      this.syncSize();
      requestAnimationFrame(() => this.syncSize());
    });
  }
}

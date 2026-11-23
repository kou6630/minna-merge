// 盤面のルール。DOM にも通信にも依存しない。
// P0 ではブラウザの中で、P1 からはサーバーで、同じコードを動かす。
import {
  CHAIN_BY_KEY, CUSTOMERS, ENERGY_MAX, ENERGY_REGEN_SEC, HOLD_MS, LEVEL_GRANTS, LEVEL_TIER_UP, MAX_LEVEL,
  ORDER_SLOTS, OWNER_OF_CHAIN, SPAWN_RADIUS, WORLD_ORDER_BONUS, WORLD_ORDER_SLOTS, START_COINS, STORAGE_MAX, STORAGE_START, chainOfKind, isGeneratorKind, kindOf,
  maxTierOfKind, mergeXp, sellCoins, storageCost, tierOfKind, xpToNext,
} from './defs.ts';

export const W = 100;
export const H = 100;
export const BLOCK = 10;
export const BLOCKS_X = W / BLOCK;
export const BLOCKS_Y = H / BLOCK;

export type Item = {
  id: number;
  kind: number;
  cell: number;
  /** 発生器の持ち主 */
  owner?: string;
  /** 最終作成者（売れる人） */
  maker?: string;
  /** ほこりをかぶっていて動かせない */
  dusty?: boolean;
  /** 発生器のチャージ */
  charges?: number;
  chargesAt?: number;
};

export type Player = {
  id: string;
  name: string;
  level: number;
  xp: number;
  energy: number;
  energyAt: number;
  coins: number;
  /** 注文（いつも ORDER_SLOTS 件） */
  orders: Order[];
  nextOrderId: number;
  /** 倉庫。入っているアイテムの kind（null は空き） */
  storage: (number | null)[];
};

export type OrderNeed = { kind: number; count: number; have: number };

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
  /** 区画: 1=開いている */
  blocks: Uint8Array;
  players: Map<string, Player>;
  /** みんなの依頼 */
  worldOrders: WorldOrder[];
  nextWorldOrderId: number;
};

/** みんなの依頼。そろうと block の区画が開く */
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
  | { t: 'levelup'; player: string; level: number; newChains: string[]; granted: string[] }
  | { t: 'sold'; player: string; coins: number }
  | { t: 'order'; player: string; customer: string; coins: number; xp: number }
  | { t: 'contrib'; player: string; coins: number; xp: number }
  /** みんなの依頼がそろって区画が開いた（全員に届く） */
  | { t: 'unlock'; block: number; owner: string; contributors: string[]; bonus: number };

export type Action =
  | { t: 'grab'; item: number }
  | { t: 'drop'; item: number; cell: number }
  | { t: 'release'; item: number }
  | { t: 'tap'; gen: number }
  | { t: 'sell'; item: number }
  /** 注文に納品する。盤面のアイテム（item）か倉庫の枠（slot）のどちらか */
  | { t: 'deliver'; order: number; item?: number; slot?: number }
  | { t: 'store'; item: number }
  | { t: 'unstore'; slot: number; cell: number }
  | { t: 'expand' }
  /** みんなの依頼に納品する */
  | { t: 'contribute'; order: number; item?: number; slot?: number };

export type RejectReason =
  | 'no-item' | 'held' | 'not-yours' | 'locked' | 'dusty' | 'energy' | 'no-charge'
  | 'no-space' | 'not-generator' | 'cannot-sell' | 'no-player' | 'nothing'
  | 'no-order' | 'not-needed' | 'storage-full' | 'empty-slot' | 'coins' | 'max-storage' | 'occupied';

export const REJECT_TEXT: Record<RejectReason, string> = {
  'no-item': 'アイテムが見つかりません',
  held: 'ほかの人が持っています',
  'not-yours': 'ほかの人の発生器です',
  locked: 'まだ開いていない区画です',
  dusty: 'ほこりをかぶっていて動かせません。同じアイテムを重ねるときれいになります',
  energy: 'エネルギーが足りません',
  'no-charge': '発生器が休んでいます。少し待ってください',
  'no-space': 'まわりに空きマスがありません',
  'not-generator': '発生器ではありません',
  'cannot-sell': '自分で作ったアイテムだけ売れます',
  'no-player': 'プレイヤーが見つかりません',
  nothing: 'まだ何も出せません',
  'no-order': 'その注文はもうありません',
  'not-needed': 'その注文には使えません',
  'storage-full': '倉庫がいっぱいです',
  'empty-slot': 'その枠は空です',
  coins: 'コインが足りません',
  'max-storage': '倉庫はこれ以上広げられません',
  occupied: 'そこには置けません',
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

/** 新しいワールド。中央の 2×2 区画を開き、ほこりをかぶったアイテムを置く */
export function createWorld(rng: Rng): World {
  const w = emptyWorld();
  for (const bx of [4, 5]) for (const by of [4, 5]) openBlock(w, by * BLOCKS_X + bx, rng);
  ensureWorldOrders(w, rng);
  return w;
}

const DUSTY_TABLE: { chain: string; tiers: number[]; weight: number }[] = [
  { chain: 'bread', tiers: [1, 1, 2, 2, 3, 4], weight: 5 },
  { chain: 'sweets', tiers: [1, 1, 2, 3], weight: 3 },
  { chain: 'veg', tiers: [1, 2, 2, 3], weight: 2 },
];

/** 区画を開き、ほこりをかぶったアイテムを置く */
export function openBlock(world: World, idx: number, rng: Rng): Op[] {
  if (world.blocks[idx] === 1) return [];
  world.blocks[idx] = 1;
  const ops: Op[] = [{ t: 'block', idx, open: true }];
  const bx = (idx % BLOCKS_X) * BLOCK;
  const by = Math.floor(idx / BLOCKS_X) * BLOCK;
  // 今いちばん進んでいる人が出せる系列も、ほこりの中に混ぜる
  const table = [...DUSTY_TABLE];
  for (const c of unlockedChains(worldLevel(world))) {
    if (!table.some((r) => r.chain === c)) table.push({ chain: c, tiers: [1, 1, 2, 3], weight: 3 });
  }
  const totalW = table.reduce((s, r) => s + r.weight, 0);
  for (let y = by; y < by + BLOCK; y++) {
    for (let x = bx; x < bx + BLOCK; x++) {
      // 地図の中央 8×8 は最初の作業場所として空けておく
      if (x >= 46 && x < 54 && y >= 46 && y < 54) continue;
      if (rng() > 0.28) continue;
      const cell = cellAt(x, y);
      if (world.cells[cell]) continue;
      let r = rng() * totalW;
      const row = table.find((t) => (r -= t.weight) < 0) ?? table[0]!;
      const tier = row.tiers[Math.floor(rng() * row.tiers.length)]!;
      const item: Item = { id: world.nextId++, kind: kindOf(row.chain, tier), cell, dusty: true };
      putItem(world, item);
      ops.push({ t: 'spawn', item: { ...item } });
    }
  }
  world.rev++;
  return ops;
}

export type WorldJson = {
  v: 1;
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
    v: 1,
    rev: world.rev,
    nextId: world.nextId,
    items: [...world.items.values()],
    blocks: [...world.blocks],
    players: [...world.players.values()],
    worldOrders: world.worldOrders,
    nextWorldOrderId: world.nextWorldOrderId,
  };
}

export function fromJson(j: WorldJson): World {
  const w = emptyWorld();
  w.rev = j.rev;
  w.nextId = j.nextId;
  w.blocks.set(j.blocks);
  for (const it of j.items) putItem(w, { ...it });
  for (const p of j.players) w.players.set(p.id, fillPlayer({ ...p }));
  w.worldOrders = (j.worldOrders ?? []).map(copyWorldOrder);
  w.nextWorldOrderId = j.nextWorldOrderId ?? 1;
  return w;
}

/** 古いセーブにない項目を埋める */
export function fillPlayer(p: Player): Player {
  p.orders ??= [];
  p.nextOrderId ??= 1;
  p.storage ??= Array.from({ length: STORAGE_START }, () => null);
  return p;
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

const MAP_CENTER = cellAt(W / 2, H / 2);

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
  const taken = new Set(world.worldOrders.map((o) => o.block));
  const out: number[] = [];
  const isOpen = (x: number, y: number) => x >= 0 && y >= 0 && x < BLOCKS_X && y < BLOCKS_Y && world.blocks[y * BLOCKS_X + x] === 1;
  for (let i = 0; i < world.blocks.length; i++) {
    if (world.blocks[i] || taken.has(i)) continue;
    const bx = i % BLOCKS_X;
    const by = Math.floor(i / BLOCKS_X);
    if (isOpen(bx - 1, by) || isOpen(bx + 1, by) || isOpen(bx, by - 1) || isOpen(bx, by + 1)) out.push(i);
  }
  return out;
}

export function makeWorldOrder(world: World, block: number, rng: Rng): WorldOrder {
  const lv = worldLevel(world);
  const opened = openCount(world);
  const chains = unlockedChains(lv);
  const maxT = Math.min(7, 3 + Math.floor(lv / 4) + Math.floor(opened / 12));
  const minT = Math.max(2, Math.min(maxT - 1, 2 + Math.floor(opened / 10)));
  const nNeeds = opened >= 6 && rng() < 0.5 ? 2 : 1;
  const needs: OrderNeed[] = [];
  for (let i = 0; i < 10 && needs.length < nNeeds; i++) {
    const chain = chains[Math.floor(rng() * chains.length)] ?? 'bread';
    const tier = minT + Math.floor(rng() * (maxT - minT + 1));
    const kind = kindOf(chain, tier);
    if (needs.some((n) => n.kind === kind)) continue;
    const count = tier <= 3 ? 4 + Math.floor(rng() * 3) : tier <= 5 ? 2 + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 2);
    needs.push({ kind, count, have: 0 });
  }
  const owner = OWNER_OF_CHAIN[chainOfKind(needs[0]!.kind).key] ?? 'bread';
  return { id: world.nextWorldOrderId++, block, owner, needs, contributors: {} };
}

/** みんなの依頼を WORLD_ORDER_SLOTS 件まで足す（区画が残っている限り） */
export function ensureWorldOrders(world: World, rng: Rng): Op[] {
  const ops: Op[] = [];
  // 開いてしまった区画の依頼は消す
  for (const o of [...world.worldOrders]) {
    if (world.blocks[o.block]) {
      world.worldOrders = world.worldOrders.filter((x) => x !== o);
      ops.push({ t: 'worldOrderDone', id: o.id });
    }
  }
  while (world.worldOrders.length < WORLD_ORDER_SLOTS) {
    const cands = candidateBlocks(world);
    if (!cands.length) break;
    // 中央に近い区画を優先
    cands.sort((a, b) => blockDist(a) - blockDist(b));
    const pool = cands.slice(0, 4);
    const block = pool[Math.floor(rng() * pool.length)]!;
    const o = makeWorldOrder(world, block, rng);
    world.worldOrders.push(o);
    ops.push({ t: 'worldOrder', order: copyWorldOrder(o) });
  }
  if (ops.length) world.rev++;
  return ops;
}

function blockDist(i: number) {
  const x = (i % BLOCKS_X) - 4.5;
  const y = Math.floor(i / BLOCKS_X) - 4.5;
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
  if (!p) {
    p = fillPlayer({
      id, name, level: 1, xp: 0, energy: ENERGY_MAX, energyAt: now, coins: START_COINS,
    } as Player);
    world.players.set(id, p);
    for (const key of LEVEL_GRANTS[1] ?? []) ops.push(...grantGenerator(world, p, key, now));
  } else {
    p.name = name;
    fillPlayer(p);
  }
  topUpOrders(p, rng);
  if (ops.length) world.rev++;
  return ops;
}

// ---------- 注文 ----------

/** 注文をひとつ作る。今のレベルで出せる系列から */
export function makeOrder(p: Player, rng: Rng): Order {
  const chains = unlockedChains(p.level);
  const maxT = Math.min(7, 3 + Math.floor(p.level / 3));
  const minT = Math.max(2, maxT - 3);
  const nNeeds = p.level >= 4 && rng() < 0.4 ? 2 : 1;
  const needs: OrderNeed[] = [];
  for (let i = 0; i < nNeeds * 4 && needs.length < nNeeds; i++) {
    const chain = chains[Math.floor(rng() * chains.length)] ?? 'bread';
    // 低い段階ほど出やすく
    const span = maxT - minT + 1;
    const tier = minT + Math.floor(rng() * rng() * span);
    const kind = kindOf(chain, Math.min(tier, maxTierOfKind(kindOf(chain, 1))));
    if (needs.some((n) => n.kind === kind)) continue;
    const count = tierOfKind(kind) <= 3 && rng() < 0.3 ? 2 : 1;
    needs.push({ kind, count, have: 0 });
  }
  const value = needs.reduce((s, n) => s + n.count * 2 ** (tierOfKind(n.kind) - 1), 0);
  const xp = needs.reduce((s, n) => s + n.count * tierOfKind(n.kind) * 2, 0);
  const customer = CUSTOMERS[Math.floor(rng() * CUSTOMERS.length)]?.key ?? 'boy';
  return { id: p.nextOrderId++, customer, needs, coins: value * 2, xp };
}

/** 注文を ORDER_SLOTS 件まで足す。お客さんと中身は、できるだけほかの注文と重ならないように */
function topUpOrders(p: Player, rng: Rng) {
  while (p.orders.length < ORDER_SLOTS) {
    const id = p.nextOrderId;
    const sig = (o: Order) => o.needs.map((n) => n.kind).sort().join(',');
    const usedCust = new Set(p.orders.map((o) => o.customer));
    const usedSig = new Set(p.orders.map(sig));
    let pick = makeOrder(p, rng);
    for (let i = 0; i < 8 && (usedCust.has(pick.customer) || usedSig.has(sig(pick))); i++) {
      const next = makeOrder(p, rng);
      // お客さんだけでも変える
      if (!usedSig.has(sig(next)) || (usedCust.has(pick.customer) && !usedCust.has(next.customer))) pick = next;
    }
    if (usedCust.has(pick.customer)) {
      const free = CUSTOMERS.filter((c) => !usedCust.has(c.key));
      if (free.length) pick.customer = free[Math.floor(rng() * free.length)]!.key;
    }
    pick.id = id;
    p.nextOrderId = id + 1;
    p.orders.push(pick);
  }
}

function grantGenerator(world: World, p: Player, key: string, now: number): Op[] {
  // 自分のほかの発生器の近く。なければ地図の中央の近く
  const mine = [...world.items.values()].find((i) => i.owner === p.id);
  const center = mine ? mine.cell : MAP_CENTER;
  let cell = world.cells[center] ? findEmptyNear(world, center, 60) : center;
  if (cell < 0 || !isOpenCell(world, cell)) cell = findEmptyNear(world, MAP_CENTER, 60);
  if (cell < 0) return [];
  const kind = kindOf(key, 1);
  const item: Item = { id: world.nextId++, kind, cell, owner: p.id, maker: p.id };
  syncCharges(item, now);
  putItem(world, item);
  return [{ t: 'spawn', item: { ...item } }];
}

/** 今のレベルで出せる系列 */
export function unlockedChains(level: number): string[] {
  const out = new Set<string>();
  for (const c of CHAIN_BY_KEY.values()) {
    for (const row of c.gen?.produces ?? []) if (row.minLevel <= level) out.add(row.chain);
  }
  return [...out];
}

function gainXp(world: World, p: Player, amount: number, now: number, ops: Op[], events: GameEvent[]) {
  p.xp += amount;
  while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
    const before = new Set(unlockedChains(p.level));
    p.xp -= xpToNext(p.level);
    p.level++;
    syncEnergy(p, now);
    p.energy = Math.max(p.energy, ENERGY_MAX);
    p.energyAt = now;
    const granted = LEVEL_GRANTS[p.level] ?? [];
    for (const key of granted) ops.push(...grantGenerator(world, p, key, now));
    const newChains = unlockedChains(p.level).filter((c) => !before.has(c));
    events.push({ t: 'levelup', player: p.id, level: p.level, newChains, granted });
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

      const sameKind = target.kind === it.kind;
      const canGrow = tierOfKind(target.kind) < maxTierOfKind(target.kind);
      const genOk = !isGeneratorKind(target.kind) || (target.owner === p.id && it.owner === p.id);

      if (sameKind && canGrow && genOk) {
        const kind = target.kind + 1;
        target.kind = kind;
        target.dusty = undefined;
        target.maker = p.id;
        if (isGeneratorKind(kind)) {
          target.owner = p.id;
          syncCharges(target, now);
          // 段階が上がった分だけ、チャージの上限も増える
          target.charges = Math.max(target.charges ?? 0, it.charges ?? 0);
        }
        ops.push(...releaseOps());
        removeItem(world, it);
        ops.push({ t: 'remove', id: it.id }, { t: 'update', item: { ...target } });
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
      if (heldByOther(world, g.id, p.id, now)) return reject('held');
      syncEnergy(p, now);
      syncCharges(g, now);
      if (p.energy < def.energyCost) return reject('energy');
      if ((g.charges ?? 0) <= 0) return reject('no-charge');
      const rows = def.produces.filter((r) => r.minLevel <= p.level);
      if (!rows.length) return reject('nothing');
      const cell = findEmptyNear(world, g.cell, SPAWN_RADIUS);
      if (cell < 0) return reject('no-space');

      const totalW = rows.reduce((s, r) => s + r.weight, 0);
      let r = rng() * totalW;
      const row = rows.find((x) => (r -= x.weight) < 0) ?? rows[0]!;
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

    case 'sell': {
      const it = world.items.get(a.item);
      if (!it) return reject('no-item');
      if (it.dusty || isGeneratorKind(it.kind) || it.maker !== p.id) return reject('cannot-sell');
      if (heldByOther(world, it.id, p.id, now)) return reject('held');
      const coins = sellCoins(it.kind);
      removeItem(world, it);
      p.coins += coins;
      ops.push({ t: 'remove', id: it.id });
      events.push({ t: 'sold', player: p.id, coins });
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
      }
      if (order.needs.every((n) => n.have >= n.count)) {
        p.orders = p.orders.filter((o) => o !== order);
        p.coins += order.coins;
        events.push({ t: 'order', player: p.id, customer: order.customer, coins: order.coins, xp: order.xp });
        gainXp(world, p, order.xp, now, ops, events);
        topUpOrders(p, rng);
      }
      return done();
    }

    case 'store': {
      const it = world.items.get(a.item);
      if (!it) return reject('no-item');
      if (it.dusty) return reject('dusty');
      if (isGeneratorKind(it.kind)) return reject('not-needed');
      if (heldByOther(world, it.id, p.id, now)) return reject('held');
      const slot = p.storage.indexOf(null);
      if (slot < 0) return reject('storage-full');
      p.storage[slot] = it.kind;
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
      const item: Item = { id: world.nextId++, kind, cell: a.cell, maker: p.id };
      putItem(world, item);
      ops.push({ t: 'spawn', item: { ...item } });
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
      }
      // 1つ納品するごとに、売値ぶんのコインと経験値
      const coins = sellCoins(kind);
      const xp = tierOfKind(kind) * 2;
      p.coins += coins;
      events.push({ t: 'contrib', player: p.id, coins, xp });
      gainXp(world, p, xp, now, ops, events);
      const changed = new Set([p.id]);
      if (order.needs.every((n) => n.have >= n.count)) {
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

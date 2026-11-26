// みんなのシャッター（サーバーで遊ぶとき）。
// 盤面は1人1枚のままで、シャッター（土地）だけをみんなで共有する。
// だれかが納品すると全員のシャッターの数が進み、そろうと全員の盤面の同じ場所が同時に開く。
import { OWNER_OF_CHAIN, chainOfKind } from './defs.ts';
import { BLOCKS_X, BLOCKS_Y, START_BLOCK, blockDist, copyWorldOrder, frontierBlocks, openBlock, shutterNeed } from './engine.ts';
import type { Op, Rng, World, WorldOrder } from './engine.ts';

export type Commons = {
  /** 区画: 1=みんなで開けた */
  blocks: Uint8Array;
  orders: WorldOrder[];
  nextId: number;
};

export type CommonsJson = { open: number[]; orders: WorldOrder[]; nextId: number };

/** 最初の区画だけ開いた状態。opened を渡すと、その区画も開いた状態から（古いセーブの引きつぎ用） */
export function createCommons(opened: Iterable<number> = []): Commons {
  const blocks = new Uint8Array(BLOCKS_X * BLOCKS_Y);
  blocks[START_BLOCK] = 1;
  for (const i of opened) if (i >= 0 && i < blocks.length) blocks[i] = 1;
  return { blocks, orders: [], nextId: 1 };
}

export function commonsToJson(c: Commons): CommonsJson {
  const open: number[] = [];
  for (let i = 0; i < c.blocks.length; i++) if (c.blocks[i]) open.push(i);
  return { open, orders: c.orders.map(copyWorldOrder), nextId: c.nextId };
}

export function commonsFromJson(j: CommonsJson): Commons {
  const c = createCommons(j.open);
  c.orders = (j.orders ?? []).map(copyWorldOrder);
  c.nextId = j.nextId ?? 1;
  return c;
}

const openCount = (c: Commons) => c.blocks.reduce((s, b) => s + b, 0);

/** level: 参加しているうちでいちばん進んでいる人のレベル */
export function makeCommonOrder(c: Commons, block: number, level: number, rng: Rng): WorldOrder {
  const { kind, count } = shutterNeed(level, openCount(c), rng);
  const owner = OWNER_OF_CHAIN[chainOfKind(kind).key] ?? 'bread';
  return { id: c.nextId++, block, owner, needs: [{ kind, count, have: 0 }], contributors: {} };
}

/** 開いた所のとなりのシャッター全部に依頼を付ける（開いた区画の依頼は消す） */
export function ensureCommonOrders(c: Commons, level: number, rng: Rng) {
  c.orders = c.orders.filter((o) => !c.blocks[o.block]);
  const taken = new Set(c.orders.map((o) => o.block));
  for (const block of frontierBlocks(c.blocks, taken).sort((a, b) => blockDist(a) - blockDist(b))) {
    c.orders.push(makeCommonOrder(c, block, level, rng));
  }
}

/** そろった依頼か */
export const isOrderFull = (o: WorldOrder) => o.needs.every((n) => n.have >= n.count);

/**
 * 1人の盤面を、みんなのシャッターに合わせる。みんなで開けた区画を開け（中身のダンボールはその盤面ごと）、
 * シャッターの依頼をそっくり同じにする。盤面に送る差分を返す
 */
export function syncWorldToCommons(w: World, c: Commons, rng: Rng): Op[] {
  w.shared = true;
  const ops: Op[] = [];
  const toOpen: number[] = [];
  for (let i = 0; i < c.blocks.length; i++) if (c.blocks[i] && !w.blocks[i]) toOpen.push(i);
  // 近い所から順に（となりの開いた所に面したダンボールが半開きになる）
  for (const i of toOpen.sort((a, b) => blockDist(a) - blockDist(b))) ops.push(...openBlock(w, i, rng));
  const ids = new Set(c.orders.map((o) => o.id));
  for (const o of w.worldOrders) if (!ids.has(o.id)) ops.push({ t: 'worldOrderDone', id: o.id });
  for (const o of c.orders) {
    const old = w.worldOrders.find((x) => x.id === o.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(o)) ops.push({ t: 'worldOrder', order: copyWorldOrder(o) });
  }
  w.worldOrders = c.orders.map(copyWorldOrder);
  w.nextWorldOrderId = c.nextId;
  if (ops.length) w.rev++;
  return ops;
}

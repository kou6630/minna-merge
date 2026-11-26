// 同期のための道具: サーバーから届いた ops を盤面に当てる・盤面を複製する・2つの盤面の差を ops にする
import { HOLD_MS, } from './defs.ts';
import { copyWorldOrder, fromJson, putItem, removeItem, toJson } from './engine.ts';
import type { Item, Op, World } from './engine.ts';

export function cloneWorld(w: World): World {
  const c = fromJson(toJson(w));
  for (const [id, h] of w.holds) c.holds.set(id, { ...h });
  return c;
}

/** ops を順に当てる（同じ ops を2回当てても壊れない） */
export function applyOps(world: World, ops: Op[], now: number) {
  for (const op of ops) {
    switch (op.t) {
      case 'spawn':
      case 'update': {
        const old = world.items.get(op.item.id);
        // 中身が変わるだけ（update）のときは、だれかが持っていることを忘れない
        const hold = world.holds.get(op.item.id);
        if (old) removeItem(world, old);
        putItem(world, { ...op.item });
        if (hold && op.t === 'update') world.holds.set(op.item.id, hold);
        break;
      }
      case 'move': {
        const it = world.items.get(op.id);
        if (!it) break;
        if (world.cells[it.cell] === it.id) world.cells[it.cell] = 0;
        it.cell = op.cell;
        world.cells[op.cell] = it.id;
        break;
      }
      case 'remove': {
        const it = world.items.get(op.id);
        if (it) removeItem(world, it);
        break;
      }
      case 'hold':
        world.holds.set(op.id, { player: op.player, until: now + HOLD_MS });
        break;
      case 'unhold':
        world.holds.delete(op.id);
        break;
      case 'block':
        world.blocks[op.idx] = op.open ? 1 : 0;
        break;
      case 'worldOrder': {
        const i = world.worldOrders.findIndex((o) => o.id === op.order.id);
        if (i >= 0) world.worldOrders[i] = copyWorldOrder(op.order);
        else world.worldOrders.push(copyWorldOrder(op.order));
        break;
      }
      case 'worldOrderDone':
        world.worldOrders = world.worldOrders.filter((o) => o.id !== op.id);
        break;
    }
  }
}

function sameItem(a: Item, b: Item): boolean {
  return (
    a.kind === b.kind && a.owner === b.owner && a.maker === b.maker && !!a.dusty === !!b.dusty && !!a.boxed === !!b.boxed &&
    a.charges === b.charges && a.chargesAt === b.chargesAt && (a.taps ?? 0) === (b.taps ?? 0)
  );
}

/** 盤面 a を b にするための ops（見た目の更新に使う） */
export function diffWorlds(a: World, b: World): Op[] {
  const ops: Op[] = [];
  for (const [id] of a.items) if (!b.items.has(id)) ops.push({ t: 'remove', id });
  for (const [id, bi] of b.items) {
    const ai = a.items.get(id);
    if (!ai) {
      ops.push({ t: 'spawn', item: { ...bi } });
      continue;
    }
    if (ai.cell !== bi.cell) ops.push({ t: 'move', id, cell: bi.cell });
    if (!sameItem(ai, bi)) ops.push({ t: 'update', item: { ...bi } });
  }
  for (const [id, h] of b.holds) {
    const ah = a.holds.get(id);
    if (!ah || ah.player !== h.player) ops.push({ t: 'hold', id, player: h.player });
  }
  for (const [id] of a.holds) if (!b.holds.has(id) && b.items.has(id)) ops.push({ t: 'unhold', id });
  for (let i = 0; i < b.blocks.length; i++) {
    if (a.blocks[i] !== b.blocks[i]) ops.push({ t: 'block', idx: i, open: b.blocks[i] === 1 });
  }
  for (const o of a.worldOrders) if (!b.worldOrders.some((x) => x.id === o.id)) ops.push({ t: 'worldOrderDone', id: o.id });
  for (const o of b.worldOrders) {
    const old = a.worldOrders.find((x) => x.id === o.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(o)) ops.push({ t: 'worldOrder', order: copyWorldOrder(o) });
  }
  return ops;
}

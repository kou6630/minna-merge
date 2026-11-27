// 注文と盤面のアイテムを突き合わせる（緑のチェック・完了ボタン用）
import { isGeneratorKind, isGiftKind, isOpenCell } from '@minna/shared';
import type { Player, World } from '@minna/shared';

/** 注文ごとの「盤面にもう出来ている」印。盤面のアイテム1個は、注文の1つにだけ割り当てる */
export type OrderMatch = {
  /** 注文 id → それぞれの need が盤面にあるか */
  ready: Map<number, boolean[]>;
  /** 注文に出せる盤面のアイテム id（緑のチェックを付ける） */
  items: Set<number>;
  /** 注文 id → need ごとに割り当てたアイテム id（盤面の物。倉庫の物は -(枠の番号+1)） */
  assign: Map<number, (number | undefined)[]>;
};

export function matchOrders(p: Player, world: World, now: number): OrderMatch {
  const avail = new Map<number, number[]>();
  for (const it of world.items.values()) {
    if (it.boxed || it.dusty || isGeneratorKind(it.kind) || isGiftKind(it.kind)) continue;
    if (!isOpenCell(world, it.cell)) continue;
    const h = world.holds.get(it.id);
    if (h && h.player !== p.id && h.until > now) continue;
    const list = avail.get(it.kind);
    if (list) list.push(it.id);
    else avail.set(it.kind, [it.id]);
  }
  for (const list of avail.values()) list.sort((a, b) => a - b);
  // 倉庫の物も数える（盤面の物を先に使う）。倉庫の物は -(枠の番号+1) で表す
  p.storage.forEach((k, slot) => {
    if (k === null || isGeneratorKind(k) || isGiftKind(k)) return;
    const list = avail.get(k);
    if (list) list.push(-(slot + 1));
    else avail.set(k, [-(slot + 1)]);
  });
  const ready = new Map<number, boolean[]>();
  const items = new Set<number>();
  const assign = new Map<number, (number | undefined)[]>();
  const sorted = [...p.orders].sort((a, b) => a.id - b.id);
  const take = (o: (typeof sorted)[number]) => {
    const ids = o.needs.map((n) => (n.have >= n.count ? undefined : avail.get(n.kind)?.shift()));
    for (const id of ids) if (id !== undefined) items.add(id);
    assign.set(o.id, ids);
    ready.set(o.id, ids.map((id) => id !== undefined));
  };
  // 1回目: 今あるアイテムで全部そろう注文から（同じ種類は1つの注文に1回しか出ない）
  for (const o of sorted) if (o.needs.every((n) => n.have >= n.count || (avail.get(n.kind)?.length ?? 0) > 0)) take(o);
  // 2回目: そろわない注文には、残ったアイテムでチェックだけ付ける
  for (const o of sorted) if (!assign.has(o.id)) take(o);
  return { ready, items, assign };
}

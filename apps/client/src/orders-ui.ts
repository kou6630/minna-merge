// 下の注文カードと倉庫の表示
import { CUSTOMERS, STORAGE_MAX, itemName, storageCost } from '@minna/shared';
import type { Order, Player } from '@minna/shared';
import type { Manifest } from './assets.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type OrdersHandlers = {
  unstore(slot: number): void;
  give(slot: number, order: number): void;
  expand(): void;
};

export function customerOf(key: string) {
  return CUSTOMERS.find((c) => c.key === key) ?? CUSTOMERS[0]!;
}

export class OrdersUi {
  private lastOrders = '';
  private lastStorage = '';
  private selected = -1;
  private player: Player | null = null;

  constructor(
    private m: Manifest,
    private h: OrdersHandlers,
  ) {
    $('dock').hidden = false;
    $('storageBtn').addEventListener('click', () => {
      $('storageTray').hidden = !$('storageTray').hidden;
      this.select(-1);
    });
    $('slotOut').addEventListener('click', () => {
      if (this.selected >= 0) this.h.unstore(this.selected);
      this.select(-1);
    });
    $('slotGive').addEventListener('click', () => {
      const o = this.orderFor(this.selected);
      if (o) this.h.give(this.selected, o.id);
      this.select(-1);
    });
    $('expandBtn').addEventListener('click', () => this.h.expand());
  }

  private img(kind: number) {
    return this.m.items[kind] ?? '';
  }

  private custImg(key: string) {
    return this.m.customers.find((c) => c.key === key)?.src ?? '';
  }

  /** この枠のアイテムを欲しがっている注文 */
  private orderFor(slot: number): Order | undefined {
    const kind = this.player?.storage[slot];
    if (kind === null || kind === undefined) return undefined;
    return this.player?.orders.find((o) => o.needs.some((n) => n.kind === kind && n.have < n.count));
  }

  render(p: Player) {
    this.player = p;
    const ok = JSON.stringify(p.orders);
    if (ok !== this.lastOrders) {
      const before = new Set((JSON.parse(this.lastOrders || '[]') as Order[]).map((o) => o.id));
      this.lastOrders = ok;
      this.renderOrders(p.orders, before);
    }
    const sk = JSON.stringify([p.storage, p.coins >= storageCost(p.storage.length)]);
    if (sk !== this.lastStorage) {
      this.lastStorage = sk;
      this.renderStorage(p);
    }
  }

  private renderOrders(orders: Order[], before: Set<number>) {
    const box = $('orders');
    box.textContent = '';
    for (const o of orders) {
      const c = customerOf(o.customer);
      const card = document.createElement('div');
      card.className = 'order';
      if (before.size && !before.has(o.id)) card.classList.add('pop');
      card.dataset.drop = 'order';
      card.dataset.order = String(o.id);
      card.title = `${c.name}「${c.line}」`;

      const top = document.createElement('div');
      top.className = 'top';
      const face = document.createElement('img');
      face.className = 'cust';
      face.src = this.custImg(o.customer);
      face.alt = c.name;
      const needs = document.createElement('div');
      needs.className = 'needs';
      for (const n of o.needs) {
        const s = document.createElement('span');
        s.className = 'need' + (n.have >= n.count ? ' done' : '');
        s.title = itemName(n.kind);
        const im = document.createElement('img');
        im.src = this.img(n.kind);
        im.alt = itemName(n.kind);
        const b = document.createElement('b');
        b.textContent = `${n.have}/${n.count}`;
        s.append(im, b);
        needs.appendChild(s);
      }
      top.append(face, needs);

      const reward = document.createElement('div');
      reward.className = 'reward';
      const coin = document.createElement('img');
      coin.src = this.m.icons.coin ?? '';
      const xp = document.createElement('img');
      xp.src = this.m.icons.xp ?? '';
      reward.append(coin, document.createTextNode(String(o.coins)), xp, document.createTextNode(String(o.xp)));
      card.append(top, reward);
      box.appendChild(card);
    }
  }

  private renderStorage(p: Player) {
    const used = p.storage.filter((s) => s !== null).length;
    $('storageCount').textContent = `${used}/${p.storage.length}`;
    const slots = $('slots');
    slots.textContent = '';
    p.storage.forEach((kind, i) => {
      const d = document.createElement('div');
      d.className = 'slot' + (kind !== null ? ' filled' : '') + (i === this.selected ? ' selected' : '');
      if (kind !== null) {
        const im = document.createElement('img');
        im.src = this.img(kind);
        im.alt = itemName(kind);
        d.title = itemName(kind);
        d.appendChild(im);
        d.onclick = () => this.select(i === this.selected ? -1 : i);
      }
      slots.appendChild(d);
    });
    const ex = $<HTMLButtonElement>('expandBtn');
    if (p.storage.length >= STORAGE_MAX) {
      ex.hidden = true;
    } else {
      ex.hidden = false;
      const cost = storageCost(p.storage.length);
      ex.textContent = `1枠広げる（${cost}コイン）`;
      ex.disabled = p.coins < cost;
    }
    if (this.selected >= 0 && p.storage[this.selected] === null) this.select(-1);
  }

  private select(i: number) {
    this.selected = i;
    $('slotActions').hidden = i < 0;
    $('slotGive').hidden = !this.orderFor(i);
    this.lastStorage = '';
    if (this.player) this.renderStorage(this.player);
  }

  /** 注文が終わったときの演出 */
  celebrate(customer: string, coins: number) {
    return `${customerOf(customer).name}「ありがとう！」 +${coins} コイン`;
  }
}

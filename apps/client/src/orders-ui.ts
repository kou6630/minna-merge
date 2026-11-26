// 左の注文の列と倉庫の表示
import {
  CLEARS_PER_CUSTOMER, CUSTOMERS, GEN_WORK_TIER, STORAGE_MAX, isGeneratorKind, isGiftKind, itemName,
  orderCustomerCount, portraitSrc, scrapCoins, storageCost, tierOfKind,
} from '@minna/shared';
import type { Order, Player, SpeakerId } from '@minna/shared';
import type { Manifest } from './assets.ts';
import type { OrderMatch } from './order-match.ts';
export { matchOrders } from './order-match.ts';
export type { OrderMatch } from './order-match.ts';

/** 注文カードの絵の版（絵を作りなおしたら上げる） */
const ORDER_ART_V = '1';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type OrdersHandlers = {
  /** 倉庫から盤面に出す（x, y は画面の位置。そのマスに出す） */
  unstoreAt(slot: number, x: number, y: number): void;
  give(slot: number, order: number): void;
  sell(slot: number): void;
  expand(): void;
  /** 完了ボタン: 盤面のアイテム（need ごとの id）をまとめて納品する */
  complete(order: number, items: number[]): void;
  /** 受け取り枠の先頭を盤面に出す */
  take(): void;
};

export function customerOf(key: string) {
  return CUSTOMERS.find((c) => c.key === key) ?? CUSTOMERS[0]!;
}

export class OrdersUi {
  private lastOrders = '';
  private shutters = new Set<number>();
  private lastStorage = '';
  private selected = -1;
  private player: Player | null = null;
  private seen = new Set<number>();
  private assign = new Map<number, (number | undefined)[]>();
  private lastInbox = '';

  constructor(
    private m: Manifest,
    private h: OrdersHandlers,
  ) {
    $('dock').hidden = false;
    document.body.classList.add('in-game');
    $('storageBtn').addEventListener('click', () => {
      $('storageTray').hidden = !$('storageTray').hidden;
      this.select(-1);
      this.placeTray();
    });
    const sellSlot = () => {
      if (this.selected >= 0) this.h.sell(this.selected);
      this.select(-1);
    };
    $('slotTrash').addEventListener('click', sellSlot);
    $('slotSell').addEventListener('click', sellSlot);
    $('expandBtn').addEventListener('click', () => this.h.expand());
    $('inboxBtn').addEventListener('click', () => this.h.take());
    this.dragScroll();
    this.edgeScroll();
  }

  /** マウスで注文の列をつかんで上下に動かすとスクロール（指はそのままスクロールできる） */
  private dragScroll() {
    const box = $('orders');
    let drag: { id: number; y: number; top: number; moved: boolean } | null = null;
    const end = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      box.classList.remove('grabbing');
    };
    box.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      drag = { id: e.pointerId, y: e.clientY, top: box.scrollTop, moved: false };
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (e.buttons === 0) { end(e); return; }
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dy) < 4) return;
      if (!drag.moved) {
        drag.moved = true;
        box.setPointerCapture(e.pointerId);
        box.classList.add('grabbing');
      }
      box.scrollTop = drag.top - dy;
    });
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('lostpointercapture', end);
  }

  /** 盤面からアイテムを運んでいる間、列の上下の端に近づけると、その向きにスクロール */
  private edgeScroll() {
    const box = $('orders');
    let speed = 0;
    let raf = 0;
    const step = () => {
      raf = 0;
      if (!speed) return;
      box.scrollTop += speed;
      raf = requestAnimationFrame(step);
    };
    const stop = () => { speed = 0; };
    window.addEventListener('pointermove', (e) => {
      // アイテムを運んでいるときだけ（盤面を動かしているときはスクロールしない）
      if (!e.buttons || !document.body.classList.contains('item-dragging')) return stop();
      if (e.target === box || box.contains(e.target as Node)) return stop();
      const r = box.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right) return stop();
      const edge = 48;
      speed = e.clientY < r.top + edge ? -Math.ceil((r.top + edge - e.clientY) / 6)
        : e.clientY > r.bottom - edge ? Math.ceil((e.clientY - (r.bottom - edge)) / 6) : 0;
      if (speed && !raf) raf = requestAnimationFrame(step);
    });
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  private img(kind: number) {
    return this.m.items[kind] ?? '';
  }

  /** この枠のアイテムを欲しがっている注文 */
  private orderFor(slot: number): Order | undefined {
    const kind = this.player?.storage[slot];
    if (kind === null || kind === undefined) return undefined;
    return this.player?.orders.find((o) => o.needs.some((n) => n.kind === kind && n.have < n.count));
  }

  /**
   * shutters: シャッターが待っているアイテム（その注文に納品すると、シャッターも開きに近づく）。
   * match: 盤面にもう出来ているアイテム（その need にチェックを付け、チェックのある人を上に並べる）
   */
  render(p: Player, shutters: number[] = [], match?: OrderMatch) {
    this.player = p;
    this.shutters = new Set(shutters);
    this.assign = match?.assign ?? new Map();
    const ready = match ? [...match.ready] : [];
    const ok = JSON.stringify([p.orders, shutters, ready, p.orderClears]);
    if (ok !== this.lastOrders) {
      this.lastOrders = ok;
      this.renderOrders(p, match?.ready ?? new Map());
    }
    const ik = JSON.stringify(p.inbox ?? []);
    if (ik !== this.lastInbox) {
      const grew = this.lastInbox !== '' && (p.inbox?.length ?? 0) > (JSON.parse(this.lastInbox) as number[]).length;
      this.lastInbox = ik;
      this.renderInbox(p.inbox ?? [], grew);
    }
    const sk = JSON.stringify([p.storage, p.coins >= storageCost(p.storage.length)]);
    if (sk !== this.lastStorage) {
      this.lastStorage = sk;
      this.renderStorage(p);
    }
    // 「注文に渡す」は注文が変わったら出し直す
  }

  private renderOrders(p: Player, ready: Map<number, boolean[]>) {
    const box = $('orders');
    // 並べかえの前の位置（動いたカードをすべらせる）
    const previous = new Map<string, { top: number; ready: boolean }>();
    for (const el of box.children) {
      previous.set((el as HTMLElement).dataset.order!, { top: el.getBoundingClientRect().top, ready: el.classList.contains('ready') });
    }

    // チェックの多い人ほど上。全部そろった人がいちばん上
    const score = (o: Order) => {
      const r = ready.get(o.id) ?? [];
      const ok = o.needs.filter((n, i) => n.have >= n.count || r[i]).length;
      return ok === o.needs.length ? 2 + ok : ok;
    };
    const rank = (o: Order) => CUSTOMERS.findIndex((c) => c.key === o.customer);
    const list = [...p.orders].sort((a, b) => score(b) - score(a) || rank(a) - rank(b));

    box.textContent = '';
    for (const o of list) {
      const c = customerOf(o.customer);
      const r = ready.get(o.id) ?? [];
      const card = document.createElement('div');
      card.className = 'order';
      if (this.seen.size && !this.seen.has(o.id)) card.classList.add('pop');
      const allReady = o.needs.every((n, i) => n.have >= n.count || r[i]);
      if (allReady) card.classList.add('ready');
      if (allReady && previous.get(String(o.id))?.ready === false) card.classList.add('just-ready');
      card.dataset.drop = 'order';
      card.dataset.order = String(o.id);
      card.dataset.customer = o.customer;
      card.title = `${c.name}「${c.line}」`;

      // 左: その人（腰から上）と名前
      const who = document.createElement('div');
      who.className = 'who';
      const face = document.createElement('img');
      face.className = 'cust';
      face.alt = c.name;
      face.draggable = false;
      face.src = `assets/orders/${o.customer}.png?v=${ORDER_ART_V}`;
      face.onerror = () => { face.onerror = null; face.src = portraitSrc(o.customer as SpeakerId); face.classList.add('fallback'); };
      const name = document.createElement('span');
      name.className = 'cust-name';
      name.textContent = c.name;
      who.append(face, name);

      const needs = document.createElement('div');
      needs.className = 'needs';
      o.needs.forEach((n, i) => {
        const s = document.createElement('span');
        s.className = 'need' + (n.have >= n.count ? ' done' : r[i] ? ' ready' : '');
        s.title = itemName(n.kind) + (r[i] ? '　盤面にある' : '');
        const im = document.createElement('img');
        im.src = this.img(n.kind);
        im.alt = itemName(n.kind);
        im.draggable = false;
        s.append(im);
        if (n.count > 1) {
          const b = document.createElement('b');
          b.textContent = `${n.have}/${n.count}`;
          s.append(b);
        }
        if (this.shutters.has(n.kind)) {
          // シャッターも待っているアイテム
          const k = document.createElement('i');
          k.className = 'shutter-mark';
          k.title = 'シャッターも開きに近づく';
          s.classList.add('for-shutter');
          s.appendChild(k);
        }
        needs.appendChild(s);
      });

      const reward = document.createElement('div');
      reward.className = 'reward';
      const coin = document.createElement('img');
      coin.src = this.m.icons.coin ?? '';
      const xp = document.createElement('img');
      xp.src = this.m.icons.xp ?? '';
      reward.append(coin, document.createTextNode(String(o.coins)), xp, document.createTextNode(String(o.xp)));
      // 右: 頼まれたアイテムと報酬
      const right = document.createElement('div');
      right.className = 'right';
      right.append(needs, reward);
      const body = document.createElement('div');
      body.className = 'body';
      body.append(who, right);
      card.append(body);
      // 全部そろったら完了ボタン（盤面のアイテムをまとめて渡す）
      const ids = (this.assign.get(o.id) ?? []).filter((id): id is number => id !== undefined);
      if (allReady && ids.length) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn order-done';
        btn.textContent = '完了';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          // 盤面の別個体に入れ替わっている場合もあるため、押した瞬間の最新の割り当てIDを使う
          const latest = (this.assign.get(o.id) ?? []).filter((id): id is number => id !== undefined);
          if (!latest.length) return;
          btn.disabled = true;
          this.h.complete(o.id, latest);
          // 断られたとき（通信で先にほかの操作が入ったなど）は注文がそのまま残るので、少ししたらまた押せるように
          window.setTimeout(() => { if (btn.isConnected) btn.disabled = false; }, 2500);
        });
        card.append(btn);
      }
      box.appendChild(card);
    }
    for (const o of p.orders) this.seen.add(o.id);

    // すべらせる（FLIP）
    for (const el of box.children) {
      const card = el as HTMLElement;
      const before = previous.get(card.dataset.order!)?.top;
      if (before === undefined) continue;
      const dy = before - card.getBoundingClientRect().top;
      if (Math.abs(dy) < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) continue;
      card.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
    }

    // 次の人が来るまで
    const n = orderCustomerCount(p.orderClears);
    const head = $('ordersNext');
    if (n >= CUSTOMERS.length) {
      head.textContent = '8人そろった！';
    } else {
      const left = CLEARS_PER_CUSTOMER - (p.orderClears % CLEARS_PER_CUSTOMER);
      head.textContent = `全部クリアあと${left}回で次の人`;
    }
  }

  /** 受け取り枠: 次に出るアイテムの絵と、右上に残りの数 */
  private renderInbox(inbox: number[], grew: boolean) {
    const btn = $('inboxBtn');
    const next = inbox[0];
    btn.classList.toggle('is-empty', next === undefined);
    const img = $<HTMLImageElement>('inboxImg');
    img.hidden = next === undefined;
    if (next !== undefined) {
      img.src = this.img(next);
      img.alt = itemName(next);
      btn.title = `次は「${itemName(next)}」。タップすると盤面に出る`;
    } else {
      btn.title = 'もらったアイテムがここに入る';
    }
    const count = $('inboxCount');
    count.hidden = inbox.length === 0;
    count.textContent = String(inbox.length);
    $('inboxLabel').textContent = next === undefined ? '受け取り' : 'タップで出す';
    if (grew) {
      btn.classList.remove('got');
      void btn.offsetWidth;
      btn.classList.add('got');
    }
  }

  /** 受け取り枠の絵の位置（飛んでいく演出の出発点） */
  inboxRect() {
    return $('inboxImg').getBoundingClientRect();
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
        d.onpointerdown = (e) => this.slotDrag(e, i, d, kind);
      }
      slots.appendChild(d);
    });
    const ex = $<HTMLButtonElement>('expandBtn');
    if (p.storage.length >= STORAGE_MAX) {
      ex.hidden = true;
    } else {
      ex.hidden = false;
      const cost = storageCost(p.storage.length);
      ex.textContent = `1枠広げる　${cost}コイン`;
      ex.disabled = p.coins < cost;
    }
    if (this.selected >= 0 && p.storage[this.selected] === null) this.select(-1);
    else if (this.selected >= 0) this.updateSlotSell(this.selected);
    this.placeTray();
  }

  /** 倉庫のマスをドラッグ: 盤面に落とすとそのマスに、注文カードに落とすと渡す。ほとんど動かさなければ選ぶ */
  private slotDrag(e: PointerEvent, i: number, el: HTMLElement, kind: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX; const y0 = e.clientY;
    let ghost: HTMLImageElement | null = null;
    let hover: HTMLElement | null = null;
    const target = (x: number, y: number) => {
      if (ghost) ghost.style.display = 'none';
      const t = document.elementFromPoint(x, y);
      if (ghost) ghost.style.display = '';
      return t;
    };
    const move = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        ghost = document.createElement('img');
        ghost.src = this.img(kind);
        ghost.className = 'slot-ghost';
        document.body.appendChild(ghost);
        el.classList.add('dragging');
      }
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
      const o = (target(ev.clientX, ev.clientY)?.closest('[data-drop="order"]') as HTMLElement | null) ?? null;
      if (o !== hover) { hover?.classList.remove('drop-hover'); o?.classList.add('drop-hover'); hover = o; }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      hover?.classList.remove('drop-hover');
      el.classList.remove('dragging');
      if (!ghost) {
        if (ev.type === 'pointerup') this.select(i === this.selected ? -1 : i);
        return;
      }
      ghost.remove();
      if (ev.type !== 'pointerup') return;
      const t = target(ev.clientX, ev.clientY);
      const order = t?.closest('[data-drop="order"]') as HTMLElement | null;
      this.select(-1);
      if (order) this.h.give(i, Number(order.dataset.order));
      else if (t instanceof HTMLCanvasElement) this.h.unstoreAt(i, ev.clientX, ev.clientY);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** 倉庫を開いているときは、下の情報欄と「元に戻す」を倉庫の上に出す（かさなって押せなくならないように） */
  private placeTray() {
    const tray = $('storageTray');
    document.body.style.setProperty('--tray-h', tray.hidden ? '0px' : `${tray.offsetHeight + 8}px`);
  }

  private updateSlotSell(i: number) {
    const trash = $('slotTrash');
    const sell = $('slotSell');
    trash.hidden = true;
    sell.hidden = true;
    const kind = i >= 0 ? this.player?.storage[i] : null;
    if (kind === null || kind === undefined) return;
    // 盤面と同じルール: プレゼント箱・発生器（部品も）は消せない（Lv1はゴミ箱、Lv2〜はコイン化）
    if (isGiftKind(kind)) return;
    if (isGeneratorKind(kind)) return; // 発生器は部品も消せない
    const coins = scrapCoins(kind);
    if (coins > 0) {
      sell.hidden = false;
      $('slotSellCoins').textContent = `+${coins}`;
    } else {
      trash.hidden = false;
    }
  }

  private select(i: number) {
    this.selected = i;
    this.updateSlotSell(i);
    // 消せる物のときだけ、ゴミ箱・コインのボタンを出す
    $('slotActions').hidden = i < 0 || ($('slotTrash').hidden && $('slotSell').hidden);
    this.lastStorage = '';
    if (this.player) this.renderStorage(this.player);
  }

  /** 注文が終わったときの演出 */
  celebrate(customer: string, coins: number) {
    const source = $('orders').querySelector<HTMLElement>(`[data-customer="${CSS.escape(customer)}"] .reward img`);
    const wallet = $('coins').parentElement!;
    const target = wallet.querySelector('img')!;
    if (source && coins > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const from = source.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      const rail = $('orders').getBoundingClientRect();
      if (from.width && to.width && from.bottom > rail.top && from.top < rail.bottom) {
        const dx = to.left + to.width / 2 - from.left - from.width / 2;
        const dy = to.top + to.height / 2 - from.top - from.height / 2;
        for (let i = 0; i < 3; i++) {
          const coin = target.cloneNode(false) as HTMLImageElement;
          coin.alt = '';
          coin.className = 'receipt-coin';
          coin.style.left = `${from.left + from.width / 2 - 11}px`;
          coin.style.top = `${from.top + from.height / 2 - 11}px`;
          document.body.append(coin);
          const flight = coin.animate([
            { transform: 'scale(.55)', opacity: 0 },
            { transform: `translate(${dx * .38 + i * 5}px, ${dy * .38 - 22 - i * 7}px) scale(1.05)`, opacity: 1, offset: .38 },
            { transform: `translate(${dx}px, ${dy}px) scale(.66)`, opacity: 1 },
          ], { duration: 430, delay: i * 55, fill: 'both', easing: 'ease-in-out' });
          flight.onfinish = () => {
            coin.remove();
            if (i === 2) wallet.animate([{ scale: '1' }, { scale: '1.12' }, { scale: '1' }], { duration: 210 });
          };
        }
      }
    }
    return `${customerOf(customer).name}「ありがとう！」 +${coins} コイン`;
  }
}

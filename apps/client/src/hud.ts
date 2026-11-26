// 画面の上に重ねる DOM の表示（レベル・エネルギー・コイン・情報欄・お知らせ・レベルアップ）
import {
  CHAIN_BY_KEY, ENERGY_MAX, GEM_ENERGY_AMOUNT, GEM_ENERGY_COST, GEN_WORK_TIER, GIFTS, genRefillCost, OWNER_OF_CHAIN, chainOfKind, itemName, isGeneratorKind, isGiftKind, kindOf, maxCharges, maxTierOfKind,
  nextEnergyMs, scrapCoins, syncCharges, syncEnergy, tierOfKind, UNDO_SELL_MS, xpToNext,
} from '@minna/shared';
import type { GameEvent, Item, Player, World } from '@minna/shared';
import type { Manifest } from './assets.ts';
import { customerOf } from './orders-ui.ts';
import { scatterAward } from './award-fx.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** 系列 → その店の店主の絵 */
const OWNER_OF = OWNER_OF_CHAIN;
type Delivery = Extract<GameEvent, { t: 'order' }>;
type Award = Extract<GameEvent, { t: 'levelup' }> | (Extract<GameEvent, { t: 'ordersCleared' }> & { delivery?: Delivery });

function fmtTime(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  private awardQueue: Award[] = [];
  private stopAward?: () => void;
  /** レベルアップ画面を出すのを待つか（ストーリーの会話や報酬の画面が出ている間） */
  holdLevelUps: () => boolean = () => false;
  /** レベルアップ画面を全部閉じたら呼ぶ */
  private luDone: (() => void)[] = [];
  private info: Item | null = null;
  /** ゴミ箱・コイン化 */
  onSell: (item: Item) => void = () => {};
  /** ゴミ箱・コイン化を元に戻す */
  onUndoSell: () => void = () => {};
  /** 一度でも盤面に出たことのあるアイテム（図鑑） */
  private seen = new Set<number>();
  private undoTimer = 0;
  /** ジェムで発生器をすぐ満タンにする */
  onRefill: (item: Item) => void = () => {};
  /** ジェムでスタミナを回復する */
  onBuyEnergy: () => void = () => {};
  private gems = 0;

  constructor(
    private m: Manifest,
    private me: string,
    private now: () => number,
  ) {
    $('hud').hidden = false;
    $('luClose').onclick = () => {
      this.stopAward?.();
      $('levelup').hidden = true;
      this.nextAward();
    };
    $('sellBtn').onclick = () => this.info && this.onSell(this.info);
    $('trashBtn').onclick = () => this.info && this.onSell(this.info);
    $('bookBtn').onclick = () => this.info && this.openBook(this.info.kind);
    $('bookClose').onclick = () => { $('bookModal').hidden = true; };
    $('bookModal').onclick = (e) => { if (e.target === $('bookModal')) $('bookModal').hidden = true; };
    $('undoBtn').onclick = () => {
      $<HTMLButtonElement>('undoBtn').disabled = true;
      this.onUndoSell();
    };
    $('refillBtn').onclick = () => this.info && this.onRefill(this.info);
    $('energyBtn').onclick = () => this.openGemShop();
    $('gemClose').onclick = () => { $('gemShop').hidden = true; };
    $('gemShop').onclick = (e) => { if (e.target === $('gemShop')) $('gemShop').hidden = true; };
    $('gemBuyEnergy').onclick = () => this.onBuyEnergy();
    $('gemEnergyAmount').textContent = `+${GEM_ENERGY_AMOUNT}`;
    $('gemEnergyCost').textContent = String(GEM_ENERGY_COST);
  }

  img(kind: number) {
    return this.m.items[kind] ?? '';
  }

  /** 参加中の人数（通信のときだけ表示） */
  setOnline(n: number | null) {
    $('onlinePill').hidden = n === null;
    if (n !== null) $('online').textContent = String(n);
  }

  /** 通信の状態（null で消す） */
  setStatus(text: string | null) {
    const el = $('netStatus');
    el.hidden = !text;
    el.textContent = text ?? '';
  }

  update(src: Player) {
    if (src.seen && src.seen.length !== this.seen.size) this.seen = new Set(src.seen);
    const now = this.now();
    const p = { ...src }; // 表示のための計算で元の値を変えない
    syncEnergy(p, now);
    $('lv').textContent = String(p.level);
    $('xpfill').style.width = `${Math.min(100, (p.xp / xpToNext(p.level)) * 100)}%`;
    $('energy').textContent = String(p.energy);
    const next = nextEnergyMs(p, now);
    $('energyNext').textContent = p.energy < ENERGY_MAX ? `+1まで ${fmtTime(next)}` : '';
    $('coins').textContent = p.coins >= 900_000 ? '∞' : String(p.coins);
    const g = document.getElementById('gems');
    if (g) g.textContent = String(p.gems ?? 0);
    this.gems = p.gems ?? 0;
    if (!$('gemShop').hidden) this.renderGemShop();
  }

  /** ジェムでスタミナを回復する画面 */
  openGemShop() {
    $('gemShop').hidden = false;
    this.renderGemShop();
  }

  closeGemShop() {
    $('gemShop').hidden = true;
  }

  private renderGemShop() {
    $('gemHave').textContent = String(this.gems);
    const ok = this.gems >= GEM_ENERGY_COST;
    $<HTMLButtonElement>('gemBuyEnergy').disabled = !ok;
    $('gemNote').textContent = ok ? '満タンをこえて回復できる' : `ジェムがあと${GEM_ENERGY_COST - this.gems}足りない。ストーリーをクリアするともらえる`;
  }

  /** 選んでいるアイテムの表示を、今の盤面に合わせ直す */
  refresh(world: World) {
    if (this.info) this.showInfo(world.items.get(this.info.id) ?? null);
  }

  showInfo(it: Item | null) {
    this.info = it;
    const box = $('info');
    if (!it) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const sell = $<HTMLButtonElement>('sellBtn');
    sell.hidden = true;
    const trash = $<HTMLButtonElement>('trashBtn');
    trash.hidden = true;
    const refill = $<HTMLButtonElement>('refillBtn');
    refill.hidden = true;
    const book = $<HTMLButtonElement>('bookBtn');
    // ふたの閉まったダンボール: 中身は見せない（名前も絵もレベルも）。ボタンも出さない
    if (it.boxed) {
      book.hidden = true;
      $<HTMLImageElement>('infoImg').src = 'assets/ui/box_closed.png';
      $('infoName').textContent = 'ダンボール';
      $('infoLv').hidden = true;
      $('infoSub').textContent = 'ふたが閉まっている。となりのマスを使えるようにすると半開きになる';
      return;
    }
    book.hidden = false;
    $('infoLv').hidden = false;
    $<HTMLImageElement>('infoImg').src = this.img(it.kind);
    const chain = chainOfKind(it.kind);
    const tier = tierOfKind(it.kind);
    $('infoName').textContent = itemName(it.kind);
    $('infoLv').textContent = `Lv${tier}`;
    let sub = '';
    if (isGiftKind(it.kind)) {
      const g = GIFTS[tier - 1]!;
      const left = g.safe - (it.taps ?? 0);
      const what = g.from === 'child' ? `段階${g.minTier}〜${g.maxTier}の作れる子アイテム` : `段階${g.minTier}〜${g.maxTier}の持っている発生器`;
      sub = `${what}が出る　${left > 0 ? `あと${left}回は必ず出る` : 'ここからは 50% で消える'}`;
    } else if (it.dusty) {
      sub = '半開きのダンボール。同じアイテムを重ねると取り出せる';
    } else if (isGeneratorKind(it.kind) && tier < GEN_WORK_TIER) {
      sub = `部品。Lv${GEN_WORK_TIER}で動きだす`;
    } else if (isGeneratorKind(it.kind)) {
      if (it.owner === this.me) {
        it = { ...it };
        syncCharges(it, this.now());
        const max = maxCharges(it);
        const ch = it.charges ?? max;
        const step = (chain.gen?.chargeSec ?? 0) * 1000;
        const wait = ch < max ? `　+1まで ${fmtTime(Math.max(0, (it.chargesAt ?? 0) + step - this.now()))}` : '';
        sub = ch > 0 ? `のこり ${ch}/${max}${wait}` : `使い切って休み中${wait}`;
        if (ch === 0) {
          // 使い切って休んでいるときだけ、ジェムですぐ満タン
          const cost = genRefillCost(max);
          refill.hidden = false;
          refill.disabled = this.gems < cost;
          // 毎秒の描き直しで中身を入れ替えると、押した瞬間に消えてクリックが抜けるので、変わったときだけ
          const html = `すぐ満タン<span class="gem-price"><img src="assets/ui/gem.png" alt="ジェム" /><b>${cost}</b></span>`;
          if (refill.dataset.html !== html) {
            refill.dataset.html = html;
            refill.innerHTML = html;
          }
        }
      } else {
        sub = 'ほかの人の発生器';
      }
    } else {
      // 次のアイテム（見たことがなければ名前は「？？？」）
      if (tier >= maxTierOfKind(it.kind)) sub = '最高レベル';
      // Lv1 はゴミ箱、Lv2 からはコインに変えられる
      const coins = scrapCoins(it.kind);
      if (coins > 0) {
        sell.hidden = false;
        $('sellCoins').textContent = `+${coins}`;
      } else {
        trash.hidden = false;
      }
    }
    $('infoSub').textContent = sub;
  }

  /** ゴミ箱・コイン化のあと: 少しの間だけ「元に戻す」 */
  showUndo(kind: number, coins: number) {
    window.clearTimeout(this.undoTimer);
    const bar = $('undoBar');
    $('undoText').textContent = coins > 0 ? `${itemName(kind)}を +${coins} コインに変えた` : `${itemName(kind)}をゴミ箱に入れた`;
    bar.hidden = false;
    $<HTMLButtonElement>('undoBtn').disabled = false;
    const t = $('undoTime');
    t.getAnimations().forEach((a) => a.cancel());
    t.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: UNDO_SELL_MS - 300, easing: 'linear', fill: 'forwards' });
    this.undoTimer = window.setTimeout(() => this.hideUndo(), UNDO_SELL_MS - 300);
  }

  /** 元に戻すのに失敗した（コイン不足・空きなし）: バーは残して、押し直せるようにする */
  undoFailed() {
    $<HTMLButtonElement>('undoBtn').disabled = false;
  }

  hideUndo() {
    window.clearTimeout(this.undoTimer);
    $('undoBar').hidden = true;
  }

  /** 図鑑: kind の種類を Lv1 から順に。3つずつ折り返して、矢印でつなぐ（2行目は右から左） */
  openBook(kind: number) {
    const chain = chainOfKind(kind);
    const gift = isGiftKind(kind);
    const max = maxTierOfKind(kind);
    const base = kind - tierOfKind(kind);
    const grid = $('bookGrid');
    grid.replaceChildren();
    let found = 0;
    const cell = (t: number) => {
      const k = base + t;
      const known = this.seen.has(k);
      if (known) found++;
      const el = document.createElement('div');
      el.className = `book-cell${known ? '' : ' is-unknown'}${k === kind ? ' is-now' : ''}`;
      const pic = document.createElement('div');
      pic.className = 'book-pic';
      const im = document.createElement('img');
      im.src = this.img(k);
      im.alt = known ? itemName(k) : '？';
      im.draggable = false;
      pic.append(im);
      if (!known) {
        const q = document.createElement('span');
        q.className = 'book-q';
        q.textContent = '？';
        pic.append(q);
      }
      const lv = document.createElement('b');
      lv.className = 'book-lv';
      lv.textContent = `Lv${t}`;
      const name = document.createElement('span');
      name.className = 'book-name';
      name.textContent = known ? itemName(k) : '？？？';
      el.append(pic, lv, name);
      return el;
    };
    const arrow = (text: string) => {
      const a = document.createElement('span');
      a.className = 'book-arrow';
      a.textContent = text;
      return a;
    };
    const empty = () => document.createElement('span');
    const COLS = 3;
    const rows = Math.ceil(max / COLS);
    for (let r = 0; r < rows; r++) {
      const tiers: number[] = [];
      for (let c = 0; c < COLS; c++) {
        const t = r * COLS + c + 1;
        if (t <= max) tiers.push(t);
      }
      const ltr = r % 2 === 0;
      // 1行に 5 マス（アイテム・矢印・アイテム・矢印・アイテム）。左から右、次の行は右から左
      const slots: (HTMLElement)[] = [];
      for (let c = 0; c < COLS; c++) {
        const t = tiers[ltr ? c : COLS - 1 - c];
        slots.push(t ? cell(t) : empty());
        if (c < COLS - 1) {
          const a = tiers[ltr ? c + 1 : COLS - 1 - c];
          const b = tiers[ltr ? c : COLS - 2 - c];
          slots.push(a && b && !gift ? arrow(ltr ? '▶' : '◀') : empty());
        }
      }
      grid.append(...slots);
      // 次の行へ: 行の終わり（左から右なら右、右から左なら左）から下へ
      if (r < rows - 1) {
        const turn = document.createElement('div');
        turn.className = `book-turn${ltr ? ' at-right' : ''}`;
        turn.textContent = gift ? '' : '▼';
        grid.append(turn);
      }
    }
    $('bookTitle').textContent = chain.name;
    $('bookCount').textContent = `${found} / ${max}`;
    $('bookModal').hidden = false;
  }

  /** 光るカーソル同士でぶつかったときのカットイン（斜めの帯が走り、大きな文字がドンと出る） */
  cutIn(o: { name: string; color: number; energy: number }) {
    $('cutin')?.remove();
    const hex = `#${o.color.toString(16).padStart(6, '0')}`;
    const el = document.createElement('div');
    el.id = 'cutin';
    el.className = 'cutin';
    el.style.setProperty('--pc', hex);
    el.innerHTML = `
      <div class="cutin-flash"></div>
      <div class="cutin-band">
        <div class="cutin-lines"></div>
        <div class="cutin-body">
          <div class="cutin-kicker"><span class="cutin-name"></span>とぶつかった！</div>
          <div class="cutin-main">ナイスタッチ<span class="cutin-bang">!!</span></div>
          <div class="cutin-reward"><img src="assets/ui/energy.png" alt="" /> スタミナ <b>+${o.energy}</b></div>
        </div>
      </div>`;
    el.querySelector('.cutin-name')!.textContent = `${o.name}さん`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  toast(text: string) {
    // 同じ知らせが出ているときは、増やさずにそれを出し直す
    for (const old of $('toasts').children) if (old.textContent === text) old.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  queueAward(e: Award) {
    this.awardQueue.push(e);
    // 同じ知らせの中のストーリーの出来事（クリアなど）を先に受け取ってから決める
    window.setTimeout(() => this.showLevelUps(), 0);
  }

  /** 待っているレベルアップ画面を出す（ストーリーの会話や報酬の画面が出ている間は待つ） */
  showLevelUps() {
    if (!$('levelup').hidden || this.holdLevelUps()) return;
    this.nextAward();
  }

  /** 待っているレベルアップ画面を全部見せてから then を呼ぶ */
  afterLevelUps(then: () => void) {
    this.luDone.push(then);
    if ($('levelup').hidden && !this.awardQueue.length) this.runLuDone();
    else this.showLevelUps();
  }

  private runLuDone() {
    const list = this.luDone;
    this.luDone = [];
    for (const f of list) f();
  }

  private nextAward() {
    const e = this.awardQueue.shift();
    if (!e) {
      this.runLuDone();
      return;
    }
    const body = $('luBody');
    body.textContent = '';
    const row = (src: string, text: string) => {
      const d = document.createElement('div');
      d.className = 'row';
      const im = document.createElement('img');
      im.src = src;
      im.alt = '';
      const s = document.createElement('span');
      s.textContent = text;
      d.append(im, s);
      body.appendChild(d);
    };
    let chara: { src: string } | undefined;
    if (e.t === 'levelup') {
      $('luLevel').textContent = String(e.level);
      for (const g of e.granted) row(this.img(kindOf(g, 2)), `${CHAIN_BY_KEY.get(g)?.name} の部品をもらった！左下の受け取り枠から出して、合成して組み立てよう`);
      for (const c of e.newChains) row(this.img(kindOf(c, 1)), `${CHAIN_BY_KEY.get(c)?.name} が出るようになった`);
      for (const g of e.gifts ?? []) row(this.img(g), `${itemName(g)}をもらった！左下の受け取り枠に入ったよ`);
      if (e.energy > 0) row('assets/ui/energy.png', `スタミナ +${e.energy}`);
      const key = e.granted[0] ?? e.newChains[0];
      chara = this.m.owners.find((o) => key && o.key === OWNER_OF[key]) ?? this.m.customers[e.level % Math.max(1, this.m.customers.length)];
    } else {
      const delivery = e.delivery;
      if (delivery) {
        const label = document.createElement('p');
        label.textContent = `${customerOf(delivery.customer).name}の依頼報酬`;
        body.append(label);
        row('assets/ui/coin.png', `コイン +${delivery.coins}`);
        row('assets/ui/xp.png', `経験値 +${delivery.xp}`);
      }
      for (const note of [e.newCustomer && `${customerOf(e.newCustomer).name}も注文に来るようになった！`, e.moreDouble && '2つ頼む人がふえた！']) {
        if (!note) continue;
        const p = document.createElement('p');
        p.textContent = note;
        body.append(p);
      }
      const customer = e.newCustomer ?? delivery?.customer;
      if (customer) chara = { src: `assets/orders/${customerOf(customer).key}.png` };
    }
    const im = $<HTMLImageElement>('luChara');
    im.hidden = !chara;
    if (chara) im.src = chara.src;
    const level = e.t === 'levelup';
    const theme = level ? 'level' : 'orders';
    $('levelTitle').hidden = !level;
    $('ordersTitle').hidden = level;
    const logo = $<HTMLImageElement>('awardLogo');
    logo.src = `assets/ui/reward-${theme}.webp`;
    logo.alt = level ? 'レベルアップ' : '依頼全員達成';
    const modal = $('levelup');
    modal.dataset.award = theme;
    modal.hidden = false;
    this.stopAward = scatterAward(modal, theme);
    $('luClose').focus({ preventScroll: true });
  }
}

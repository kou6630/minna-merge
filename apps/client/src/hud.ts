// 画面の上に重ねる DOM の表示（レベル・エネルギー・コイン・情報欄・お知らせ・レベルアップ）
import {
  CHAIN_BY_KEY, ENERGY_MAX, chainOfKind, itemName, isGeneratorKind, kindOf, maxCharges, maxTierOfKind,
  nextEnergyMs, sellCoins, syncCharges, syncEnergy, tierOfKind, xpToNext,
} from '@minna/shared';
import type { GameEvent, Item, Player, World } from '@minna/shared';
import type { Manifest } from './assets.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** 系列 → その店の店主の絵 */
const OWNER_OF: Record<string, string> = {
  bread: 'bread', sweets: 'bread', veg: 'veg', flower: 'flower', fish: 'fish', goods: 'goods', tools: 'tools',
  oven: 'bread', crate: 'veg', bucket: 'flower', fishbox: 'fish', shelf: 'goods', toolbox: 'tools',
};

function fmtTime(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  private luQueue: Extract<GameEvent, { t: 'levelup' }>[] = [];
  private info: Item | null = null;
  onSell: (item: Item) => void = () => {};

  constructor(
    private m: Manifest,
    private me: string,
    private now: () => number,
  ) {
    $('hud').hidden = false;
    $('luClose').onclick = () => {
      $('levelup').hidden = true;
      this.nextLevelUp();
    };
    $('sellBtn').onclick = () => this.info && this.onSell(this.info);
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
    const now = this.now();
    const p = { ...src }; // 表示のための計算で元の値を変えない
    syncEnergy(p, now);
    $('lv').textContent = String(p.level);
    $('xpfill').style.width = `${Math.min(100, (p.xp / xpToNext(p.level)) * 100)}%`;
    $('energy').textContent = String(p.energy);
    const next = nextEnergyMs(p, now);
    $('energyNext').textContent = p.energy < ENERGY_MAX ? `+1まで ${fmtTime(next)}` : '';
    $('coins').textContent = String(p.coins);
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
    $<HTMLImageElement>('infoImg').src = this.img(it.kind);
    const chain = chainOfKind(it.kind);
    const tier = tierOfKind(it.kind);
    $('infoName').textContent = `${itemName(it.kind)}`;
    let sub = `${chain.name}　段階 ${tier} / ${maxTierOfKind(it.kind)}`;
    const sell = $<HTMLButtonElement>('sellBtn');
    sell.hidden = true;
    if (it.dusty) {
      sub += '　ほこりをかぶっている。同じアイテムを重ねるときれいになる';
    } else if (isGeneratorKind(it.kind)) {
      if (it.owner === this.me) {
        it = { ...it };
        syncCharges(it, this.now());
        const max = maxCharges(it);
        const ch = it.charges ?? max;
        const step = (chain.gen?.chargeSec ?? 0) * 1000;
        const wait = ch < max ? `（+1まで ${fmtTime(Math.max(0, (it.chargesAt ?? 0) + step - this.now()))}）` : '';
        sub += `　タップで出す　のこり ${ch}/${max}${wait}`;
      } else {
        sub += '　ほかの人の発生器';
      }
    } else {
      if (tier < maxTierOfKind(it.kind)) sub += `　次: ${itemName(it.kind + 1)}`;
      if (it.maker === this.me) {
        sell.hidden = false;
        sell.textContent = `売る +${sellCoins(it.kind)}`;
      }
    }
    $('infoSub').textContent = sub;
  }

  toast(text: string) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  levelUp(e: Extract<GameEvent, { t: 'levelup' }>) {
    this.luQueue.push(e);
    if ($('levelup').hidden) this.nextLevelUp();
  }

  private nextLevelUp() {
    const e = this.luQueue.shift();
    if (!e) return;
    $('luLevel').textContent = String(e.level);
    const body = $('luBody');
    body.textContent = '';
    const row = (kind: number, text: string) => {
      const d = document.createElement('div');
      d.className = 'row';
      const im = document.createElement('img');
      im.src = this.img(kind);
      const s = document.createElement('span');
      s.textContent = text;
      d.append(im, s);
      body.appendChild(d);
    };
    for (const g of e.granted) row(kindOf(g, 1), `${CHAIN_BY_KEY.get(g)?.name} をもらった！`);
    for (const c of e.newChains) row(kindOf(c, 1), `${CHAIN_BY_KEY.get(c)?.name} が出るようになった`);
    if (!e.granted.length && !e.newChains.length) {
      const p = document.createElement('div');
      p.textContent = 'エネルギーが満タンになった';
      body.appendChild(p);
    }
    const key = e.granted[0] ?? e.newChains[0];
    const owner = key ? this.m.owners.find((o) => o.key === OWNER_OF[key]) : undefined;
    const chara = owner ?? this.m.customers[e.level % Math.max(1, this.m.customers.length)];
    const im = $<HTMLImageElement>('luChara');
    im.hidden = !chara;
    if (chara) im.src = chara.src;
    $('levelup').hidden = false;
  }
}

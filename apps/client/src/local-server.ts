// ひとりで練習用: ブラウザの中でルールを動かす「サーバーのかわり」。
import {
  BLOCKS_X, BLOCKS_Y, START_BLOCK, ENERGY_MAX, REJECT_TEXT, ensureWorldOrders, addPlayer, apply, createWorld, defaultStory, expireHolds, extendHold, fromJson, grantXp, mulberry32,
  toJson,
} from '@minna/shared';
import type { Action, GameEvent, Op, Player, World, WorldJson } from '@minna/shared';
import type { Conn, ServerListener } from './conn.ts';

const SAVE_KEY = 'minna-merge:p0';
const PREVIEW_SAVE_KEY = 'minna-merge:story-preview';
const INFINITE_COINS = 999_999;

function loadSave(key: string): WorldJson | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as WorldJson) : null;
  } catch {
    return null;
  }
}

export class LocalServer implements Conn {
  readonly world: World;
  readonly me: string;
  readonly online: string[];
  readonly infiniteCoins: boolean;
  private readonly saveKey: string;
  private listeners: ServerListener[] = [];
  private rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
  private saveTimer = 0;

  constructor(me: string, name: string, opts?: { infiniteCoins?: boolean; saveKey?: string }) {
    this.me = me;
    this.online = [me];
    this.infiniteCoins = !!opts?.infiniteCoins;
    this.saveKey = opts?.saveKey ?? (this.infiniteCoins ? PREVIEW_SAVE_KEY : SAVE_KEY);
    const saved = loadSave(this.saveKey);
    // 古いセーブ（みんなで1枚のころ・ダンボールのないころ・発生器を組み直す前）は使わず、新しく作る
    this.world = saved && saved.v === 4 && saved.blocks?.length === BLOCKS_X * BLOCKS_Y && saved.blocks[START_BLOCK] === 1 ? fromJson(saved) : createWorld(this.rng);
    // サーバーと同じ数にそろえる前のセーブ（1回だけ）: まだ1個も納品していないシャッターは、今の数で出しなおす
    const migKey = `${this.saveKey}:shutters2`;
    let migrate = false;
    try {
      migrate = !!saved && !localStorage.getItem(migKey);
      localStorage.setItem(migKey, '1');
    } catch {
      // 保存できないブラウザでは何もしない
    }
    if (migrate) this.world.worldOrders = this.world.worldOrders.filter((o) => o.needs.some((n) => n.have > 0));
    ensureWorldOrders(this.world, this.rng);
    addPlayer(this.world, me, name, Date.now());
    if (this.infiniteCoins) this.player.coins = INFINITE_COINS;
    this.save();
    setInterval(() => {
      const ops = expireHolds(this.world, Date.now());
      if (ops.length) this.emit(ops, []);
    }, 1000);
    addEventListener('pagehide', () => this.save());
  }

  get player(): Player {
    return this.world.players.get(this.me)!;
  }

  now() {
    return Date.now();
  }

  on(l: ServerListener) {
    this.listeners.push(l);
  }

  send(action: Action): boolean {
    if (this.infiniteCoins) this.player.coins = INFINITE_COINS;
    const r = apply(this.world, this.me, action, Date.now(), this.rng);
    if (!r.ok) {
      if (r.ops.length) this.emit(r.ops, []);
      for (const l of this.listeners) l.reject(r.reason, REJECT_TEXT[r.reason], action);
      return false;
    }
    if (this.infiniteCoins) this.player.coins = INFINITE_COINS;
    this.emit(r.ops, r.events);
    return true;
  }

  /** 確認用: ストーリー進行を最初からに戻す */
  resetStory() {
    this.player.story = defaultStory();
    if (this.infiniteCoins) this.player.coins = INFINITE_COINS;
    this.emit([], []);
    this.save();
  }

  /** おためし用: 経験値を足す */
  debugXp(n: number) {
    const r = grantXp(this.world, this.me, n, Date.now());
    this.emit(r.ops, r.events);
  }

  /** おためし用: エネルギー満タン */
  debugEnergy() {
    const p = this.player;
    p.energy = ENERGY_MAX;
    p.energyAt = Date.now();
    this.emit([], []);
  }

  sendCursor() {
    /* ひとりなので送らない */
  }

  keepHold(id: number) {
    extendHold(this.world, this.me, id, Date.now());
  }

  private emit(ops: Op[], events: GameEvent[]) {
    for (const l of this.listeners) l.ops(ops, events);
    this.scheduleSave();
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 800);
  }

  /** リセットしたあと（ページを読み込み直すまで）は保存しない（閉じるときの自動保存で、消したセーブが戻らないように） */
  private static resetting = false;

  save() {
    if (LocalServer.resetting) return;
    try {
      localStorage.setItem(this.saveKey, JSON.stringify(toJson(this.world)));
    } catch {
      /* 保存できない環境 */
    }
  }

  static reset(preview = false) {
    LocalServer.resetting = true;
    try {
      localStorage.removeItem(preview ? PREVIEW_SAVE_KEY : SAVE_KEY);
      localStorage.removeItem(`${preview ? PREVIEW_SAVE_KEY : SAVE_KEY}:shutters2`);
    } catch {
      /* noop */
    }
  }
}

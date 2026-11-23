// ひとりで練習用: ブラウザの中でルールを動かす「サーバーのかわり」。
import {
  ENERGY_MAX, REJECT_TEXT, addPlayer, apply, createWorld, expireHolds, extendHold, fromJson, grantXp, mulberry32,
  toJson,
} from '@minna/shared';
import type { Action, GameEvent, Op, Player, World, WorldJson } from '@minna/shared';
import type { Conn, ServerListener } from './conn.ts';

const SAVE_KEY = 'minna-merge:p0';

function loadSave(): WorldJson | null {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    return s ? (JSON.parse(s) as WorldJson) : null;
  } catch {
    return null;
  }
}

export class LocalServer implements Conn {
  readonly world: World;
  readonly me: string;
  readonly online: string[];
  private listeners: ServerListener[] = [];
  private rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
  private saveTimer = 0;

  constructor(me: string, name: string) {
    this.me = me;
    this.online = [me];
    const saved = loadSave();
    this.world = saved ? fromJson(saved) : createWorld(this.rng);
    addPlayer(this.world, me, name, Date.now());
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
    const r = apply(this.world, this.me, action, Date.now(), this.rng);
    if (!r.ok) {
      if (r.ops.length) this.emit(r.ops, []);
      for (const l of this.listeners) l.reject(r.reason, REJECT_TEXT[r.reason], action);
      return false;
    }
    this.emit(r.ops, r.events);
    return true;
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

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(toJson(this.world)));
    } catch {
      /* 保存できない環境では何もしない */
    }
  }

  static reset() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* noop */
    }
  }
}

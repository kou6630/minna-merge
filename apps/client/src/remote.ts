// 通信版のサーバー。WebSocket でつなぎ、手元では「確定した盤面＋まだ確定していない自分の操作」を表示する。
import {
  PROTOCOL, REJECT_TEXT, apply, applyOps, cloneWorld, diffWorlds, fromJson,
} from '@minna/shared';
import type { Action, Batch, C2S, DeniedReason, GameEvent, Player, S2C, ServerInfo, World } from '@minna/shared';
import type { Conn, ServerListener } from './conn.ts';

export { normalizeAddress } from './server-code.ts';

/** サーバーが起きているか、名前と人数を聞く */
export function probe(address: string, ms = 3000): Promise<ServerInfo | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(address);
    } catch {
      resolve(null);
      return;
    }
    const done = (v: ServerInfo | null) => {
      clearTimeout(t);
      ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close();
      } catch {
        /* noop */
      }
      resolve(v);
    };
    const t = setTimeout(() => done(null), ms);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL } satisfies C2S));
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as S2C;
      if (m.t === 'server') done({ id: m.id, name: m.name, online: m.online, protocol: m.protocol });
    };
    ws.onerror = () => done(null);
    ws.onclose = () => done(null);
  });
}

export type Creds = { token: string } | { name: string; password: string };

type Fail = { ok: false; info?: ServerInfo; reason: DeniedReason | 'offline' | 'need-join'; text: string };
type Handshake =
  | { ok: true; ws: WebSocket; info: ServerInfo; playerId: string; token?: string; welcome: Extract<S2C, { t: 'welcome' }> }
  | Fail;

const OFFLINE_TEXT = 'サーバーにつながりません。起動しているか確かめてください';

function handshake(address: string, creds: (info: ServerInfo) => Creds | null): Promise<Handshake> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(address);
    } catch {
      resolve({ ok: false, reason: 'offline', text: OFFLINE_TEXT });
      return;
    }
    let info: ServerInfo | undefined;
    let joined: Extract<S2C, { t: 'joined' }> | undefined;
    const stop = () => {
      clearTimeout(timer);
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    };
    const fail = (f: Fail) => {
      stop();
      try {
        ws.close();
      } catch {
        /* noop */
      }
      resolve(f);
    };
    const timer = setTimeout(() => fail({ ok: false, info, reason: 'offline', text: OFFLINE_TEXT }), 8000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL } satisfies C2S));
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as S2C;
      if (m.t === 'server') {
        info = { id: m.id, name: m.name, online: m.online, protocol: m.protocol };
        if (m.protocol !== PROTOCOL) return; // このあと denied が来る
        const c = creds(info);
        if (!c) return fail({ ok: false, info, reason: 'need-join', text: '' });
        const msg: C2S = 'token' in c ? { t: 'resume', token: c.token } : { t: 'join', name: c.name, password: c.password };
        ws.send(JSON.stringify(msg));
      } else if (m.t === 'denied') {
        fail({ ok: false, info, reason: m.reason, text: m.text });
      } else if (m.t === 'joined') {
        joined = m;
      } else if (m.t === 'welcome' && joined && info) {
        stop();
        resolve({ ok: true, ws, info, playerId: joined.playerId, token: joined.token, welcome: m });
      }
    };
    ws.onerror = () => fail({ ok: false, info, reason: 'offline', text: OFFLINE_TEXT });
    ws.onclose = () => fail({ ok: false, info, reason: 'offline', text: OFFLINE_TEXT });
  });
}

export type ConnectResult = { ok: true; conn: RemoteServer; info: ServerInfo; token?: string } | Fail;

const PREDICT = new Set(['grab', 'drop', 'release', 'store']);
const noRng = () => 0.5;

export class RemoteServer implements Conn {
  readonly me: string;
  readonly info: ServerInfo;
  online: string[] = [];
  private address: string;
  private token: string;
  private ws!: WebSocket;
  private confirmed!: World;
  private view!: World;
  private seq = 0;
  private pending: { s: number; a: Action }[] = [];
  private sent = new Map<number, Action>();
  private lastRev = 0;
  private offset = 0;
  private listeners: ServerListener[] = [];
  private retry = 0;
  private connected = false;

  static async connect(address: string, creds: (info: ServerInfo) => Creds | null): Promise<ConnectResult> {
    let token: string | undefined;
    const hs = await handshake(address, (info) => {
      const c = creds(info);
      if (c && 'token' in c) token = c.token;
      return c;
    });
    if (!hs.ok) return hs;
    const conn = new RemoteServer(address, hs, hs.token ?? token ?? '');
    return { ok: true, conn, info: hs.info, token: hs.token };
  }

  private constructor(address: string, hs: Extract<Handshake, { ok: true }>, token: string) {
    this.address = address;
    this.token = token;
    this.me = hs.playerId;
    this.info = hs.info;
    this.useWelcome(hs.welcome, true);
    this.attach(hs.ws);
    setInterval(() => this.raw({ t: 'ping', at: Date.now() }), 15_000);
  }

  get world(): World {
    return this.view;
  }

  get player(): Player {
    return this.view.players.get(this.me)!;
  }

  now() {
    return Date.now() + this.offset;
  }

  on(l: ServerListener) {
    this.listeners.push(l);
  }

  send(a: Action): boolean {
    if (!this.connected) {
      for (const l of this.listeners) l.reject('no-player', '通信がつながっていません', a);
      return false;
    }
    const s = ++this.seq;
    if (PREDICT.has(a.t)) {
      // 手元ですぐ反映する（先行表示）
      const r = apply(this.view, this.me, a, this.now(), noRng);
      if (!r.ok) {
        if (r.ops.length) for (const l of this.listeners) l.ops(r.ops, []);
        for (const l of this.listeners) l.reject(r.reason, REJECT_TEXT[r.reason], a);
        return false;
      }
      this.pending.push({ s, a });
      const fx = r.events.filter((e) => e.t === 'merge');
      for (const l of this.listeners) l.ops(r.ops, fx);
    }
    this.sent.set(s, a);
    this.raw({ t: 'act', s, a });
    return true;
  }

  keepHold(id: number) {
    this.raw({ t: 'keep', item: id });
  }

  sendCursor(x: number, y: number, d?: number) {
    this.raw({ t: 'cursor', x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, d });
  }

  private raw(m: C2S) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private attach(ws: WebSocket) {
    this.ws = ws;
    this.connected = true;
    this.retry = 0;
    ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as S2C);
    ws.onclose = () => this.lost();
    ws.onerror = () => ws.close();
  }

  private onMessage(m: S2C) {
    switch (m.t) {
      case 'batch':
        this.onBatch(m);
        break;
      case 'welcome':
        this.useWelcome(m, false);
        break;
      case 'pong': {
        const rtt = Date.now() - m.at;
        this.offset = m.now + rtt / 2 - Date.now();
        break;
      }
      default:
        break;
    }
  }

  private useWelcome(w: Extract<S2C, { t: 'welcome' }>, first: boolean) {
    this.offset = w.now - Date.now();
    this.confirmed = fromJson(w.world);
    this.lastRev = w.world.rev;
    this.pending = [];
    this.sent.clear();
    this.online = w.online;
    if (first) {
      this.view = cloneWorld(this.confirmed);
      return;
    }
    this.rebuild([]);
    for (const l of this.listeners) l.online?.(this.online);
  }

  private onBatch(b: Batch) {
    if (b.rev0 !== this.lastRev) {
      this.raw({ t: 'resync' });
      return;
    }
    applyOps(this.confirmed, b.ops, this.now());
    this.confirmed.rev = b.rev;
    this.lastRev = b.rev;
    for (const p of b.players) this.confirmed.players.set(p.id, { ...p });

    const acks = b.acks ?? [];
    const rejects = b.rejects ?? [];
    const done = new Set([...acks, ...rejects.map((r) => r.s)]);
    this.pending = this.pending.filter((p) => !done.has(p.s));
    for (const r of rejects) {
      const a = this.sent.get(r.s);
      if (a) for (const l of this.listeners) l.reject(r.reason, REJECT_TEXT[r.reason], a);
    }
    for (const s of done) this.sent.delete(s);

    // 自分のマージは手元ですでに演出したので、ほかの人の分だけ。レベルアップなどは自分の分だけ
    const events = b.events.filter((e) =>
      e.t === 'merge' ? e.player !== this.me : !('player' in e) || e.player === this.me,
    );
    this.rebuild(events);
    if (b.online) {
      this.online = b.online;
      for (const l of this.listeners) l.online?.(this.online);
    }
    if (b.cursors) for (const l of this.listeners) l.cursors?.(b.cursors);
  }

  /** 確定した盤面に、まだ確定していない自分の操作を当て直し、見た目との差を伝える */
  private rebuild(events: GameEvent[]) {
    const next = cloneWorld(this.confirmed);
    for (const p of this.pending) apply(next, this.me, p.a, this.now(), noRng);
    const ops = diffWorlds(this.view, next);
    this.view = next;
    for (const l of this.listeners) l.ops(ops, events);
  }

  private lost() {
    this.connected = false;
    for (const l of this.listeners) l.status?.('つながりが切れました。つなぎ直しています…');
    const wait = Math.min(10_000, 1000 * 2 ** this.retry++);
    setTimeout(() => void this.reconnect(), wait);
  }

  private async reconnect() {
    const hs = await handshake(this.address, () => ({ token: this.token }));
    if (!hs.ok) {
      if (hs.reason === 'offline') return this.lost();
      for (const l of this.listeners) l.status?.(`${hs.text}　タイトルにもどってください`);
      return;
    }
    this.attach(hs.ws);
    this.useWelcome(hs.welcome, false);
    for (const l of this.listeners) l.status?.(null);
  }
}

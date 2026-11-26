// 通信版のサーバー。WebSocket でつなぎ、手元では「確定した盤面＋まだ確定していない自分の操作」を表示する。
import {
  PROTOCOL, REJECT_TEXT, apply, applyOps, cloneWorld, diffWorlds, fromJson,
} from '@minna/shared';
import type { Action, Batch, C2S, CursorInfo, DeniedReason, GameEvent, Op, Player, S2C, ServerInfo, World } from '@minna/shared';
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
  /** ほかの人のカーソルの最新 */
  private cursorMap = new Map<string, CursorInfo>();
  private retry = 0;
  private connected = false;
  private closed = false;
  private pingTimer = 0;
  private retryTimer = 0;
  /**
   * サーバーコードで入ったとき: つなぎ直す前に、今の住所を調べ直す。
   * 文字列=今の住所 / null=止まっている / undefined=調べられなかった（前の住所のまま試す）
   */
  private resolveAddress?: () => Promise<string | null | undefined>;

  static async connect(
    address: string,
    creds: (info: ServerInfo) => Creds | null,
    resolveAddress?: () => Promise<string | null | undefined>,
  ): Promise<ConnectResult> {
    let token: string | undefined;
    const hs = await handshake(address, (info) => {
      const c = creds(info);
      if (c && 'token' in c) token = c.token;
      return c;
    });
    if (!hs.ok) return hs;
    const conn = new RemoteServer(address, hs, hs.token ?? token ?? '');
    conn.resolveAddress = resolveAddress;
    return { ok: true, conn, info: hs.info, token: hs.token };
  }

  private constructor(address: string, hs: Extract<Handshake, { ok: true }>, token: string) {
    this.address = address;
    this.token = token;
    this.me = hs.playerId;
    this.info = hs.info;
    this.useWelcome(hs.welcome, true);
    this.attach(hs.ws);
    this.pingTimer = window.setInterval(() => this.raw({ t: 'ping', at: Date.now() }), 15_000);
  }

  /** 接続とタイマーを完全に止める（タイトル画面でキャンセルされた接続の破棄用） */
  close() {
    this.closed = true;
    this.connected = false;
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.retryTimer);
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
    }
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
    // 画面ができる前に届いていたカーソル（止まっている人の分）も見せる
    if (this.cursorMap.size) l.cursors?.([...this.cursorMap.values()]);
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
        // drop 失敗で手元のつかみを外したときは、サーバー側のつかみも即座に外す（15秒残らないように）
        for (const op of r.ops) {
          if (op.t === 'unhold') {
            const rs = ++this.seq;
            const rel: Action = { t: 'release', item: op.id };
            this.pending.push({ s: rs, a: rel });
            this.sent.set(rs, rel);
            this.raw({ t: 'act', s: rs, a: rel });
          }
        }
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
    ws.onmessage = (e) => {
      let m: S2C;
      try {
        m = JSON.parse(String(e.data)) as S2C;
      } catch {
        return;
      }
      this.onMessage(m);
    };
    ws.onclose = () => this.lost();
    ws.onerror = () => ws.close();
    // つなぎ終わる前（handshake のあと、ここまでのあいだ）に切れていたら、すぐつなぎ直す
    if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      ws.onclose = null;
      this.lost();
    }
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
    // 切れているあいだに出ていった人のカーソルは消す（今いる人のカーソルは、このあとサーバーが送り直す）
    const gone = [...this.cursorMap.values()].filter((c) => !this.online.includes(c.p)).map((c) => ({ ...c, gone: true as const }));
    for (const c of gone) this.cursorMap.delete(c.p);
    if (gone.length) for (const l of this.listeners) l.cursors?.(gone);
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

    // 自分のマージは手元ですでに演出したので、ほかの人の分だけ。レベルアップなどは自分の分だけ。
    // みんなのシャッターへの納品は、ほかの人の分も（「○○が○個納品しました」）
    const events = b.events.filter((e) =>
      e.t === 'merge' ? e.player !== this.me : e.t === 'shutterGive' || !('player' in e) || e.player === this.me,
    );
    this.rebuild(events, b.ops);
    if (b.online) {
      this.online = b.online;
      for (const l of this.listeners) l.online?.(this.online);
    }
    if (b.cursors) {
      for (const c of b.cursors) {
        if (c.gone) this.cursorMap.delete(c.p);
        else this.cursorMap.set(c.p, c);
      }
      for (const l of this.listeners) l.cursors?.(b.cursors);
    }
  }

  /** 確定した盤面に、まだ確定していない自分の操作を当て直し、見た目との差を伝える */
  private rebuild(events: GameEvent[], hint: Op[] = []) {
    const next = cloneWorld(this.confirmed);
    for (const p of this.pending) apply(next, this.me, p.a, this.now(), noRng);
    const ops = diffWorlds(this.view, next);
    // サーバーの spawn にあった「どこから出たか」を付け直す（発生器・箱から放物線で飛び出す演出）
    const from = new Map<number, number>();
    for (const o of hint) if (o.t === 'spawn' && o.from !== undefined) from.set(o.item.id, o.from);
    for (const o of ops) if (o.t === 'spawn' && from.has(o.item.id)) o.from = from.get(o.item.id);
    this.view = next;
    for (const l of this.listeners) l.ops(ops, events);
  }

  private status(text: string | null) {
    for (const l of this.listeners) l.status?.(text);
  }

  /** つながりが切れた。少し待ってつなぎ直す（1秒・2秒・4秒…最大10秒） */
  private lost(serverDown = false) {
    if (this.closed) return;
    this.connected = false;
    this.status(
      serverDown || this.retry >= 3
        ? 'サーバーが止まっているようです。サーバーを立てている人に確かめてください。動き出したら自動でつながります'
        : 'つながりが切れました。つなぎ直しています…',
    );
    // サーバーコードのときは GitHub に聞きに行くので、間をあける（GitHub は1時間に60回まで）
    const cap = this.resolveAddress ? 60_000 : 10_000;
    const wait = Math.min(cap, 1000 * 2 ** this.retry++);
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => void this.reconnect(), wait);
  }

  private async reconnect() {
    if (this.closed) return;
    // サーバーを立て直すとトンネルの住所が変わるので、サーバーコードから調べ直す
    if (this.resolveAddress) {
      let addr: string | null | undefined;
      try {
        addr = await this.resolveAddress();
      } catch {
        return this.lost(true);
      }
      if (this.closed) return;
      if (addr === null) return this.lost(true);
      if (addr) this.address = addr;
    }
    let hs: Handshake;
    try {
      hs = await handshake(this.address, () => ({ token: this.token }));
    } catch {
      return this.lost();
    }
    if (this.closed) {
      if (hs.ok) hs.ws.close();
      return;
    }
    if (!hs.ok) {
      if (hs.reason === 'offline') return this.lost();
      this.status(`${hs.text}　タイトルにもどってください`);
      return;
    }
    this.attach(hs.ws);
    this.useWelcome(hs.welcome, false);
    for (const l of this.listeners) l.status?.(null);
  }
}

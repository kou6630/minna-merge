// 1つのサーバー＝1つの盤面。WebSocket で全員とつながり、正しい盤面を1つだけ持つ。
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import {
  DENIED_TEXT, PROTOCOL, W, H, addPlayer, ensureWorldOrders, apply, createWorld, expireHolds, extendHold, fromJson,
  mulberry32, parseAction, toJson,
} from '@minna/shared';
import type { Batch, C2S, CursorInfo, DeniedReason, GameEvent, Op, RejectReason, S2C, World } from '@minna/shared';
import type { Config } from './config.ts';
import { readSave, writeSave } from './store.ts';
import type { Account } from './store.ts';

const FLUSH_MS = 50;
const SAVE_MS = 2000;
const MAX_FAILS_PER_MIN = 5;

type Client = {
  ws: WebSocket;
  ip: string;
  hello: boolean;
  playerId?: string;
  lastS: number;
  acks: number[];
  rejects: { s: number; reason: RejectReason }[];
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function safeEqual(a: string, b: string) {
  const x = Buffer.from(sha(a));
  const y = Buffer.from(sha(b));
  return timingSafeEqual(x, y);
}

export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true; // ブラウザ以外（試験用のクライアントなど）
  try {
    const u = new URL(origin);
    if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return true;
  } catch {
    return false;
  }
  return allowed.includes(origin);
}

export class Room {
  world: World;
  accounts: Account[];
  private rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
  private clients = new Set<Client>();
  private http: Server;
  private wss: WebSocketServer;
  private timers: NodeJS.Timeout[] = [];
  private fails = new Map<string, number[]>();
  private dirty = false;
  private sentRev: number;
  private q = { ops: [] as Op[], events: [] as GameEvent[], players: new Set<string>(), online: false };
  /** カーソル（保存しない）。送るべきものだけ cursorQ に入れる */
  private cursors = new Map<string, CursorInfo>();
  private cursorQ = new Map<string, CursorInfo>();

  private cfg: Config;
  private savePath: string;
  private log: (msg: string) => void;

  constructor(cfg: Config, savePath: string, log: (msg: string) => void = console.log) {
    this.cfg = cfg;
    this.savePath = savePath;
    this.log = log;
    const saved = readSave(savePath);
    this.world = saved ? fromJson(saved.world) : createWorld(this.rng);
    this.accounts = saved?.accounts ?? [];
    this.world.holds.clear();
    ensureWorldOrders(this.world, this.rng); // 古いセーブには、みんなの依頼がない
    this.sentRev = this.world.rev;
    if (!saved) this.save();

    this.http = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
      res.end(`みんなでマージ サーバー「${cfg.serverName}」 参加中 ${this.onlineIds().length}人\n`);
    });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    this.http.on('upgrade', (req, socket, head) => {
      if (!originAllowed(req.headers.origin, cfg.allowedOrigins)) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.connect(ws, req));
    });
  }

  start(port = this.cfg.port): Promise<number> {
    this.timers.push(setInterval(() => this.tick(), FLUSH_MS));
    this.timers.push(setInterval(() => this.dirty && this.save(), SAVE_MS));
    return new Promise((resolve) => {
      this.http.listen(port, () => resolve((this.http.address() as AddressInfo).port));
    });
  }

  async stop() {
    for (const t of this.timers) clearInterval(t);
    for (const c of this.clients) c.ws.terminate();
    this.save();
    await new Promise<void>((r) => this.wss.close(() => r()));
    await new Promise<void>((r) => this.http.close(() => r()));
  }

  save() {
    writeSave(this.savePath, { v: 1, world: toJson(this.world), accounts: this.accounts });
    this.dirty = false;
  }

  info() {
    return { id: this.cfg.serverId, name: this.cfg.serverName, online: this.onlineIds().length, protocol: PROTOCOL };
  }

  private onlineIds(): string[] {
    const s = new Set<string>();
    for (const c of this.clients) if (c.playerId) s.add(c.playerId);
    return [...s];
  }

  // ---------- 接続 ----------

  private connect(ws: WebSocket, req: IncomingMessage) {
    const ip = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress ?? '?';
    const c: Client = { ws, ip, hello: false, lastS: 0, acks: [], rejects: [] };
    this.clients.add(c);
    ws.on('message', (data) => {
      let msg: C2S;
      try {
        msg = JSON.parse(String(data)) as C2S;
      } catch {
        return;
      }
      this.onMessage(c, msg);
    });
    ws.on('close', () => this.disconnect(c));
    ws.on('error', () => ws.terminate());
  }

  private send(c: Client, m: S2C) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m));
  }

  private deny(c: Client, reason: DeniedReason) {
    this.send(c, { t: 'denied', reason, text: DENIED_TEXT[reason] });
  }

  private onMessage(c: Client, m: C2S) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      c.hello = true;
      this.send(c, { t: 'server', ...this.info() });
      if (m.protocol !== PROTOCOL) this.deny(c, 'protocol');
      return;
    }
    if (m.t === 'ping') {
      this.send(c, { t: 'pong', at: m.at, now: Date.now() });
      return;
    }
    if (!c.hello) return;
    switch (m.t) {
      case 'join':
        return this.join(c, String(m.name ?? ''), String(m.password ?? ''));
      case 'resume':
        return this.resume(c, String(m.token ?? ''));
      case 'resync':
        if (c.playerId) this.welcome(c);
        return;
      case 'keep':
        if (c.playerId && Number.isInteger(m.item)) extendHold(this.world, c.playerId, m.item, Date.now());
        return;
      case 'cursor':
        return this.cursor(c, m.x, m.y, m.d);
      case 'act':
        return this.act(c, m.s, m.a);
    }
  }

  private tooManyFails(ip: string) {
    const now = Date.now();
    const list = (this.fails.get(ip) ?? []).filter((t) => now - t < 60_000);
    this.fails.set(ip, list);
    return list.length >= MAX_FAILS_PER_MIN;
  }

  private join(c: Client, rawName: string, password: string) {
    if (this.tooManyFails(c.ip)) return this.deny(c, 'rate');
    if (!safeEqual(password, this.cfg.password)) {
      this.fails.get(c.ip)!.push(Date.now());
      return this.deny(c, 'password');
    }
    const name = rawName.trim();
    if (!name || [...name].length > 12) return this.deny(c, 'name');
    // 同じ名前なら同じプレイヤーとして続きから（端末を変えたとき用）
    let acc = this.accounts.find((a) => a.name === name);
    if (!acc) {
      acc = { playerId: randomBytes(6).toString('hex'), name, tokenHashes: [] };
      this.accounts.push(acc);
    }
    const token = randomBytes(24).toString('base64url');
    acc.tokenHashes.push(sha(token));
    acc.tokenHashes = acc.tokenHashes.slice(-8);
    this.attach(c, acc, token);
  }

  private resume(c: Client, token: string) {
    const h = sha(token);
    const acc = this.accounts.find((a) => a.tokenHashes.includes(h));
    if (!acc) return this.deny(c, 'token');
    this.attach(c, acc);
  }

  private attach(c: Client, acc: Account, token?: string) {
    const ops = addPlayer(this.world, acc.playerId, acc.name, Date.now(), this.rng);
    this.queue(ops, [], [acc.playerId]);
    this.dirty = true;
    c.playerId = acc.playerId;
    c.lastS = 0;
    this.q.online = true;
    this.send(c, { t: 'joined', playerId: acc.playerId, token });
    this.welcome(c);
    this.log(`参加: ${acc.name}（${this.onlineIds().length}人）`);
  }

  /** 盤面をまるごと送る。先にほかの人へ差分を送り切ってから */
  private welcome(c: Client) {
    // この人はまだ盤面を持っていないので、差分は送らない（盤面の中に入っている）
    const pid = c.playerId;
    c.playerId = undefined;
    this.flush();
    c.playerId = pid;
    this.send(c, { t: 'welcome', now: Date.now(), world: toJson(this.world), online: this.onlineIds() });
    // 今いる人のカーソルも知らせる
    if (this.cursors.size) this.cursorQ = new Map([...this.cursorQ, ...this.cursors]);
  }

  private cursor(c: Client, x: unknown, y: unknown, d: unknown) {
    const pid = c.playerId;
    if (!pid || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const info: CursorInfo = {
      p: pid,
      x: Math.round(Math.min(W, Math.max(0, x)) * 100) / 100,
      y: Math.round(Math.min(H, Math.max(0, y)) * 100) / 100,
    };
    if (Number.isInteger(d) && this.world.holds.get(d as number)?.player === pid) {
      info.d = d as number;
      extendHold(this.world, pid, info.d, Date.now());
    }
    this.cursors.set(pid, info);
    this.cursorQ.set(pid, info);
  }

  private disconnect(c: Client) {
    this.clients.delete(c);
    const pid = c.playerId;
    if (!pid) return;
    this.q.online = true;
    if ([...this.clients].some((o) => o.playerId === pid)) return;
    if (this.cursors.delete(pid)) this.cursorQ.set(pid, { p: pid, x: 0, y: 0, gone: true });
    // 持っていたアイテムを離す
    const ops: Op[] = [];
    for (const [id, h] of this.world.holds) {
      if (h.player === pid) {
        this.world.holds.delete(id);
        ops.push({ t: 'unhold', id });
      }
    }
    if (ops.length) {
      this.world.rev++;
      this.queue(ops, []);
    }
    const name = this.world.players.get(pid)?.name ?? '?';
    this.log(`退出: ${name}（${this.onlineIds().length}人）`);
  }

  // ---------- 操作 ----------

  private act(c: Client, s: unknown, raw: unknown) {
    if (!c.playerId || !Number.isInteger(s)) return;
    const seq = s as number;
    if (seq <= c.lastS) return; // 再送は二重に実行しない
    c.lastS = seq;
    const a = parseAction(raw);
    if (!a) {
      c.rejects.push({ s: seq, reason: 'no-item' });
      return;
    }
    const r = apply(this.world, c.playerId, a, Date.now(), this.rng);
    if (r.ok) {
      c.acks.push(seq);
      this.queue(r.ops, r.events, r.changedPlayers);
      this.dirty = true;
    } else {
      c.rejects.push({ s: seq, reason: r.reason });
      if (r.ops.length) {
        this.world.rev++;
        this.queue(r.ops, []);
      }
    }
  }

  private queue(ops: Op[], events: GameEvent[], players: string[] = []) {
    this.q.ops.push(...ops);
    this.q.events.push(...events);
    for (const p of players) this.q.players.add(p);
    // レベルアップで発生器をもらった人なども、ここで拾う
    for (const e of events) if (e.t === 'levelup') this.q.players.add(e.player);
  }

  private tick() {
    const ops = expireHolds(this.world, Date.now());
    if (ops.length) this.queue(ops, []);
    this.flush();
  }

  /** たまった差分を全員へ送る */
  flush() {
    const anyPrivate = [...this.clients].some((c) => c.acks.length || c.rejects.length);
    if (!this.q.ops.length && !this.q.events.length && !this.q.players.size && !this.q.online && !anyPrivate && !this.cursorQ.size) return;
    const common: Omit<Batch, 'acks' | 'rejects'> = {
      t: 'batch',
      rev0: this.sentRev,
      rev: this.world.rev,
      ops: this.q.ops,
      events: this.q.events,
      players: [...this.q.players].map((id) => this.world.players.get(id)!).filter(Boolean),
      online: this.q.online ? this.onlineIds() : undefined,
      cursors: this.cursorQ.size ? [...this.cursorQ.values()] : undefined,
    };
    const json = JSON.stringify(common);
    for (const c of this.clients) {
      if (!c.playerId) continue;
      if (!c.acks.length && !c.rejects.length) {
        if (c.ws.readyState === WebSocket.OPEN) c.ws.send(json);
      } else {
        this.send(c, { ...common, acks: c.acks, rejects: c.rejects } as Batch);
      }
      c.acks = [];
      c.rejects = [];
    }
    this.sentRev = this.world.rev;
    this.q = { ops: [], events: [], players: new Set(), online: false };
    this.cursorQ.clear();
  }
}


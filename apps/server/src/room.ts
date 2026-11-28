// 1つのサーバーに、参加した人ごとの盤面（1人1枚）。WebSocket で全員とつながり、カーソルはみんなに見せる。
// シャッター（土地）だけはみんなで共有: だれかが納品すると全員に届き、そろうと全員の盤面の同じ場所が開く。
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import {
  DENIED_TEXT, ENERGY_MAX, GLOW_COOLDOWN_MS, GLOW_ENERGY, GLOW_HIT_R, PROTOCOL, W, H, WORLD_ORDER_BONUS, addPlayer, syncEnergy, apply, createWorld, defaultStory, expireHolds, extendHold, fromJson,
  commonsFromJson, commonsToJson, copyWorldOrder, createCommons, ensureCommonOrders, isOrderFull, mulberry32, parseAction, seeWorld, syncWorldToCommons, toJson,
} from '@minna/shared';
import type { Batch, C2S, Commons, CursorInfo, DeniedReason, GameEvent, Op, Player, RejectReason, S2C, World, WorldOrder } from '@minna/shared';
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
  /** 盤面をまるごと送る直前（このあいだは差分を送らない） */
  welcoming?: boolean;
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** 文字列でなければ空（オブジェクトの toString などを呼ばない） */
const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : '');

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

type Queue = { ops: Op[]; events: GameEvent[]; players: Set<string> };

/** 点 (px,py) から線分 (ax,ay)-(bx,by) までの距離。速く動かしても、通りすぎた分の当たりをとる */
export function segDist(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

export class Room {
  /** プレイヤー id → その人の盤面 */
  worlds = new Map<string, World>();
  /** みんなのシャッター（開けた区画と、今出ている依頼） */
  commons: Commons;
  accounts: Account[];
  private rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
  private clients = new Set<Client>();
  private http: Server;
  private wss: WebSocketServer;
  private timers: NodeJS.Timeout[] = [];
  private fails = new Map<string, number[]>();
  private dirty = false;
  /** 盤面ごとの、送った版と送る差分 */
  private sentRev = new Map<string, number>();
  private qs = new Map<string, Queue>();
  private onlineChanged = false;
  /** カーソル（保存しない）。送るべきものだけ cursorQ に入れる */
  private cursors = new Map<string, CursorInfo>();
  private cursorQ = new Map<string, CursorInfo>();
  /** 光るカーソル: 次に光る時刻と、光り終わる時刻（光っていなければ 0） */
  /** 光るカーソル: ぶつかった2人の組ごとのクールダウン（キーは2人の id を並べたもの → 終わる時刻） */
  private pairCool = new Map<string, number>();

  private cfg: Config;
  private savePath: string;
  private log: (msg: string) => void;

  constructor(cfg: Config, savePath: string, log: (msg: string) => void = console.log) {
    this.cfg = cfg;
    this.savePath = savePath;
    this.log = log;
    const saved = readSave(savePath, log);
    this.accounts = saved?.accounts ?? [];
    // 古いセーブ（みんなで1枚の盤面）は読まず、盤面は1人ずつ作り直す
    if (saved?.v === 2) {
      for (const [pid, j] of Object.entries(saved.worlds)) {
        // 発生器を組み直す前の盤面（v2〜3）は読まず、入り直したときに作り直す
        if (j.v !== 4) continue;
        const w = fromJson(j);
        w.holds.clear();
        this.worlds.set(pid, w);
      }
    }
    if (saved?.v === 2 && saved.commons) {
      this.commons = commonsFromJson(saved.commons);
    } else {
      // みんなのシャッターができる前のセーブ: だれかが開けていた区画は、みんなで開けたことにする
      const opened = new Set<number>();
      for (const w of this.worlds.values()) w.blocks.forEach((b, i) => b && opened.add(i));
      this.commons = createCommons(opened);
    }
    ensureCommonOrders(this.commons, this.topLevel(), this.rng);
    for (const [pid, w] of this.worlds) {
      syncWorldToCommons(w, this.commons, this.rng);
      this.sentRev.set(pid, w.rev);
    }
    if (saved?.v !== 2 || !saved.commons) this.save();

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
    const worlds: Record<string, ReturnType<typeof toJson>> = {};
    for (const [pid, w] of this.worlds) worlds[pid] = toJson(w);
    try {
      writeSave(this.savePath, { v: 2, worlds, commons: commonsToJson(this.commons), accounts: this.accounts });
      this.dirty = false;
    } catch (e) {
      // 書けなかった（ほかのアプリがファイルを開いているなど）: 止めずに、次の保存でもう一度
      this.log(`保存できませんでした。少ししてからもう一度保存します: ${(e as Error)?.message ?? e}`);
    }
  }

  /** その人の盤面（初めてなら作る） */
  worldOf(pid: string): World {
    let w = this.worlds.get(pid);
    if (!w) {
      w = createWorld(this.rng);
      // みんなで開けた所は、はじめて入った人の盤面でも開いている
      syncWorldToCommons(w, this.commons, this.rng);
      this.worlds.set(pid, w);
      this.sentRev.set(pid, w.rev);
    }
    return w;
  }

  private player(pid: string): Player | undefined {
    return this.worlds.get(pid)?.players.get(pid);
  }

  /** いちばん進んでいる人のレベル（みんなのシャッターの難しさ） */
  private topLevel(): number {
    let lv = 1;
    for (const [pid, w] of this.worlds) lv = Math.max(lv, w.players.get(pid)?.level ?? 1);
    return lv;
  }

  /** ほかの人に渡す最小限の情報（id と名前だけ。コイン・ジェム・倉庫・注文・ストーリー進行は送らない） */
  private publicPlayer(p: Player): Player {
    return {
      id: p.id, name: p.name, level: 1, xp: 0, energy: 0, energyAt: 0, coins: 0, gems: 0,
      story: defaultStory(), orders: [], nextOrderId: 1, orderClears: 0, storage: [], inbox: [], seen: [],
    };
  }

  /** 参加中のほかの人（名前の表示用） */
  private othersOnline(pid: string): Player[] {
    return this.onlineIds()
      .filter((id) => id !== pid)
      .map((id) => this.player(id))
      .filter((p): p is Player => !!p)
      .map((p) => this.publicPlayer(p));
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
      // おかしな形のメッセージ1通でサーバーごと落ちないように
      try {
        this.onMessage(c, msg);
      } catch (e) {
        this.log(`おかしなメッセージを無視しました（${c.ip}）: ${(e as Error)?.message ?? e}`);
      }
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
      this.send(c, { t: 'server', ...this.info() });
      // 版が合わない人は入れない（このあとの join なども受けつけない）
      if (m.protocol !== PROTOCOL) {
        this.deny(c, 'protocol');
        return;
      }
      c.hello = true;
      return;
    }
    if (m.t === 'ping') {
      this.send(c, { t: 'pong', at: m.at, now: Date.now() });
      return;
    }
    if (!c.hello) return;
    switch (m.t) {
      case 'join':
        // 同じつながりで2回目の参加はしない（前の人のカーソルが残ってしまう）
        if (c.playerId) return;
        return this.join(c, str(m.name), str(m.password));
      case 'resume':
        if (c.playerId) return;
        return this.resume(c, str(m.token));
      case 'resync':
        if (c.playerId) this.welcome(c);
        return;
      case 'keep':
        if (c.playerId && Number.isInteger(m.item)) extendHold(this.worldOf(c.playerId), c.playerId, m.item, Date.now());
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
    const ops = addPlayer(this.worldOf(acc.playerId), acc.playerId, acc.name, Date.now(), this.rng);
    this.queue(acc.playerId, ops, [], [acc.playerId]);
    this.dirty = true;
    c.playerId = acc.playerId;
    c.lastS = 0;
    this.send(c, { t: 'joined', playerId: acc.playerId, token });
    this.welcome(c);
    // 参加中の一覧は、この人を入れた形で次の差分と一緒に全員へ送る
    this.onlineChanged = true;
    this.log(`参加: ${acc.name}（${this.onlineIds().length}人）`);
  }

  /** 盤面をまるごと送る。先にほかの人へ差分を送り切ってから */
  private welcome(c: Client) {
    // この人には差分を送らない（盤面の中に入っている）。参加中の一覧からは消さない
    const pid = c.playerId!;
    c.welcoming = true;
    this.flush();
    c.welcoming = false;
    const w = this.worldOf(pid);
    // 盤面はこの人のもの。ほかの参加中の人は、カーソルの名前を出すために一緒に送る
    const json = toJson(w);
    json.players = [...json.players, ...this.othersOnline(pid)];
    this.sentRev.set(pid, w.rev);
    this.send(c, { t: 'welcome', now: Date.now(), world: json, online: this.onlineIds() });
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
    // 盤面は1人ずつ別なので、ほかの人にはカーソルの位置だけ見せる（つかんでいるアイテムは見せない）
    if (Number.isInteger(d)) extendHold(this.worldOf(pid), pid, d as number, Date.now());
    const prev = this.cursors.get(pid);
    this.cursors.set(pid, info);
    this.cursorQ.set(pid, info);
    this.checkBump(pid, prev ?? info, info, Date.now());
  }

  // ---------- 光るカーソル ----------

  private pairKey(a: string, b: string) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /** a と b がぶつかれるか（その2人の組のクールダウンが終わっている）。ほかの人とはいつでもぶつかれる */
  private pairReady(a: string, b: string, now = Date.now()) {
    return (this.pairCool.get(this.pairKey(a, b)) ?? 0) <= now;
  }

  /** クールダウンが明けた組は、おたがいのカーソルをまた光らせる（送り直す） */
  private tickGlows(now: number) {
    for (const [k, until] of this.pairCool) {
      if (until > now) continue;
      this.pairCool.delete(k);
      for (const pid of k.split('|')) {
        const cur = this.cursors.get(pid);
        if (cur) this.cursorQ.set(pid, cur);
      }
    }
  }

  /** pid のカーソルが a から b へ動いた。まだぶつかっていない相手（組ごとに15分）とぶつかったら、2人ともスタミナ */
  private checkBump(pid: string, a: CursorInfo, b: CursorInfo, now: number) {
    for (const [q, o] of this.cursors) {
      if (q === pid || o.gone || !this.pairReady(pid, q, now)) continue;
      if (segDist(a.x, a.y, b.x, b.y, o.x, o.y) > GLOW_HIT_R) continue;
      for (const [me, other] of [[pid, q], [q, pid]] as const) {
        const p = this.player(me);
        if (p) {
          syncEnergy(p, now);
          p.energy += GLOW_ENERGY;
          if (p.energy >= ENERGY_MAX) p.energyAt = now;
          this.queue(me, [], [{ t: 'bump', player: me, from: other, energy: GLOW_ENERGY }], [me]);
        }
        // おたがいのカーソルを送り直す（この2人の間だけ光らなくなる）
        const cur = this.cursors.get(me);
        if (cur) this.cursorQ.set(me, cur);
      }
      this.pairCool.set(this.pairKey(pid, q), now + GLOW_COOLDOWN_MS);
      this.dirty = true;
      this.log(`光るカーソル: ${this.player(pid)?.name ?? '?'} と ${this.player(q)?.name ?? '?'} がぶつかった（2人ともスタミナ+${GLOW_ENERGY}）`);
      return;
    }
  }

  private disconnect(c: Client) {
    this.clients.delete(c);
    const pid = c.playerId;
    if (!pid) return;
    this.onlineChanged = true;
    if ([...this.clients].some((o) => o.playerId === pid)) return;
    if (this.cursors.delete(pid)) this.cursorQ.set(pid, { p: pid, x: 0, y: 0, gone: true });
    // 持っていたアイテムを離す
    const w = this.worldOf(pid);
    const ops: Op[] = [];
    for (const [id, h] of w.holds) {
      if (h.player === pid) {
        w.holds.delete(id);
        ops.push({ t: 'unhold', id });
      }
    }
    if (ops.length) {
      w.rev++;
      this.queue(pid, ops, []);
    }
    const name = this.player(pid)?.name ?? '?';
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
    const pid = c.playerId;
    const w = this.worldOf(pid);
    const r = apply(w, pid, a, Date.now(), this.rng);
    if (r.ok) {
      c.acks.push(seq);
      this.queue(pid, r.ops, r.events, r.changedPlayers);
      this.shareShutters(pid, r.events);
      this.dirty = true;
    } else {
      c.rejects.push({ s: seq, reason: r.reason });
      if (r.ops.length) {
        w.rev++;
        this.queue(pid, r.ops, []);
      }
    }
  }

  /**
   * みんなのシャッター: pid の盤面で進んだ数を、みんなのものにして全員の盤面へ届ける。
   * そろったら全員の盤面の同じ場所を開けて、納品した人にコイン
   */
  private shareShutters(pid: string, events: GameEvent[]) {
    const gives = events.filter((e): e is Extract<GameEvent, { t: 'shutterGive' }> => e.t === 'shutterGive');
    if (!gives.length) return;
    const w = this.worldOf(pid);
    const full: WorldOrder[] = [];
    for (const id of new Set(gives.map((g) => g.order))) {
      const mine = w.worldOrders.find((o) => o.id === id);
      const i = this.commons.orders.findIndex((o) => o.id === id);
      if (!mine || i < 0) continue;
      this.commons.orders[i] = copyWorldOrder(mine);
      if (isOrderFull(mine)) full.push(mine);
    }
    for (const o of full) this.commons.blocks[o.block] = 1;
    if (full.length) ensureCommonOrders(this.commons, this.topLevel(), this.rng);
    const paid = new Set<string>();
    for (const o of full) {
      for (const cid of Object.keys(o.contributors)) {
        const q = this.player(cid);
        if (!q) continue;
        q.coins += WORLD_ORDER_BONUS;
        paid.add(cid);
      }
      this.log(`シャッターが開いた: 区画 ${o.block}（${Object.keys(o.contributors).map((id) => this.player(id)?.name ?? '?').join('、')}）`);
    }
    for (const [qid, qw] of this.worlds) {
      const ops = syncWorldToCommons(qw, this.commons, this.rng);
      // 開いた所の半開きのダンボールも、図鑑の「見た」に入れる
      const owner = qw.players.get(qid);
      const sawNew = !!owner && seeWorld(qw, owner);
      // 納品した本人には、もう知らせが入っている
      const evs: GameEvent[] = qid === pid ? [] : [...gives];
      for (const o of full) {
        evs.push({ t: 'unlock', block: o.block, owner: o.owner, contributors: Object.keys(o.contributors), bonus: paid.has(qid) ? WORLD_ORDER_BONUS : 0 });
      }
      if (ops.length || evs.length) this.queue(qid, ops, evs, paid.has(qid) || sawNew ? [qid] : []);
    }
  }

  /** その人の盤面の差分をためる */
  private queue(pid: string, ops: Op[], events: GameEvent[], players: string[] = []) {
    let q = this.qs.get(pid);
    if (!q) { q = { ops: [], events: [], players: new Set() }; this.qs.set(pid, q); }
    q.ops.push(...ops);
    q.events.push(...events);
    for (const p of players) q.players.add(p);
    for (const e of events) if (e.t === 'levelup') q.players.add(e.player);
  }

  private tick() {
    const now = Date.now();
    for (const pid of this.onlineIds()) {
      const ops = expireHolds(this.worldOf(pid), now);
      if (ops.length) this.queue(pid, ops, []);
    }
    this.tickGlows(now);
    this.flush();
  }

  /** たまった差分を送る。盤面の差分はその人にだけ、カーソルと参加中の一覧はみんなに */
  flush() {
    const anyPrivate = [...this.clients].some((c) => c.acks.length || c.rejects.length);
    if (!this.qs.size && !this.onlineChanged && !anyPrivate && !this.cursorQ.size) return;
    const online = this.onlineChanged ? this.onlineIds() : undefined;
    const cursors = this.cursorQ.size ? [...this.cursorQ.values()] : undefined;
    for (const c of this.clients) {
      if (!c.playerId || c.welcoming) continue;
      const pid = c.playerId;
      const w = this.worldOf(pid);
      const q = this.qs.get(pid);
      const players = [...(q?.players ?? [])].map((id) => this.player(id)).filter((p): p is Player => !!p);
      // 参加中の人が変わったら、ほかの人の名前も届ける
      if (online) players.push(...this.othersOnline(pid));
      if (!q && !online && !cursors && !c.acks.length && !c.rejects.length) continue;
      const b: Batch = {
        t: 'batch', rev0: this.sentRev.get(pid) ?? w.rev, rev: w.rev,
        ops: q?.ops ?? [], events: q?.events ?? [], players,
        acks: c.acks, rejects: c.rejects, online,
        // 光るのは、見ている人がまだぶつかれる相手のカーソルだけ（人ごとにクールダウンがちがう）
        cursors: cursors?.filter((x) => x.p !== pid).map((x) => {
          const { g: _g, ...rest } = x;
          return !x.gone && pid && this.pairReady(pid, x.p) ? { ...rest, g: 1 as const } : rest;
        }),
      };
      this.send(c, b);
      c.acks = [];
      c.rejects = [];
    }
    // 送った版を覚える（同じ人が2つの端末で入っていても、同じ差分が届く）
    for (const pid of this.qs.keys()) { const w = this.worlds.get(pid); if (w) this.sentRev.set(pid, w.rev); }
    this.qs.clear();
    this.onlineChanged = false;
    this.cursorQ.clear();
  }
}

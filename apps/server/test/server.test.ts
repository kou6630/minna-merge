import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL, kindOf } from '@minna/shared';
import type { S2C, WorldJson } from '@minna/shared';
import { Room, originAllowed } from '../src/room.ts';
import type { Config } from '../src/config.ts';

const TMP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '.tmp');
mkdirSync(TMP_ROOT, { recursive: true });
after(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

const cfg = (): Config => ({ serverId: 'test-server', serverName: 'テスト', password: 'abc', port: 0, allowedOrigins: [], pagesUrl: 'http://localhost/' });

async function startRoom(dir = mkdtempSync(join(TMP_ROOT, 'r-'))) {
  const room = new Room(cfg(), join(dir, 'world.json'), () => {});
  const port = await room.start(0);
  return { room, port, dir };
}

/** 試験用のクライアント */
class Bot {
  msgs: S2C[] = [];
  private ws: WebSocket;
  private waiters: (() => void)[] = [];
  s = 0;
  ready: Promise<void>;
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ready = new Promise((r) => this.ws.addEventListener('open', () => r()));
    this.ws.addEventListener('message', (e) => {
      this.msgs.push(JSON.parse(String(e.data)) as S2C);
      for (const w of this.waiters.splice(0)) w();
    });
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  act(a: unknown) {
    this.s++;
    this.send({ t: 'act', s: this.s, a });
    return this.s;
  }
  async waitFor<T extends S2C>(pred: (m: S2C) => m is T, ms?: number): Promise<T>;
  async waitFor(pred: (m: S2C) => boolean, ms?: number): Promise<S2C>;
  async waitFor(pred: (m: S2C) => boolean, ms = 2000): Promise<S2C> {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.msgs.findIndex(pred);
      if (i >= 0) return this.msgs.splice(i, 1)[0]!;
      if (Date.now() > deadline) throw new Error('待ちきれなかった');
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }
  close() {
    this.ws.close();
  }
  async join(name: string) {
    await this.ready;
    this.send({ t: 'hello', protocol: PROTOCOL });
    await this.waitFor((m) => m.t === 'server');
    this.send({ t: 'join', name, password: 'abc' });
    const j = (await this.waitFor((m) => m.t === 'joined')) as Extract<S2C, { t: 'joined' }>;
    const w = (await this.waitFor((m) => m.t === 'welcome')) as Extract<S2C, { t: 'welcome' }>;
    return { playerId: j.playerId, token: j.token!, world: w.world };
  }
}

const isBatch = (m: S2C): m is Extract<S2C, { t: 'batch' }> => m.t === 'batch';
const myGen = (w: WorldJson, pid: string) => w.items.find((i) => i.owner === pid)!;

test('合言葉がちがうと入れず、合えば参加証と盤面がもらえる', async () => {
  const { room, port } = await startRoom();
  const b = new Bot(port);
  await b.ready;
  b.send({ t: 'hello', protocol: PROTOCOL });
  const info = await b.waitFor((m) => m.t === 'server');
  assert.equal(info.t === 'server' && info.name, 'テスト');
  b.send({ t: 'join', name: 'たこ', password: 'ちがう' });
  const d = await b.waitFor((m) => m.t === 'denied');
  assert.equal(d.t === 'denied' && d.reason, 'password');
  b.send({ t: 'join', name: 'たこ', password: 'abc' });
  const j = await b.waitFor((m) => m.t === 'joined');
  assert.ok(j.t === 'joined' && j.token && j.token.length > 20);
  const w = await b.waitFor((m) => m.t === 'welcome');
  assert.ok(w.t === 'welcome' && w.world.items.some((i) => i.owner === j.playerId && i.kind === kindOf('oven', 1)));
  b.close();
  await room.stop();
});

test('版が合わないと断る', async () => {
  const { room, port } = await startRoom();
  const b = new Bot(port);
  await b.ready;
  b.send({ t: 'hello', protocol: PROTOCOL + 99 });
  const d = await b.waitFor((m) => m.t === 'denied');
  assert.equal(d.t === 'denied' && d.reason, 'protocol');
  b.close();
  await room.stop();
});

test('参加証で2回目は自動で入れる。知らない参加証は断る', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  const { playerId, token } = await a.join('たこ');
  a.close();

  const b = new Bot(port);
  await b.ready;
  b.send({ t: 'hello', protocol: PROTOCOL });
  b.send({ t: 'resume', token: 'でたらめ' });
  const d = await b.waitFor((m) => m.t === 'denied');
  assert.equal(d.t === 'denied' && d.reason, 'token');
  b.send({ t: 'resume', token });
  const j = await b.waitFor((m) => m.t === 'joined');
  assert.equal(j.t === 'joined' && j.playerId, playerId);
  b.close();
  await room.stop();
});

test('1人がタップすると、もう1人の画面にアイテムが届く', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  const b = new Bot(port);
  const ja = await a.join('Aさん');
  await b.join('Bさん');
  const gen = myGen(ja.world, ja.playerId);
  const s = a.act({ t: 'tap', gen: gen.id });
  const ackA = await a.waitFor((m) => isBatch(m) && (m.acks ?? []).includes(s));
  assert.ok(isBatch(ackA));
  const seen = await b.waitFor((m) => isBatch(m) && m.ops.some((o) => o.t === 'spawn' && o.from === gen.cell));
  assert.ok(isBatch(seen));
  a.close();
  b.close();
  await room.stop();
});

test('同じアイテムを2人が同時につかむと、あとの人は断られる', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  const b = new Bot(port);
  const ja = await a.join('Aさん');
  await b.join('Bさん');
  a.act({ t: 'tap', gen: myGen(ja.world, ja.playerId).id });
  const sp = await b.waitFor((m) => isBatch(m) && m.ops.some((o) => o.t === 'spawn' && o.from !== undefined));
  const spawn = isBatch(sp) ? sp.ops.find((o) => o.t === 'spawn' && o.from !== undefined) : undefined;
  assert.ok(spawn && spawn.t === 'spawn');
  const item = spawn.item.id;

  const sa = a.act({ t: 'grab', item });
  const sb = b.act({ t: 'grab', item });
  const ra = await a.waitFor((m) => isBatch(m) && ((m.acks ?? []).includes(sa) || (m.rejects ?? []).some((r) => r.s === sa)));
  const rb = await b.waitFor((m) => isBatch(m) && ((m.acks ?? []).includes(sb) || (m.rejects ?? []).some((r) => r.s === sb)));
  const aOk = isBatch(ra) && (ra.acks ?? []).includes(sa);
  const bOk = isBatch(rb) && (rb.acks ?? []).includes(sb);
  assert.equal(aOk !== bOk, true, '片方だけがつかめる');
  const loser = aOk ? rb : ra;
  assert.ok(isBatch(loser) && loser.rejects.some((r) => r.reason === 'held'));
  a.close();
  b.close();
  await room.stop();
});

test('マージはほかの人にも届き、切断すると持っていたアイテムは離される', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  const b = new Bot(port);
  const ja = await a.join('Aさん');
  await b.join('Bさん');
  const gen = myGen(ja.world, ja.playerId);
  a.act({ t: 'tap', gen: gen.id });
  a.act({ t: 'tap', gen: gen.id });
  const spawned: number[] = [];
  while (spawned.length < 2) {
    const m = await b.waitFor(isBatch);
    for (const o of m.ops) if (o.t === 'spawn' && o.from === gen.cell) spawned.push(o.item.id);
  }
  const [x, y] = spawned as [number, number];
  const yCell = room.world.items.get(y)!.cell;
  a.act({ t: 'grab', item: x });
  a.act({ t: 'drop', item: x, cell: yCell });
  const merged = await b.waitFor((m) => isBatch(m) && m.ops.some((o) => o.t === 'remove' && o.id === x));
  assert.ok(isBatch(merged) && merged.ops.some((o) => o.t === 'update' && o.item.id === y && o.item.kind === kindOf('bread', 2)));

  // つかんだまま切断
  a.act({ t: 'grab', item: y });
  await b.waitFor((m) => isBatch(m) && m.ops.some((o) => o.t === 'hold' && o.id === y));
  a.close();
  await b.waitFor((m) => isBatch(m) && m.ops.some((o) => o.t === 'unhold' && o.id === y));
  assert.equal(room.world.holds.size, 0);
  b.close();
  await room.stop();
});

test('同じ番号の操作を2回送っても1回しか実行しない', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  const ja = await a.join('Aさん');
  const gen = myGen(ja.world, ja.playerId);
  const before = room.world.items.size;
  a.send({ t: 'act', s: 1, a: { t: 'tap', gen: gen.id } });
  a.send({ t: 'act', s: 1, a: { t: 'tap', gen: gen.id } });
  await a.waitFor((m) => isBatch(m) && (m.acks ?? []).includes(1));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(room.world.items.size, before + 1);
  a.close();
  await room.stop();
});

test('止めて起動し直しても、盤面と参加証が残る', async () => {
  const first = await startRoom();
  const a = new Bot(first.port);
  const ja = await a.join('Aさん');
  a.act({ t: 'tap', gen: myGen(ja.world, ja.playerId).id });
  await a.waitFor((m) => isBatch(m) && (m.acks ?? []).length > 0);
  a.close();
  const items = first.room.world.items.size;
  const rev = first.room.world.rev;
  await first.room.stop();

  const second = await startRoom(first.dir);
  assert.equal(second.room.world.items.size, items);
  assert.equal(second.room.world.rev, rev);
  const b = new Bot(second.port);
  await b.ready;
  b.send({ t: 'hello', protocol: PROTOCOL });
  b.send({ t: 'resume', token: ja.token });
  const j = await b.waitFor((m) => m.t === 'joined');
  assert.equal(j.t === 'joined' && j.playerId, ja.playerId);
  b.close();
  await second.room.stop();
});

test('接続を許すページ', () => {
  assert.equal(originAllowed('http://localhost:5181', []), true);
  assert.equal(originAllowed('https://kou6630.github.io', ['https://kou6630.github.io']), true);
  assert.equal(originAllowed('https://evil.example', ['https://kou6630.github.io']), false);
  assert.equal(originAllowed(undefined, []), true);
});

test('倉庫と注文は通信で使え、起動し直しても残る', async () => {
  const first = await startRoom();
  const a = new Bot(first.port);
  const ja = await a.join('Aさん');
  const gen = myGen(ja.world, ja.playerId);
  a.act({ t: 'tap', gen: gen.id });
  const sp = await a.waitFor((m) => isBatch(m) && m.ops.some((o) => o.t === 'spawn' && o.from === gen.cell));
  const spawned = isBatch(sp) ? sp.ops.find((o) => o.t === 'spawn' && o.from === gen.cell) : undefined;
  assert.ok(spawned && spawned.t === 'spawn');
  const s = a.act({ t: 'store', item: spawned.item.id });
  const st = await a.waitFor((m) => isBatch(m) && (m.acks ?? []).includes(s));
  assert.ok(isBatch(st));
  const me = st.players.find((p) => p.id === ja.playerId)!;
  assert.equal(me.storage[0], spawned.item.kind);
  assert.equal(me.orders.length, 3);

  // 注文をこのアイテムに書きかえて、倉庫から納品
  const p = first.room.world.players.get(ja.playerId)!;
  p.orders[0]!.needs = [{ kind: spawned.item.kind, count: 1, have: 0 }];
  const coins = p.orders[0]!.coins;
  const firstOrder = p.orders[0]!.id;
  const s2 = a.act({ t: 'deliver', order: firstOrder, slot: 0 });
  const dv = await a.waitFor((m) => isBatch(m) && (m.acks ?? []).includes(s2));
  assert.ok(isBatch(dv) && dv.events.some((e) => e.t === 'order'));
  const after = dv.players.find((q) => q.id === ja.playerId)!;
  assert.equal(after.coins, coins);
  assert.equal(after.storage[0], null);
  assert.ok(!after.orders.some((o) => o.id === firstOrder));
  const orderIds = after.orders.map((o) => o.id);
  a.close();
  await first.room.stop();

  const second = await startRoom(first.dir);
  const back = second.room.world.players.get(ja.playerId)!;
  assert.deepEqual(back.orders.map((o) => o.id), orderIds);
  assert.equal(back.coins, coins);
  await second.room.stop();
});

test('カーソルがほかの人に届き、切断すると消える。みんなの依頼も最初から届く', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  const b = new Bot(port);
  const ja = await a.join('Aさん');
  const jb = await b.join('Bさん');
  assert.equal(jb.world.worldOrders?.length, 2);
  a.send({ t: 'cursor', x: 50.5, y: 49.25 });
  const m = await b.waitFor((x) => isBatch(x) && (x.cursors ?? []).some((c) => c.p === ja.playerId));
  const cur = isBatch(m) ? m.cursors!.find((c) => c.p === ja.playerId)! : undefined;
  assert.deepEqual(cur, { p: ja.playerId, x: 50.5, y: 49.25 });
  // 持っていないアイテムを d に入れても無視される
  a.send({ t: 'cursor', x: 1, y: 2, d: 99999 });
  const m2 = await b.waitFor((x) => isBatch(x) && (x.cursors ?? []).some((c) => c.p === ja.playerId && c.x === 1));
  assert.equal(isBatch(m2) && m2.cursors!.find((c) => c.p === ja.playerId)!.d, undefined);
  a.close();
  await b.waitFor((x) => isBatch(x) && (x.cursors ?? []).some((c) => c.p === ja.playerId && c.gone));
  b.close();
  await room.stop();
});

test('参加した人には、盤面より先に差分を送らない', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  await a.join('Aさん');
  const b = new Bot(port);
  await b.ready;
  b.send({ t: 'hello', protocol: PROTOCOL });
  b.send({ t: 'join', name: 'Bさん', password: 'abc' });
  await b.waitFor((m) => m.t === 'welcome');
  // welcome より前に batch が来ていたら msgs に残っている
  const order = b.msgs.map((m) => m.t);
  assert.ok(!order.includes('batch'), `届いた順: ${order.join(',')}`);
  a.close();
  b.close();
  await room.stop();
});

test('あとから入った人も、参加中の人数に数えられる', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  const ja = await a.join('Aさん');
  const b = new Bot(port);
  const jb = await b.join('Bさん');
  const m = await a.waitFor((x) => isBatch(x) && (x.online ?? []).length === 2);
  assert.ok(isBatch(m) && m.online!.includes(ja.playerId) && m.online!.includes(jb.playerId));
  const m2 = await b.waitFor((x) => isBatch(x) && (x.online ?? []).length === 2);
  assert.ok(isBatch(m2));
  a.close();
  b.close();
  await room.stop();
});

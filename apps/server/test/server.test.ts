import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLOW_ENERGY, GEN_WORK_TIER, PROTOCOL, cellAt, kindOf } from '@minna/shared';
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
  assert.ok(w.t === 'welcome' && w.world.items.some((i) => i.owner === j.playerId && i.kind === kindOf('oven', GEN_WORK_TIER)));
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
  // 版が合わないまま参加しようとしても、入れない
  b.send({ t: 'join', name: 'ずる', password: 'abc' });
  await assert.rejects(b.waitFor((m) => m.t === 'joined', 400));
  b.close();
  await room.stop();
});

test('おかしな形のメッセージを送られても、サーバーは落ちずに動き続ける', async () => {
  const { room, port } = await startRoom();
  const bad = new Bot(port);
  await bad.ready;
  bad.send({ t: 'hello', protocol: PROTOCOL });
  await bad.waitFor((m) => m.t === 'server');
  // 名前や合言葉が文字列でない（toString がこわれたオブジェクト）・中身のない act など
  bad.send({ t: 'join', name: { toString: 1 }, password: { toString: 1 } });
  bad.send({ t: 'resume', token: { toString: 1 } });
  bad.send({ t: 'act', s: 1, a: { t: 'drop', item: 'x' } });
  bad.send({ t: 'cursor', x: 'a', y: null });
  await new Promise((r) => setTimeout(r, 100));
  // ほかの人はふつうに入れる
  const ok = new Bot(port);
  const j = await ok.join('ふつうの人');
  assert.ok(j.playerId);
  bad.close();
  ok.close();
  await room.stop();
});

test('セーブがこわれていても起動でき、こわれたファイルは別の名前で残る', async () => {
  const dir = mkdtempSync(join(TMP_ROOT, 'r-'));
  writeFileSync(join(dir, 'world.json'), '{"v":2,"worlds":{', 'utf8');
  const { room, port } = await startRoom(dir);
  const a = new Bot(port);
  const ja = await a.join('Aさん');
  assert.ok(ja.playerId);
  assert.ok(readdirSync(dir).some((f) => f.startsWith('world.json.broken-')));
  a.close();
  await room.stop();
  assert.ok(existsSync(join(dir, 'world.json')));
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

test('盤面は1人1枚。1人がタップしても、もう1人の盤面には何も届かない', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  const b = new Bot(port);
  const ja = await a.join('Aさん');
  const jb = await b.join('Bさん');
  // それぞれ自分の発生器だけを持つ別の盤面
  assert.ok(myGen(ja.world, ja.playerId) && !ja.world.items.some((i) => i.owner === jb.playerId));
  assert.ok(myGen(jb.world, jb.playerId) && !jb.world.items.some((i) => i.owner === ja.playerId));
  assert.notEqual(room.worlds.get(ja.playerId), room.worlds.get(jb.playerId));
  const gen = myGen(ja.world, ja.playerId);
  const s = a.act({ t: 'tap', gen: gen.id });
  const ackA = await a.waitFor((m) => isBatch(m) && (m.acks ?? []).includes(s));
  assert.ok(isBatch(ackA) && ackA.ops.some((o) => o.t === 'spawn' && o.from === gen.cell));
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!b.msgs.some((m) => isBatch(m) && m.ops.length > 0), 'Bさんには盤面の差分が届かない');
  a.close();
  b.close();
  await room.stop();
});

test('マージができ、切断すると持っていたアイテムは離される', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  const ja = await a.join('Aさん');
  const w = room.worlds.get(ja.playerId)!;
  // 盤面に同じパンを2つ置いておく（発生器から出る物はパン・お菓子・飲み物のどれかなので）
  const spawned: number[] = [];
  for (const c of [cellAt(1, 99), cellAt(1, 98)]) {
    const id = w.nextId++;
    w.items.set(id, { id, kind: kindOf('bread', 1), cell: c, maker: ja.playerId });
    w.cells[c] = id;
    spawned.push(id);
  }
  const [x, y] = spawned as [number, number];
  const yCell = w.items.get(y)!.cell;
  a.act({ t: 'grab', item: x });
  a.act({ t: 'drop', item: x, cell: yCell });
  const merged = await a.waitFor((m) => isBatch(m) && m.ops.some((o) => o.t === 'remove' && o.id === x));
  assert.ok(isBatch(merged) && merged.ops.some((o) => o.t === 'update' && o.item.id === y && o.item.kind === kindOf('bread', 2)));
  // つかんだまま切断
  const sg = a.act({ t: 'grab', item: y });
  await a.waitFor((m) => isBatch(m) && (m.acks ?? []).includes(sg));
  assert.equal(w.holds.size, 1);
  a.close();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(w.holds.size, 0);
  await room.stop();
});

test('同じ番号の操作を2回送っても1回しか実行しない', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  const ja = await a.join('Aさん');
  const gen = myGen(ja.world, ja.playerId);
  const w = room.worlds.get(ja.playerId)!;
  const before = w.items.size;
  a.send({ t: 'act', s: 1, a: { t: 'tap', gen: gen.id } });
  a.send({ t: 'act', s: 1, a: { t: 'tap', gen: gen.id } });
  await a.waitFor((m) => isBatch(m) && (m.acks ?? []).includes(1));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(w.items.size, before + 1);
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
  const items = first.room.worlds.get(ja.playerId)!.items.size;
  const rev = first.room.worlds.get(ja.playerId)!.rev;
  await first.room.stop();

  const second = await startRoom(first.dir);
  assert.equal(second.room.worlds.get(ja.playerId)!.items.size, items);
  assert.equal(second.room.worlds.get(ja.playerId)!.rev, rev);
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
  assert.equal(me.orders.length, 2);

  // 注文をこのアイテムに書きかえて、倉庫から納品
  const p = first.room.worlds.get(ja.playerId)!.players.get(ja.playerId)!;
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
  const back = second.room.worlds.get(ja.playerId)!.players.get(ja.playerId)!;
  assert.deepEqual(back.orders.map((o) => o.id), orderIds);
  assert.equal(back.coins, coins);
  await second.room.stop();
});

test('みんなのシャッター: 1人の納品がほかの人にすぐ届き、そろうと全員の盤面の同じ場所が開く', async () => {
  const first = await startRoom();
  const { room } = first;
  const a = new Bot(first.port);
  const b = new Bot(first.port);
  const ja = await a.join('Aさん');
  const jb = await b.join('Bさん');
  // 最初のシャッターは、みんな同じ依頼（2段目のパンを40個）
  assert.deepEqual(ja.world.worldOrders, jb.world.worldOrders);
  assert.equal(ja.world.worldOrders![0]!.needs[0]!.count, 40);

  const gen = myGen(ja.world, ja.playerId);
  const wa = room.worlds.get(ja.playerId)!;
  const pa = wa.players.get(ja.playerId)!;
  const target = room.commons.orders[0]!;
  const deliverOne = async () => {
    a.act({ t: 'tap', gen: gen.id });
    const sp = await a.waitFor((m) => isBatch(m) && m.ops.some((o) => o.t === 'spawn' && o.from === gen.cell));
    const it = isBatch(sp) ? sp.ops.find((o) => o.t === 'spawn' && o.from === gen.cell) : undefined;
    assert.ok(it && it.t === 'spawn');
    // 出たアイテムを、シャッターも注文も待っていることにする（残り2個）
    target.needs[0]!.kind = it.item.kind;
    for (const w of room.worlds.values()) w.worldOrders.find((o) => o.id === target.id)!.needs[0]!.kind = it.item.kind;
    pa.orders[0]!.needs = [{ kind: it.item.kind, count: 1, have: 0 }];
    return a.act({ t: 'deliver', order: pa.orders[0]!.id, item: it.item.id });
  };
  target.needs[0]!.have = 38;
  for (const w of room.worlds.values()) w.worldOrders.find((o) => o.id === target.id)!.needs[0]!.have = 38;

  await deliverOne();
  const got = await b.waitFor((m) => isBatch(m) && m.events.some((e) => e.t === 'shutterGive'));
  assert.ok(isBatch(got));
  const give = got.events.find((e) => e.t === 'shutterGive');
  assert.ok(give && give.t === 'shutterGive' && give.name === 'Aさん' && give.have === 39 && give.count === 40);
  assert.ok(got.ops.some((o) => o.t === 'worldOrder' && o.order.id === target.id && o.order.needs[0]!.have === 39));

  const coins = pa.coins;
  const s = await deliverOne();
  const opened = await b.waitFor((m) => isBatch(m) && m.events.some((e) => e.t === 'unlock'));
  assert.ok(isBatch(opened));
  assert.ok(opened.ops.some((o) => o.t === 'block' && o.idx === target.block && o.open));
  const ub = opened.events.find((e) => e.t === 'unlock');
  assert.ok(ub && ub.t === 'unlock' && ub.bonus === 0 && ub.contributors.includes(ja.playerId));
  const mine = await a.waitFor((m) => isBatch(m) && (m.acks ?? []).includes(s));
  assert.ok(isBatch(mine));
  const ua = mine.events.find((e) => e.t === 'unlock');
  assert.ok(ua && ua.t === 'unlock' && ua.bonus > 0);
  assert.ok(pa.coins >= coins + ua.bonus);
  // 2人の盤面とも同じ場所が開き、次のシャッターの依頼もそっくり同じ
  for (const w of room.worlds.values()) {
    assert.equal(w.blocks[target.block], 1);
    assert.deepEqual(w.worldOrders, room.commons.orders);
  }
  assert.ok(!room.commons.orders.some((o) => o.id === target.id));
  a.close();
  b.close();
  await room.stop();

  // 起動し直しても、みんなで開けた所は残る
  const second = await startRoom(first.dir);
  assert.equal(second.room.commons.blocks[target.block], 1);
  assert.deepEqual(second.room.worlds.get(jb.playerId)!.worldOrders, second.room.commons.orders);
  await second.room.stop();
});

test('カーソルはほかの人に届き（名前も分かる）、切断すると消える。シャッターの依頼も最初から届く', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  const b = new Bot(port);
  const ja = await a.join('Aさん');
  const jb = await b.join('Bさん');
  assert.ok((jb.world.worldOrders?.length ?? 0) >= 2);
  // あとから入った B の盤面にも、A の名前が入っている（コインや倉庫などの個人情報は含まない）
  const aInB = jb.world.players.find((p) => p.id === ja.playerId);
  assert.ok(aInB && aInB.name === 'Aさん');
  assert.equal(aInB.coins, 0);
  assert.equal(aInB.gems, 0);
  assert.deepEqual(aInB.storage, []);
  assert.deepEqual(aInB.orders, []);
  a.send({ t: 'cursor', x: 50.5, y: 49.25 });
  const m = await b.waitFor((x) => isBatch(x) && (x.cursors ?? []).some((c) => c.p === ja.playerId));
  const cur = isBatch(m) ? m.cursors!.find((c) => c.p === ja.playerId)! : undefined;
  // カーソルはふだん光っている（g: 1）
  assert.deepEqual(cur, { p: ja.playerId, x: 50.5, y: 49.25, g: 1 });
  // つかんでいるアイテムは見せない（盤面が別なので）
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

test('光るカーソル: ほかの人のカーソルは光っていて、ぶつかると2人ともスタミナ（GLOW_ENERGY）。その2人の間だけ15分光らない', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  const b = new Bot(port);
  const ja = await a.join('Aさん');
  const jb = await b.join('Bさん');
  a.send({ t: 'cursor', x: 10, y: 10 });
  // 入ったときから光っている
  await b.waitFor((x) => isBatch(x) && (x.cursors ?? []).some((c) => c.p === ja.playerId && c.g === 1));
  b.send({ t: 'cursor', x: 30, y: 30 });
  await a.waitFor((x) => isBatch(x) && (x.cursors ?? []).some((c) => c.p === jb.playerId && c.g === 1));
  const energy = (pid: string) => room.worlds.get(pid)!.players.get(pid)!.energy;
  const ea = energy(ja.playerId);
  const eb = energy(jb.playerId);
  // B が A のカーソルの上を通りすぎる（途中の点は送らない）
  b.send({ t: 'cursor', x: 5, y: 5 });
  const hb = await b.waitFor((x) => isBatch(x) && x.events.some((e) => e.t === 'bump'));
  const ha = await a.waitFor((x) => isBatch(x) && x.events.some((e) => e.t === 'bump'));
  assert.ok(isBatch(hb) && hb.players.some((p) => p.id === jb.playerId && p.energy === eb + GLOW_ENERGY));
  assert.ok(isBatch(ha) && ha.players.some((p) => p.id === ja.playerId && p.energy === ea + GLOW_ENERGY));
  // おたがいの光が消える
  assert.ok(isBatch(hb) && hb.cursors!.some((c) => c.p === ja.playerId && !c.g));
  assert.ok(isBatch(ha) && ha.cursors!.some((c) => c.p === jb.playerId && !c.g));
  // クールダウン中は、もう一度ぶつかっても何もない
  b.send({ t: 'cursor', x: 10, y: 10 });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(energy(ja.playerId), ea + GLOW_ENERGY);
  assert.equal(energy(jb.playerId), eb + GLOW_ENERGY);
  // 15分たつと、また光る
  const cool = (room as unknown as { pairCool: Map<string, number> }).pairCool;
  const [key] = [...cool.keys()];
  assert.ok(cool.get(key!)! - Date.now() > 14 * 60_000);
  cool.set(key!, Date.now());
  await b.waitFor((x) => isBatch(x) && (x.cursors ?? []).some((c) => c.p === ja.playerId && c.g === 1));
  a.close();
  b.close();
  await room.stop();
});

test('光るカーソル: クールダウンは人ごと。A と B がぶつかったあとも、C は A とぶつかれる', async () => {
  const { room, port } = await startRoom();
  const a = new Bot(port);
  const b = new Bot(port);
  const c = new Bot(port);
  const ja = await a.join('Aさん');
  const jb = await b.join('Bさん');
  const jc = await c.join('Cさん');
  const cool = (room as unknown as { pairCool: Map<string, number> }).pairCool;
  const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  cool.set(key(ja.playerId, jb.playerId), Date.now() + 60_000);
  c.send({ t: 'cursor', x: 40, y: 40 });
  a.send({ t: 'cursor', x: 10, y: 10 });
  await c.waitFor((x) => isBatch(x) && (x.cursors ?? []).some((v) => v.p === ja.playerId && v.g === 1));
  const energy = (pid: string) => room.worlds.get(pid)!.players.get(pid)!.energy;
  const eb = energy(jb.playerId);
  const ec = energy(jc.playerId);
  // B は A とクールダウン中なので何もない
  b.send({ t: 'cursor', x: 10, y: 10 });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(energy(jb.playerId), eb);
  // C は A とぶつかれる
  c.send({ t: 'cursor', x: 10, y: 10 });
  await c.waitFor((x) => isBatch(x) && x.events.some((e) => e.t === 'bump'));
  assert.equal(energy(jc.playerId), ec + GLOW_ENERGY);
  a.close();
  b.close();
  c.close();
  await room.stop();
});

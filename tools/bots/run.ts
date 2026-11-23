// ボットで試す: 10人が同時にタップ・マージ・カーソル移動をして、遅れと盤面のずれを調べる。
// 使い方: node tools/bots/run.ts <アドレス> <合言葉> [人数=10] [秒数=30]
//   例: node tools/bots/run.ts ws://localhost:8787 test1234
import {
  PROTOCOL, applyOps, fromJson, maxTierOfKind, tierOfKind, toJson,
} from '../../packages/shared/src/index.ts';
import type { Batch, S2C, World } from '../../packages/shared/src/index.ts';

const [address = 'ws://localhost:8787', password = '', countArg = '10', secArg = '30'] = process.argv.slice(2);
const COUNT = Number(countArg);
const SECONDS = Number(secArg);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Stats = { sent: number; acks: number; rejects: Record<string, number>; lat: number[] };

class Bot {
  ws: WebSocket;
  world!: World;
  me = '';
  s = 0;
  sentAt = new Map<number, number>();
  stats: Stats = { sent: 0, acks: 0, rejects: {}, lat: [] };
  ready: Promise<void>;
  private resolveReady!: () => void;
  resyncs = 0;

  name: string;

  constructor(name: string) {
    this.name = name;
    this.ready = new Promise((r) => (this.resolveReady = r));
    this.ws = new WebSocket(address);
    this.ws.onopen = () => this.raw({ t: 'hello', protocol: PROTOCOL });
    this.ws.onmessage = (e) => this.on(JSON.parse(String(e.data)) as S2C);
    this.ws.onerror = () => console.log(`${name}: 通信エラー`);
  }

  raw(m: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  act(a: unknown) {
    const s = ++this.s;
    this.sentAt.set(s, performance.now());
    this.stats.sent++;
    this.raw({ t: 'act', s, a });
  }

  on(m: S2C) {
    if (m.t === 'server') this.raw({ t: 'join', name: this.name, password });
    else if (m.t === 'denied') console.log(`${this.name}: 断られた ${m.text}`);
    else if (m.t === 'joined') this.me = m.playerId;
    else if (m.t === 'welcome') {
      this.world = fromJson(m.world);
      this.resolveReady();
    } else if (m.t === 'batch') this.batch(m);
  }

  batch(b: Batch) {
    if (!this.world) throw new Error(`${this.name}: 盤面より先に差分が届いた`);
    if (b.rev0 !== this.world.rev) {
      this.resyncs++;
      this.raw({ t: 'resync' });
      return;
    }
    applyOps(this.world, b.ops, Date.now());
    this.world.rev = b.rev;
    for (const p of b.players) this.world.players.set(p.id, p);
    const now = performance.now();
    for (const s of b.acks ?? []) {
      this.stats.acks++;
      const t = this.sentAt.get(s);
      if (t !== undefined) this.stats.lat.push(now - t);
      this.sentAt.delete(s);
    }
    for (const r of b.rejects ?? []) {
      this.stats.rejects[r.reason] = (this.stats.rejects[r.reason] ?? 0) + 1;
      this.sentAt.delete(r.s);
    }
  }

  /** 1手: 同じアイテムが2つあれば重ねる。なければ発生器をタップ */
  step() {
    const w = this.world;
    const mine = [...w.items.values()].filter((i) => !i.dusty && !i.owner && !w.holds.has(i.id));
    const byKind = new Map<number, number[]>();
    for (const it of mine) {
      if (tierOfKind(it.kind) >= maxTierOfKind(it.kind)) continue;
      const list = byKind.get(it.kind) ?? [];
      list.push(it.id);
      byKind.set(it.kind, list);
    }
    const pairs = [...byKind.values()].filter((l) => l.length >= 2);
    if (pairs.length && Math.random() < 0.6) {
      const [a, b] = pairs[Math.floor(Math.random() * pairs.length)]!;
      const target = w.items.get(b!)!;
      this.act({ t: 'grab', item: a });
      this.act({ t: 'drop', item: a, cell: target.cell });
    } else {
      const gen = [...w.items.values()].find((i) => i.owner === this.me);
      if (gen) this.act({ t: 'tap', gen: gen.id });
    }
    this.raw({ t: 'cursor', x: 40 + Math.random() * 20, y: 40 + Math.random() * 20 });
  }
}

console.log(`${address} に ${COUNT} 人で ${SECONDS} 秒つなぎます`);
const bots = Array.from({ length: COUNT }, (_, i) => new Bot(`ボット${i + 1}`));
await Promise.race([Promise.all(bots.map((b) => b.ready)), wait(10_000)]);
const joined = bots.filter((b) => b.world);
console.log(`参加できた: ${joined.length}/${COUNT}`);

const end = Date.now() + SECONDS * 1000;
await Promise.all(
  joined.map(async (b) => {
    while (Date.now() < end) {
      b.step();
      await wait(250 + Math.random() * 500);
    }
  }),
);
await wait(1500);

const lat = joined.flatMap((b) => b.stats.lat).sort((a, b) => a - b);
const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]!.toFixed(0) : '-');
const rejects: Record<string, number> = {};
for (const b of joined) for (const [k, v] of Object.entries(b.stats.rejects)) rejects[k] = (rejects[k] ?? 0) + v;
const sent = joined.reduce((s, b) => s + b.stats.sent, 0);
const acks = joined.reduce((s, b) => s + b.stats.acks, 0);
console.log(`操作: ${sent} 回送って ${acks} 回確定（${((acks / (SECONDS || 1))).toFixed(1)} 回/秒）`);
console.log(`確定までの時間(ms): 中央 ${pct(0.5)} / 95% ${pct(0.95)} / 最大 ${pct(0.999)}`);
console.log(`断られた理由: ${JSON.stringify(rejects)}`);
console.log(`取り直し(resync): ${joined.reduce((s, b) => s + b.resyncs, 0)} 回`);

// 全員の手元の盤面が同じか
const sig = (w: World) => JSON.stringify(toJson(w).items.sort((a, b) => a.id - b.id)) + w.rev;
const first = sig(joined[0]!.world);
const same = joined.every((b) => sig(b.world) === first);
console.log(same ? '全員の盤面が一致しました' : '★ 盤面がずれています');
for (const b of bots) b.ws.close();
process.exit(same ? 0 : 1);

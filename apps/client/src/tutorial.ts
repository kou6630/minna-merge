// チュートリアル: 遊び方を、レイナが1つずつ教える（だれでも、そのブラウザで1回）。
// あいさつ → パン窯をタップ → 合体 → 注文に渡す → シャッター → 倉庫 の順。
// 画面を少し暗くして、やる所だけ明るくする。操作はふさがない（どこを押しても遊べる）。
import { BLOCK, BLOCKS_X, STORY_ASSET_V, cellAt, chainOfKind, waitingShutters, isGeneratorKind, isGiftKind, maxTierOfKind, tierOfKind } from '@minna/shared';
import type { Item, Player, World } from '@minna/shared';
import type { Board } from './board.ts';
import { matchOrders } from './order-match.ts';

type State = { world: World; player: Player | undefined; now: number };
type Rect = { x: number; y: number; w: number; h: number };

// 2: 全員にもう一度出す版（前の版を終えた人にも出す）
const doneKey = (id: string) => `minna-merge:tutorial2:${id}`;

function isDone(id: string): boolean {
  try {
    return localStorage.getItem(doneKey(id)) === '1';
  } catch {
    return false;
  }
}

export class Tutorial {
  private root = document.createElement('div');
  private svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private hand = document.createElement('div');
  private bubble = document.createElement('div');
  private text = document.createElement('p');
  private timer = 0;
  private finished = false;
  /** intro: あいさつ / play: 実際にやる（タップ・合体・渡す） / cheer・shutter・storage: 説明して「次へ」 */
  private phase: 'intro' | 'play' | 'cheer' | 'shutter' | 'storage' = 'intro';
  private next = document.createElement('button');
  /** 1回でも合体を教えたか（そのあとは「くり返そう」と言う） */
  private merged = false;
  /** 合体を教えるときの手の動き（つかむ所 → 重ねる所） */
  private drag: { a: Rect; b: Rect } | null = null;
  private t0 = performance.now();

  constructor(
    private board: Board,
    private state: () => State,
  ) {
    const p = state().player;
    // そのブラウザで、まだ見ていない人
    if (!p || isDone(p.id)) return;
    this.root.className = 'tut';
    this.svg.setAttribute('class', 'tut-dim');
    this.hand.className = 'tut-hand';
    this.hand.textContent = '👆';
    this.bubble.className = 'tut-bubble';
    const face = document.createElement('img');
    face.src = `assets/story/reina_smile.png?v=${STORY_ASSET_V}`;
    face.alt = 'レイナ';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'tut-skip';
    skip.textContent = 'スキップ';
    skip.onclick = () => this.finish();
    this.next.type = 'button';
    this.next.className = 'btn btn-small tut-next';
    this.next.onclick = () => this.advance();
    const body = document.createElement('div');
    body.className = 'tut-body';
    const who = document.createElement('b');
    who.textContent = 'レイナ';
    body.append(who, this.text, this.next);
    this.bubble.append(face, body, skip);
    this.root.append(this.svg, this.hand, this.bubble);
    document.body.appendChild(this.root);
    this.timer = window.setInterval(() => this.update(), 200);
    const loop = () => {
      if (this.finished) return;
      this.moveHand();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this.update();
  }

  /** 自分の注文が1つ終わった */
  orderDone() {
    if (this.finished || !this.timer || this.phase !== 'play') return;
    this.phase = 'cheer';
    this.update();
  }

  /** 「次へ」 */
  private advance() {
    if (this.phase === 'intro') this.phase = 'play';
    else if (this.phase === 'cheer') this.phase = 'shutter';
    else if (this.phase === 'shutter') this.phase = 'storage';
    else return this.finish();
    this.update();
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    clearInterval(this.timer);
    const p = this.state().player;
    if (p) {
      try {
        localStorage.setItem(doneKey(p.id), '1');
      } catch {
        /* 保存できない環境 */
      }
    }
    this.root.remove();
  }

  /** 盤面のマスの、画面での四角 */
  private cellRect(cell: number): Rect {
    const c = this.board.cellToClient(cell);
    const r = this.board.cellToClient(cell + 1);
    const s = Math.max(24, Math.abs(r.x - c.x));
    return { x: c.x - s / 2, y: c.y - s / 2, w: s, h: s };
  }

  private update() {
    if (this.finished) return;
    const { world, player: p, now } = this.state();
    if (!p) return;
    // ストーリーやほかの画面を開いているときは隠す
    const busy = document.getElementById('storyView')?.hidden === false || !!document.querySelector('.modal:not([hidden])');
    this.root.hidden = busy;
    if (busy) return;
    this.next.hidden = this.phase === 'play';
    this.next.textContent = this.phase === 'storage' ? 'はじめる！' : '次へ';
    this.drag = null;
    if (this.phase === 'intro') {
      this.say('ようこそ、みんなの商店街へ！わたしはレイナ。ここでの遊び方を教えるね');
      this.spot([]);
      return this.point(null);
    }
    if (this.phase === 'cheer') {
      this.say('やったね！注文を渡すと、コインと経験値がもらえるよ');
      const r = document.querySelector('.pill:has(img[src*="coin"])')?.getBoundingClientRect();
      this.spot(r ? [{ x: r.left, y: r.top, w: r.width, h: r.height }] : []);
      return this.point(null);
    }
    if (this.phase === 'shutter') {
      // いちばん近い、今進んでいるシャッター
      const waiting = waitingShutters(world.worldOrders);
      const o = world.worldOrders.filter((x) => !waiting.has(x.id)).sort((a, b) => a.block - b.block).pop() ?? world.worldOrders[0];
      this.say('シャッターに描いてあるアイテムを注文でお客さんに渡すと、シャッターの数が進むよ。そろうと、みんなで新しい区画が開けられるよ！');
      if (o) {
        const x0 = (o.block % BLOCKS_X) * BLOCK; const y0 = Math.floor(o.block / BLOCKS_X) * BLOCK;
        const a = this.cellRect(cellAt(x0, y0)); const b = this.cellRect(cellAt(x0 + BLOCK - 1, y0 + BLOCK - 1));
        const r = { x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y };
        this.spot([r]);
      } else this.spot([]);
      return this.point(null);
    }
    if (this.phase === 'storage') {
      this.say('盤面がいっぱいになったら、アイテムを倉庫にしまっておけるよ。倉庫からはドラッグで出せるよ。さあ、はじめよう！');
      const r = document.getElementById('storageBtn')?.getBoundingClientRect();
      const rr = r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
      this.spot(rr ? [rr] : []);
      return this.point(rr);
    }

    // 3. 注文に出せる物がそろった → 注文カード
    const m = matchOrders(p, world, now);
    const ready = p.orders.find((o) => (m.ready.get(o.id) ?? []).length && m.ready.get(o.id)!.every(Boolean));
    if (ready) {
      const card = document.querySelector(`[data-order="${ready.id}"]`) as HTMLElement | null;
      const r = card?.getBoundingClientRect();
      this.say('できた！お客さんの注文のところまで運んでね。「完了」を押してもOKだよ');
      this.spot(r ? [{ x: r.left, y: r.top, w: r.width, h: r.height }] : []);
      this.point(r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null);
      return;
    }

    // 2. 同じ物が2つある → 重ねて合体
    const pair = this.findPair(world);
    if (pair) {
      const a = this.cellRect(pair[0].cell);
      const b = this.cellRect(pair[1].cell);
      this.say('同じものを重ねると合体するよ！片方をつかんで、もう片方の上で離してね');
      this.spot([a, b]);
      this.drag = { a, b };
      this.merged = true;
      this.hand.hidden = false;
      return;
    }

    // 1. 発生器をタップ（パン窯があればパン窯）
    const gens = [...world.items.values()].filter((i) => i.owner === p.id && isGeneratorKind(i.kind) && tierOfKind(i.kind) >= 3);
    const gen = gens.find((i) => chainOfKind(i.kind).key === 'oven') ?? gens[0];
    if (gen) {
      const r = this.cellRect(gen.cell);
      this.say(this.merged
        ? '注文に描いてあるアイテムができるまで、タップと合体をくり返そう！'
        : chainOfKind(gen.kind).key === 'oven' ? 'まずはパン窯をタップしてみて！小麦粉が出てくるよ' : 'まずは発生器をタップしてみて！アイテムが出てくるよ');
      this.spot([r]);
      this.point(r);
    } else {
      this.say('パン窯をタップすると、小麦粉が出てくるよ');
      this.spot([]);
      this.point(null);
    }
  }

  /** 画面に映っている、合体できる同じ物の組（パンを優先） */
  private findPair(world: World): [Item, Item] | null {
    const by = new Map<number, Item[]>();
    for (const it of world.items.values()) {
      if (it.boxed || it.dusty || isGiftKind(it.kind) || isGeneratorKind(it.kind)) continue;
      if (tierOfKind(it.kind) >= maxTierOfKind(it.kind)) continue;
      const q = this.board.cellToClient(it.cell);
      if (q.x < 0 || q.y < 0 || q.x > innerWidth || q.y > innerHeight) continue;
      const list = by.get(it.kind);
      if (list) list.push(it);
      else by.set(it.kind, [it]);
    }
    const pairs = [...by.entries()].filter(([, l]) => l.length >= 2);
    pairs.sort(([a], [b]) => (chainOfKind(a).key === 'bread' ? 0 : 1) - (chainOfKind(b).key === 'bread' ? 0 : 1) || a - b);
    const l = pairs[0]?.[1];
    return l ? [l[0]!, l[1]!] : null;
  }

  private say(t: string) {
    if (this.text.textContent !== t) this.text.textContent = t;
  }

  /** 画面を暗くして、四角の所だけ明るくする */
  private spot(rects: Rect[]) {
    const pad = 6;
    const holes = rects
      .map((r) => `<rect x="${r.x - pad}" y="${r.y - pad}" width="${r.w + pad * 2}" height="${r.h + pad * 2}" rx="14" fill="black"/>`)
      .join('');
    const html = `<defs><mask id="tutMask"><rect x="0" y="0" width="100%" height="100%" fill="white"/>${holes}</mask></defs>`
      + `<rect x="0" y="0" width="100%" height="100%" fill="rgba(20,12,6,0.45)" mask="url(#tutMask)"/>`
      + rects.map((r) => `<rect class="tut-ring" x="${r.x - pad}" y="${r.y - pad}" width="${r.w + pad * 2}" height="${r.h + pad * 2}" rx="14"/>`).join('');
    if (this.svg.innerHTML !== html) this.svg.innerHTML = html;
  }

  /** 手で1か所を指す */
  private point(r: Rect | null) {
    this.hand.hidden = !r;
    if (!r) return;
    this.hand.style.left = `${r.x + r.w * 0.6}px`;
    this.hand.style.top = `${r.y + r.h * 0.6}px`;
  }

  /** 合体を教えるときは、手を片方からもう片方へ動かす */
  private moveHand() {
    const d = this.drag;
    if (!d || this.root.hidden) return;
    const k = ((performance.now() - this.t0) % 1600) / 1600;
    // 0〜0.15 つかむ / 〜0.75 運ぶ / 〜1 離して待つ
    const u = k < 0.15 ? 0 : k < 0.75 ? (k - 0.15) / 0.6 : 1;
    const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    const ax = d.a.x + d.a.w * 0.6; const ay = d.a.y + d.a.h * 0.6;
    const bx = d.b.x + d.b.w * 0.6; const by = d.b.y + d.b.h * 0.6;
    this.hand.style.left = `${ax + (bx - ax) * e}px`;
    this.hand.style.top = `${ay + (by - ay) * e}px`;
    this.hand.style.opacity = k > 0.9 ? String(1 - (k - 0.9) * 10) : '1';
  }
}

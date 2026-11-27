// 盤面の描画（PixiJS）。ルールは持たず、ops を受けて見た目を合わせるだけ。
import { Application, Container, Graphics, Sprite, Text, TilingSprite } from 'pixi.js';
import type { Texture, Ticker } from 'pixi.js';
import { BLOCK, BLOCKS_X, GIFTS, H, W, cellX, cellY, isGeneratorKind, isGiftKind, isWorkingGenerator, maxTierOfKind, tierOfKind, waitingShutters } from '@minna/shared';
import type { CursorInfo, GameEvent, Item, Op, World, WorldOrder } from '@minna/shared';
import { Tweens, ease } from './tween.ts';

export const CELL = 64;
const ITEM_BOX = 58;
const DRAG_SCALE = 1.15;
const FONT = "'M PLUS Rounded 1c', 'Yu Gothic UI', sans-serif";

/** プレイヤーごとの色 */
export function playerColor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  // HSL(hue, 70%, 50%) → RGB
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const a = 0.7 * Math.min(0.5, 0.5);
    return Math.round(255 * (0.5 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

type Cursor = { c: Container; x: number; y: number; tx: number; ty: number; d?: number; halo: Graphics; glow: boolean; name: Text; pill: Graphics; color: number };

export type TexBank = {
  item(kind: number): Texture;
  ground: Texture;
  shutter: Texture;
  boxClosed: Texture;
  boxOpen: Texture;
  boxFront: Texture;
  /** 最大レベルのアイテムの右下に付けるピンクの星 */
  maxStar: Texture;
  gift50: Texture;
  owner(key: string): Texture | null;
};

/** box: 半開きの箱（奥）/ 閉じた箱。front: 半開きの箱の手前の面（中のアイテムの前） */
type ItemView = {
  c: Container; s: Sprite; base?: Graphics; dust: Graphics; box: Sprite; front: Sprite; star: Sprite; kind: number;
  /** プレゼント箱: 「50%」の札・紫のキラキラ・消えるかもしれない状態か */
  badge?: Container; sparkle?: Container; risky?: boolean;
  /** 注文に出せる印（右上の緑のチェック） */
  check?: Container;
};

export class Board {
  readonly cam = new Container();
  readonly tweens: Tweens;
  private groundLayer = new Container();
  private itemLayer = new Container();
  private fxLayer = new Container();
  private topLayer = new Container();
  private selGfx = new Graphics();
  private hoverGfx = new Graphics();
  private hoverCell = -1;
  private hoverMerge = false;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private views = new Map<number, ItemView>();
  private blockViews: (Container | null)[] = [];
  private selectedCell = -1;
  private selectedId = 0;
  private signLayer = new Container();
  private cursorLayer = new Container();
  private signs = new Map<number, Container>();
  /** 同じアイテムのシャッターが先なので、順番を待っている看板 */
  private waiting = new Set<number>();
  private cursors = new Map<string, Cursor>();
  /** プレゼント箱の id（震え・キラキラを動かす） */
  private giftIds = new Set<number>();
  /** 注文に出せるアイテムの id */
  private orderChecks = new Set<number>();
  /** タップ直後のドキドキ（id → 強く震える終わりの時刻） */
  private suspenseUntil = new Map<number, number>();
  private stopDragWobble?: () => void;

  constructor(
    private app: Application,
    private tex: TexBank,
    private src: { readonly world: World },
    private me: string,
  ) {
    this.tweens = new Tweens(app.ticker);
    app.stage.addChild(this.cam);
    this.cam.addChild(
      this.groundLayer, this.signLayer, this.selGfx, this.hoverGfx, this.itemLayer, this.fxLayer, this.topLayer,
      this.cursorLayer,
    );
    for (let i = 0; i < BLOCKS_X * BLOCKS_X; i++) this.drawBlock(i);
    for (const it of src.world.items.values()) this.addItem(it);
    this.waiting = waitingShutters(src.world.worldOrders);
    for (const o of src.world.worldOrders) this.drawSign(o);
    app.ticker.add(() => this.tickCursors());
    app.ticker.add(() => this.tickGifts());
  }

  // ---------- 座標 ----------

  cellCenter(cell: number) {
    return { x: cellX(cell) * CELL + CELL / 2, y: cellY(cell) * CELL + CELL / 2 };
  }

  /** 画面座標 → マス（盤面の外なら -1） */
  cellAtScreen(sx: number, sy: number): number {
    const p = this.cam.toLocal({ x: sx, y: sy });
    const x = Math.floor(p.x / CELL);
    const y = Math.floor(p.y / CELL);
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    return y * W + x;
  }

  screenToWorld(sx: number, sy: number) {
    return this.cam.toLocal({ x: sx, y: sy });
  }

  /** マスのまん中の、ページ上の座標（DOM の演出用） */
  cellToClient(cell: number) {
    const p = this.cam.toGlobal(this.cellCenter(cell));
    const r = this.app.canvas.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, size: CELL * this.cam.scale.x };
  }

  // ---------- カメラ ----------

  centerOn(cell: number, scale = this.cam.scale.x) {
    const c = this.cellCenter(cell);
    this.cam.scale.set(scale);
    this.cam.position.set(this.app.screen.width / 2 - c.x * scale, this.app.screen.height / 2 - c.y * scale);
    this.clampCam();
  }

  panBy(dx: number, dy: number) {
    this.cam.x += dx;
    this.cam.y += dy;
    this.clampCam();
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.cam.toLocal({ x: sx, y: sy });
    const s = Math.min(2, Math.max(0.12, this.cam.scale.x * factor));
    this.cam.scale.set(s);
    this.cam.x = sx - before.x * s;
    this.cam.y = sy - before.y * s;
    this.clampCam();
  }

  /** 盤面が画面の外へ行きすぎないようにする */
  private clampCam() {
    const s = this.cam.scale.x;
    const mw = W * CELL * s;
    const mh = H * CELL * s;
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const m = 200;
    this.cam.x = Math.min(m, Math.max(sw - mw - m, this.cam.x));
    this.cam.y = Math.min(m, Math.max(sh - mh - m, this.cam.y));
    if (mw + m * 2 < sw) this.cam.x = (sw - mw) / 2;
    if (mh + m * 2 < sh) this.cam.y = (sh - mh) / 2;
  }

  // ---------- 地面 ----------

  private drawBlock(idx: number) {
    this.blockViews[idx]?.destroy({ children: true });
    const c = new Container();
    c.position.set((idx % BLOCKS_X) * BLOCK * CELL, Math.floor(idx / BLOCKS_X) * BLOCK * CELL);
    const size = BLOCK * CELL;
    if (this.src.world.blocks[idx]) {
      const g = new TilingSprite({ texture: this.tex.ground, width: size, height: size });
      g.tileScale.set(size / this.tex.ground.width);
      c.addChild(g);
      const grid = new Graphics();
      // 市松模様でマスの区切りを分かりやすく
      for (let y = 0; y < BLOCK; y++)
        for (let x = 0; x < BLOCK; x++) if ((x + y) % 2 === 0) grid.rect(x * CELL, y * CELL, CELL, CELL);
      grid.fill({ color: 0x6b4a2e, alpha: 0.07 });
      for (let i = 1; i < BLOCK; i++) {
        grid.moveTo(i * CELL, 0).lineTo(i * CELL, size);
        grid.moveTo(0, i * CELL).lineTo(size, i * CELL);
      }
      grid.stroke({ width: 1.5, color: 0x6b4a2e, alpha: 0.22 });
      c.addChild(grid);
    } else {
      const s = new Sprite(this.tex.shutter);
      s.width = size;
      s.height = size;
      s.tint = 0x9c948c;
      c.addChild(s);
    }
    const frame = new Graphics().rect(0, 0, size, size).stroke({ width: 3, color: 0x4a2f1d, alpha: 0.35 });
    c.addChild(frame);
    c.cullable = true;
    this.groundLayer.addChild(c);
    this.blockViews[idx] = c;
  }

  // ---------- アイテム ----------

  private makeView(it: Item): ItemView {
    const c = new Container();
    c.cullable = true;
    let base: Graphics | undefined;
    // 動く発生器だけ、黄色い丸の台に乗せる（1〜2 段目の部品は、ふつうのアイテムと同じ）
    if (isWorkingGenerator(it.kind)) {
      const mine = it.owner === this.me;
      base = new Graphics()
        .circle(0, 4, CELL * 0.44)
        .fill({ color: mine ? 0xffd34d : 0xb0a8a0, alpha: 0.45 })
        .stroke({ width: 3, color: mine ? 0xe8a400 : 0x777777, alpha: 0.7 });
      c.addChild(base);
    }
    // 半開きのダンボールの、マスの色（少し暗く）
    const dust = new Graphics()
      .roundRect(-CELL / 2 + 2, -CELL / 2 + 2, CELL - 4, CELL - 4, 8)
      .fill({ color: 0x5a4636, alpha: 0.18 });
    c.addChild(dust);
    const box = new Sprite(this.tex.boxOpen);
    box.anchor.set(0.5);
    c.addChild(box);
    const s = new Sprite(this.tex.item(it.kind));
    s.anchor.set(0.5);
    c.addChild(s);
    const front = new Sprite(this.tex.boxFront);
    front.anchor.set(0.5, 0);
    c.addChild(front);
    // 最大レベルの印（右下の小さなピンクの星）
    const star = new Sprite(this.tex.maxStar);
    star.anchor.set(0.5);
    star.scale.set((CELL * 0.3) / Math.max(this.tex.maxStar.width, this.tex.maxStar.height));
    star.position.set(CELL * 0.31, CELL * 0.31);
    c.addChild(star);
    const v: ItemView = { c, s, base, dust, box, front, star, kind: it.kind };
    this.skin(v, it);
    return v;
  }

  private skin(v: ItemView, it: Item) {
    const t = this.tex.item(it.kind);
    v.s.texture = t;
    // 段階が上がるほど少しだけ大きく
    const box = ITEM_BOX * (isGeneratorKind(it.kind) ? 0.95 : 0.86 + tierOfKind(it.kind) * 0.02);
    const k = Math.min(box / t.width, box / t.height);
    v.s.scale.set(k);
    v.s.tint = 0xffffff;
    v.s.alpha = 1;
    v.s.position.set(0, 0);
    v.dust.visible = !!it.dusty || !!it.boxed;
    // ダンボール: 閉じた箱は箱だけ。半開きは、開いた箱の中からアイテムの上半分がのぞく
    const bw = CELL * 0.92;
    if (it.boxed) {
      v.box.texture = this.tex.boxClosed;
      v.box.scale.set(bw / this.tex.boxClosed.width);
      v.box.position.set(0, 0);
      v.box.visible = true;
      v.s.visible = false;
      v.front.visible = false;
    } else if (it.dusty) {
      const ks = bw / this.tex.boxOpen.width;
      v.box.texture = this.tex.boxOpen;
      v.box.scale.set(ks);
      v.box.position.set(0, 4);
      v.box.visible = true;
      v.s.visible = true;
      v.s.scale.set(k * 0.78);
      v.s.position.set(0, -6);
      v.front.scale.set(ks);
      // 手前の面は、開いた箱の絵の下 48% を同じ位置に重ねる
      v.front.position.set(0, 4 + (this.tex.boxOpen.height * 0.52 - this.tex.boxOpen.height / 2) * ks);
      v.front.visible = true;
    } else {
      v.box.visible = false;
      v.s.visible = true;
      v.front.visible = false;
    }
    this.skinGift(v, it);
    // 最大レベルなら星（ダンボールの中は見せない）
    v.star.visible = !it.boxed && !it.dusty && !isGiftKind(it.kind) && tierOfKind(it.kind) >= maxTierOfKind(it.kind);
    v.kind = it.kind;
  }

  private addItem(it: Item, from?: number) {
    const v = this.makeView(it);
    const to = this.cellCenter(it.cell);
    this.views.set(it.id, v);
    if (this.orderChecks.has(it.id)) this.showCheck(v, true, false);
    this.itemLayer.addChild(v.c);
    if (from === undefined) {
      v.c.position.set(to.x, to.y);
      return;
    }
    const f = this.cellCenter(from);
    v.c.scale.set(0.3);
    this.tweens.add(
      380,
      (k) => {
        v.c.x = f.x + (to.x - f.x) * k;
        v.c.y = f.y + (to.y - f.y) * k - Math.sin(Math.PI * k) * CELL * 0.9;
        v.c.scale.set(0.3 + 0.7 * k);
      },
      { ease: ease.outCubic, key: v.c },
    );
  }

  private moveView(id: number, cell: number) {
    const v = this.views.get(id);
    if (!v) return;
    const to = this.cellCenter(cell);
    const fx = v.c.x;
    const fy = v.c.y;
    this.tweens.add(160, (k) => v.c.position.set(fx + (to.x - fx) * k, fy + (to.y - fy) * k), { key: v.c });
  }

  private pop(v: ItemView) {
    this.tweens.add(320, (k) => v.c.scale.set(1.35 - 0.35 * k), { ease: ease.outBack, key: v.c });
  }

  private burst(x: number, y: number, color: number, n = 10) {
    for (let i = 0; i < n; i++) {
      const g = new Graphics().star(0, 0, 5, 7, 3).fill({ color });
      g.position.set(x, y);
      this.fxLayer.addChild(g);
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const d = CELL * (0.6 + Math.random() * 0.4);
      this.tweens.add(
        480,
        (k) => {
          g.position.set(x + Math.cos(a) * d * k, y + Math.sin(a) * d * k);
          g.alpha = 1 - k;
          g.rotation = k * 3;
        },
        { done: () => g.destroy() },
      );
    }
  }

  applyOps(ops: Op[], events: GameEvent[]) {
    let signsChanged = false;
    for (const op of ops) {
      switch (op.t) {
        case 'spawn':
          this.addItem(op.item, op.from);
          break;
        case 'move':
          this.moveView(op.id, op.cell);
          break;
        case 'remove': {
          for (const cur of this.cursors.values()) if (cur.d === op.id) cur.d = undefined;
          const v = this.views.get(op.id);
          if (v) {
            this.tweens.finish(v.c);
            v.c.destroy({ children: true });
            this.views.delete(op.id);
          }
          break;
        }
        case 'update': {
          const v = this.views.get(op.item.id);
          if (!v) break;
          const genChanged = isWorkingGenerator(op.item.kind) !== !!v.base;
          if (genChanged) {
            v.c.destroy({ children: true });
            this.views.delete(op.item.id);
            this.addItem(op.item);
          } else {
            this.skin(v, op.item);
          }
          break;
        }
        case 'block':
          this.drawBlock(op.idx);
          break;
        case 'hold': {
          // ほかの人が持っているアイテムは薄くする
          const v = this.views.get(op.id);
          if (v && op.player !== this.me) v.c.alpha = 0.45;
          break;
        }
        case 'unhold': {
          for (const cur of this.cursors.values()) if (cur.d === op.id) this.releaseRemoteDrag(cur);
          const v = this.views.get(op.id);
          if (v) v.c.alpha = 1;
          break;
        }
        case 'worldOrder':
          this.drawSign(op.order);
          signsChanged = true;
          break;
        case 'worldOrderDone':
          this.signs.get(op.id)?.destroy({ children: true });
          this.signs.delete(op.id);
          signsChanged = true;
          break;
      }
    }
    if (signsChanged) this.refreshWaiting();
    for (const e of events) {
      if (e.t === 'unlock') this.celebrateBlock(e.block);
      if (e.t === 'merge') {
        const v = this.views.get(e.id);
        if (v && !this.reducedMotion.matches) {
          this.pop(v);
          const maxed = tierOfKind(e.kind) === maxTierOfKind(e.kind);
          const color = maxed ? 0xff99bc : 0xffdc79;
          const wave = new Graphics().circle(0, 0, CELL * .47).stroke({ width: 2.5, color });
          if (maxed) {
            wave.circle(0, 0, CELL * .39).stroke({ width: 1.2, color: 0xfff4be });
            for (let i = 0; i < 4; i++) {
              const a = Math.PI * (.25 + i / 2);
              wave.star(Math.cos(a) * CELL * .52, Math.sin(a) * CELL * .52, 4, 5, 1.6).fill(0xfff4be);
            }
          }
          wave.position.copyFrom(v.c.position);
          wave.scale.set(.58);
          this.fxLayer.addChild(wave);
          this.tweens.add(maxed ? 620 : 360, (k) => {
            wave.scale.set(.58 + k * (maxed ? 1.24 : .78));
            wave.alpha = 1 - k * k;
          }, { done: () => wave.destroy() });
          this.burst(v.c.x, v.c.y, color, maxed ? 12 : 7);
        }
      }
    }
    this.drawSelection();
  }

  /** ジェネレーターを弾ませる（タップの手ごたえ） */
  /** 何もしないでいるとき: 画面に映っている同じアイテムの組を、クイックイッと引き寄せ合わせる（絵だけ動かす） */
  hintPair() {
    const w = this.src.world;
    const by = new Map<number, Item[]>();
    for (const it of w.items.values()) {
      if (it.boxed || it.dusty || isGiftKind(it.kind) || tierOfKind(it.kind) >= maxTierOfKind(it.kind)) continue;
      if (!this.views.has(it.id)) continue;
      const q = this.cellToClient(it.cell);
      if (q.x < 0 || q.y < 0 || q.x > innerWidth || q.y > innerHeight) continue;
      if (document.elementFromPoint(q.x, q.y) !== this.app.canvas) continue;
      const list = by.get(it.kind);
      if (list) list.push(it);
      else by.set(it.kind, [it]);
    }
    let best: [Item, Item] | null = null;
    let bd = Infinity;
    for (const list of by.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!; const b = list[j]!;
          const d = Math.hypot(cellX(a.cell) - cellX(b.cell), cellY(a.cell) - cellY(b.cell)) + Math.random() * 0.5;
          if (d < bd) { bd = d; best = [a, b]; }
        }
      }
    }
    if (!best) return;
    const [a, b] = best;
    const pa = this.cellCenter(a.cell); const pb = this.cellCenter(b.cell);
    const len = Math.max(1, Math.hypot(pb.x - pa.x, pb.y - pa.y));
    const dx = (pb.x - pa.x) / len; const dy = (pb.y - pa.y) / len;
    const pull = (id: number, sx: number, sy: number) => {
      const v = this.views.get(id);
      if (!v) return;
      const x0 = 0; const y0 = 0; // ふつうのアイテムの絵は、いつもマスのまん中（0, 0）
      const amp = CELL * 0.12;
      // 2回、相手のほうへ引っぱられて戻る
      this.tweens.add(700, (k) => {
        const o = Math.max(0, Math.sin(k * Math.PI * 4)) * amp;
        v.s.position.set(x0 + sx * o, y0 + sy * o);
      }, { key: v.s, ease: ease.linear, done: () => v.s.position.set(x0, y0) });
    };
    pull(a.id, dx, dy);
    pull(b.id, -dx, -dy);
  }

  bounce(id: number) {
    const v = this.views.get(id);
    if (!v) return;
    this.tweens.add(220, (k) => v.c.scale.set(1 - Math.sin(Math.PI * k) * 0.12, 1 + Math.sin(Math.PI * k) * 0.08), {
      key: v.c,
      ease: ease.linear,
    });
  }

  // ---------- シャッターの依頼（5×5 のシャッター1枚ずつ） ----------

  /** シャッターが進んだり開いたりしたら、「順番待ち」の看板を描き直す */
  private refreshWaiting() {
    const orders = this.src.world.worldOrders;
    const next = waitingShutters(orders);
    const changed = orders.filter((o) => next.has(o.id) !== this.waiting.has(o.id));
    this.waiting = next;
    for (const o of changed) this.drawSign(o);
  }

  /** ほかの人が納品したとき: 看板の絵と数をぴょんとはねさせる */
  pulseSign(orderId: number) {
    const c = this.signs.get(orderId);
    if (!c) return;
    const sp = c.children[1];
    const label = c.children[2];
    if (!sp || !label) return;
    const s0 = sp.scale.x;
    this.tweens.add(360, (k) => {
      // 次の納品で看板が描き直されていたら何もしない
      if (sp.destroyed || label.destroyed) return;
      const b = Math.sin(Math.PI * k);
      sp.scale.set(s0 * (1 + b * 0.18));
      label.scale.set(1 + b * 0.3);
    }, { key: label, ease: ease.linear });
  }

  private drawSign(o: WorldOrder) {
    this.signs.get(o.id)?.destroy({ children: true });
    const size = BLOCK * CELL;
    const c = new Container();
    c.position.set((o.block % BLOCKS_X) * size, Math.floor(o.block / BLOCKS_X) * size);
    // 同じアイテムのシャッターが先に進んでいる: 灰色にして「順番待ち」
    const wait = this.waiting.has(o.id);
    c.addChild(
      new Graphics()
        .roundRect(12, 12, size - 24, size - 24, 28)
        .fill({ color: wait ? 0xe4ddd2 : 0xfff3d0, alpha: wait ? 0.5 : 0.55 })
        .stroke({ width: 8, color: wait ? 0xa99d8c : 0xffc531 }),
    );
    const n = o.needs[0]!;
    const t = this.tex.item(n.kind);
    const sp = new Sprite(t);
    sp.scale.set(Math.min(150 / t.width, 150 / t.height));
    sp.anchor.set(0.5);
    sp.position.set(size / 2, 128);
    if (wait) sp.alpha = 0.55;
    const label = new Text({
      text: `${n.have}/${n.count}`,
      style: { fontFamily: FONT, fontSize: 50, fontWeight: '800', fill: 0x4a2f1d, stroke: { color: 0xffffff, width: 10 } },
    });
    label.anchor.set(0.5, 0);
    label.position.set(size / 2, 205);
    const hint = new Text({
      text: wait ? '順番待ち' : '注文で納品すると開く',
      style: { fontFamily: FONT, fontSize: 24, fontWeight: '800', fill: 0x4a2f1d, stroke: { color: 0xffffff, width: 6 } },
    });
    hint.anchor.set(0.5, 0);
    hint.position.set(size / 2, 262);
    c.addChild(sp, label, hint);
    this.signLayer.addChild(c);
    this.signs.set(o.id, c);
  }

  private celebrateBlock(idx: number) {
    const size = BLOCK * CELL;
    const cx = (idx % BLOCKS_X) * size + size / 2;
    const cy = Math.floor(idx / BLOCKS_X) * size + size / 2;
    const flash = new Graphics().rect(cx - size / 2, cy - size / 2, size, size).fill({ color: 0xffffff });
    this.fxLayer.addChild(flash);
    this.tweens.add(900, (k) => (flash.alpha = 0.8 * (1 - k)), { done: () => flash.destroy() });
    for (let i = 0; i < 6; i++) {
      setTimeout(() => this.burst(cx + (Math.random() - 0.5) * size * 0.7, cy + (Math.random() - 0.5) * size * 0.7, 0xffd34d, 14), i * 120);
    }
  }

  // ---------- ほかの人のカーソル ----------

  setCursor(info: CursorInfo) {
    if (info.p === this.me) return;
    let cur = this.cursors.get(info.p);
    if (info.gone) {
      if (cur) {
        this.releaseRemoteDrag(cur);
        cur.c.destroy({ children: true });
        this.cursors.delete(info.p);
      }
      return;
    }
    if (!cur) {
      const c = new Container();
      const color = playerColor(info.p);
      // 光っているときの輪（ぶつかるとスタミナ）
      const halo = new Graphics()
        .circle(0, 0, 30).fill({ color: 0xffe066, alpha: 0.28 })
        .circle(0, 0, 19).fill({ color: 0xfff6b0, alpha: 0.55 })
        .circle(0, 0, 30).stroke({ width: 3, color: 0xffc21a, alpha: 0.95 });
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        halo.star(Math.cos(a) * 40, Math.sin(a) * 40, 4, 6, 2.5).fill(0xfff3a0);
      }
      halo.position.set(6, 12);
      halo.visible = false;
      c.addChild(halo);
      c.addChild(
        new Graphics().poly([0, 0, 0, 22, 6, 17, 10, 26, 14, 24, 10, 15, 17, 15]).fill(color).stroke({ width: 2, color: 0xffffff }),
      );
      const name = new Text({
        text: this.src.world.players.get(info.p)?.name ?? '?',
        style: { fontFamily: FONT, fontSize: 13, fontWeight: '800', fill: 0xffffff },
      });
      name.position.set(18, 18);
      const pill = new Graphics().roundRect(14, 16, name.width + 8, name.height + 4, 8).fill(color);
      c.addChild(pill, name);
      this.cursorLayer.addChild(c);
      cur = { c, x: info.x * CELL, y: info.y * CELL, tx: info.x * CELL, ty: info.y * CELL, halo, glow: false, name, pill, color };
      this.cursors.set(info.p, cur);
    }
    // 名前があとから分かったら（はじめは「?」）、書き直す
    const nm = this.src.world.players.get(info.p)?.name;
    if (nm && cur.name.text !== nm) {
      cur.name.text = nm;
      cur.pill.clear().roundRect(14, 16, cur.name.width + 8, cur.name.height + 4, 8).fill(cur.color);
    }
    cur.tx = info.x * CELL;
    cur.ty = info.y * CELL;
    cur.glow = !!info.g;
    cur.halo.visible = cur.glow;
    if (cur.d !== info.d) {
      this.releaseRemoteDrag(cur);
      if (info.d !== undefined) {
        const v = this.views.get(info.d);
        if (v) {
          this.tweens.finish(v.c);
          this.topLayer.addChild(v.c);
          v.c.alpha = 0.85;
          cur.d = info.d;
        }
      }
    }
  }

  /** ほかの人の名前が届いたら、止まっているカーソルの名前も書き直す */
  refreshCursorNames() {
    for (const [pid, cur] of this.cursors) {
      const nm = this.src.world.players.get(pid)?.name;
      if (!nm || cur.name.text === nm) continue;
      cur.name.text = nm;
      cur.pill.clear().roundRect(14, 16, cur.name.width + 8, cur.name.height + 4, 8).fill(cur.color);
    }
  }

  private releaseRemoteDrag(cur: Cursor) {
    if (cur.d === undefined) return;
    const id = cur.d;
    cur.d = undefined;
    const v = this.views.get(id);
    const it = this.src.world.items.get(id);
    if (!v || !it) return;
    this.itemLayer.addChild(v.c);
    const h = this.src.world.holds.get(id);
    v.c.alpha = h && h.player !== this.me ? 0.45 : 1;
    this.moveView(id, it.cell);
  }

  private tickCursors() {
    const inv = 1 / this.cam.scale.x;
    const t = performance.now() / 1000;
    for (const cur of this.cursors.values()) {
      if (cur.glow) {
        cur.halo.scale.set(1 + 0.14 * Math.sin(t * 6));
        cur.halo.rotation = t * 1.2;
        cur.halo.alpha = 0.75 + 0.25 * Math.sin(t * 6);
      }
      cur.x += (cur.tx - cur.x) * 0.35;
      cur.y += (cur.ty - cur.y) * 0.35;
      cur.c.position.set(cur.x, cur.y);
      cur.c.scale.set(inv);
      if (cur.d !== undefined) {
        const v = this.views.get(cur.d);
        if (v) v.c.position.set(cur.x, cur.y - 10);
        else cur.d = undefined;
      }
    }
  }

  /** ミニマップ用: ほかの人のカーソル（マス単位） */
  cursorList() {
    return [...this.cursors.entries()].map(([p, c]) => ({ p, x: c.tx / CELL, y: c.ty / CELL, glow: c.glow }));
  }

  /** そのカーソルが光っているか */
  isGlowing(p: string) {
    return !!this.cursors.get(p)?.glow;
  }

  /** 光るカーソルにぶつかったときの演出: 白い閃光・衝撃波の輪・集中線・星の大爆発（大きさは画面の見た目でそろえる） */
  bumpFx(p: string) {
    const cur = this.cursors.get(p);
    if (!cur) return;
    const x = cur.x + 6 / this.cam.scale.x;
    const y = cur.y + 12 / this.cam.scale.x;
    const u = 1 / this.cam.scale.x; // 画面の 1px
    // 閃光
    const flash = new Graphics().circle(0, 0, 60).fill({ color: 0xffffff });
    flash.position.set(x, y);
    this.fxLayer.addChild(flash);
    this.tweens.add(260, (k) => { flash.scale.set(u * (0.4 + 1.6 * k)); flash.alpha = 1 - k; }, { done: () => flash.destroy() });
    // 衝撃波（3重の輪）
    for (let i = 0; i < 3; i++) {
      const ring = new Graphics().circle(0, 0, 100).stroke({ width: 10 - i * 3, color: i === 1 ? 0xffffff : 0xffc21a });
      ring.position.set(x, y);
      ring.alpha = 0;
      this.fxLayer.addChild(ring);
      setTimeout(() => {
        this.tweens.add(520, (k) => { ring.scale.set(u * (0.15 + 1.9 * ease.outCubic(k))); ring.alpha = 1 - k; }, { done: () => ring.destroy() });
      }, i * 90);
    }
    // 集中線（外へ飛ぶ細い光）
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI * 2 * i) / 16 + Math.random() * 0.2;
      const line = new Graphics().rect(0, -2.5, 70 + Math.random() * 50, 5).fill({ color: i % 2 ? 0xffffff : 0xffe066 });
      line.position.set(x, y);
      line.rotation = a;
      this.fxLayer.addChild(line);
      this.tweens.add(420, (k) => {
        const d = (30 + 170 * ease.outCubic(k)) * u;
        line.position.set(x + Math.cos(a) * d, y + Math.sin(a) * d);
        line.scale.set(u * (1 - k * 0.7), u);
        line.alpha = 1 - k;
      }, { done: () => line.destroy() });
    }
    // 星の大爆発
    for (let i = 0; i < 22; i++) {
      const g = new Graphics().star(0, 0, 5, 12, 5).fill({ color: [0xffd34d, 0xffffff, 0xff9f1a][i % 3]! });
      g.position.set(x, y);
      this.fxLayer.addChild(g);
      const a = Math.random() * Math.PI * 2;
      const d = (90 + Math.random() * 130) * u;
      const s = 0.6 + Math.random() * 0.9;
      this.tweens.add(700 + Math.random() * 300, (k) => {
        const e = ease.outCubic(k);
        g.position.set(x + Math.cos(a) * d * e, y + Math.sin(a) * d * e + 40 * u * k * k);
        g.scale.set(u * s * (1 - k * 0.6));
        g.rotation = k * 6;
        g.alpha = 1 - k * k;
      }, { done: () => g.destroy() });
    }
    this.shake(14);
  }

  /** プレゼント箱: 保証の回数を使い切ったら「50%」の札を出して震わせる。紫はいつもキラキラ */
  private skinGift(v: ItemView, it: Item) {
    const gift = isGiftKind(it.kind) && !it.boxed && !it.dusty;
    if (!gift) {
      this.giftIds.delete(it.id);
      if (v.badge) v.badge.visible = false;
      if (v.sparkle) v.sparkle.visible = false;
      v.risky = false;
      v.s.rotation = 0;
      return;
    }
    this.giftIds.add(it.id);
    const tier = tierOfKind(it.kind);
    v.risky = (it.taps ?? 0) >= GIFTS[tier - 1]!.safe;
    if (v.risky && !v.badge) {
      // ひびの入った「50%」の札（今にも割れそう）
      const b = new Container();
      const s = new Sprite(this.tex.gift50);
      s.anchor.set(0.5);
      s.scale.set((CELL * 0.62) / Math.max(1, this.tex.gift50.width));
      b.addChild(s);
      b.position.set(0, CELL * 0.33);
      v.c.addChild(b);
      v.badge = b;
    }
    if (v.badge) v.badge.visible = v.risky;
    if (tier === 4 && !v.sparkle) {
      const sp = new Container();
      const spots = [[-24, -22], [24, -18], [-20, 20], [26, 16], [0, -30]];
      for (const [x, y] of spots) {
        const g = new Graphics().star(0, 0, 4, 6, 2).fill(0xfff3a0).star(0, 0, 4, 3, 1).fill(0xffffff);
        g.position.set(x!, y!);
        sp.addChild(g);
      }
      v.c.addChild(sp);
      v.sparkle = sp;
    }
    if (v.sparkle) v.sparkle.visible = tier === 4;
  }

  /** 完了ボタンで納品したアイテムの所に、きらっと光る演出 */
  deliverFx(cell: number) {
    const { x, y } = this.cellCenter(cell);
    const ring = new Graphics().circle(0, 0, CELL * 0.45).stroke({ width: 5, color: 0x7dff7d });
    ring.position.set(x, y);
    this.fxLayer.addChild(ring);
    this.tweens.add(380, (k) => { ring.scale.set(0.4 + 1.2 * k); ring.alpha = 1 - k; }, { ease: ease.outCubic, done: () => ring.destroy() });
    this.burst(x, y, 0x2fb344, 8);
    this.burst(x, y, 0xffd34d, 6);
  }

  /** 注文に出せるアイテム（右上に緑のチェックを付ける） */
  setOrderChecks(ids: Set<number>) {
    for (const id of this.orderChecks) if (!ids.has(id)) { const v = this.views.get(id); if (v) this.showCheck(v, false, false); }
    for (const id of ids) if (!this.orderChecks.has(id)) { const v = this.views.get(id); if (v) this.showCheck(v, true, true); }
    this.orderChecks = ids;
  }

  private showCheck(v: ItemView, on: boolean, pop: boolean) {
    if (on && !v.check) {
      const r = CELL * 0.14;
      const g = new Graphics()
        .circle(0, 0, r).fill(0x2fb344).stroke({ width: 2.5, color: 0xffffff })
        .moveTo(-r * 0.45, r * 0.02).lineTo(-r * 0.1, r * 0.38).lineTo(r * 0.48, -r * 0.34)
        .stroke({ width: r * 0.3, color: 0xffffff, cap: 'round', join: 'round' });
      g.position.set(CELL * 0.31, -CELL * 0.31);
      v.c.addChild(g);
      v.check = g;
    }
    if (!v.check) return;
    v.check.visible = on;
    if (on && pop) {
      const c = v.check;
      this.tweens.add(260, (k) => c.scale.set(k), { ease: ease.outBack, key: c });
    } else {
      v.check.scale.set(1);
    }
  }

  /** タップしてから結果が出るまで、強く震わせる（ドキドキ） */
  suspense(id: number, ms: number) {
    this.suspenseUntil.set(id, performance.now() + ms);
  }

  private tickGifts() {
    const now = performance.now();
    const t = now / 1000;
    for (const id of this.giftIds) {
      const v = this.views.get(id);
      if (!v) { this.giftIds.delete(id); continue; }
      const hard = (this.suspenseUntil.get(id) ?? 0) > now;
      if (hard || v.risky) {
        // 小刻みに震え、ときどき大きく揺れる。タップ直後はもっと強く
        const amp = hard ? 0.2 : 0.04 + 0.08 * Math.max(0, Math.sin(t * 2.4)) ** 4;
        v.s.rotation = Math.sin(t * (hard ? 64 : 40)) * amp;
        v.s.x = hard ? Math.sin(t * 83) * 3 : 0;
      } else if (v.s.rotation) {
        v.s.rotation = 0;
      }
      if (v.badge?.visible) {
        // 札もドキドキ: ふくらんでカタカタ揺れる。タップ直後は激しく
        v.badge.scale.set(1 + (hard ? 0.18 : 0.1) * Math.max(0, Math.sin(t * (hard ? 14 : 5))));
        v.badge.rotation = Math.sin(t * (hard ? 71 : 23)) * (hard ? 0.16 : 0.05);
      }
      if (v.sparkle?.visible) {
        v.sparkle.children.forEach((g, i) => {
          const k = Math.max(0, Math.sin(t * 3 + i * 1.7));
          g.alpha = k;
          g.scale.set(0.5 + 0.8 * k);
          g.rotation = t * 2 + i;
        });
      }
    }
  }

  /** プレゼント箱を開けたときの演出（光の輪と紙ふぶき） */
  giftFx(cell: number, kind: number) {
    const { x, y } = this.cellCenter(cell);
    const color = [0xffffff, 0x4aa8ff, 0xff4a5a, 0xb35cff][tierOfKind(kind) - 1] ?? 0xffd34d;
    const ring = new Graphics().circle(0, 0, CELL * 0.5).stroke({ width: 6, color: 0xffe066 });
    ring.position.set(x, y);
    this.fxLayer.addChild(ring);
    this.tweens.add(450, (k) => { ring.scale.set(0.3 + 1.8 * ease.outCubic(k)); ring.alpha = 1 - k; }, { done: () => ring.destroy() });
    this.burst(x, y, 0xffd34d, 12);
    this.burst(x, y, color, 10);
    if (tierOfKind(kind) >= 3) this.shake(tierOfKind(kind) * 2);
  }

  /** 画面を揺らす（だんだん弱く） */
  shake(px: number) {
    const el = this.app.canvas as HTMLCanvasElement;
    const frames: Keyframe[] = [];
    for (let i = 0; i <= 10; i++) {
      const f = px * (1 - i / 10);
      frames.push({ transform: i === 10 ? 'none' : `translate(${(Math.random() * 2 - 1) * f}px, ${(Math.random() * 2 - 1) * f}px) rotate(${(Math.random() * 2 - 1) * f * 0.06}deg)` });
    }
    el.animate(frames, { duration: 450, easing: 'linear' });
  }

  /** ミニマップ用: 今映している範囲（マス単位） */
  viewRect() {
    const a = this.cam.toLocal({ x: 0, y: 0 });
    const b = this.cam.toLocal({ x: this.app.screen.width, y: this.app.screen.height });
    return { x0: a.x / CELL, y0: a.y / CELL, x1: b.x / CELL, y1: b.y / CELL };
  }

  // ---------- ドラッグ ----------

  startDrag(id: number, sx: number, sy: number) {
    this.stopDragWobble?.();
    const v = this.views.get(id);
    if (!v) return;
    this.tweens.finish(v.c);
    this.topLayer.addChild(v.c);
    v.c.scale.set(DRAG_SCALE);
    if (this.reducedMotion.matches) return;

    const start = this.screenToWorld(sx, sy);
    let lastX = start.x;
    let lastY = start.y - 10;
    let tilt = 0, tiltSpeed = 0;
    let stretch = 0, stretchSpeed = 0;
    const tick = ({ deltaMS }: Ticker) => {
      if (v.c.destroyed) { this.stopDragWobble?.(); return; }
      // 画面上の移動速度で横の傾きと縦の伸び縮みを決める。
      const speedFactor = this.cam.scale.x / Math.max(1, deltaMS);
      const targetTilt = .19 * Math.tanh((v.c.x - lastX) * speedFactor);
      const targetStretch = .11 * Math.tanh((v.c.y - lastY) * speedFactor) - .18 * Math.abs(targetTilt);
      lastX = v.c.x;
      lastY = v.c.y;

      // 小さな時間刻みでばねを動かし、切り返しや停止のあとに余韻を残す。
      const dt = Math.min(deltaMS, 64) / 1000;
      const steps = Math.max(1, Math.ceil(dt * 120));
      const step = dt / steps;
      for (let i = 0; i < steps; i++) {
        tiltSpeed += ((targetTilt - tilt) * 660 - tiltSpeed * 14) * step;
        stretchSpeed += ((targetStretch - stretch) * 660 - stretchSpeed * 14) * step;
        tilt += tiltSpeed * step;
        stretch += stretchSpeed * step;
      }
      v.c.rotation = tilt;
      v.c.scale.set(DRAG_SCALE * (1 - stretch), DRAG_SCALE * (1 + stretch));
    };
    this.app.ticker.add(tick);
    this.stopDragWobble = () => {
      this.app.ticker.remove(tick);
      if (!v.c.destroyed) {
        v.c.rotation = 0;
        v.c.scale.set(1);
      }
      this.stopDragWobble = undefined;
    };
  }

  dragTo(id: number, sx: number, sy: number) {
    const v = this.views.get(id);
    if (!v) return;
    const p = this.cam.toLocal({ x: sx, y: sy });
    v.c.position.set(p.x, p.y - 10);
  }

  endDrag(id: number) {
    this.stopDragWobble?.();
    this.hover(-1);
    const v = this.views.get(id);
    if (!v) return;
    this.itemLayer.addChild(v.c);
    v.c.scale.set(1);
  }

  setHidden(id: number, hidden: boolean) {
    const v = this.views.get(id);
    if (v) v.c.visible = !hidden;
  }

  snapBack(id: number) {
    const it = this.src.world.items.get(id);
    if (it) this.moveView(id, it.cell);
  }

  hover(cell: number, good = false) {
    if (cell === this.hoverCell && good === this.hoverMerge) return;
    this.hoverCell = cell;
    this.hoverMerge = good;
    const frame = this.hoverGfx;
    this.tweens.finish(frame);
    frame.clear();
    if (cell < 0) return;
    const { x, y } = this.cellCenter(cell);
    frame.position.set(x, y);
    const edge = CELL / 2 - 3;
    frame.roundRect(-edge, -edge, edge * 2, edge * 2, 10)
      .fill({ color: good ? 0x7dff7d : 0xffffff, alpha: good ? 0.35 : 0.22 })
      .stroke({ width: 3, color: good ? 0x3cbf3c : 0xffffff, alpha: 0.9 });
    if (!good) return;
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) {
        frame.moveTo(side * (edge - 8), end * edge).lineTo(side * edge, end * edge)
          .lineTo(side * edge, end * (edge - 8)).stroke({ width: 3, color: 0xfffabd, cap: 'round', join: 'round' });
      }
    }
    if (this.reducedMotion.matches) return;
    frame.scale.set(1.24);
    this.tweens.add(230, k => frame.scale.set(1 + .24 * (1 - k)), { key: frame, ease: ease.outBack });
  }

  select(cell: number) {
    this.selectedCell = cell;
    // 選んだアイテム（同じマスにあとから別の物が来ても、枠は付けない）
    this.selectedId = cell >= 0 ? this.src.world.cells[cell] ?? 0 : 0;
    this.drawSelection();
  }

  private drawSelection() {
    this.selGfx.clear();
    const cell = this.selectedCell;
    if (cell < 0 || !this.src.world.cells[cell] || this.src.world.cells[cell] !== this.selectedId) return;
    const x = cellX(cell) * CELL;
    const y = cellY(cell) * CELL;
    this.selGfx
      .roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 12)
      .fill({ color: 0xfff1b8, alpha: 0.55 })
      .stroke({ width: 4, color: 0xff8a3d });
  }
}

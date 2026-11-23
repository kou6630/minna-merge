// 盤面の描画（PixiJS）。ルールは持たず、ops を受けて見た目を合わせるだけ。
import { Application, Container, Graphics, Sprite, Text, TilingSprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { BLOCK, BLOCKS_X, H, W, cellX, cellY, isGeneratorKind, tierOfKind } from '@minna/shared';
import type { CursorInfo, GameEvent, Item, Op, World, WorldOrder } from '@minna/shared';
import { Tweens, ease } from './tween.ts';

export const CELL = 64;
const ITEM_BOX = 58;
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

type Cursor = { c: Container; x: number; y: number; tx: number; ty: number; d?: number };

export type TexBank = {
  item(kind: number): Texture;
  ground: Texture;
  shutter: Texture;
  owner(key: string): Texture | null;
};

type ItemView = { c: Container; s: Sprite; base?: Graphics; dust: Graphics; kind: number };

export class Board {
  readonly cam = new Container();
  readonly tweens: Tweens;
  private groundLayer = new Container();
  private itemLayer = new Container();
  private fxLayer = new Container();
  private topLayer = new Container();
  private selGfx = new Graphics();
  private hoverGfx = new Graphics();
  private views = new Map<number, ItemView>();
  private blockViews: (Container | null)[] = [];
  private selectedCell = -1;
  private signLayer = new Container();
  private cursorLayer = new Container();
  private signs = new Map<number, Container>();
  private cursors = new Map<string, Cursor>();

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
    for (const o of src.world.worldOrders) this.drawSign(o);
    app.ticker.add(() => this.tickCursors());
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
    if (isGeneratorKind(it.kind)) {
      const mine = it.owner === this.me;
      base = new Graphics()
        .circle(0, 4, CELL * 0.44)
        .fill({ color: mine ? 0xffd34d : 0xb0a8a0, alpha: 0.45 })
        .stroke({ width: 3, color: mine ? 0xe8a400 : 0x777777, alpha: 0.7 });
      c.addChild(base);
    }
    // ほこり: くすんだ四角の上に、白っぽいもやを重ねる
    const dust = new Graphics()
      .roundRect(-CELL / 2 + 4, -CELL / 2 + 4, CELL - 8, CELL - 8, 10)
      .fill({ color: 0x7a7168, alpha: 0.32 })
      .stroke({ width: 2, color: 0x5a524a, alpha: 0.35, alignment: 1 });
    c.addChild(dust);
    const s = new Sprite(this.tex.item(it.kind));
    s.anchor.set(0.5);
    c.addChild(s);
    const v: ItemView = { c, s, base, dust, kind: it.kind };
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
    v.s.tint = it.dusty ? 0xc2bab2 : 0xffffff;
    v.s.alpha = it.dusty ? 0.75 : 1;
    v.dust.visible = !!it.dusty;
    v.kind = it.kind;
  }

  private addItem(it: Item, from?: number) {
    const v = this.makeView(it);
    const to = this.cellCenter(it.cell);
    this.views.set(it.id, v);
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
          const genChanged = isGeneratorKind(op.item.kind) !== !!v.base;
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
          break;
        case 'worldOrderDone':
          this.signs.get(op.id)?.destroy({ children: true });
          this.signs.delete(op.id);
          break;
      }
    }
    for (const e of events) {
      if (e.t === 'unlock') this.celebrateBlock(e.block);
      if (e.t === 'merge') {
        const v = this.views.get(e.id);
        if (v) {
          this.pop(v);
          this.burst(v.c.x, v.c.y, 0xffe066);
        }
      }
    }
    this.drawSelection();
  }

  /** ジェネレーターを弾ませる（タップの手ごたえ） */
  bounce(id: number) {
    const v = this.views.get(id);
    if (!v) return;
    this.tweens.add(220, (k) => v.c.scale.set(1 - Math.sin(Math.PI * k) * 0.12, 1 + Math.sin(Math.PI * k) * 0.08), {
      key: v.c,
      ease: ease.linear,
    });
  }

  // ---------- みんなの依頼の看板 ----------

  private drawSign(o: WorldOrder) {
    this.signs.get(o.id)?.destroy({ children: true });
    const size = BLOCK * CELL;
    const c = new Container();
    c.position.set((o.block % BLOCKS_X) * size, Math.floor(o.block / BLOCKS_X) * size);
    c.addChild(
      new Graphics()
        .roundRect(14, 14, size - 28, size - 28, 40)
        .fill({ color: 0xfff3d0, alpha: 0.4 })
        .stroke({ width: 12, color: 0xffc531 }),
    );
    const face = this.tex.owner(o.owner);
    if (face) {
      const sp = new Sprite(face);
      sp.scale.set(Math.min(260 / face.width, 230 / face.height));
      sp.anchor.set(0.5, 0);
      sp.position.set(size / 2, 34);
      c.addChild(sp);
    }
    const title = new Text({
      text: 'みんなの依頼',
      style: { fontFamily: FONT, fontSize: 50, fontWeight: '800', fill: 0x4a2f1d, stroke: { color: 0xffffff, width: 12 } },
    });
    title.anchor.set(0.5, 0);
    title.position.set(size / 2, 272);
    c.addChild(title);
    const slotW = 210;
    const x0 = size / 2 - ((o.needs.length - 1) * slotW) / 2;
    o.needs.forEach((n, i) => {
      const t = this.tex.item(n.kind);
      const sp = new Sprite(t);
      sp.scale.set(Math.min(160 / t.width, 160 / t.height));
      sp.anchor.set(0.5);
      sp.position.set(x0 + i * slotW, 440);
      const done = n.have >= n.count;
      if (done) sp.alpha = 0.5;
      const label = new Text({
        text: `${n.have}/${n.count}`,
        style: { fontFamily: FONT, fontSize: 54, fontWeight: '800', fill: done ? 0x2f9e44 : 0x4a2f1d, stroke: { color: 0xffffff, width: 12 } },
      });
      label.anchor.set(0.5, 0);
      label.position.set(x0 + i * slotW, 530);
      c.addChild(sp, label);
    });
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
      cur = { c, x: info.x * CELL, y: info.y * CELL, tx: info.x * CELL, ty: info.y * CELL };
      this.cursors.set(info.p, cur);
    }
    cur.tx = info.x * CELL;
    cur.ty = info.y * CELL;
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
    for (const cur of this.cursors.values()) {
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
    return [...this.cursors.entries()].map(([p, c]) => ({ p, x: c.tx / CELL, y: c.ty / CELL }));
  }

  /** ミニマップ用: 今映している範囲（マス単位） */
  viewRect() {
    const a = this.cam.toLocal({ x: 0, y: 0 });
    const b = this.cam.toLocal({ x: this.app.screen.width, y: this.app.screen.height });
    return { x0: a.x / CELL, y0: a.y / CELL, x1: b.x / CELL, y1: b.y / CELL };
  }

  // ---------- ドラッグ ----------

  startDrag(id: number) {
    const v = this.views.get(id);
    if (!v) return;
    this.tweens.finish(v.c);
    this.topLayer.addChild(v.c);
    v.c.scale.set(1.15);
  }

  dragTo(id: number, sx: number, sy: number) {
    const v = this.views.get(id);
    if (!v) return;
    const p = this.cam.toLocal({ x: sx, y: sy });
    v.c.position.set(p.x, p.y - 10);
  }

  endDrag(id: number) {
    const v = this.views.get(id);
    if (!v) return;
    this.itemLayer.addChild(v.c);
    v.c.scale.set(1);
    this.hover(-1);
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
    this.hoverGfx.clear();
    if (cell < 0) return;
    const x = cellX(cell) * CELL;
    const y = cellY(cell) * CELL;
    this.hoverGfx
      .roundRect(x + 3, y + 3, CELL - 6, CELL - 6, 10)
      .fill({ color: good ? 0x7dff7d : 0xffffff, alpha: good ? 0.35 : 0.22 })
      .stroke({ width: 3, color: good ? 0x3cbf3c : 0xffffff, alpha: 0.9 });
  }

  select(cell: number) {
    this.selectedCell = cell;
    this.drawSelection();
  }

  private drawSelection() {
    this.selGfx.clear();
    const cell = this.selectedCell;
    if (cell < 0 || !this.src.world.cells[cell]) return;
    const x = cellX(cell) * CELL;
    const y = cellY(cell) * CELL;
    this.selGfx
      .roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 12)
      .fill({ color: 0xfff1b8, alpha: 0.55 })
      .stroke({ width: 4, color: 0xff8a3d });
  }
}

// 指・マウスの操作: タップ / ドラッグでアイテム移動 / 何もない所をドラッグで移動 / ピンチ・ホイールで拡大縮小
import { isOpenCell, maxTierOfKind, tierOfKind, worldOrderAtCell } from '@minna/shared';
import { CELL } from './board.ts';
import type { Board } from './board.ts';
import type { Hud } from './hud.ts';
import type { Action } from '@minna/shared';
import type { Conn } from './conn.ts';

type Mode = 'idle' | 'pending' | 'drag' | 'pan' | 'pinch';
const MOVE_PX = 8;

export class Input {
  private pointers = new Map<number, { x: number; y: number }>();
  private mode: Mode = 'idle';
  private start = { x: 0, y: 0, cell: -1, item: 0 };
  private dragId = 0;
  private pinch = { dist: 0, mx: 0, my: 0 };
  private lastKeep = 0;
  private dropEl: HTMLElement | null = null;
  private lastCursor = 0;

  constructor(
    private el: HTMLElement,
    private board: Board,
    private server: Conn,
    private hud: Hud,
  ) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e, false));
    el.addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.board.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private down(e: PointerEvent) {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (this.pointers.size === 1) {
      const cell = this.board.cellAtScreen(e.offsetX, e.offsetY);
      this.start = { x: e.offsetX, y: e.offsetY, cell, item: cell >= 0 ? this.server.world.cells[cell]! : 0 };
      this.mode = 'pending';
    } else if (this.pointers.size === 2) {
      if (this.mode === 'drag') this.cancelDrag();
      this.mode = 'pinch';
      this.pinch = this.measure();
    }
  }

  private measure() {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return { dist: 1, mx: 0, my: 0 };
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  private move(e: PointerEvent) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.offsetX, y: e.offsetY };
    this.pointers.set(e.pointerId, cur);
    this.cursor(cur.x, cur.y, false);

    if (this.mode === 'pending') {
      if (Math.hypot(cur.x - this.start.x, cur.y - this.start.y) < MOVE_PX) return;
      if (this.start.item && this.tryGrab(this.start.item)) {
        this.mode = 'drag';
      } else {
        this.mode = 'pan';
      }
    }
    if (this.mode === 'pan') {
      this.board.panBy(cur.x - prev.x, cur.y - prev.y);
    } else if (this.mode === 'drag') {
      this.board.dragTo(this.dragId, cur.x, cur.y);
      const el = this.domTarget(e.clientX, e.clientY);
      if (el !== this.dropEl) {
        this.dropEl?.classList.remove('drop-hover');
        el?.classList.add('drop-hover');
        this.dropEl = el;
      }
      const cell = el ? -1 : this.board.cellAtScreen(cur.x, cur.y);
      this.board.hover(cell, this.canMergeInto(cell));
      const now = performance.now();
      if (now - this.lastKeep > 3000) {
        this.lastKeep = now;
        this.server.keepHold(this.dragId);
      }
    } else if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const m = this.measure();
      this.board.zoomAt(m.mx, m.my, m.dist / this.pinch.dist);
      this.board.panBy(m.mx - this.pinch.mx, m.my - this.pinch.my);
      this.pinch = m;
    }
  }

  private tryGrab(id: number): boolean {
    const it = this.server.world.items.get(id);
    if (!it || it.dusty) return false;
    if (it.owner && it.owner !== this.server.me) return false;
    if (!this.server.send({ t: 'grab', item: id })) return false;
    this.dragId = id;
    this.board.startDrag(id);
    this.cursor(this.start.x, this.start.y, true);
    this.board.select(-1);
    this.hud.showInfo(null);
    return true;
  }

  private canMergeInto(cell: number): boolean {
    if (cell < 0) return false;
    const w = this.server.world;
    const me = w.items.get(this.dragId);
    const tid = w.cells[cell];
    const t = tid ? w.items.get(tid) : undefined;
    if (!me) return false;
    if (!isOpenCell(w, cell)) {
      const wo = worldOrderAtCell(w, cell);
      return !!wo && wo.needs.some((n) => n.kind === me.kind && n.have < n.count);
    }
    if (!t || t.id === me.id) return false;
    return t.kind === me.kind && tierOfKind(t.kind) < maxTierOfKind(t.kind) && (!t.owner || t.owner === this.server.me);
  }

  private up(e: PointerEvent, cancelled: boolean) {
    this.pointers.delete(e.pointerId);
    const p = { x: e.offsetX, y: e.offsetY };
    if (this.mode === 'pending' && !cancelled) {
      this.click(this.start.cell);
    } else if (this.mode === 'drag') {
      if (cancelled) this.cancelDrag();
      else this.drop(p.x, p.y, this.domTarget(e.clientX, e.clientY));
      this.dropEl?.classList.remove('drop-hover');
      this.dropEl = null;
    }
    if (this.mode === 'pinch' && this.pointers.size === 1) {
      this.mode = 'pan'; // 残った指でそのまま動かせる
      return;
    }
    if (this.pointers.size === 0) this.mode = 'idle';
  }

  private click(cell: number) {
    const w = this.server.world;
    const id = cell >= 0 ? w.cells[cell] : 0;
    const it = id ? w.items.get(id) : undefined;
    if (!it) {
      this.board.select(-1);
      this.hud.showInfo(null);
      return;
    }
    if (it.owner === this.server.me && this.server.send({ t: 'tap', gen: it.id })) {
      this.board.bounce(it.id);
    }
    this.board.select(cell);
    this.hud.showInfo(w.items.get(it.id) ?? null);
  }

  /** 自分のカーソルを送る（10回/秒まで。force なら今すぐ） */
  private cursor(sx: number, sy: number, force: boolean) {
    const now = performance.now();
    if (!force && now - this.lastCursor < 100) return;
    this.lastCursor = now;
    const p = this.board.screenToWorld(sx, sy);
    this.server.sendCursor(p.x / CELL, p.y / CELL, this.dragId || undefined);
  }

  /** 注文カードや倉庫の上か */
  private domTarget(x: number, y: number): HTMLElement | null {
    const el = document.elementFromPoint(x, y);
    return (el?.closest('[data-drop]') as HTMLElement | null) ?? null;
  }

  private drop(sx: number, sy: number, target: HTMLElement | null) {
    const id = this.dragId;
    this.dragId = 0;
    this.board.endDrag(id);
    this.cursor(sx, sy, true); // ドラッグ終わりを知らせる
    const cell0 = target ? -1 : this.board.cellAtScreen(sx, sy);
    const w0 = this.server.world;
    const wo = cell0 >= 0 && !isOpenCell(w0, cell0) ? worldOrderAtCell(w0, cell0) : undefined;
    if (wo) {
      // シャッターの「みんなの依頼」に納品。断られたら onReject で元に戻す
      this.board.setHidden(id, true);
      this.server.send({ t: 'contribute', order: wo.id, item: id });
      return;
    }
    if (target) {
      // 注文に納品 / 倉庫に入れる。断られたら onReject で元に戻す
      this.board.setHidden(id, true);
      if (target.dataset.drop === 'order') this.server.send({ t: 'deliver', order: Number(target.dataset.order), item: id });
      else this.server.send({ t: 'store', item: id });
      return;
    }
    const cell = this.board.cellAtScreen(sx, sy);
    if (cell < 0) {
      this.server.send({ t: 'release', item: id });
      this.board.snapBack(id);
      return;
    }
    if (!this.server.send({ t: 'drop', item: id, cell })) {
      this.board.snapBack(id);
      return;
    }
    const w = this.server.world;
    const landed = w.cells[cell] ? w.items.get(w.cells[cell]!) : undefined;
    this.board.select(landed ? cell : -1);
    this.hud.showInfo(landed ?? null);
  }

  /** サーバーにつかむのを断られたら（ほかの人が先につかんだ）、ドラッグをやめて元に戻す */
  onReject(a: Action) {
    if (a.t === 'grab' && a.item === this.dragId) {
      const id = this.dragId;
      this.dragId = 0;
      this.board.endDrag(id);
      this.board.snapBack(id);
      if (this.mode === 'drag') this.mode = 'idle';
    }
    if ((a.t === 'deliver' || a.t === 'store' || a.t === 'contribute') && a.item !== undefined) {
      this.board.setHidden(a.item, false);
      this.board.snapBack(a.item);
      this.server.send({ t: 'release', item: a.item });
    }
  }

  private cancelDrag() {
    const id = this.dragId;
    if (!id) return;
    this.dragId = 0;
    this.board.endDrag(id);
    this.server.send({ t: 'release', item: id });
    this.board.snapBack(id);
  }
}

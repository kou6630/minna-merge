// 指・マウスの操作: タップ / ドラッグでアイテム移動 / 何もない所をドラッグで移動 / ピンチ・ホイールで拡大縮小
import { GIFTS, isGiftKind, isOpenCell, maxTierOfKind, tierOfKind } from '@minna/shared';
import { CELL } from './board.ts';
import type { Board } from './board.ts';
import type { Hud } from './hud.ts';
import type { Action, Item } from '@minna/shared';
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
  private lastPtr = { x: 0, y: 0 };
  /** ドキドキ中のプレゼント箱（結果が出るまで次のタップを受けない） */
  private giftBusy = new Set<number>();
  private cursorTimer = 0;
  private pendingCursor: { x: number; y: number } | null = null;
  /** アイテムを運んでいて画面の端に来たときの、盤面を動かす速さ（1コマあたり） */
  private edgeV = { x: 0, y: 0 };
  private edgePt = { x: 0, y: 0 };
  private edgeRaf = 0;

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
      // ホイール1目盛りで約5%ずつ（マウスによって1回の量がちがうので、1回あたりの量に上限を付ける）
      const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const d = Math.max(-100, Math.min(100, dy));
      this.board.zoomAt(e.offsetX, e.offsetY, Math.exp(-d * 0.0005));
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private down(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
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

  /** アイテムを運んでいて画面の端に近づいたら、その方向へ盤面を動かす（注文などの上では動かさない） */
  private edgeCheck(e: PointerEvent, cur: { x: number; y: number }, overDom: boolean) {
    const r = this.el.getBoundingClientRect();
    const side = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--side')) || 0;
    // 盤面の絵は画面より広いことがあるので、見えている所の端で見る
    const left = Math.max(r.left, side);
    const right = Math.min(r.right, innerWidth);
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, innerHeight);
    const Z = 56;
    // 端からの近さで速さを決める（端の外＝パネルの上では動かさない）
    const sp = (d: number) => (d < 0 || d >= Z ? 0 : ((Z - d) / Z) * 16);
    this.edgeV = overDom
      ? { x: 0, y: 0 }
      : { x: sp(e.clientX - left) - sp(right - e.clientX), y: sp(e.clientY - top) - sp(bottom - e.clientY) };
    this.edgePt = cur;
    if ((this.edgeV.x || this.edgeV.y) && !this.edgeRaf) this.edgeRaf = requestAnimationFrame(this.edgeStep);
  }

  private edgeStep = () => {
    this.edgeRaf = 0;
    const v = this.edgeV;
    if (this.mode !== 'drag' || !this.dragId || (!v.x && !v.y)) return;
    this.board.panBy(v.x, v.y);
    // 指の下にアイテムがついてくるように、運んでいる絵と重ねる先を合わせ直す
    const p = this.edgePt;
    this.board.dragTo(this.dragId, p.x, p.y);
    const cell = this.board.cellAtScreen(p.x, p.y);
    this.board.hover(cell, this.canMergeInto(cell));
    this.edgeRaf = requestAnimationFrame(this.edgeStep);
  };

  private move(e: PointerEvent) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      // マウスは押していなくてもカーソルをみんなに見せる（光るカーソルにぶつかれるように）
      if (e.pointerType === 'mouse') this.cursor(e.offsetX, e.offsetY, false);
      return;
    }
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
      this.edgeCheck(e, cur, !!el);
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
    if (!it || it.dusty || it.boxed) return false;
    // ドキドキ演出中のプレゼント箱は動かせない（このあと開く）
    if (this.giftBusy.has(id)) return false;
    if (it.owner && it.owner !== this.server.me) return false;
    if (!this.server.send({ t: 'grab', item: id })) return false;
    this.dragId = id;
    document.body.classList.add('item-dragging');
    this.board.startDrag(id, this.start.x, this.start.y);
    this.cursor(this.start.x, this.start.y, true);
    this.selectItem(undefined);
    return true;
  }

  private canMergeInto(cell: number): boolean {
    if (cell < 0) return false;
    const w = this.server.world;
    const me = w.items.get(this.dragId);
    const tid = w.cells[cell];
    const t = tid ? w.items.get(tid) : undefined;
    if (!me) return false;
    // シャッターには直接置けない（お客さんの注文に納品すると数が進む）
    if (!isOpenCell(w, cell)) return false;
    if (!t || t.id === me.id || t.boxed) return false;
    const hold = w.holds.get(t.id);
    if (hold && hold.player !== this.server.me && hold.until > this.server.now()) return false;
    // プレゼント箱どうしは合成できない
    if (isGiftKind(t.kind)) return false;
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
    // 3本指から2本指になったとき: 残った2本で測り直す（カメラが飛ばないように）
    if (this.mode === 'pinch' && this.pointers.size >= 2) {
      this.pinch = this.measure();
      return;
    }
    if (this.pointers.size === 0) this.mode = 'idle';
  }

  /** 選んでいるアイテム（もう一度タップすると、発生器なら出す・プレゼント箱なら開ける） */
  private selId = 0;

  /** 盤面のアイテムを選ぶ（枠と、下の名前の枠） */
  selectItem(it: Item | undefined) {
    this.selId = it?.id ?? 0;
    this.board.select(it ? it.cell : -1);
    this.hud.showInfo(it ?? null);
  }

  private click(cell: number) {
    const w = this.server.world;
    const id = cell >= 0 ? w.cells[cell] : 0;
    const it = id ? w.items.get(id) : undefined;
    if (!it) {
      this.selectItem(undefined);
      return;
    }
    // 1回目のタップは選ぶだけ。選んでいる物をもう一度タップすると、発生器は出す・プレゼント箱は開ける
    const again = this.selId === it.id;
    this.selectItem(it);
    if (!again) return;
    // プレゼント箱: タップで中身が1個出る。消えるかもしれない回は、少し震わせてから結果を出す
    if (isGiftKind(it.kind) && !it.boxed && !it.dusty) {
      if (this.giftBusy.has(it.id)) return;
      const risky = (it.taps ?? 0) >= GIFTS[tierOfKind(it.kind) - 1]!.safe;
      if (risky) {
        this.giftBusy.add(it.id);
        this.board.suspense(it.id, 650);
        window.setTimeout(() => {
          this.giftBusy.delete(it.id);
          this.server.send({ t: 'openGift', item: it.id });
        }, 650);
      } else if (this.server.send({ t: 'openGift', item: it.id })) {
        this.board.bounce(it.id);
      }
      return;
    }
    if (it.owner === this.server.me && this.server.send({ t: 'tap', gen: it.id })) {
      this.board.bounce(it.id);
      this.hud.showInfo(w.items.get(it.id) ?? null);
    }
  }

  /** 自分のカーソルを送る（10回/秒まで。force なら今すぐ） */
  private cursor(sx: number, sy: number, force: boolean) {
    const now = performance.now();
    if (!force && now - this.lastCursor < 100) {
      // 間引いた分も、止まった位置は少しあとで必ず送る
      this.pendingCursor = { x: sx, y: sy };
      if (!this.cursorTimer) {
        this.cursorTimer = window.setTimeout(() => {
          this.cursorTimer = 0;
          const p = this.pendingCursor;
          this.pendingCursor = null;
          if (p) this.cursor(p.x, p.y, true);
        }, 100 - (now - this.lastCursor));
      }
      return;
    }
    this.pendingCursor = null;
    this.lastCursor = now;
    this.lastPtr = { x: sx, y: sy };
    const p = this.board.screenToWorld(sx, sy);
    this.server.sendCursor(p.x / CELL, p.y / CELL, this.dragId || undefined);
  }

  private clearDropHover() {
    this.dropEl?.classList.remove('drop-hover');
    this.dropEl = null;
  }

  /** 注文カードや倉庫の上か */
  private domTarget(x: number, y: number): HTMLElement | null {
    const el = document.elementFromPoint(x, y);
    return (el?.closest('[data-drop]') as HTMLElement | null) ?? null;
  }

  private drop(sx: number, sy: number, target: HTMLElement | null) {
    const id = this.dragId;
    this.dragId = 0;
    document.body.classList.remove('item-dragging');
    this.board.endDrag(id);
    this.cursor(sx, sy, true); // ドラッグ終わりを知らせる
    const w0 = this.server.world;
    if (target) {
      // 注文に納品 / 倉庫に入れる。断られたら onReject で元に戻す
      this.board.setHidden(id, true);
      if (target.dataset.drop === 'order') this.server.send({ t: 'deliver', order: Number(target.dataset.order), item: id });
      else this.server.send({ t: 'store', item: id });
      // 返事が来ないまま（つなぎ直しなど）でアイテムが残っていたら、元のマスへ見えるように戻す
      window.setTimeout(() => {
        if (this.server.world.items.has(id) && this.dragId !== id) {
          this.board.setHidden(id, false);
          this.board.snapBack(id);
        }
      }, 3000);
      return;
    }
    const cell = this.board.cellAtScreen(sx, sy);
    if (cell < 0) {
      this.server.send({ t: 'release', item: id });
      this.board.snapBack(id);
      return;
    }
    // 同じマスの中で少し動かしただけ: マスのまん中に戻す
    const same = w0.items.get(id);
    if (same && same.cell === cell) {
      this.server.send({ t: 'drop', item: id, cell });
      this.board.snapBack(id);
      this.selectItem(same);
      return;
    }
    if (!this.server.send({ t: 'drop', item: id, cell })) {
      this.board.snapBack(id);
      return;
    }
    // 別のマスに置いたあと（合体を含む）は、何も選ばない
    this.selectItem(undefined);
  }

  /** サーバーにつかむのを断られたら（ほかの人が先につかんだ）、ドラッグをやめて元に戻す */
  onReject(a: Action) {
    if (a.t === 'grab' && a.item === this.dragId) {
      const id = this.dragId;
      this.dragId = 0;
      document.body.classList.remove('item-dragging');
      this.clearDropHover();
      this.board.endDrag(id);
      this.board.snapBack(id);
      this.cursor(this.lastPtr.x, this.lastPtr.y, true);
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
    document.body.classList.remove('item-dragging');
    this.clearDropHover();
    this.board.endDrag(id);
    this.cursor(this.lastPtr.x, this.lastPtr.y, true);
    this.server.send({ t: 'release', item: id });
    this.board.snapBack(id);
  }
}

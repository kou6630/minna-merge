// 右上のミニマップ: 開いた区画・みんなの依頼・ほかの人の居場所・今映している範囲。押すとそこへ移動
import { BLOCK, BLOCKS_X, BLOCKS_Y, H, PLAY_CELLS, PLAY_Y0, W, blockInPlay, cellAt } from '@minna/shared';
import type { Board } from './board.ts';
import { playerColor } from './board.ts';
import type { Conn } from './conn.ts';

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private size: number;

  constructor(
    private canvas: HTMLCanvasElement,
    private board: Board,
    private conn: Conn,
  ) {
    canvas.hidden = false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = 110 * dpr;
    canvas.width = this.size;
    canvas.height = this.size;
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const r = canvas.getBoundingClientRect();
      // 地図に出すのは遊べる範囲（左下の 50×50マス）だけ
      const x = Math.floor(((e.clientX - r.left) / r.width) * PLAY_CELLS);
      const y = PLAY_Y0 + Math.floor(((e.clientY - r.top) / r.height) * PLAY_CELLS);
      this.board.centerOn(cellAt(Math.min(W - 1, Math.max(0, x)), Math.min(H - 1, Math.max(0, y))));
      this.draw();
    });
    setInterval(() => this.draw(), 250);
    this.draw();
  }

  draw() {
    const c = this.ctx;
    const k = this.size / PLAY_CELLS;
    const w = this.conn.world;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.size, this.size);
    // 遊べる範囲が地図いっぱいになるように、上にずらして描く
    c.setTransform(1, 0, 0, 1, 0, -PLAY_Y0 * k);
    const bs = BLOCK * k;
    for (let by = 0; by < BLOCKS_Y; by++) {
      for (let bx = 0; bx < BLOCKS_X; bx++) {
        if (!blockInPlay(by * BLOCKS_X + bx)) continue;
        c.fillStyle = w.blocks[by * BLOCKS_X + bx] ? '#e9dcc4' : '#6b625a';
        c.fillRect(bx * bs + 0.5, by * bs + 0.5, bs - 1, bs - 1);
      }
    }
    for (const o of w.worldOrders) {
      const bx = (o.block % BLOCKS_X) * bs;
      const by = Math.floor(o.block / BLOCKS_X) * bs;
      c.fillStyle = '#ffc531';
      c.fillRect(bx + 1, by + 1, bs - 2, bs - 2);
      c.fillStyle = '#4a2f1d';
      c.font = `bold ${Math.round(bs * 0.7)}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('!', bx + bs / 2, by + bs / 2 + 1);
    }
    // 自分の発生器
    c.fillStyle = '#ff8a3d';
    for (const it of w.items.values()) {
      if (it.owner !== this.conn.me) continue;
      c.fillRect((it.cell % W) * k - k, Math.floor(it.cell / W) * k - k, k * 3, k * 3);
    }
    for (const cur of this.board.cursorList()) {
      c.fillStyle = `#${playerColor(cur.p).toString(16).padStart(6, '0')}`;
      c.beginPath();
      c.arc(cur.x * k, cur.y * k, Math.max(2.5, k * 2), 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#fff';
      c.lineWidth = 1;
      c.stroke();
      // 光っているカーソルは、点滅する金色の輪で目立たせる
      if (cur.glow) {
        c.strokeStyle = `rgba(255, 200, 30, ${0.55 + 0.45 * Math.sin(performance.now() / 160)})`;
        c.lineWidth = Math.max(2, k);
        c.beginPath();
        c.arc(cur.x * k, cur.y * k, Math.max(6, k * 5), 0, Math.PI * 2);
        c.stroke();
      }
    }
    const v = this.board.viewRect();
    c.strokeStyle = '#ffffff';
    c.lineWidth = Math.max(1.5, k * 0.8);
    c.strokeRect(v.x0 * k, v.y0 * k, (v.x1 - v.x0) * k, (v.y1 - v.y0) * k);
  }
}

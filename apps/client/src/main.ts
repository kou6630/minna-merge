import './style.css';
import { Application, CullerPlugin, extensions } from 'pixi.js';
import { OWNERS, findEmptyNear, isOpenCell } from '@minna/shared';
import { Board } from './board.ts';
import { loadManifest, loadTextures } from './assets.ts';
import type { Conn } from './conn.ts';
import { Hud } from './hud.ts';
import { Input } from './input.ts';
import { LocalServer } from './local-server.ts';
import { Minimap } from './minimap.ts';
import { OrdersUi } from './orders-ui.ts';
import { Title, savedName } from './title.ts';

extensions.add(CullerPlugin);

const $ = (id: string) => document.getElementById(id)!;

async function boot(conn: Conn) {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#3a3530',
    antialias: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });
  $('stage').appendChild(app.canvas);

  const manifest = await loadManifest();
  const tex = await loadTextures(app, manifest);
  const board = new Board(app, tex, conn, conn.me);
  const hud = new Hud(manifest, conn.me, () => conn.now());
  const input = new Input(app.canvas, board, conn, hud);
  const solo = conn instanceof LocalServer;
  hud.setOnline(solo ? null : conn.online.length);

  const myGen = [...conn.world.items.values()].find((i) => i.owner === conn.me);
  board.centerOn(myGen?.cell ?? 5050, 1);

  const orders = new OrdersUi(manifest, {
    unstore(slot) {
      // 画面のまん中の近くの空きマスに出す
      const c = board.cellAtScreen(app.screen.width / 2, app.screen.height / 2);
      const w = conn.world;
      const cell = c >= 0 && isOpenCell(w, c) && !w.cells[c] ? c : findEmptyNear(w, c >= 0 ? c : 5050, 30);
      if (cell < 0) return hud.toast('近くに空きマスがありません。開いた区画を映してください');
      conn.send({ t: 'unstore', slot, cell });
    },
    give(slot, order) {
      conn.send({ t: 'deliver', order, slot });
    },
    expand() {
      conn.send({ t: 'expand' });
    },
  });

  new Minimap(document.getElementById('minimap') as HTMLCanvasElement, board, conn);

  // タイトルへ（ページを読み込み直す。サーバーとのつながりも切れる）
  const toTitle = $('toTitle');
  toTitle.hidden = false;
  toTitle.addEventListener('click', () => {
    if (conn instanceof LocalServer) conn.save();
    location.href = location.pathname;
  });

  hud.onSell = (it) => {
    if (conn.send({ t: 'sell', item: it.id })) {
      board.select(-1);
      hud.showInfo(null);
    }
  };

  conn.on({
    ops(ops, events) {
      board.applyOps(ops, events);
      for (const e of events) {
        if (e.t === 'levelup') hud.levelUp(e);
        if (e.t === 'sold') hud.toast(`+${e.coins} コイン`);
        if (e.t === 'order') hud.toast(orders.celebrate(e.customer, e.coins));
        if (e.t === 'contrib') hud.toast(`みんなの依頼に納品！ +${e.coins} コイン`);
        if (e.t === 'unlock') {
          const o = OWNERS[e.owner];
          if (o) hud.toast(`${o.name}「${o.line}」`);
          hud.toast(
            e.contributors.includes(conn.me)
              ? `シャッターが上がった！ お礼に +${e.bonus} コイン`
              : 'みんなの依頼がそろって、シャッターが上がった！',
          );
        }
      }
      hud.update(conn.player);
      orders.render(conn.player);
      hud.refresh(conn.world);
    },
    reject(_reason, text, action) {
      input.onReject(action);
      hud.toast(text);
    },
    status(text) {
      hud.setStatus(text);
    },
    online(ids) {
      hud.setOnline(ids.length);
    },
    cursors(list) {
      for (const c of list) board.setCursor(c);
    },
  });
  hud.update(conn.player);
  orders.render(conn.player);
  setInterval(() => {
    hud.update(conn.player);
    hud.refresh(conn.world);
  }, 1000);

  if (solo && new URLSearchParams(location.search).has('debug')) {
    $('debug').hidden = false;
    $('debug').addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).dataset.dbg;
      if (k === 'xp') conn.debugXp(50);
      if (k === 'energy') conn.debugEnergy();
      if (k === 'reset' && confirm('練習の盤面を最初からにしますか？')) {
        LocalServer.reset();
        location.reload();
      }
    });
  }
  // 確認用
  Object.assign(window, { __game: { app, board, conn, hud } });
}

new Title((c) => {
  $('title').hidden = true;
  const conn = c === 'solo' ? new LocalServer('me', savedName() || 'ひとり') : c;
  void boot(conn);
});

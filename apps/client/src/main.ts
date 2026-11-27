import './style.css';
import './award.css';
import { Application, CullerPlugin, extensions } from 'pixi.js';
import { GIFTS, GLOW_ENERGY, H, OWNERS, W, findEmptyNear, isOpenCell, itemName } from '@minna/shared';
import type { GameEvent } from '@minna/shared';
import { Board, CELL, playerColor } from './board.ts';
import { preloadStoryAssets } from './story-iso.ts';
import { Tutorial } from './tutorial.ts';
import { loadManifest, loadTextures } from './assets.ts';
import type { Conn } from './conn.ts';
import { Hud } from './hud.ts';
import { Input } from './input.ts';
import { LocalServer } from './local-server.ts';
import { Minimap } from './minimap.ts';
import { OrdersUi, matchOrders } from './orders-ui.ts';
import { StoryUi } from './story-ui.ts';
import { Title, savedName } from './title.ts';

extensions.add(CullerPlugin);

const $ = (id: string) => document.getElementById(id)!;

async function boot(conn: Conn, opts?: { previewMode?: boolean }) {
  const app = new Application();
  await app.init({
    // 盤面は右の 5/6（左の 1/6 は注文の列）
    resizeTo: $('stage'),
    background: '#3a3530',
    antialias: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });
  $('stage').appendChild(app.canvas);

  const manifest = await loadManifest();
  const tex = await loadTextures(app, manifest);
  const board = new Board(app, tex, conn, conn.me);
  setTimeout(() => void preloadStoryAssets(), 3000);
  // ストーリー画面を開いている間は、後ろの盤面を描かない（重くなるので）
  new MutationObserver(() => {
    if (document.getElementById('storyView')?.hidden === false) app.ticker.stop();
    else app.ticker.start();
  }).observe(document.getElementById('storyView')!, { attributes: true, attributeFilter: ['hidden'] });
  const hud = new Hud(manifest, conn.me, () => conn.now());
  const input = new Input(app.canvas, board, conn, hud);
  const solo = conn instanceof LocalServer;
  hud.setOnline(solo ? null : conn.online.length);

  const myGen = [...conn.world.items.values()].find((i) => i.owner === conn.me);
  // シャッターが待っているアイテム（注文カードに印を付ける）
  const shutterKinds = () => conn.world.worldOrders.flatMap((o) => o.needs.filter((n) => n.have < n.count).map((n) => n.kind));
  board.centerOn(myGen?.cell ?? 9702, 1);

  // 返事を待っている操作（通信で連打すると、同じマスに2回出そうとしたりジェムを2回使ったりするので、返事が来るまで次を送らない）
  const busy = new Map<string, number>();
  const tryBusy = (key: string) => {
    const t = busy.get(key);
    if (t && Date.now() - t < 2500) return false;
    busy.set(key, Date.now());
    return true;
  };
  const done = (key: string) => busy.delete(key);

  /** 倉庫や受け取り枠から出す先: 画面のまん中にいちばん近い、画面に映っている空きマス（なければ -1） */
  const spawnCell = (): number => {
    const w = conn.world;
    const p = board.screenToWorld(app.screen.width / 2, app.screen.height / 2);
    // 画面のまん中が盤面の外でも、盤面のいちばん近いマスから探す
    const x = Math.max(0, Math.min(W - 1, Math.floor(p.x / CELL)));
    const y = Math.max(0, Math.min(H - 1, Math.floor(p.y / CELL)));
    // 近い順に、盤面が見えている（画面の中で、注文パネルなどの裏でない）空きマスを探す
    const seen = (cell: number) => {
      const q = board.cellToClient(cell);
      return q.x >= 0 && q.y >= 0 && q.x <= innerWidth && q.y <= innerHeight && document.elementFromPoint(q.x, q.y) === app.canvas;
    };
    let best = -1; let bd = Infinity;
    for (let d = 0; d <= 30 && best < 0; d++) {
      for (let yy = y - d; yy <= y + d; yy++) {
        for (let xx = x - d; xx <= x + d; xx++) {
          if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) !== d || xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const c = yy * W + xx;
          const dist = (xx - x) ** 2 + (yy - y) ** 2;
          if (dist < bd && !w.cells[c] && isOpenCell(w, c) && seen(c)) { best = c; bd = dist; }
        }
      }
    }
    // 見えている空きマスがなければ（パネルの裏などしかない）、見えていなくても近い空きマスに出す
    return best >= 0 ? best : findEmptyNear(w, y * W + x, 30);
  };
  // 倉庫を広げるボタンの連打（返事を待つ間に2回買ってしまう）を防ぐ
  let lastExpand = 0;
  let expandFrom = -1;

  const orders = new OrdersUi(manifest, {
    unstoreAt(slot, x, y) {
      // 落とした所のマス。ふさがっていたら、そこにいちばん近い空きマス
      const r = app.canvas.getBoundingClientRect();
      const at = board.cellAtScreen(x - r.left, y - r.top);
      const w = conn.world;
      const cell = at < 0 ? -1 : isOpenCell(w, at) && !w.cells[at] ? at : findEmptyNear(w, at, 30);
      if (cell < 0) return hud.toast('近くに空きマスがありません');
      conn.send({ t: 'unstore', slot, cell });
    },
    give(slot, order) {
      conn.send({ t: 'deliver', order, slot });
    },
    sell(slot) {
      conn.send({ t: 'sell', slot });
    },
    expand() {
      const n = conn.player.storage.length;
      if (n === expandFrom && Date.now() - lastExpand < 3000) return;
      expandFrom = n;
      lastExpand = Date.now();
      conn.send({ t: 'expand' });
    },
    take() {
      if (!conn.player.inbox?.length) return hud.toast('報酬でもらったアイテムがここに入ります');
      const cell = spawnCell();
      if (cell < 0) return hud.toast('近くに空きマスがありません。開いた区画を映してください');
      if (!tryBusy('take')) return;
      if (!conn.send({ t: 'takeReward', cell })) done('take');
    },
    complete(order, items) {
      for (const id of items) {
        // 倉庫の物
        if (id < 0) { conn.send({ t: 'deliver', order, slot: -id - 1 }); continue; }
        const it = conn.world.items.get(id);
        if (!it) continue;
        board.deliverFx(it.cell);
        conn.send({ t: 'deliver', order, item: id });
      }
    },
  });
  orders.getWorld = () => conn.world;
  // 5秒なにもしない（アイテムを持たない・発生器を押さない）と、合体できる組を引き寄せ合わせて教える
  let lastAct = Date.now();
  let lastHint = 0;
  const act = () => { lastAct = Date.now(); };
  window.addEventListener('pointerdown', act);
  window.addEventListener('pointermove', (e) => { if (e.buttons) act(); });
  window.addEventListener('keydown', act);
  setInterval(() => {
    const idle = Date.now() - lastAct;
    if (idle < 5000 || document.hidden || document.body.classList.contains('item-dragging')) return;
    if (document.getElementById('storyView')?.hidden === false) return;
    // 5秒たったら1回、そのあとは4秒ごと
    if (Date.now() - lastHint < 4000) return;
    lastHint = Date.now();
    board.hintPair();
  }, 1000);
  hud.getWorld = () => conn.world;

  // 注文の列と、盤面の「注文に出せる」チェック
  const refreshOrders = () => {
    const m = matchOrders(conn.player, conn.world, conn.now());
    board.setOrderChecks(m.items);
    orders.render(conn.player, shutterKinds(), m);
  };

  new Minimap(document.getElementById('minimap') as HTMLCanvasElement, board, conn);
  // 上の HUD が折り返して高くなったら、ミニマップと確認用ボタンをその下へ
  const placeUnderHud = () => {
    const r = $('hud').getBoundingClientRect();
    const minimap = $('minimap').getBoundingClientRect();
    const overlaps = r.right > minimap.left - 4;
    document.body.style.setProperty('--hud-h', `${Math.round(r.bottom)}px`);
    document.body.style.setProperty('--minimap-top', `${Math.round(overlaps ? r.bottom + 8 : 62)}px`);
  };
  new ResizeObserver(placeUnderHud).observe($('hud'));
  addEventListener('resize', placeUnderHud);
  placeUnderHud();
  let tutorial: Tutorial | undefined;
  const story = new StoryUi(conn, { previewMode: opts?.previewMode, onToast: (m) => hud.toast(m) });
  // ストーリーの会話・報酬の画面が出ている間は、レベルアップ画面を待たせて、そのあとに出す
  hud.holdLevelUps = () => story.busy();
  story.afterLevelUps = (then) => hud.afterLevelUps(then);

  // タイトルへ（ページを読み込み直す。サーバーとのつながりも切れる）
  const toTitle = $('toTitle');
  toTitle.hidden = false;
  toTitle.addEventListener('click', () => {
    if (conn instanceof LocalServer) conn.save();
    location.href = location.pathname;
  });

  hud.onRefill = (it) => {
    if (!tryBusy('gem')) return;
    if (!conn.send({ t: 'refillGen', gen: it.id })) done('gem');
  };
  hud.onBuyEnergy = () => {
    if (!tryBusy('gem')) return;
    if (!conn.send({ t: 'buyEnergy' })) done('gem');
  };

  // ゴミ箱（Lv1）・コイン化（Lv2〜）。少しの間だけ元に戻せる
  hud.onSell = (it) => {
    if (conn.send({ t: 'sell', item: it.id })) input.selectItem(undefined);
  };
  hud.onUndoSell = () => {
    conn.send({ t: 'undoSell' });
  };

  const nameOf = (id: string) => conn.world.players.get(id)?.name ?? '?';

  // ほかの人がみんなのシャッターに納品した: 続けて納品したぶんは少しまとめて「○○が○○を3個納品しました」
  const gives = new Map<string, { e: Extract<GameEvent, { t: 'shutterGive' }>; n: number; timer: number }>();
  const showGive = (key: string) => {
    const g = gives.get(key);
    gives.delete(key);
    if (!g) return;
    const left = g.e.count - g.e.have;
    hud.toast(`${g.e.name}が${itemName(g.e.kind)}を${g.n}個納品しました　${g.e.have}/${g.e.count}${left > 0 ? '' : '　そろった！'}`);
  };
  const onGive = (e: Extract<GameEvent, { t: 'shutterGive' }>) => {
    const key = `${e.player}:${e.order}`;
    const g = gives.get(key);
    if (g) {
      g.n++;
      g.e = e;
      window.clearTimeout(g.timer);
    }
    const cur = g ?? { e, n: 1, timer: 0 };
    cur.timer = window.setTimeout(() => showGive(key), 1200);
    gives.set(key, cur);
    board.pulseSign(e.order);
  };
  conn.on({
    ops(ops, events) {
      board.applyOps(ops, events);
      let delivery: Extract<GameEvent, { t: 'order' }> | undefined;
      for (const e of events) {
        if (e.t === 'levelup') hud.queueAward(e);
        if (e.t === 'order' && e.player === conn.me) tutorial?.orderDone();
        if (e.t === 'sold') hud.showUndo(e.kind, e.coins);
        if (e.t === 'unsold') {
          hud.hideUndo();
          if (e.id !== undefined) {
            input.selectItem(conn.world.items.get(e.id));
            board.bounce(e.id);
          }
          hud.toast(e.coins > 0 ? `元に戻した　-${e.coins} コイン` : '元に戻した');
        }
        if (e.t === 'order') {
          delivery = e;
          hud.toast(orders.celebrate(e.customer, e.coins));
        }
        if (e.t === 'rewardTaken' && e.player === conn.me) done('take');
        if (e.t === 'gemUse' && e.player === conn.me) done('gem');
        if (e.t === 'rewardTaken' && e.player === conn.me) {
          // 受け取り枠から盤面へ、絵が飛んでいく
          board.setHidden(e.id, true);
          const from = orders.inboxRect();
          const to = board.cellToClient(e.cell);
          const ghost = document.createElement('img');
          ghost.src = manifest.items[e.kind] ?? '';
          ghost.className = 'fly-ghost';
          const size = Math.max(36, Math.min(96, to.size * 0.8));
          Object.assign(ghost.style, { left: `${from.left + from.width / 2 - size / 2}px`, top: `${from.top + from.height / 2 - size / 2}px`, width: `${size}px`, height: `${size}px` });
          document.body.appendChild(ghost);
          const dx = to.x - (from.left + from.width / 2);
          const dy = to.y - (from.top + from.height / 2);
          const anim = ghost.animate([
            { transform: 'translate(0, 0) scale(0.7)' },
            { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(1.15)`, offset: 0.55 },
            { transform: `translate(${dx}px, ${dy}px) scale(1)` },
          ], { duration: 420, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' });
          const land = () => {
            ghost.remove();
            board.setHidden(e.id, false);
            board.bounce(e.id);
          };
          anim.onfinish = land;
          anim.oncancel = land;
        }
        if (e.t === 'gemUse' && e.player === conn.me) {
          if (e.what === 'energy') {
            hud.closeGemShop();
            hud.toast(`スタミナ +${e.energy}！　ジェム -${e.gems}`);
          } else if (e.gen !== undefined) {
            const g = conn.world.items.get(e.gen);
            if (g) {
              board.deliverFx(g.cell);
              board.bounce(g.id);
            }
            hud.toast(`発生器が満タンになった！　ジェム -${e.gems}`);
          }
        }
        if (e.t === 'ordersCleared') {
          hud.queueAward({ ...e, delivery: delivery?.player === e.player ? delivery : undefined });
          delivery = undefined;
        }
        if (e.t === 'shutterGive' && e.player !== conn.me) onGive(e);
        if (e.t === 'unlock') {
          // まとめて待っている納品の知らせを先に出す（「そろった！」→「開けた！」の順）
          for (const [key, g] of [...gives]) {
            window.clearTimeout(g.timer);
            showGive(key);
          }
          const many = e.contributors.length > 1 || (e.contributors.length === 1 && e.contributors[0] !== conn.me);
          if (many) hud.toast(`みんなでシャッターを開けた！${e.bonus ? ` +${e.bonus} コイン` : ''}`);
          else hud.toast(`シャッターが上がった！ +${e.bonus} コイン`);
        }
        if (e.t === 'giftTap') {
          if (e.broke) {
            board.giftFx(e.cell, e.kind);
            hud.toast('プレゼントがなくなった！');
          } else if (e.taps > GIFTS[(e.kind % 100) - 1]!.safe) {
            board.bounce(e.id);
            hud.toast('セーフ！ まだ出る！');
          }
        }
        if (e.t === 'glow') hud.toast(`カーソルがまた光った！ 光っている人とぶつかると、2人ともスタミナ +${GLOW_ENERGY}`);
        if (e.t === 'bump') {
          board.bumpFx(e.from);
          if (story.isOpen()) hud.toast(`${nameOf(e.from)}とぶつかった！ スタミナ +${e.energy}`);
          else hud.cutIn({ name: nameOf(e.from), color: playerColor(e.from), energy: e.energy });
        }
      }
      hud.update(conn.player);
      refreshOrders();
      story.onEvents(events, conn.player);
      hud.refresh(conn.world);
    },
    reject(reason, text, action) {
      if (action.t === 'takeReward') done('take');
      if (action.t === 'undoSell') hud.undoFailed();
      if (action.t === 'refillGen' || action.t === 'buyEnergy') done('gem');
      input.onReject(action);
      story.onReject(action);
      hud.toast(text);
      // スタミナ切れ: そのままジェムで回復できる画面を出す
      if (reason === 'energy') hud.openGemShop();
    },
    status(text) {
      hud.setStatus(text);
    },
    online(ids) {
      hud.setOnline(ids.length);
      board.refreshCursorNames();
    },
    cursors(list) {
      for (const c of list) board.setCursor(c);
    },
  });
  hud.update(conn.player);
  refreshOrders();
  // 運んでいる途中など、手元だけで盤面が動いたときもチェックを合わせる
  setInterval(refreshOrders, 400);
  story.render(conn.player);
  if (opts?.previewMode) story.open();
  // はじめての人には、最初の注文を終えるまでチュートリアルを出す
  if (!opts?.previewMode) tutorial = new Tutorial(board, () => ({ world: conn.world, player: conn.player, now: conn.now() }));
  setInterval(() => {
    hud.update(conn.player);
    hud.refresh(conn.world);
  }, 1000);

  if (solo && (opts?.previewMode || new URLSearchParams(location.search).has('debug'))) {
    $('debug').hidden = false;
    $('debug').addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).dataset.dbg;
      if (k === 'xp') conn.debugXp(50);
      if (k === 'energy') conn.debugEnergy();
      if (k === 'reset' && confirm('練習の盤面を最初からにしますか？')) {
        LocalServer.reset(opts?.previewMode);
        location.reload();
      }
    });
  }
  // 確認用
  Object.assign(window, { __game: { app, board, conn, hud, story } });
}

// 2回押しても、ゲームは1回だけ始める
let started = false;
new Title((c) => {
  if (started) return;
  started = true;
  $('title').hidden = true;
  // 盤面が映るまで、砂時計の「読み込み中」を出す
  $('bootLoading').hidden = false;
  const done = () => { $('bootLoading').hidden = true; };
  if (c === 'story-preview') {
    const conn = new LocalServer('me', savedName() || 'レイナ', { infiniteCoins: true });
    void boot(conn, { previewMode: true }).finally(done);
    return;
  }
  const conn = c === 'solo' ? new LocalServer('me', savedName() || 'ひとり') : c;
  void boot(conn).finally(done);
});

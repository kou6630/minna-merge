// 商店街復興ストーリー画面（PixiJS 2:1 アイソメトリック空間・マルチフェーズ1〜3＋屋根オープン＋立ち絵会話）
import {
  CHAPTERS, SPEAKERS, STORY_ASSET_V, chainOfKind, currentChapter, itemName, findStoryTask, getChapter, nextStoryTask, portraitSrc,
} from '@minna/shared';
import type {
  Action, ChapterReward, DecoChoice, DialogLine, GameEvent, Player, StoryChapter, StoryTask,
} from '@minna/shared';
import type { Conn } from './conn.ts';
import { LocalServer } from './local-server.ts';
import { StoryIsoMap, preloadStoryAssets, storyPreloadProgress } from './story-iso.ts';
import { playStoryReward } from './story-reward-fx.ts';
import { scatterAward } from './award-fx.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** 報酬の演出の長さ（story-reward-fx.ts の最後のフェードが終わるまで） */
const REWARD_FX_MS = 2400;

/** 立ち絵の左右をそろえる: レイナはいつも左、モモはレイナと話すときだけ右、ほかの人どうしは1つの会話の中で同じ側のまま
 *  （話す人が変わるたびに、立ち絵が左右に入れ替わらないように） */
function steadySides(lines: DialogLine[]): DialogLine[] {
  const seat = new Map<string, 'left' | 'right'>();
  return lines.map((l) => {
    if (!l.speaker) return l;
    const sp = l.speaker;
    const ot = l.other?.speaker;
    let side: 'left' | 'right';
    if (sp === 'reina') side = 'left';
    else if (sp === 'momo') side = ot === 'reina' ? 'right' : 'left';
    else if (!ot || ot === 'reina' || ot === 'momo') side = 'right';
    else {
      side = seat.get(sp) ?? (seat.get(ot) === 'right' ? 'left' : 'right');
      seat.set(sp, side);
      if (!seat.has(ot)) seat.set(ot, side === 'right' ? 'left' : 'right');
    }
    return side === l.side ? l : { ...l, side };
  });
}

export class StoryUi {
  private iso = new StoryIsoMap();
  private openFlag = false;
  /** open/close の世代番号（初回ロード中に閉じた・開き直したのを判別する） */
  private openSeq = 0;
  /** 通信で storyTask の返事を待っている間（連打による二重送信を防ぐ） */
  private sendingTask = false;
  private sendTimer = 0;
  /** メモ内で閲覧中のフェーズ番号（null のときは現在進行中のフェーズ） */
  private picking: { task: StoryTask; mode: 'buy' | 'restyle'; selected: number } | null = null;
  private dialogQueue: DialogLine[] = [];
  private dialogIdx = 0;
  private onDialogDone: (() => void) | null = null;
  /** 報酬の演出が終わる時刻（それまでの Esc は演出を飛ばすだけ） */
  private rewardFxUntil = 0;
  private pendingClear: { chapter: StoryChapter; reward: ChapterReward; part?: number; gift?: number } | null = null;
  /** 50% のプレゼント（会話のあとに出す） */
  private pendingHalf: { chapter: StoryChapter; energy: number; part?: number; gift?: number } | null = null;
  /** 報酬の画面が 50% 用か */
  private rewardIsHalf = false;
  private clearGaugeChapter: StoryChapter | null = null;
  private finishRewardFx?: () => void;
  private animTimer = 0;
  /** タスク完了 → 会話 → 報酬 の流れの途中か */
  private seq = false;
  /** マップに描いている着せ替え（変わったら描き直す。通信で返事があとから来るとき用） */
  private lastChoices = '';
  private lastDone = '';
  /** 通信で着せ替えの返事を待っている最中の選択（返事より前に別の人の通信が来ても元へ巻き戻さない） */
  private pendingStyles = new Map<string, { choice: number; timer: number }>();
  /** レベルアップ画面を見せ終わってから then を呼ぶ（main でつなぐ） */
  afterLevelUps: (then: () => void) => void = (then) => then();

  constructor(
    private conn: Conn,
    private opts: { previewMode?: boolean; onToast: (msg: string) => void },
  ) {
    $('storyBtn').hidden = false;
    $('storyBtn').onclick = () => void this.open();
    $('storyClose').onclick = () => {
      if (this.sendingTask || (this.seq && $('storyDialog').hidden && $('storyRewardModal').hidden)) return;
      this.close();
    };
    $('storyReplayIntro').onclick = () => {
      if (!this.iso.isReady() || this.busy()) return;
      const ch = currentChapter(this.conn.player.story);
      this.playDialog(ch.intro, () => this.idle());
    };
    $('storyFitBtn').onclick = () => {
      if (!this.iso.isReady() || this.busy()) return;
      const ch = currentChapter(this.conn.player.story);
      this.iso.focusChapter(ch.id, true);
    };

    // マップ上の設置済みオブジェクト（門・テラス・窯・カウンター）をクリックで着せ替え
    this.iso.onRestyleClick = (taskId) => {
      if (!this.iso.isReady()) return;
      const found = findStoryTask(taskId);
      if (found && !this.picking && !this.busy()) {
        this.startRestyle(found.task, this.conn.player);
      }
    };

    // 左下の「すすめる」ボタン: やることの一覧は出さず、押すとストーリーの次の場面に進む
    $('storyMemoBtn').onclick = () => {
      if (!this.iso.isReady()) return;
      const p = this.conn.player;
      // 前のタスクの演出（会話・報酬）や送信待ちが終わるまでは、次に進めない（連打で会話や報酬が消えないように）
      if (this.picking || this.busy()) return;
      const next = nextStoryTask(currentChapter(p.story), p.story);
      if (!next) return;
      if (p.coins < next.cost) {
        const b = $('storyMemoBtn');
        b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
        return;
      }
      this.startTask(next, p);
    };

    const resetBtn = $('storyResetBtn');
    const previewBadge = $('storyPreviewBadge');
    if (opts.previewMode && conn instanceof LocalServer) {
      resetBtn.hidden = false;
      previewBadge.hidden = false;
      resetBtn.onclick = () => {
        if (!this.iso.isReady() || this.busy()) return;
        this.setSendingTask(false);
        this.clearPendingStyles();
        this.picking = null;
        this.pendingClear = null;
        this.pendingHalf = null;
        this.rewardIsHalf = false;
        this.clearGaugeChapter = null;
        this.finishRewardFx?.();
        clearTimeout(this.animTimer);
        this.seq = false;
        this.closeDialog();
        $('storyRewardModal').hidden = true;
    for (const el of $('storyView').children) (el as HTMLElement).inert = false;
        conn.resetStory();
        this.iso.syncState(conn.player.story, null, false);
        this.iso.focusChapter(1, true);
        this.render(conn.player);
        this.playIntroIfNeeded(conn.player);
      };
    }

    // 会話送り
    $('storyDialog').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('#storySkip')) return;
      this.advanceDialog();
    });
    $('storySkip').addEventListener('click', (e) => {
      e.stopPropagation();
      this.finishDialog();
    });
    addEventListener('keydown', (e) => {
      if (!this.openFlag) return;
      if (!$('storyDialog').hidden && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.advanceDialog();
      } else if (e.key === 'Escape' && $('storyDialog').hidden) {
        if (this.picking) {
          this.picking = null;
          this.iso.syncState(this.conn.player.story, null, false);
          this.iso.focusChapter(currentChapter(this.conn.player.story).id, true);
          this.render(this.conn.player);
        } else if (!$('storyRewardModal').hidden) {
          if (!this.skipRewardFx()) this.closeClearModal();
        }
      }
    });

    $('storyRewardClose').onclick = () => this.closeClearModal();

    $('storyPickCancel').onclick = () => {
      this.picking = null;
      this.iso.syncState(this.conn.player.story, null, false);
      this.iso.focusChapter(currentChapter(this.conn.player.story).id, true);
      this.render(this.conn.player);
    };
    $('storyPickConfirm').onclick = () => {
      const pk = this.picking;
      if (!pk || this.busy()) return;
      if (pk.mode === 'buy') {
        this.setSendingTask(true, pk.task.id);
        if (this.conn.send({ t: 'storyTask', taskId: pk.task.id, choice: pk.selected })) {
          this.picking = null;
          this.render(this.conn.player);
        } else {
          this.setSendingTask(false);
          this.picking = null;
          this.iso.syncState(this.conn.player.story, null, false);
          this.render(this.conn.player);
        }
      } else {
        if (this.conn.send({ t: 'storyStyle', taskId: pk.task.id, choice: pk.selected })) {
          this.picking = null;
          // 通信では返事がまだなので、選んだ見た目で先に描く（返事より前の別バッチで元に戻らないよう覚えておく）。
          // 「変更しました」は確定してから出す。1人プレイでは送った時点で確定している
          if (this.conn.player.story.choices[pk.task.id] === pk.selected) this.opts.onToast(`「${pk.task.choices?.[pk.selected]?.label ?? ''}」に変更しました！`);
          else this.rememberPendingStyle(pk.task.id, pk.selected);
          const shown = this.storyWithPending(this.conn.player.story);
          this.lastChoices = JSON.stringify(shown.choices);
          this.iso.syncState(shown, null, true);
          this.render(this.conn.player);
        }
      }
    };
  }

  isOpen(): boolean {
    return this.openFlag;
  }

  /** 会話・報酬・送信待ちの途中か。この間は連打やレベルアップ画面を待たせる */
  busy(): boolean {
    if (!this.openFlag) return false;
    return this.seq || this.sendingTask || !$('storyDialog').hidden || !$('storyRewardModal').hidden;
  }

  private sendingTaskId: string | null = null;
  private setSendingTask(on: boolean, taskId: string | null = null) {
    clearTimeout(this.sendTimer);
    this.sendingTask = on;
    this.sendingTaskId = on ? taskId : null;
    if (on) {
      this.sendTimer = window.setTimeout(() => {
        this.sendingTask = false;
      }, 6000);
    }
  }

  private rememberPendingStyle(taskId: string, choice: number) {
    const prev = this.pendingStyles.get(taskId);
    if (prev) clearTimeout(prev.timer);
    const timer = window.setTimeout(() => {
      this.pendingStyles.delete(taskId);
      if (this.openFlag && !this.picking) {
        const shown = this.storyWithPending(this.conn.player.story);
        this.lastChoices = JSON.stringify(shown.choices);
        this.iso.syncState(shown, null, false);
      }
    }, 6000);
    this.pendingStyles.set(taskId, { choice, timer });
  }

  private clearPendingStyles(taskId?: string) {
    if (taskId !== undefined) {
      const prev = this.pendingStyles.get(taskId);
      if (prev) clearTimeout(prev.timer);
      this.pendingStyles.delete(taskId);
      return;
    }
    for (const v of this.pendingStyles.values()) clearTimeout(v.timer);
    this.pendingStyles.clear();
  }

  /** 送信中の着せ替えを重ねた表示用の story */
  private storyWithPending(story: Player['story']): Player['story'] {
    if (!this.pendingStyles.size) return story;
    const choices = { ...story.choices };
    for (const [id, v] of this.pendingStyles) choices[id] = v.choice;
    return { ...story, choices };
  }

  /** サーバーに断られたとき（通信の失敗など）: 仮のプレビュー表示と送信待ちを元に戻す */
  onReject(action: Action) {
    if (action.t === 'storyTask') {
      this.setSendingTask(false);
      this.picking = null;
      this.iso.syncState(this.storyWithPending(this.conn.player.story), null, false);
      this.render(this.conn.player);
    } else if (action.t === 'storyStyle') {
      this.clearPendingStyles(action.taskId);
      this.picking = null;
      const shown = this.storyWithPending(this.conn.player.story);
      this.lastChoices = JSON.stringify(shown.choices);
      this.iso.syncState(shown, null, false);
      this.render(this.conn.player);
    }
  }

  /** 流れが終わった: たまっているレベルアップ画面を出す */
  private idle(then: () => void = () => {}) {
    this.seq = false;
    this.afterLevelUps(then);
  }

  async open() {
    if (this.openFlag) return;
    this.openFlag = true;
    const seq = ++this.openSeq;
    this.render(this.conn.player);
    $('storyView').hidden = false;
    // 絵を読んでいる間は「読み込み中」を出す（最初の1回だけ時間がかかる）
    const loading = document.createElement('div');
    loading.className = 'story-loading';
    $('storyIsoHost').appendChild(loading);
    const tick = () => {
      const p = storyPreloadProgress();
      loading.textContent = p.total ? `商店街を読み込み中… ${Math.floor((p.done / p.total) * 100)}%` : '商店街を読み込み中…';
    };
    tick();
    const loadTimer = setInterval(tick, 200);
    void preloadStoryAssets();
    try {
      await this.iso.mount($('storyIsoHost'));
    } finally {
      clearInterval(loadTimer);
      loading.remove();
    }
    // 読み込みの途中で閉じられた・開き直された場合はここで止める
    if (!this.openFlag || seq !== this.openSeq) {
      if (!this.openFlag) this.iso.setVisible(false);
      return;
    }
    // 非表示のあいだに画面サイズが変わっていても、正しいサイズへ戻して描画を再開する
    this.iso.setVisible(true);
    const ch = currentChapter(this.conn.player.story);
    this.lastChoices = JSON.stringify(this.conn.player.story.choices);
    this.lastDone = this.conn.player.story.done.join(',');
    this.iso.syncState(this.conn.player.story, null, false);
    this.iso.focusChapter(ch.id, false);
    this.render(this.conn.player);
    // 途中で閉じた報酬は、開き直したときに出す（会話と重ならないよう会話は先に閉じる）
    if (!$('storyRewardModal').hidden) {
      this.closeDialog();
      this.seq = true;
    } else if (this.pendingHalf) {
      this.closeDialog();
      this.seq = true;
      this.showHalfModal(this.pendingHalf.chapter, this.pendingHalf.energy, this.pendingHalf.part, this.pendingHalf.gift);
      this.pendingHalf = null;
    } else if (this.pendingClear) {
      this.closeDialog();
      this.seq = true;
      this.showClearModal(this.pendingClear.chapter, this.pendingClear.reward, this.pendingClear.part, this.pendingClear.gift);
      this.pendingClear = null;
    } else {
      this.playIntroIfNeeded(this.conn.player);
    }
  }

  close() {
    this.finishRewardFx?.();
    this.openFlag = false;
    this.openSeq++;
    this.picking = null;
    this.setSendingTask(false);
    // 演出の待ちと会話は止める（報酬は pending に残っていて、次に開いたときに出す）
    clearTimeout(this.animTimer);
    this.closeDialog();
    this.iso.setVisible(false);
    $('storyView').hidden = true;
    this.idle();
  }

  private playIntroIfNeeded(p: Player) {
    if (!this.openFlag) return;
    const ch = currentChapter(p.story);
    if (!p.story.seenIntro.includes(ch.id)) {
      this.conn.send({ t: 'storySeen', chapter: ch.id });
      this.iso.focusChapter(ch.id, true);
      this.playDialog(ch.intro, () => this.idle());
    }
  }

  onEvents(events: GameEvent[], p: Player) {
    let completed: { chapter: StoryChapter; task: StoryTask } | undefined;
    let cleared: { chapter: StoryChapter; reward: ChapterReward; part?: number; gift?: number } | undefined;
    for (const e of events) {
      if (e.t === 'storyTask' && e.player === this.conn.me) {
        const found = findStoryTask(e.taskId);
        if (found) completed = { chapter: found.chapter, task: found.task };
      }
      if (e.t === 'chapterClear' && e.player === this.conn.me) {
        const ch = getChapter(e.chapter);
        if (ch) cleared = { chapter: ch, reward: { xp: e.xp, energy: e.energy, gems: e.gems }, part: e.part, gift: e.gift };
      }
      if (e.t === 'chapterHalf' && e.player === this.conn.me) {
        const ch = getChapter(e.chapter);
        if (ch) this.pendingHalf = { chapter: ch, energy: e.energy, part: e.part, gift: e.gift };
      }
    }
    if (cleared) {
      this.clearGaugeChapter = cleared.chapter;
      this.pendingClear = cleared;
    }
    if (completed || (this.sendingTaskId && p.story.done.includes(this.sendingTaskId))) this.setSendingTask(false);
    if (this.picking?.mode === 'buy' && p.story.done.includes(this.picking.task.id)) this.picking = null;
    this.render(p);
    // 着せ替えが変わった（通信の返事・別の端末）: 返事待ち中の着せ替えは巻き戻さず、確定したら解除する
    for (const [id, v] of [...this.pendingStyles]) {
      if (p.story.choices[id] !== v.choice) continue;
      this.clearPendingStyles(id);
      const label = findStoryTask(id)?.task.choices?.[v.choice]?.label;
      if (label) this.opts.onToast(`「${label}」に変更しました！`);
    }
    const shown = this.storyWithPending(p.story);
    const ck = JSON.stringify(shown.choices);
    // 進んだ作業（片付けなど）も見る: 通信が切れてつなぎ直したときは storyTask の知らせが来ないので
    const dk = shown.done.join(',');
    if (ck !== this.lastChoices || dk !== this.lastDone) {
      this.lastChoices = ck;
      this.lastDone = dk;
      if (this.openFlag && !this.picking && !completed) this.iso.syncState(shown, null, true);
    }
    if (completed) {
      // 商店街を閉じたあとに届いた場合は、裏で会話を開かず報酬だけ pending に残しておく（次に開いたときに出す）
      if (!this.openFlag || !this.iso.isReady()) {
        clearTimeout(this.animTimer);
        this.seq = false;
        return;
      }
      // 報酬の画面が出ている（ほかの端末で進んだ）ときは、裏で会話を始めない（報酬は次に開いたときに出す）
      if (!$('storyRewardModal').hidden) return;
      this.seq = true;
      this.iso.syncState(p.story, null, true);
      const lines = cleared ? [...completed.task.after, ...completed.chapter.outro] : completed.task.after;
      clearTimeout(this.animTimer);
      this.animTimer = window.setTimeout(() => {
        if (!this.openFlag) return;
        this.playDialog(lines, () => {
          if (!this.openFlag) return;
          if (this.pendingHalf) {
            this.showHalfModal(this.pendingHalf.chapter, this.pendingHalf.energy, this.pendingHalf.part, this.pendingHalf.gift);
            this.pendingHalf = null;
          } else if (this.pendingClear) {
            this.showClearModal(this.pendingClear.chapter, this.pendingClear.reward, this.pendingClear.part, this.pendingClear.gift);
            this.pendingClear = null;
          } else {
            this.iso.focusChapter(currentChapter(this.conn.player.story).id, true);
            this.idle();
          }
        });
      }, cleared ? 1350 : 1050);
    }
  }

  private closeClearModal() {
    this.finishRewardFx?.();
    this.finishRewardFx = undefined;
    $('storyRewardModal').hidden = true;
    for (const el of $('storyView').children) (el as HTMLElement).inert = false;
    // 50% のプレゼントを閉じたら、同時にクリアしていればクリア報酬、でなければそのまま続ける
    if (this.rewardIsHalf) {
      this.rewardIsHalf = false;
      if (this.pendingClear) {
        this.showClearModal(this.pendingClear.chapter, this.pendingClear.reward, this.pendingClear.part, this.pendingClear.gift);
        this.pendingClear = null;
      } else {
        this.iso.focusChapter(currentChapter(this.conn.player.story).id, true);
        this.idle();
      }
      return;
    }
    this.clearGaugeChapter = null;
    const p = this.conn.player;
    const nextCh = currentChapter(p.story);
    this.iso.syncState(p.story, null, true);
    this.iso.focusChapter(nextCh.id, true);
    this.render(p);
    // クリア報酬 → レベルアップ → 次の章の会話 の順に
    this.idle(() => this.playIntroIfNeeded(this.conn.player));
  }

  private startTask(task: StoryTask, p: Player) {
    if (task.choices?.length) {
      this.picking = { task, mode: 'buy', selected: 0 };
      this.iso.syncState(p.story, { taskId: task.id, choice: 0 }, true);
      this.render(p);
    } else {
      this.setSendingTask(true, task.id);
      if (!this.conn.send({ t: 'storyTask', taskId: task.id })) {
        this.setSendingTask(false);
      }
    }
  }

  private startRestyle(task: StoryTask, p: Player) {
    const cur = p.story.choices[task.id] ?? 0;
    this.picking = { task, mode: 'restyle', selected: cur };
    this.iso.syncState(p.story, { taskId: task.id, choice: cur }, true);
    this.render(p);
  }

  render(p: Player) {
    const ch = currentChapter(p.story);
    const prog = p.story;
    const next = nextStoryTask(ch, prog);
    const canAct = !!next && p.coins >= next.cost;

    const badge = $('storyBadge');
    badge.hidden = !canAct;
    badge.textContent = '!';

    if (!this.openFlag) return;

    const memoBadge = $('storyMemoBadge');
    memoBadge.hidden = !canAct;
    memoBadge.textContent = '1';

    // 現在のチャプター毎の進み具合（％）＋ 50% / 100% プレゼント箱の状態更新
    const gaugeChapter = this.clearGaugeChapter ?? ch;
    const doneCount = gaugeChapter.tasks.filter((t) => prog.done.includes(t.id)).length;
    const total = gaugeChapter.tasks.length;
    const pct = Math.round((doneCount / Math.max(1, total)) * 100);
    $('storyChapterTitle').textContent = gaugeChapter.title;
    $('storyProgressText').textContent = `${pct}%`;
    $('storyProgressFill').style.width = `${pct}%`;
    $('storyGift50').classList.toggle('is-reached', pct >= 50);
    // 報酬の画面で箱を開けるまでは、ゲージの箱は閉じたまま（開ける演出の前に開封済みにしない）
    const hold50 = this.pendingHalf?.chapter.id === gaugeChapter.id;
    const hold100 = this.pendingClear?.chapter.id === gaugeChapter.id;
    $('storyGift50').classList.toggle('is-claimed', !hold50 && (prog.half.includes(gaugeChapter.id) || prog.claimed.includes(gaugeChapter.id)));
    $('storyGift100').classList.toggle('is-reached', pct >= 100);
    $('storyGift100').classList.toggle('is-claimed', !hold100 && prog.claimed.includes(gaugeChapter.id));
    $('storyNextCost').textContent = next ? (next.cost > 0 ? String(next.cost) : 'すすめる') : '完了';
    $('storyCoins').textContent = p.coins >= 900_000 ? '∞' : String(p.coins);
    $('storyGems').textContent = String(p.gems ?? 0);

    const picker = $('storyPicker');
    const memoBtn = $('storyMemoBtn');
    const rightFabs = document.querySelector<HTMLElement>('.story-fab-right');
    if (this.picking) {
      picker.hidden = false;
      memoBtn.hidden = true;
      if (rightFabs) rightFabs.hidden = true;
      this.renderPicker(p);
    } else {
      picker.hidden = true;
      memoBtn.hidden = false;
      if (rightFabs) rightFabs.hidden = false;
    }

  }

  private renderPicker(p: Player) {
    const pk = this.picking!;
    const choices: DecoChoice[] = pk.task.choices ?? [];
    const cur = choices[pk.selected];
    $('storyPickLabel').textContent = pk.mode === 'buy'
      ? `${cur?.label ?? ''}　${pk.task.cost} コイン`
      : `${cur?.label ?? ''}　無料で変更`;

    const row = $('storyPickChoices');
    if (row.dataset.task !== pk.task.id) {
      row.dataset.task = pk.task.id;
      row.textContent = '';
      for (const c of choices) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pick-bubble';
        btn.dataset.id = String(c.id);
        btn.title = c.label;
        const im = document.createElement('img');
        im.src = `${c.thumb}?v=${STORY_ASSET_V}`;
        im.alt = c.label;
        btn.appendChild(im);
        btn.onclick = () => {
          const now = this.picking;
          if (!now) return;
          now.selected = c.id;
          this.iso.syncState(this.conn.player.story, { taskId: now.task.id, choice: c.id }, true);
          this.render(this.conn.player);
        };
        row.appendChild(btn);
      }
    }
    for (const b of row.children) (b as HTMLElement).classList.toggle('on', Number((b as HTMLElement).dataset.id) === pk.selected);

    const ok = $<HTMLButtonElement>('storyPickConfirm');
    ok.disabled = pk.mode === 'buy' && p.coins < pk.task.cost;
  }

  // ---------- 立ち絵付きビジュアルノベル会話 ----------

  private playDialog(lines: DialogLine[], onDone?: () => void) {
    if (!lines.length) {
      onDone?.();
      return;
    }
    this.dialogQueue = steadySides(lines);
    this.dialogIdx = 0;
    this.onDialogDone = onDone ?? null;
    $('storyDialog').hidden = false;
    this.renderDialogLine();
  }

  private renderDialogLine() {
    const line = this.dialogQueue[this.dialogIdx];
    if (!line) return this.finishDialog();

    const leftWrap = $('dlgLeft');
    const rightWrap = $('dlgRight');
    const leftImg = $<HTMLImageElement>('dlgLeftImg');
    const rightImg = $<HTMLImageElement>('dlgRightImg');

    leftWrap.classList.remove('active', 'dim');
    rightWrap.classList.remove('active', 'dim');

    if (!line.speaker) {
      leftWrap.hidden = true;
      rightWrap.hidden = true;
      $('dlgName').hidden = true;
    } else {
      const sp = SPEAKERS[line.speaker];
      const nameEl = $('dlgName');
      nameEl.hidden = false;
      nameEl.textContent = sp.name;
      nameEl.style.background = sp.color;

      const side = line.side ?? (line.speaker === 'reina' ? 'left' : 'right');
      if (side === 'left') {
        leftWrap.hidden = false;
        leftImg.src = portraitSrc(line.speaker, line.expr);
        leftWrap.classList.add('active');
        if (line.other) {
          rightWrap.hidden = false;
          rightImg.src = portraitSrc(line.other.speaker, line.other.expr);
          rightWrap.classList.add('dim');
        } else {
          rightWrap.hidden = true;
        }
      } else {
        rightWrap.hidden = false;
        rightImg.src = portraitSrc(line.speaker, line.expr);
        rightWrap.classList.add('active');
        if (line.other) {
          leftWrap.hidden = false;
          leftImg.src = portraitSrc(line.other.speaker, line.other.expr);
          leftWrap.classList.add('dim');
        } else {
          leftWrap.hidden = true;
        }
      }
    }

    $('dlgText').textContent = line.text;
    $('dlgCount').textContent = `${this.dialogIdx + 1} / ${this.dialogQueue.length}`;
  }

  private advanceDialog() {
    this.dialogIdx++;
    if (this.dialogIdx >= this.dialogQueue.length) {
      this.finishDialog();
    } else {
      this.renderDialogLine();
    }
  }

  private closeDialog() {
    $('storyDialog').hidden = true;
    this.dialogQueue = [];
    this.dialogIdx = 0;
    this.onDialogDone = null;
  }

  private finishDialog() {
    const cb = this.onDialogDone;
    this.closeDialog();
    cb?.();
  }

  /** 50% のプレゼント: スタミナ（中）と発生器の部品レベル1 */
  private showHalfModal(ch: StoryChapter, energy: number, part?: number, gift?: number) {
    this.rewardIsHalf = true;
    $('storyRewardTitle').textContent = `${ch.title} 50% 達成！`;
    $('storyRewardSub').textContent = `「${ch.areaName}」が半分まできれいになったよ！ プレゼントをどうぞ！`;
    $('rwXpBox').hidden = true;
    $('rwGemsBox').hidden = true;
    $('rwEnergyLabel').textContent = 'スタミナ';
    $('rwEnergy').textContent = `+${energy}`;
    this.showPart(part);
    this.showGift(gift);
    this.openRewardModal();
  }

  private showGift(gift?: number) {
    $('rwGiftBox').hidden = gift === undefined;
    if (gift !== undefined) {
      $<HTMLImageElement>('rwGiftImg').src = `assets/items/${gift}.png`;
      $('rwGiftName').textContent = itemName(gift);
    }
  }

  private showPart(part?: number) {
    const partBox = $('rwPartBox');
    partBox.hidden = part === undefined;
    if (part !== undefined) {
      $<HTMLImageElement>('rwPartImg').src = `assets/items/${part}.png`;
      $('rwPartName').textContent = `${chainOfKind(part).name}の部品`;
    }
  }

  private showClearModal(ch: StoryChapter, rw: ChapterReward, part?: number, gift?: number) {
    this.rewardIsHalf = false;
    $('rwXpBox').hidden = false;
    $('rwGemsBox').hidden = false;
    $('rwEnergyLabel').textContent = 'スタミナ';
    $('storyRewardTitle').textContent = `${ch.title} クリア！`;
    // 次のストーリーの場所を案内する（雲はお店の区画にはかけていないので「雲が晴れた」とは言わない）
    const nextCh = CHAPTERS.find((c) => c.id === ch.id + 1);
    const nextHint = ch.id === 2
      ? '外まわりが完了！次はパン屋さんの中をきれいにしましょう！'
      : nextCh ? `次は「${nextCh.areaName}」を直しにいこう！` : '商店街がまたひとつ元気になりました！続きのストーリーをお楽しみに！';
    $('storyRewardSub').textContent = `「${ch.areaName}」完了！ ${nextHint}`;
    $('rwXp').textContent = `+${rw.xp}`;
    $('rwEnergy').textContent = `+${rw.energy}`;
    $('rwGems').textContent = `+${rw.gems}`;
    // 発生器の部品とプレゼント箱（マージ画面の左下の受け取り枠に入る）
    this.showPart(part);
    this.showGift(gift);
    this.openRewardModal();
  }

  private openRewardModal() {
    this.finishRewardFx?.();
    const modal = $('storyRewardModal');
    $('storyRewardLogo').hidden = !this.rewardIsHalf;
    $('storyClearLogo').hidden = this.rewardIsHalf;
    const theme = this.rewardIsHalf ? 'half' : 'story';
    modal.dataset.award = theme;
    modal.querySelector<HTMLImageElement>('.story-reward-chara')!.src = `assets/story/reina_smile.png?v=${STORY_ASSET_V}`;
    modal.hidden = false;
    // 裏の画面（ゲージ・ボタン）は、キーボードでも押せないようにする
    for (const el of $('storyView').children) if (el !== modal) (el as HTMLElement).inert = true;
    const finishBox = playStoryReward(modal, $(this.rewardIsHalf ? 'storyGift50' : 'storyGift100'));
    const finishSparkles = scatterAward(modal, theme, 1030);
    this.finishRewardFx = () => { finishBox(); finishSparkles(); };
    // 「動きを減らす」設定では演出がないので、すぐ閉じられる
    const fxMs = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : REWARD_FX_MS;
    this.rewardFxUntil = performance.now() + fxMs;
    window.setTimeout(() => { if (!modal.hidden) $('storyRewardClose').focus({ preventScroll: true }); }, fxMs);
    // 呼んだ側が pending を消したあとに、ゲージの箱を開封済みにする（演出中はゲージの箱は隠れている）
    queueMicrotask(() => this.render(this.conn.player));
  }

  /** 報酬の演出の途中なら、演出を最後まで飛ばす（Esc で、報酬を見ないまま閉じないように） */
  private skipRewardFx(): boolean {
    if (performance.now() >= this.rewardFxUntil) return false;
    this.finishRewardFx?.();
    this.rewardFxUntil = 0;
    $('storyRewardClose').focus({ preventScroll: true });
    return true;
  }
}

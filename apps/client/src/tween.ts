// 小さなトゥイーン。Pixi の ticker で動かす。
import type { Ticker } from 'pixi.js';

type Tw = {
  t: number;
  dur: number;
  step: (k: number) => void;
  ease: (k: number) => number;
  done?: () => void;
  key?: object;
};

export const ease = {
  linear: (k: number) => k,
  outCubic: (k: number) => 1 - (1 - k) ** 3,
  outBack: (k: number) => {
    const c = 1.7;
    return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
  },
  inOutSine: (k: number) => -(Math.cos(Math.PI * k) - 1) / 2,
};

/** key が Pixi の物で、もう destroy されているか */
const gone = (tw: Tw) => !!tw.key && (tw.key as { destroyed?: boolean }).destroyed === true;

/** 1回だけ動かす。エラーになったら false（そのトゥイーンはやめる） */
function safe(f: () => void): boolean {
  try {
    f();
    return true;
  } catch (e) {
    console.warn('tween', e);
    return false;
  }
}

export class Tweens {
  private list: Tw[] = [];

  constructor(ticker: Ticker) {
    ticker.add((t) => this.update(t.deltaMS));
  }

  /** key が同じものは前のトゥイーンを止めて最後の状態にする */
  add(dur: number, step: (k: number) => void, opts: { ease?: (k: number) => number; done?: () => void; key?: object } = {}) {
    if (opts.key) this.finish(opts.key);
    this.list.push({ t: 0, dur, step, ease: opts.ease ?? ease.outCubic, done: opts.done, key: opts.key });
  }

  finish(key: object) {
    const hit = this.list.filter((tw) => tw.key === key);
    if (!hit.length) return;
    this.list = this.list.filter((tw) => tw.key !== key);
    for (const tw of hit) {
      if (gone(tw)) continue;
      safe(() => tw.step(1));
      safe(() => tw.done?.());
    }
  }

  private update(ms: number) {
    if (!this.list.length) return;
    const ended: Tw[] = [];
    for (const tw of this.list) {
      // 動かしている物が消えた（destroy された）トゥイーンは、その場でやめる（毎フレームのエラーにしない）
      if (gone(tw)) {
        ended.push(tw);
        continue;
      }
      tw.t += ms;
      const k = Math.min(1, tw.t / tw.dur);
      if (!safe(() => tw.step(tw.ease(k)))) {
        ended.push(tw);
        tw.done = undefined;
        continue;
      }
      if (k >= 1) ended.push(tw);
    }
    if (ended.length) {
      this.list = this.list.filter((tw) => !ended.includes(tw));
      for (const tw of ended) if (!gone(tw)) safe(() => tw.done?.());
    }
  }
}

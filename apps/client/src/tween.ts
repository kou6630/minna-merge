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
      tw.step(1);
      tw.done?.();
    }
  }

  private update(ms: number) {
    if (!this.list.length) return;
    const ended: Tw[] = [];
    for (const tw of this.list) {
      tw.t += ms;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(tw.ease(k));
      if (k >= 1) ended.push(tw);
    }
    if (ended.length) {
      this.list = this.list.filter((tw) => !ended.includes(tw));
      for (const tw of ended) tw.done?.();
    }
  }
}

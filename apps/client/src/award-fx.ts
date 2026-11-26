type AwardTheme = 'level' | 'orders' | 'story' | 'half';

/** 粒の軌道を最初に計算し、再生中の移動と回転はブラウザに任せる。 */
export function scatterAward(host: HTMLElement, theme: AwardTheme, delay = 0): () => void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const field = document.createElement('div');
  field.className = 'award-particles';
  field.setAttribute('aria-hidden', 'true');
  host.append(field);
  const width = field.clientWidth;
  const height = field.clientHeight;
  const span = Math.min(width, 960);
  const rise = Math.min(height * .49, 370);
  const count = width < 560 ? 44 : 68;
  const animations: Animation[] = [];
  const random = Math.random;
  for (let i = 0; i < count; i++) {
    const bit = document.createElement('i');
    const glint = i % 4 === 0;
    bit.className = glint ? 'award-glint' : theme === 'story' ? 'award-petal' : theme === 'orders' ? 'award-foil' : 'award-crystal';
    const depth = .5 + random() * .85;
    bit.style.setProperty('--size', `${(glint ? 13 : 9) * depth}px`);
    bit.style.setProperty('--tint', `var(--foil-${i % 3})`);
    field.append(bit);
    const side = i % 2 ? 1 : -1;
    const phase = random() * Math.PI * 2;
    const reach = .22 + random() * .65;
    const lift = .65 + random() * .65;
    const twist = (140 + random() * 380) * side;
    const frames: Keyframe[] = [];
    for (let j = 0; j <= 16; j++) {
      const t = j / 16;
      let x: number, y: number;
      if (theme === 'orders') {
        // 左右から打ち上げる紙吹雪。いったん高く舞い、ひらひら落ちる。
        x = side * span * (.47 - reach * t) + 15 * t * Math.sin(phase + t * 9);
        y = height * .16 - rise * lift * 4 * t * (1 - t) + rise * .57 * t;
      } else if (theme === 'story') {
        // 箱から扇形に吹き出した桜は、風向きが変わって横に流れる。
        x = side * span * reach * .72 * (1 - (1 - t) ** 3) + 34 * t * Math.sin(phase + t * 7);
        y = -rise * lift * Math.sin(t * Math.PI) + rise * .56 * t * t;
      } else {
        // 星が螺旋状に上がり、奥の粒と手前の粒で奥行きがつく。
        x = Math.sin(phase + t * 5) * (.08 + .63 * t) * span * reach;
        y = rise * (.78 - 2.35 * t * lift);
      }
      frames.push({
        transform: `translate3d(${x}px,${y}px,0) rotate(${phase * 50 + twist * t}deg) rotateY(${glint ? 0 : twist * t * 1.6}deg) scale(${depth * (.55 + .45 * Math.sin(Math.PI * t))})`,
        opacity: Math.min(1, t * 9, (1 - t) * 4),
      });
    }
    animations.push(bit.animate(frames, {
      delay: delay + random() * 570, duration: 1500 + random() * 1150, fill: 'both',
    }));
  }
  const lettering = host.querySelector<HTMLElement>('.award-lettering, .story-clear-logo:not([hidden]), .story-reward-logo:not([hidden])');
  if (lettering) animations.push(lettering.animate([
    { transform: 'translateY(10px) scale(.78)', opacity: 0 },
    { transform: 'translateY(-2px) scale(1.045)', opacity: 1, offset: .68 },
    { transform: 'none', opacity: 1 },
  ], { duration: 540, delay: delay ? delay + 350 : 100, fill: 'backwards', easing: 'ease-out' }));
  const stop = () => {
    field.remove();
    animations.forEach(a => a.cancel());
  };
  void Promise.all(animations.map(a => a.finished)).then(stop, () => {});
  return stop;
}

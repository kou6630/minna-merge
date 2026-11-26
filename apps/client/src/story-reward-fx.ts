/** ゲージと同じ箱を開け、実際に獲得したアイコンを報酬欄へ飛ばす。 */
export function playStoryReward(modal: HTMLElement, marker: HTMLElement): () => void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};

  const card = modal.querySelector<HTMLElement>('.story-reward-card')!;
  const source = marker.querySelector('svg')!;
  const start = source.getBoundingClientRect();
  const stage = document.createElement('div');
  stage.className = 'story-reward-stage';
  stage.setAttribute('aria-hidden', 'true');
  const box = source.cloneNode(true) as SVGSVGElement;
  stage.append(box);
  modal.append(stage);

  const rect = stage.getBoundingClientRect();
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = start.x + start.width / 2 - cx;
  const dy = start.y + start.height / 2 - cy;
  marker.style.visibility = 'hidden';
  card.inert = true;
  const fade = card.animate([{ opacity: 0 }, { opacity: 1 }], {
    delay: 1410, duration: 430, fill: 'backwards',
  });
  box.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${start.width / rect.width})` },
    { transform: `translate(${dx * .38}px, ${dy * .7}px) rotate(-14deg) scale(.62)`, offset: .5 },
    { transform: 'translateY(-5px) rotate(4deg) scale(1.06)', offset: .84 },
    { transform: 'none' },
  ], { duration: 660, easing: 'ease-out' });

  const release = (selector: string, transform: string, delay: number) => {
    box.querySelector(selector)!.animate([
      { transform: 'none', opacity: 1 }, { transform, opacity: 0 },
    ], { delay, duration: 380, easing: 'ease-out', fill: 'forwards' });
  };
  release('.gift-band', 'translate(10px, 1px) rotate(68deg) scaleY(.45)', 660);
  release('.gift-bow', 'translate(-9px, -6px) rotate(-48deg)', 690);
  release('.gift-lid', 'translate(5px, -12px) rotate(26deg)', 930);

  const icons = [...card.querySelectorAll<HTMLImageElement>('.reward-item:not([hidden]) img')];
  icons.forEach((icon, i) => {
    const target = icon.getBoundingClientRect();
    const item = icon.cloneNode() as HTMLImageElement;
    item.removeAttribute('id');
    item.alt = '';
    item.className = 'story-reward-drop';
    stage.append(item);
    const fan = icons.length === 1 ? 0 : i / (icons.length - 1) * 2 - 1;
    const spread = Math.min(modal.clientWidth * .30, 145);
    item.animate([
      { opacity: 0, transform: 'translate(0, 0) scale(.18)' },
      { opacity: 1, transform: `translate(${fan * spread}px, ${-90 - 36 * (1 - Math.abs(fan))}px) scale(1.18)`, offset: .48 },
      { opacity: 1, transform: `translate(${target.x + target.width / 2 - cx}px, ${target.y + target.height / 2 - cy}px) scale(1)` },
    ], { delay: 1030 + i * 40, duration: 790, easing: 'ease-in-out', fill: 'both' });
  });

  const settle = stage.animate([{ opacity: 1 }, { opacity: 0 }], {
    delay: Math.max(1690, 1030 + (icons.length - 1) * 40 + 790 + 40), duration: 330, fill: 'forwards',
  });
  function finish() {
    settle.onfinish = null;
    stage.remove();
    fade.cancel();
    marker.style.removeProperty('visibility');
    card.inert = false;
  }
  settle.onfinish = finish;
  return finish;
}

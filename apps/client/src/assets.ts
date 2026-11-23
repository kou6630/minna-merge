// 生成した素材（public/assets）を読み込む。無いものは仮の絵を作って埋める。
import { Assets, Container, Graphics, Text, Texture } from 'pixi.js';
import type { Application } from 'pixi.js';
import { allKinds, chainOfKind, tierOfKind } from '@minna/shared';
import type { TexBank } from './board.ts';

export type Manifest = {
  items: Record<string, string>;
  customers: { key: string; src: string }[];
  owners: { key: string; src: string }[];
  icons: Record<string, string>;
  bg: Record<string, string>;
};

const EMPTY: Manifest = { items: {}, customers: [], owners: [], icons: {}, bg: {} };

export async function loadManifest(): Promise<Manifest> {
  try {
    const r = await fetch('assets/manifest.json', { cache: 'no-cache' });
    return r.ok ? ((await r.json()) as Manifest) : EMPTY;
  } catch {
    return EMPTY;
  }
}

const CHAIN_COLORS = [0xe8b765, 0xf59ac0, 0x7cc66b, 0xf7d046, 0x6fb3e0, 0xc9a0e8, 0xa0a8b0];

function placeholder(app: Application, kind: number): Texture {
  const c = new Container();
  const idx = Math.floor(kind / 100);
  const color = CHAIN_COLORS[idx % CHAIN_COLORS.length] ?? 0xcccccc;
  c.addChild(new Graphics().roundRect(0, 0, 96, 96, 24).fill(color).stroke({ width: 6, color: 0x4a2f1d }));
  const label = new Text({
    text: `${chainOfKind(kind).name}\n${tierOfKind(kind)}`,
    style: { fontSize: 22, fontWeight: '800', fill: 0x4a2f1d, align: 'center' },
  });
  label.anchor.set(0.5);
  label.position.set(48, 48);
  c.addChild(label);
  const t = app.renderer.generateTexture(c);
  c.destroy({ children: true });
  return t;
}

function plain(app: Application, color: number): Texture {
  const g = new Graphics().rect(0, 0, 64, 64).fill(color);
  const t = app.renderer.generateTexture(g);
  g.destroy();
  return t;
}

export async function loadTextures(app: Application, m: Manifest): Promise<TexBank> {
  const items = new Map<number, Texture>();
  await Promise.all(
    allKinds().map(async (kind) => {
      const src = m.items[kind];
      if (!src) return;
      try {
        items.set(kind, await Assets.load<Texture>(src));
      } catch {
        /* 仮の絵にする */
      }
    }),
  );
  const load = async (src: string | undefined, fallback: number) => {
    if (src) {
      try {
        return await Assets.load<Texture>(src);
      } catch {
        /* noop */
      }
    }
    return plain(app, fallback);
  };
  const owners = new Map<string, Texture>();
  await Promise.all(
    m.owners.map(async (o) => {
      try {
        owners.set(o.key, await Assets.load<Texture>(o.src));
      } catch {
        /* 絵なしで表示 */
      }
    }),
  );
  const ground = await load(m.bg.ground, 0xe9dcc4);
  const shutter = await load(m.bg.shutter, 0x8a8278);
  return {
    item(kind) {
      let t = items.get(kind);
      if (!t) {
        t = placeholder(app, kind);
        items.set(kind, t);
      }
      return t;
    },
    ground,
    shutter,
    owner(key) {
      return owners.get(key) ?? null;
    },
  };
}

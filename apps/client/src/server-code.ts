// サーバーの指定のしかた: 招待リンク / サーバーコード（Gist の ID）/ 直接アドレス

export type ServerRef = { gist: string } | { address: string };

const GIST_ID = /^[0-9a-f]{20,40}$/i;

/** 「localhost:8787」なども受け付けて ws:// か wss:// の形にする */
export function normalizeAddress(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, 'ws');
  if (!/^wss?:\/\//i.test(s)) {
    const host = s.split(/[/:]/)[0] ?? '';
    const local = /^(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(host);
    s = (local ? 'ws://' : 'wss://') + s;
  }
  try {
    return new URL(s).toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** 入力されたものを、サーバーコードか直接アドレスに分ける */
export function parseServerInput(raw: string): ServerRef | null {
  const s = raw.trim();
  if (!s) return null;
  const join = s.match(/[?&]join=([0-9a-f]{20,40})/i);
  if (join) return { gist: join[1]!.toLowerCase() };
  const gist = s.match(/gist\.github(?:usercontent)?\.com\/(?:[^/\s]+\/)?([0-9a-f]{20,40})/i);
  if (gist) return { gist: gist[1]!.toLowerCase() };
  if (GIST_ID.test(s)) return { gist: s.toLowerCase() };
  const address = normalizeAddress(s);
  return address ? { address } : null;
}

export type GistServer = { id: string; name: string; url: string; online: boolean };

/** サーバーコード（Gist）から、サーバーの今の住所を調べる */
export async function resolveGist(gist: string, fetcher: typeof fetch = fetch): Promise<GistServer | null> {
  try {
    const r = await fetcher(`https://api.github.com/gists/${gist}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { files?: Record<string, { content?: string }> };
    const content = j.files?.['minna-merge-server.json']?.content;
    if (!content) return null;
    const c = JSON.parse(content) as Partial<GistServer>;
    if (typeof c.id !== 'string' || typeof c.name !== 'string') return null;
    return { id: c.id, name: c.name, url: typeof c.url === 'string' ? c.url : '', online: !!c.online && !!c.url };
  } catch {
    return null;
  }
}

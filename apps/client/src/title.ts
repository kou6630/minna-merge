// タイトル画面: サーバーが起動しているか確かめ、起動していたら「はじめる」で入る
import type { ServerInfo } from '@minna/shared';
import type { Conn } from './conn.ts';
import { RemoteServer, probe } from './remote.ts';
import { parseServerInput, resolveGist } from './server-code.ts';
import { isOwnerBrowser, isOwnerKey, markOwnerBrowser } from './owner.ts';

/** 一覧の1行。gist（サーバーコード）か address（直接アドレス）のどちらか */
type Entry = { address?: string; gist?: string; id?: string; name?: string };

const SERVERS_KEY = 'minna-merge:servers';
const TOKENS_KEY = 'minna-merge:tokens';
const NAME_KEY = 'minna-merge:name';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function load<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, v: unknown) {
  try {
    localStorage.setItem(key, typeof v === 'string' ? v : JSON.stringify(v));
  } catch {
    /* 保存できない環境 */
  }
}

export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export type StartFn = (conn: Conn | 'solo' | 'story-preview') => void;

export class Title {
  private servers: Entry[] = load<Entry[]>(SERVERS_KEY, []);
  private tokens: Record<string, string> = load<Record<string, string>>(TOKENS_KEY, {});
  private busy = false;
  /** 接続試行の世代番号（もどる・ソロ開始・削除で上げて古い接続結果を破棄する） */
  private attempt = 0;
  private started = false;
  private joinFor: { entry: Entry; info: ServerInfo; address: string } | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking = false;
  private gistAddr = new Map<string, { address: string | null; at: number }>();

  constructor(private onStart: StartFn) {
    if (!this.servers.length) this.servers = [{ address: 'ws://localhost:8787', name: 'このPCのサーバー' }];
    $('startBtn').addEventListener('click', () => void this.enter(this.current()));
    $('joinCancel').addEventListener('click', () => this.closeJoin());
    $('joinForm').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submitJoin();
    });
    // 「ひとりで練習」（?solo）「ストーリー確認」（?story）は持ち主のブラウザだけ（開発サーバー中・localhost では常に使える）
    const local = ['localhost', '127.0.0.1'].includes(location.hostname) || import.meta.env.DEV;
    const canLocal = local || isOwnerBrowser();
    void this.checkOwnerLink();

    const params = new URLSearchParams(location.search);
    if (canLocal && (params.has('story') || params.has('solo'))) {
      this.launch(params.has('story') ? 'story-preview' : 'solo');
      return;
    }

    // 招待リンク（?join=サーバーコード）で開かれたら、一覧に足してそのまま入る
    const join = params.get('join');
    if (join) {
      params.delete('join');
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
      const ref = parseServerInput(join);
      if (ref && 'gist' in ref) {
        const entry = this.addEntry(ref);
        this.markUsed(entry);
        void this.enter(entry);
      }
    }
    void this.check();
    this.timer = setInterval(() => void this.check(), 3000);
  }

  /** 自分用リンク（?owner=鍵）で開かれたら、このブラウザで「ひとりで練習」を使えるようにする */
  private async checkOwnerLink() {
    const params = new URLSearchParams(location.search);
    const key = params.get('owner');
    if (!key) return;
    params.delete('owner');
    const q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
    if (await isOwnerKey(key)) {
      markOwnerBrowser();
      if (params.has('story') || params.has('solo')) {
        this.launch(params.has('story') ? 'story-preview' : 'solo');
        return;
      }
      this.msg('このブラウザで「ひとりで練習」（アドレスの最後に ?solo）と「ストーリー確認」（?story）が使えるようになりました');
    } else {
      this.msg('自分用リンクがちがいます');
    }
  }

  /** 進行中の接続試行を取り消す */
  private cancelPending() {
    this.attempt++;
    this.busy = false;
    $<HTMLButtonElement>('startBtn').disabled = false;
  }

  /** ゲーム開始（2重起動を防ぎ、裏で待っていた接続もすべて破棄する） */
  private launch(target: Conn | 'solo' | 'story-preview') {
    if (this.started) {
      if (target instanceof RemoteServer) target.close();
      return;
    }
    this.started = true;
    clearInterval(this.timer);
    this.cancelPending();
    this.joinFor = null;
    $('joinDlg').hidden = true;
    this.onStart(target);
  }

  private addEntry(ref: { gist: string } | { address: string }): Entry {
    const found = this.servers.find((s) => ('gist' in ref ? s.gist === ref.gist : s.address === ref.address));
    if (found) return found;
    const entry: Entry = { ...ref };
    this.servers.push(entry);
    this.saveServers();
    return entry;
  }

  /** 今つなぐ住所。サーバーコードなら Gist から調べる */
  private async addressOf(entry: Entry): Promise<{ address: string | null; offline?: boolean; missing?: boolean }> {
    if (!entry.gist) return { address: entry.address ?? null };
    const g = await resolveGist(entry.gist);
    if (!g) return { address: null, missing: true };
    if (entry.name !== g.name || entry.id !== g.id) {
      entry.name = g.name;
      entry.id = g.id;
      this.saveServers();
    }
    return g.online ? { address: g.url } : { address: null, offline: true };
  }

  /** サーバーコードの行なら、つなぎ直すたびに住所を調べ直す関数を渡す */
  private resolverFor(entry: Entry): (() => Promise<string | null | undefined>) | undefined {
    const gist = entry.gist;
    if (!gist) return undefined;
    return async () => {
      const g = await resolveGist(gist);
      if (!g) return undefined; // 調べられなかった
      return g.online ? g.url : null;
    };
  }

  private saveServers() {
    store(SERVERS_KEY, this.servers);
  }

  private msg(text: string | null) {
    const el = $('titleMsg');
    el.hidden = !text;
    el.textContent = text ?? '';
  }

  /** 入るサーバー（起動しているもののうち、いちばん最近入ったもの） */
  private onlineEntry: Entry | null = null;
  private current(): Entry {
    return this.onlineEntry ?? this.servers[0]!;
  }

  /** 入れたサーバーを一覧の先頭にする（次に開いたとき、まずそこを確かめる） */
  private markUsed(entry: Entry) {
    this.servers = [entry, ...this.servers.filter((s) => s !== entry)];
    this.saveServers();
  }

  /** サーバーの住所。サーバーコードなら Gist を調べるのは1分に1回まで（GitHub の回数制限があるので） */
  private async addressCached(entry: Entry): Promise<{ address: string | null; missing?: boolean }> {
    const c = entry.gist ? this.gistAddr.get(entry.gist) : undefined;
    if (c && Date.now() - c.at < 60_000) return { address: c.address };
    const w = await this.addressOf(entry);
    if (entry.gist) this.gistAddr.set(entry.gist, { address: w.address, at: Date.now() });
    return w;
  }

  /** サーバーが起動しているか確かめ、起動していたら「はじめる」を出す（一覧の上から順に、最初に起動していたもの） */
  private async check() {
    if (this.started || this.checking) return;
    this.checking = true;
    let entry: Entry | null = null;
    let info: ServerInfo | null = null;
    let missing = false;
    for (const e of [...this.servers]) {
      const w = await this.addressCached(e);
      if (w.missing) missing = true;
      info = w.address ? await probe(w.address) : null;
      if (info) {
        entry = e;
        break;
      }
    }
    this.checking = false;
    if (this.started) return;
    this.onlineEntry = entry;
    const st = $('titleStatus');
    if (!entry || !info) {
      st.className = 'title-status';
      st.textContent = missing ? 'サーバーが見つかりません' : 'サーバー確認中…';
      $('startBtn').hidden = true;
      return;
    }
    if (entry.name !== info.name || entry.id !== info.id) {
      entry.name = info.name;
      entry.id = info.id;
      this.saveServers();
    }
    st.className = 'title-status is-on';
    st.textContent = `${info.name}　${info.online}人が遊んでいます`;
    $('startBtn').hidden = false;
  }

  private async enter(entry: Entry) {
    if (this.busy || this.started) return;
    const my = ++this.attempt;
    this.busy = true;
    $<HTMLButtonElement>('startBtn').disabled = true;
    this.msg(null);
    const where = await this.addressOf(entry);
    if (this.started || my !== this.attempt || !this.servers.includes(entry)) return;
    if (!where.address) {
      this.busy = false;
      $<HTMLButtonElement>('startBtn').disabled = false;
      return this.msg(
        where.missing ? 'サーバーコードが見つかりません' : 'サーバーが起動していません。立てている人に聞いてください',
      );
    }
    const address = where.address;
    const r = await RemoteServer.connect(
      address,
      (info) => {
        const t = this.tokens[info.id];
        return t ? { token: t } : null;
      },
      this.resolverFor(entry),
    );
    if (this.started || my !== this.attempt || !this.servers.includes(entry)) {
      if (r.ok) r.conn.close();
      return;
    }
    this.busy = false;
    $<HTMLButtonElement>('startBtn').disabled = false;
    if (r.ok) {
      entry.id = r.info.id;
      entry.name = r.info.name;
      this.markUsed(entry);
      this.launch(r.conn);
      return;
    }
    if ((r.reason === 'need-join' || r.reason === 'token') && r.info) {
      if (r.reason === 'token') delete this.tokens[r.info.id];
      store(TOKENS_KEY, this.tokens);
      this.openJoin(entry, r.info, address);
      return;
    }
    this.msg(r.text);
  }

  private openJoin(entry: Entry, info: ServerInfo, address: string) {
    if (this.started) return;
    this.joinFor = { entry, info, address };
    $('joinServer').textContent = info.name;
    $<HTMLInputElement>('joinName').value = savedName();
    $<HTMLInputElement>('joinPass').value = '';
    $('joinErr').hidden = true;
    $('joinDlg').hidden = false;
    ($<HTMLInputElement>('joinName').value ? $('joinPass') : $('joinName')).focus();
  }

  private closeJoin() {
    this.joinFor = null;
    $('joinDlg').hidden = true;
    this.cancelPending();
  }

  private async submitJoin() {
    const j = this.joinFor;
    if (!j || this.busy || this.started) return;
    const name = $<HTMLInputElement>('joinName').value.trim();
    const password = $<HTMLInputElement>('joinPass').value;
    const err = $('joinErr');
    if (!name) {
      err.hidden = false;
      err.textContent = '名前を入れてください';
      return;
    }
    const my = ++this.attempt;
    this.busy = true;
    const r = await RemoteServer.connect(j.address, () => ({ name, password }), this.resolverFor(j.entry));
    if (this.started || my !== this.attempt || this.joinFor !== j) {
      if (r.ok) r.conn.close();
      return;
    }
    this.busy = false;
    if (!r.ok) {
      err.hidden = false;
      err.textContent = r.text;
      return;
    }
    store(NAME_KEY, name);
    if (r.token) this.tokens[r.info.id] = r.token;
    store(TOKENS_KEY, this.tokens);
    j.entry.id = r.info.id;
    j.entry.name = r.info.name;
    this.markUsed(j.entry);
    this.launch(r.conn);
  }
}

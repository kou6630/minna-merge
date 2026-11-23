// タイトル画面: サーバー一覧（マイクラのマルチプレイ画面のように）・追加・参加
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

export type StartFn = (conn: Conn | 'solo') => void;

export class Title {
  private servers: Entry[] = load<Entry[]>(SERVERS_KEY, []);
  private tokens: Record<string, string> = load<Record<string, string>>(TOKENS_KEY, {});
  private busy = false;
  private joinFor: { entry: Entry; info: ServerInfo; address: string } | null = null;

  constructor(private onStart: StartFn) {
    if (!this.servers.length) this.servers = [{ address: 'ws://localhost:8787', name: 'このPCのサーバー' }];
    $('addServer').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $<HTMLInputElement>('addr');
      const ref = parseServerInput(input.value);
      if (!ref) return this.msg('招待リンク・サーバーコード・アドレスのどれかを入れてください');
      this.addEntry(ref);
      input.value = '';
      this.msg(null);
      this.render();
    });
    $('solo').addEventListener('click', () => this.onStart('solo'));
    $('joinCancel').addEventListener('click', () => this.closeJoin());
    $('joinForm').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submitJoin();
    });
    this.render();

    // 「ひとりで練習」は持ち主のブラウザだけ（開発中の localhost では常に出す）
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    $('solo').hidden = !(local || isOwnerBrowser());
    void this.checkOwnerLink();

    // 招待リンク（?join=サーバーコード）で開かれたら、一覧に足してそのまま入る
    const params = new URLSearchParams(location.search);
    const join = params.get('join');
    if (join) {
      params.delete('join');
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
      const ref = parseServerInput(join);
      if (ref && 'gist' in ref) {
        const entry = this.addEntry(ref);
        this.render();
        void this.enter(entry);
      }
    }
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
      $('solo').hidden = false;
      this.msg('このブラウザで「ひとりで練習」が使えるようになりました');
    } else {
      this.msg('自分用リンクがちがいます');
    }
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

  render() {
    const list = $('serverList');
    list.textContent = '';
    if (!this.servers.length) {
      const p = document.createElement('div');
      p.className = 'server-empty';
      p.textContent = 'サーバーがありません。アドレスを追加してください';
      list.appendChild(p);
    }
    for (const entry of this.servers) {
      const row = document.createElement('div');
      row.className = 'server';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = entry.name ?? entry.address ?? 'サーバー';
      const sub = document.createElement('div');
      sub.className = 'sub';
      const st = document.createElement('span');
      st.textContent = '確認中…';
      const where = entry.gist ? `コード ${entry.gist.slice(0, 8)}…` : (entry.address ?? '').replace(/^wss?:\/\//, '');
      sub.append(st, document.createTextNode(`　${where}`));
      meta.append(name, sub);
      const go = document.createElement('button');
      go.className = 'btn btn-small';
      go.type = 'button';
      go.textContent = '入る';
      go.onclick = () => void this.enter(entry);
      const del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.title = '一覧から消す';
      del.textContent = '×';
      del.onclick = () => {
        this.servers = this.servers.filter((s) => s !== entry);
        this.saveServers();
        this.render();
      };
      row.append(meta, go, del);
      list.appendChild(row);

      void (async () => {
        const where = await this.addressOf(entry);
        const info = where.address ? await probe(where.address) : null;
        if (where.address === null || !info) {
          st.className = 'st-off';
          st.textContent = where.missing ? '見つかりません' : 'オフライン';
          return;
        }
        st.className = 'st-on';
        st.textContent = `オンライン ${info.online}人`;
        if (entry.name !== info.name || entry.id !== info.id) {
          entry.name = info.name;
          entry.id = info.id;
          name.textContent = info.name;
          this.saveServers();
        }
      })();
    }
  }

  private async enter(entry: Entry) {
    if (this.busy) return;
    this.busy = true;
    this.msg(null);
    const where = await this.addressOf(entry);
    if (!where.address) {
      this.busy = false;
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
    this.busy = false;
    if (r.ok) {
      entry.id = r.info.id;
      entry.name = r.info.name;
      this.saveServers();
      this.onStart(r.conn);
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
  }

  private async submitJoin() {
    const j = this.joinFor;
    if (!j || this.busy) return;
    const name = $<HTMLInputElement>('joinName').value.trim();
    const password = $<HTMLInputElement>('joinPass').value;
    const err = $('joinErr');
    if (!name) {
      err.hidden = false;
      err.textContent = '名前を入れてください';
      return;
    }
    this.busy = true;
    const r = await RemoteServer.connect(j.address, () => ({ name, password }), this.resolverFor(j.entry));
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
    this.saveServers();
    this.closeJoin();
    this.onStart(r.conn);
  }
}

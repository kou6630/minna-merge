// config.json（サーバーの名前・ID・合言葉・ポート）。無ければ初回に作る。
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

export type Config = {
  serverId: string;
  serverName: string;
  password: string;
  port: number;
  /** 接続を許すゲーム画面の置き場所（localhost はいつでも許す） */
  allowedOrigins: string[];
  /** ゲーム画面のURL（招待リンクに使う） */
  pagesUrl: string;
  /** サーバーの今の住所を書く Gist（初回に自動で作る） */
  gistId?: string;
  /** 自分用リンクの鍵（「ひとりで練習」を使えるようにする。友達には教えない） */
  ownerKey?: string;
};

const DEFAULTS = {
  serverName: 'みんなの商店街',
  port: 8787,
  allowedOrigins: ['https://kou6630.github.io'],
  pagesUrl: 'https://kou6630.github.io/minna-merge/',
};

export function saveConfig(path: string, cfg: Config) {
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

export async function loadConfig(path: string): Promise<Config> {
  if (existsSync(path)) {
    const c = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>;
    const full: Config = {
      serverId: c.serverId ?? randomBytes(8).toString('hex'),
      serverName: c.serverName ?? DEFAULTS.serverName,
      password: c.password ?? '',
      port: c.port ?? DEFAULTS.port,
      allowedOrigins: c.allowedOrigins ?? DEFAULTS.allowedOrigins,
      pagesUrl: c.pagesUrl ?? DEFAULTS.pagesUrl,
      gistId: c.gistId,
      ownerKey: c.ownerKey,
    };
    if (!full.password) throw new Error(`${path} の password（合言葉）が空です`);
    return full;
  }

  let serverName = process.env.MINNA_SERVER_NAME ?? '';
  let password = process.env.MINNA_PASSWORD ?? '';
  if (process.stdin.isTTY && (!serverName || !password)) {
    console.log('はじめての起動です。サーバーの設定をします。');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    serverName = serverName || (await rl.question(`サーバーの名前（Enterで「${DEFAULTS.serverName}」）: `)).trim();
    while (!password) password = (await rl.question('合言葉（友達に教えるパスワード）: ')).trim();
    rl.close();
  }
  if (!password) password = String(1000 + (randomBytes(2).readUInt16BE() % 9000));
  const cfg: Config = {
    serverId: randomBytes(8).toString('hex'),
    serverName: serverName || DEFAULTS.serverName,
    password,
    port: Number(process.env.MINNA_PORT) || DEFAULTS.port,
    allowedOrigins: DEFAULTS.allowedOrigins,
    pagesUrl: DEFAULTS.pagesUrl,
  };
  saveConfig(path, cfg);
  console.log(`${path} を作りました。合言葉: ${cfg.password}`);
  return cfg;
}

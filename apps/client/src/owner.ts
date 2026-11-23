// 「ひとりで練習」は持ち主（サーバーを立てる人）のブラウザだけで使う。
// 自分用リンク（?owner=鍵）を一度開くと、このブラウザに印をつける。
// 鍵そのものはここに置かず、ハッシュだけを置く（鍵は config.json の ownerKey）。
const OWNER_HASH = '8978abaf8332fcba6d69461de2e26558083624095840027fd94efadb4147da20';
const OWNER_FLAG = 'minna-merge:owner';

export async function isOwnerKey(key: string): Promise<boolean> {
  const data = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === OWNER_HASH;
}

export function isOwnerBrowser(): boolean {
  try {
    return localStorage.getItem(OWNER_FLAG) === '1';
  } catch {
    return false;
  }
}

export function markOwnerBrowser() {
  try {
    localStorage.setItem(OWNER_FLAG, '1');
  } catch {
    /* 保存できない環境 */
  }
}

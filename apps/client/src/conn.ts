// 画面から見た「サーバー」。ひとりで練習（LocalServer）でも、通信（RemoteServer）でも同じ形。
import type { Action, CursorInfo, GameEvent, Op, Player, RejectReason, World } from '@minna/shared';

export type ServerListener = {
  ops(ops: Op[], events: GameEvent[]): void;
  reject(reason: RejectReason, text: string, action: Action): void;
  /** 通信の状態（null ならつながっている） */
  status?(text: string | null): void;
  /** 参加中のプレイヤーが変わった */
  online?(ids: string[]): void;
  /** ほかの人のカーソルが動いた */
  cursors?(list: CursorInfo[]): void;
};

export interface Conn {
  /** 画面に出している盤面 */
  readonly world: World;
  readonly me: string;
  readonly player: Player;
  /** サーバーの時計に合わせた今の時刻 */
  now(): number;
  on(l: ServerListener): void;
  /** 操作を送る。手元で明らかにだめなら false */
  send(a: Action): boolean;
  keepHold(id: number): void;
  /** 自分のカーソル（マス単位）。d はドラッグ中のアイテム */
  sendCursor(x: number, y: number, d?: number): void;
  readonly online: string[];
}

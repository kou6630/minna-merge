// 商店街復興ストーリー定義（1区画 = 1フェーズ / 1チャプター）

import { CHAPTERS_11, SPEAKERS_11 } from './story-ch11.ts';
import type { SpeakerId11 } from './story-ch11.ts';

export type SpeakerId = 'reina' | 'momo' | 'ryoji' | 'gorou' | 'takumi' | 'misaki' | 'yuri' | 'haruto' | 'kiyo' | 'daigo' | SpeakerId11;

export type Expression = 'lazy' | 'angry' | 'smug' | 'smile';

export type DialogLine = {
  /** 話し手（省略時はナレーション） */
  speaker?: SpeakerId;
  /** 表情（立ち絵ファイル: assets/story/<speaker>_<expr>.png） */
  expr?: Expression;
  /** 立ち絵の左右（left: 主人公側, right: 相手側） */
  side?: 'left' | 'right';
  /** もう片方に残しておきたい相手 */
  other?: { speaker: SpeakerId; expr: Expression };
  text: string;
};

export type DecoChoice = {
  id: number;
  label: string;
  desc: string;
  /** この選択肢を選んだときのフルサイズ 3D マップ画像（ズレ0px） */
  stageImg: string;
  /** 3択丸ボタン用のサムネイル */
  thumb: string;
};

/** マップ上のピン＆カメラフォーカス座標（% 単位） */
export type PinSpot = {
  x: number;
  y: number;
  zoom?: number;
};

/** 区画を覆う雲パーツの位置 */
export type CloudSpot = {
  x: number;
  y: number;
  w: number;
  img: string;
  label?: string;
  /** このチャプターをクリアしたら晴れる雲（次フェーズのお披露目） */
  unlocksOnClear?: boolean;
};

export type StoryTask = {
  id: string;
  title: string;
  desc: string;
  cost: number;
  /** タスク完了で切り替わるマップ画像（choices がないタスク用） */
  stageImg?: string;
  /** マップ上のピン＆カメラフォーカス位置 */
  pin: PinSpot;
  /** 3択で選べる設置アイテム */
  choices?: DecoChoice[];
  /** タスク完了時に流れる会話 */
  after: DialogLine[];
};

/**
 * 章クリアの報酬（だれでも同じ）。経験値は、ふつうに遊んでその章をクリアするころのレベルで、ちょうど半レベルぶん。
 * 1回で上がるのは多くても1レベル（engine の章クリアで止める）
 */
export type ChapterReward = {
  xp: number;
  energy: number;
  gems: number;
};

export type StoryChapter = {
  id: number;
  title: string;
  areaName: string;
  subtitle: string;
  /** 初期状態のマップ画像 */
  baseImg: string;
  /** クリア後に晴れる雲・奥の未解放区画の雲 */
  clouds: CloudSpot[];
  /** クリア後に出現する次フェーズ予告ピン */
  nextPhasePin?: { x: number; y: number; label: string };
  /** 入口付近に立つミニ主人公の位置 */
  avatarSpot?: { x: number; y: number };
  intro: DialogLine[];
  tasks: StoryTask[];
  outro: DialogLine[];
  reward: ChapterReward;
};

export type StoryProgress = {
  /** 完了したタスク id 一覧 */
  done: string[];
  /** タスク id → 選んだスタイル番号 (0..2) */
  choices: Record<string, number>;
  /** 導入会話を見たチャプター id */
  seenIntro: number[];
  /** クリア報酬を受け取ったチャプター id */
  claimed: number[];
  /** 50% のプレゼントを受け取ったチャプター id */
  half: number[];
};

export const SPEAKERS: Record<SpeakerId, { name: string; role: string; color: string }> = {
  reina: { name: 'レイナ', role: 'ギャルママ・35', color: '#e84a7f' },
  momo: { name: 'モモ', role: '娘・4歳', color: '#f59e0b' },
  ryoji: { name: 'リョウジ', role: '元旦那・38', color: '#4f5d95' },
  gorou: { name: 'ゴロウさん', role: 'パン屋の店主', color: '#9c6236' },
  takumi: { name: 'タクミ', role: '揚げ物屋をひらく若者・22', color: '#d9622b' },
  misaki: { name: 'ミサキ', role: 'ケーキ屋のパティシエ・28', color: '#e07aa5' },
  yuri: { name: 'ユリさん', role: '服屋のマダム', color: '#3f9e8f' },
  haruto: { name: 'ハルト', role: '喫茶店をひらく青年・30', color: '#8a5a3c' },
  kiyo: { name: 'キヨさん', role: '駄菓子屋のおばあちゃん・80', color: '#c0583e' },
  daigo: { name: 'ダイゴ', role: '元プロレスラーのトレーナー・34', color: '#d23b3b' },
  // 11〜20章の店主
  ...SPEAKERS_11,
};

export const STORY_ASSET_V = '13';

export function portraitSrc(speaker: SpeakerId, expr: Expression = 'smile'): string {
  const base = speaker === 'reina'
    ? `assets/story/reina_${expr}.png`
    : speaker === 'momo'
      ? `assets/story/momo_${expr === 'angry' ? 'angry' : 'smile'}.png`
      : speaker === 'ryoji'
        ? 'assets/story/ryoji_smug.png'
        : speaker === 'gorou' ? 'assets/story/gorou_smile.png' : `assets/story/${speaker}_smile.png`;
  return `${base}?v=${STORY_ASSET_V}`;
}

export function defaultStory(): StoryProgress {
  return { done: [], choices: {}, seenIntro: [], claimed: [], half: [] };
}

export function copyStory(s?: StoryProgress): StoryProgress {
  if (!s) return defaultStory();
  return {
    done: [...(s.done ?? [])],
    choices: { ...(s.choices ?? {}) },
    seenIntro: [...(s.seenIntro ?? [])],
    claimed: [...(s.claimed ?? [])],
    half: [...(s.half ?? [])],
  };
}

/** 50% のプレゼント: スタミナ（中）= クリア報酬のスタミナ（大）の半分（5 の倍数） */
/** ストーリーのスタミナは、章に書いた量の 7 割（多すぎて、ずっと遊べてしまうので）。5 の倍数にそろえる */
export const STORY_ENERGY_RATE = 0.7;
export function storyEnergy(ch: StoryChapter): number {
  return Math.max(5, Math.round((ch.reward.energy * STORY_ENERGY_RATE) / 5) * 5);
}

/** 50% のごほうびのスタミナ: クリアの半分 */
export function halfEnergy(ch: StoryChapter): number {
  return Math.max(5, Math.round(storyEnergy(ch) / 10) * 5);
}

/** チャプターのタスクが半分以上おわったか（進み具合のバーの 50% の箱と同じ判定） */
export function isChapterHalf(ch: StoryChapter, prog: StoryProgress): boolean {
  const done = ch.tasks.filter((t) => prog.done.includes(t.id)).length;
  return done * 2 >= ch.tasks.length;
}

export const CHAPTERS: StoryChapter[] = [
  {
    id: 1,
    title: 'ストーリー1',
    areaName: '商店街の入口エリア',
    subtitle: 'まずは入口から！ゴミをどかして、床と壁を磨いて、ボロボロの門を変えよう！',
    baseImg: 'assets/story/iso_stage0.jpg',
    avatarSpot: { x: 24, y: 86 },
    nextPhasePin: { x: 18, y: 54, label: '🔜 フェーズ2：パン屋さん　準備中' },
    clouds: [
      // フェーズ2：入口から1番近いパン屋さんを覆う雲（フェーズ1クリアで晴れる！）
      { x: 18, y: 54, w: 30, img: 'assets/story/cloud_0.png', label: 'フェーズ2：パン屋さん', unlocksOnClear: true },
      // フェーズ3以降：八百屋・花屋・魚屋・奥の商店街＆公園を覆う雲
      { x: 44, y: 40, w: 36, img: 'assets/story/cloud_1.png', label: 'フェーズ3〜 奥の商店街' },
      { x: 64, y: 32, w: 36, img: 'assets/story/cloud_2.png' },
      { x: 84, y: 18, w: 38, img: 'assets/story/cloud_3.png' },
      { x: 76, y: 52, w: 36, img: 'assets/story/cloud_0.png' },
      { x: 24, y: 20, w: 38, img: 'assets/story/cloud_3.png' },
      { x: 54, y: 14, w: 36, img: 'assets/story/cloud_1.png' },
      { x: 90, y: 42, w: 34, img: 'assets/story/cloud_2.png' },
    ],
    intro: [
      {
        text: '親から受け継いだ『あさひ商店街』――。かつては賑わった通りも、今やゴミと錆だらけ。',
      },
      {
        speaker: 'reina', expr: 'lazy', side: 'left',
        text: 'はぁ〜……マジしんど。35にもなって親から「商店街たのむわ」って鍵だけ丸投げされても、これただの廃墟じゃん……。',
      },
      {
        speaker: 'momo', expr: 'smile', side: 'right',
        other: { speaker: 'reina', expr: 'lazy' },
        text: 'ママー！あっちのゴミばこからダンゴムシでてきたよー！',
      },
      {
        speaker: 'reina', expr: 'lazy', side: 'left',
        other: { speaker: 'momo', expr: 'smile' },
        text: 'ちょ、モモ触んなって〜！ジェルネイル欠けるし腰も痛いし、今日はもうコンビニ飯でよくない……？',
      },
      {
        speaker: 'ryoji', expr: 'smug', side: 'right',
        other: { speaker: 'reina', expr: 'lazy' },
        text: 'おーおー、相変わらずダラしないなレイナ。35になってもその格好か？　なんだこのドブみたいな商店街は。',
      },
      {
        speaker: 'reina', expr: 'angry', side: 'left',
        other: { speaker: 'ryoji', expr: 'smug' },
        text: 'はぁ！？リョウジ！？アンタなんでここにいんのよ、とっくに籍抜いたでしょーが！',
      },
      {
        speaker: 'ryoji', expr: 'smug', side: 'right',
        other: { speaker: 'reina', expr: 'angry' },
        text: '惨めな暮らししてないか様子見に来てやったんだよ。お前に立て直しなんてどうせ無理だろ？　俺の元に帰ってこいよ、金ならいくらでもやるからさ。',
      },
      {
        speaker: 'momo', expr: 'angry', side: 'left',
        other: { speaker: 'ryoji', expr: 'smug' },
        text: 'やだっ！モモ、パパのとこなんか行かないもん！ママといっしょにここにいるのっ！',
      },
      {
        speaker: 'reina', expr: 'angry', side: 'left',
        other: { speaker: 'ryoji', expr: 'smug' },
        text: '……聞いた？リョウジ。ウチのモモもこう言ってんの。アンタの金なんかビタ一文いらねーし、二度と戻る気もねーわ！',
      },
      {
        speaker: 'reina', expr: 'smug', side: 'left',
        other: { speaker: 'ryoji', expr: 'smug' },
        text: '上等じゃん、そこまで言うなら見てろよ！このボロボロの商店街、アンタが悔しがるくらいピカピカに復活させてやっから！',
      },
      {
        speaker: 'ryoji', expr: 'smug', side: 'right',
        other: { speaker: 'reina', expr: 'smug' },
        text: 'ハッ、面白い冗談だな。せいぜい頑張れよ、すぐ泣きついてくる姿が目に浮かぶぜ。',
      },
      {
        speaker: 'reina', expr: 'angry', side: 'left',
        other: { speaker: 'momo', expr: 'angry' },
        text: 'ったく、あいつのあのムカつく顔！！絶対に見返してやっからね！！',
      },
      {
        speaker: 'momo', expr: 'smile', side: 'right',
        other: { speaker: 'reina', expr: 'smile' },
        text: 'うん！モモもおてつだいするー！まずはいりぐちのゴミからおそうじしようよ、ママ！',
      },
      {
        speaker: 'reina', expr: 'smile', side: 'left',
        other: { speaker: 'momo', expr: 'smile' },
        text: 'ありがとモモ！よし、ママ本気出しちゃうからね！まずは入口のゴミの山から片付けるよーっ！',
      },
    ],
    tasks: [
      {
        id: 'ch1_garbage',
        title: '入口のゴミをどかす',
        desc: '入口広場に山積みになったゴミ袋や段ボール、割れた木箱をどかそう！',
        cost: 20,
        stageImg: 'assets/story/iso_stage1.jpg',
        pin: { x: 28, y: 84, zoom: 1.55 },
        after: [
          {
            speaker: 'reina', expr: 'lazy', side: 'left',
            text: 'ぜぇ、はぁ……ゴミどかしただけでアラフォー手前の腰が悲鳴あげてるんですけど……！',
          },
          {
            speaker: 'momo', expr: 'smile', side: 'right',
            other: { speaker: 'reina', expr: 'lazy' },
            text: 'すごいよーママ！でも、じめんとかべがまだドロドロだよー？',
          },
          {
            speaker: 'reina', expr: 'smug', side: 'left',
            other: { speaker: 'momo', expr: 'smile' },
            text: 'そだね、ゴミが消えたら床と壁の汚さが余計目立つわ！よし、次はゴシゴシ磨き上げるよっ！',
          },
        ],
      },
      {
        id: 'ch1_polish',
        title: '広場の床と花壇を磨きあげる',
        desc: 'ひび割れて泥だらけの石畳と、枯れた花壇・ボロボロのベンチや街灯をピカピカにしよう！',
        cost: 40,
        stageImg: 'assets/story/iso_stage2.jpg',
        pin: { x: 35, y: 80, zoom: 1.55 },
        after: [
          {
            speaker: 'momo', expr: 'smile', side: 'right',
            other: { speaker: 'reina', expr: 'smile' },
            text: 'わぁーっ！！ゆかもかべもピカピカだよー！！ママ、まほうつかいみたい！',
          },
          {
            speaker: 'reina', expr: 'smile', side: 'left',
            other: { speaker: 'momo', expr: 'smile' },
            text: 'ふふん、本気出せばこんなもんっしょ！……って、床と壁が綺麗になったら、あの錆びた門だけマジ浮いててダサくない！？',
          },
          {
            speaker: 'momo', expr: 'smile', side: 'right',
            other: { speaker: 'reina', expr: 'smug' },
            text: 'ほんとだー！あのもん、キラキラのかわいいもんにかえちゃおうよ！',
          },
        ],
      },
      {
        id: 'ch1_gate',
        title: 'ボロボロの商店街の門を変える',
        desc: '錆びて傾いた古い門を解体して、ピカピカの新アーチ門に建て替えよう！3択から選べるよ。',
        cost: 60,
        pin: { x: 36, y: 66, zoom: 1.65 },
        choices: [
          {
            id: 0,
            label: '昭和レトロネオン門',
            desc: '赤い電飾と提灯が輝く懐かしい商店街アーチ',
            stageImg: 'assets/story/iso/gate_0.png',
            thumb: 'assets/story/iso/gate_0.png',
          },
          {
            id: 1,
            label: '森の木彫り＆蔦の門',
            desc: 'あたたかい木製アーチと鮮やかな緑の蔦',
            stageImg: 'assets/story/iso/gate_1.png',
            thumb: 'assets/story/iso/gate_1.png',
          },
          {
            id: 2,
            label: 'ゴージャス星＆ピンク門',
            desc: 'パステルピンクと大きな金色の星が映える門',
            stageImg: 'assets/story/iso/gate_2.png',
            thumb: 'assets/story/iso/gate_2.png',
          },
        ],
        after: [
          {
            speaker: 'momo', expr: 'smile', side: 'right',
            other: { speaker: 'reina', expr: 'smug' },
            text: 'わぁーーっ！！すっごいステキなもんになったよー！！ここがおみせのいりぐちだね！',
          },
          {
            speaker: 'reina', expr: 'smug', side: 'left',
            other: { speaker: 'momo', expr: 'smile' },
            text: 'じゃんっ！やっぱ入口がバチッと決まるとテンションぶち上がるじゃん！！',
          },
        ],
      },
    ],
    outro: [
      {
        speaker: 'ryoji', expr: 'smug', side: 'right',
        other: { speaker: 'reina', expr: 'smug' },
        text: 'なっ……おい、入口のボロ門とゴミ山が消えてピカピカになってるだと！？　嘘だろ……',
      },
      {
        speaker: 'reina', expr: 'smug', side: 'left',
        other: { speaker: 'ryoji', expr: 'smug' },
        text: 'おーっほっほ！どうリョウジ、ビビった？　あたしとモモの本気、ナメんじゃねーよ！',
      },
      {
        speaker: 'momo', expr: 'smile', side: 'left',
        other: { speaker: 'ryoji', expr: 'smug' },
        text: 'ママすごいでしょー！もうパパのおかねなんていらなーい！',
      },
      {
        speaker: 'ryoji', expr: 'smug', side: 'right',
        other: { speaker: 'reina', expr: 'smug' },
        text: 'くっ……ま、まだ入口だけだろ！すぐ奥のお店なんてシャッター閉まったままボロボロじゃないか……すぐ息切れするに決まってる！',
      },
      {
        speaker: 'reina', expr: 'smile', side: 'left',
        other: { speaker: 'momo', expr: 'smile' },
        text: 'ふふん、逃げてったわ！……あれ、門がきれいになったら、奥のボロボロのパン屋さんがよく見えるじゃん！',
      },
      {
        speaker: 'momo', expr: 'smile', side: 'right',
        other: { speaker: 'reina', expr: 'smile' },
        text: 'パンやさんだー！ママ、つぎはあのパンやさんをキレイにしようよー！',
      },
    ],
    reward: {
      xp: 30,
      energy: 50,
      gems: 30,
    },
  },
  {
    id: 2,
    title: 'ストーリー2',
    areaName: '入口から1番近いパン屋さんのおもて＆店先',
    subtitle: '門のすぐ奥のボロボロのパン屋さん！店主ゴロウさんと一緒に店のまわりと店先を直そう！',
    baseImg: 'assets/story/iso/blow_gx_dirty.png',
    clouds: [],
    intro: [
      {
        speaker: 'reina', expr: 'smile', side: 'left',
        other: { speaker: 'momo', expr: 'smile' },
        text: '門をくぐってすぐのところに、ボロボロのパン屋さんがあるじゃん！あれ……店の前に腕を組んだおじさんが立ってるよ？',
      },
      {
        speaker: 'gorou', expr: 'smile', side: 'right',
        other: { speaker: 'reina', expr: 'smile' },
        text: 'おおっ、あんたがレイナちゃんか！親父さんから商店街を任せたって聞いてたぞ。わしはここでパン屋をやってたゴロウだ！',
      },
      {
        speaker: 'momo', expr: 'smile', side: 'left',
        other: { speaker: 'gorou', expr: 'smile' },
        text: 'パンやさんのおじさんだー！メロンパンあるー！？',
      },
      {
        speaker: 'gorou', expr: 'smile', side: 'right',
        other: { speaker: 'momo', expr: 'smile' },
        text: 'はっはっは、ごめんなぁお嬢ちゃん。お客さんが来なくなって、店もボロボロでずっと閉めたままなんだよ……',
      },
      {
        speaker: 'reina', expr: 'smug', side: 'left',
        other: { speaker: 'gorou', expr: 'smile' },
        text: 'ちょ、それならウチらに任せなよゴロウさん！元旦那を見返すためにも、1軒目のパン屋さんからド派手に復活させよーじゃん！',
      },
      {
        speaker: 'gorou', expr: 'smile', side: 'right',
        other: { speaker: 'reina', expr: 'smug' },
        text: 'おおっ、頼もしいなぁ！よし、まずは店先のゴミ掃除と腰壁・ひさしの修理から始めようぜ！',
      },
    ],
    tasks: [
      {
        id: 'ch2_clean',
        title: 'パン屋前のゴミ山を片付けて通りを磨く',
        desc: 'パン屋さんの前をふさぐ大きな瓦礫やゴミの山をどかして、店前の石畳もピカピカにしよう！',
        cost: 35,
        pin: { x: 50, y: 50, zoom: 1.3 },
        after: [
          {
            speaker: 'reina', expr: 'smile', side: 'left',
            other: { speaker: 'gorou', expr: 'smile' },
            text: 'ふぅ〜っ！店前のデカいゴミ山がなくなって石畳もピカピカ！やっぱ綺麗になると気持ちいいじゃん！',
          },
          {
            speaker: 'gorou', expr: 'smile', side: 'right',
            other: { speaker: 'reina', expr: 'smile' },
            text: 'ありがとうレイナちゃん！次は色あせて破れたひさしと、汚れた腰壁や入口を綺麗に直そうぜ！',
          },
        ],
      },
      {
        id: 'ch2_exterior',
        title: 'パン屋の腰壁とひさしを直す',
        desc: '汚れた腰壁や入口を綺麗に塗り直し、破れたひさしも新品に変えて明るい店先にしよう！',
        cost: 55,
        pin: { x: 50, y: 45, zoom: 1.35 },
        after: [
          {
            speaker: 'gorou', expr: 'smile', side: 'right',
            other: { speaker: 'reina', expr: 'smug' },
            text: 'うわぁ……昔のピッカピカな店先が戻ってきたみてぇだ！思わず涙が出そうだよ……！',
          },
          {
            speaker: 'momo', expr: 'smile', side: 'left',
            other: { speaker: 'gorou', expr: 'smile' },
            text: 'おみせ、すっごくかわいくなったよー！でもまえのベンチとがいとうがボロボロだよー？',
          },
          {
            speaker: 'reina', expr: 'smug', side: 'left',
            other: { speaker: 'gorou', expr: 'smile' },
            text: 'ほんとだ、ボロいベンチと街灯そのままじゃ台無しじゃん！次は通りのベンチと飾りも一気にオシャレにしよっ！',
          },
        ],
      },
      {
        id: 'ch2_street_decor',
        title: '店先のベンチ＆飾りを整える',
        desc: 'ボロボロのベンチと街灯を新しくして、プランターや飾りでパン屋前の通りを華やかにしよう！3択から選べるよ。',
        cost: 65,
        pin: { x: 50, y: 54, zoom: 1.38 },
        choices: [
          {
            id: 0,
            label: 'クラシック木製＆街灯',
            desc: 'あたたかい木製ベンチと丸いアンティーク街灯＆花鉢',
            stageImg: 'assets/story/iso/street_deco_0.png',
            thumb: 'assets/story/iso/street_deco_0.png',
          },
          {
            id: 1,
            label: 'ナチュラル花鉢＆ランタン',
            desc: '白木ベンチと緑のプランター＆木製ランタン灯',
            stageImg: 'assets/story/iso/street_deco_1.png',
            thumb: 'assets/story/iso/street_deco_1.png',
          },
          {
            id: 2,
            label: 'ポップベンチ＆三角旗',
            desc: 'カラフルなパステルベンチと可愛い三角旗ガーランド',
            stageImg: 'assets/story/iso/street_deco_2.png',
            thumb: 'assets/story/iso/street_deco_2.png',
          },
        ],
        after: [
          {
            speaker: 'momo', expr: 'smile', side: 'left',
            other: { speaker: 'reina', expr: 'smile' },
            text: 'わぁーっ！おみせのまえ、ピカピカでかわいいよー！モモ、ここであそびたーい！',
          },
          {
            speaker: 'reina', expr: 'smug', side: 'left',
            other: { speaker: 'gorou', expr: 'smile' },
            text: 'え、めっちゃ映えるじゃん！通りまで一気に今っぽくなったし、仕上げに店先のテラス席も置いちゃおっか！',
          },
          {
            speaker: 'gorou', expr: 'smile', side: 'right',
            other: { speaker: 'reina', expr: 'smug' },
            text: 'おおっ、こりゃ歩いているお客さんも思わず立ち止まるぜ！よし、仕上げにテラスと看板を飾ろうぜ！',
          },
        ],
      },
      {
        id: 'ch2_terrace',
        title: '店先にテラス＆看板を飾る',
        desc: '通りすがりの人がつい足を止めちゃう可愛いテラス席やワゴンを置こう！3択から選べるよ。',
        cost: 80,
        pin: { x: 50, y: 52, zoom: 1.4 },
        choices: [
          {
            id: 0,
            label: '赤白カフェテラス',
            desc: 'ギンガムチェックの丸テーブルとメニュー看板',
            stageImg: 'assets/story/iso/terrace_0.png',
            thumb: 'assets/story/iso/terrace_0.png',
          },
          {
            id: 1,
            label: 'ボタニカルグリーン席',
            desc: '観葉植物いっぱいの癒やしテラス席',
            stageImg: 'assets/story/iso/terrace_1.png',
            thumb: 'assets/story/iso/terrace_1.png',
          },
          {
            id: 2,
            label: 'ピンクスイーツワゴン',
            desc: 'リボンが映える可愛いスイーツ＆パンワゴン',
            stageImg: 'assets/story/iso/terrace_2.png',
            thumb: 'assets/story/iso/terrace_2.png',
          },
        ],
        after: [
          {
            speaker: 'reina', expr: 'smug', side: 'left',
            other: { speaker: 'gorou', expr: 'smile' },
            text: 'ちょ、ヤバくない！？マジで雑誌に載るレベルのオシャレパン屋じゃん！！',
          },
          {
            speaker: 'gorou', expr: 'smile', side: 'right',
            other: { speaker: 'reina', expr: 'smug' },
            text: '店のまわりは100点満点だ！……ただなぁレイナちゃん、実は『お店の中』がまだホコリだらけでパンが焼けねぇんだ！',
          },
        ],
      },
    ],
    outro: [
      {
        speaker: 'reina', expr: 'smug', side: 'left',
        other: { speaker: 'gorou', expr: 'smile' },
        text: 'えーっ、外だけピカピカでもパン焼けなきゃ意味ないじゃん！よし、次はパン屋さんの中を丸ごと改装しちゃおうよ！',
      },
      {
        speaker: 'momo', expr: 'smile', side: 'right',
        other: { speaker: 'reina', expr: 'smile' },
        text: 'パンやさんのなか、ピカピカにしたいー！モモ、やきたてパンたべたーい！',
      },
      {
        speaker: 'gorou', expr: 'smile', side: 'right',
        other: { speaker: 'reina', expr: 'smile' },
        text: 'よし、お礼を受け取ってくれ！さっそく中も直して、店内の大改装だ！',
      },
    ],
    reward: {
      xp: 60,
      energy: 70,
      gems: 50,
    },
  },
  {
    id: 3,
    title: 'ストーリー3',
    areaName: 'パン屋さんの店内改装',
    subtitle: '外まわりはバッチリ！次は広々としたパン屋の中。床も壁もパン窯もカウンターもピカピカにしよう！',
    baseImg: 'assets/story/iso/bfloor_dirty.png',
    clouds: [],
    intro: [
      {
        speaker: 'reina', expr: 'lazy', side: 'left',
        other: { speaker: 'gorou', expr: 'smile' },
        text: '外はバッチリになったけど、中をのぞいてみたらクモの巣とボロボロの床じゃん……！これガチで掃除からだね。',
      },
      {
        speaker: 'gorou', expr: 'smile', side: 'right',
        other: { speaker: 'reina', expr: 'lazy' },
        text: 'すまねぇなぁ！でも床と壁を直して新しいパン窯とカウンターを入れたら、昔みたいに焼きたての香りが通り中に広がるぞ！',
      },
      {
        speaker: 'reina', expr: 'smile', side: 'left',
        other: { speaker: 'momo', expr: 'smile' },
        text: 'いいね！モモにも焼きたてメロンパン食べさせてあげたいし、一気にオシャレな店内に仕上げるよーっ！',
      },
    ],
    tasks: [
      {
        id: 'ch3_floor',
        title: '店内の床と壁をピカピカにする',
        desc: 'ホコリと段ボールを片付けて、明るい木目の床と清潔な内壁に張り替えよう！',
        cost: 70,
        pin: { x: 50, y: 50, zoom: 1.55 },
        after: [
          {
            speaker: 'momo', expr: 'smile', side: 'right',
            other: { speaker: 'reina', expr: 'smile' },
            text: 'わぁーっ！おへやのなか、ピッカピカでひろーい！！',
          },
          {
            speaker: 'reina', expr: 'smile', side: 'left',
            other: { speaker: 'momo', expr: 'smile' },
            text: 'おっ、床と壁が綺麗になったらめっちゃ映えるじゃん！次はパン屋の命、パン焼き窯を入れよう！',
          },
        ],
      },
      {
        id: 'ch3_oven',
        title: 'パン焼き窯＆パン棚を置く',
        desc: '店内の奥に本格的なパン窯と焼きたてパンが並ぶ棚を設置しよう！3択から選べるよ。',
        cost: 90,
        pin: { x: 50, y: 46, zoom: 1.6 },
        choices: [
          {
            id: 0,
            label: '赤レンガの本格石窯',
            desc: '香ばしく焼ける王道レンガ石窯＆木製棚',
            stageImg: 'assets/story/iso/oven_0.png',
            thumb: 'assets/story/iso/oven_0.png',
          },
          {
            id: 1,
            label: 'レトロ銅窯＆アンティーク棚',
            desc: '老舗の風格ただよう重厚な銅窯セット',
            stageImg: 'assets/story/iso/oven_1.png',
            thumb: 'assets/story/iso/oven_1.png',
          },
          {
            id: 2,
            label: 'ピンク最新オーブン＆棚',
            desc: '写真映え抜群のパステル可愛いオーブン',
            stageImg: 'assets/story/iso/oven_2.png',
            thumb: 'assets/story/iso/oven_2.png',
          },
        ],
        after: [
          {
            speaker: 'gorou', expr: 'smile', side: 'right',
            other: { speaker: 'reina', expr: 'smug' },
            text: 'おおーっ！！素晴らしい窯だ！！さっそく試運転でメロンパン焼いてみるぞー！',
          },
          {
            speaker: 'momo', expr: 'smile', side: 'left',
            other: { speaker: 'gorou', expr: 'smile' },
            text: 'いいにおいしてきたー！！はやくたべたいよー！！',
          },
        ],
      },
      {
        id: 'ch3_counter',
        title: 'レジカウンター＆店内席を置く',
        desc: '仕上げにお客さんを迎えるレジカウンターとイートイン席を置こう！3択から選べるよ。',
        cost: 110,
        pin: { x: 50, y: 52, zoom: 1.6 },
        choices: [
          {
            id: 0,
            label: 'ぬくもり木製カウンター',
            desc: '居心地のいいナチュラル木製カウンター＆席',
            stageImg: 'assets/story/iso/counter_0.png',
            thumb: 'assets/story/iso/counter_0.png',
          },
          {
            id: 1,
            label: '深緑ボタニカルカウンター',
            desc: 'グリーンが爽やかなおしゃれカフェ仕様',
            stageImg: 'assets/story/iso/counter_1.png',
            thumb: 'assets/story/iso/counter_1.png',
          },
          {
            id: 2,
            label: 'ピンク＆リボンカウンター',
            desc: 'スイーツ店みたいな激カワカウンター席',
            stageImg: 'assets/story/iso/counter_2.png',
            thumb: 'assets/story/iso/counter_2.png',
          },
        ],
        after: [
          {
            speaker: 'reina', expr: 'smug', side: 'left',
            other: { speaker: 'gorou', expr: 'smile' },
            text: '完成ーーっ！！見てよゴロウさん、外も中も完璧すぎるパン屋さんになっちゃったじゃん！！',
          },
          {
            speaker: 'gorou', expr: 'smile', side: 'right',
            other: { speaker: 'reina', expr: 'smug' },
            text: '夢みてぇだ……！ほらモモちゃん、焼きたて第1号のメロンパンだぞ！',
          },
        ],
      },
    ],
    outro: [
      {
        speaker: 'ryoji', expr: 'smug', side: 'right',
        other: { speaker: 'reina', expr: 'smug' },
        text: 'なんだこの甘い匂いは……！？おいレイナ、本当にパン屋まで復活させやがったのか……！',
      },
      {
        speaker: 'reina', expr: 'smug', side: 'left',
        other: { speaker: 'ryoji', expr: 'smug' },
        text: 'あーらリョウジ、焼きたてパンの匂いにつられて来たの？　アンタには1個10万円で売ってあげよっか？',
      },
      {
        speaker: 'ryoji', expr: 'smug', side: 'right',
        other: { speaker: 'reina', expr: 'smug' },
        text: 'くそっ……減らず口を！向かいの空き家も隣のケーキ屋もボロボロだろうが！次こそ絶対うまくいくもんか……！',
      },
      {
        speaker: 'gorou', expr: 'smile', side: 'right',
        other: { speaker: 'reina', expr: 'smile' },
        text: 'はっはっは！口ほどにもないな。……ん？向かいの空き家の前に、誰か立ってるぞ。',
      },
      {
        speaker: 'reina', expr: 'smile', side: 'left',
        other: { speaker: 'momo', expr: 'smile' },
        text: 'ほんとだ、若い男の子じゃん！ちょっと声かけてみよっか！',
      },
    ],
    reward: {
      xp: 130,
      energy: 80,
      gems: 60,
    },
  },
  {
    id: 4,
    title: 'ストーリー4',
    areaName: '向かいの空き家 → 揚げ物屋さん',
    subtitle: '商店街でお店を出したい若者タクミと一緒に、ボロボロの空き家を揚げ物屋さんに生まれ変わらせよう！',
    baseImg: 'assets/story/iso/fry_wall_gx_dirty.png',
    clouds: [],
    intro: [
      { speaker: 'takumi', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
        text: 'あ、あの！この商店街を直してるのって、お姉さんですよね！？オレ、タクミっていいます！' },
      { speaker: 'reina', expr: 'smug', side: 'left', other: { speaker: 'takumi', expr: 'smile' },
        text: 'お姉さんって〜！わかってんじゃん！で、どしたの？' },
      { speaker: 'takumi', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smug' },
        text: 'オレ、ずっと自分の揚げ物屋を出すのが夢で……！この空き家、使わせてもらえませんか！？' },
      { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'takumi', expr: 'smile' },
        text: 'あげものやさん！？コロッケある！？モモ、コロッケだいすき！' },
      { speaker: 'gorou', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
        text: 'パン屋の向かいに揚げ物屋か！いいじゃねぇか、昔もここは揚げたての匂いでいっぱいだったんだぜ！' },
      { speaker: 'reina', expr: 'smile', side: 'left', other: { speaker: 'takumi', expr: 'smile' },
        text: 'よっしゃ、決まり！タクミの夢、ウチらが全力で応援すっから！まずは空き家の中のガラクタからどかそ！' },
    ],
    tasks: [
      {
        id: 'ch4_clean', title: '空き家のガラクタを片付ける',
        desc: '空き家の中に山積みになった瓦礫や廃材、ゴミ袋をぜんぶ運び出そう！', cost: 120,
        pin: { x: 50, y: 50, zoom: 1.4 },
        after: [
          { speaker: 'takumi', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'lazy' },
            text: 'すげぇ……あんなにあったガラクタが全部なくなった！レイナさん、力持ちっすね！' },
          { speaker: 'reina', expr: 'lazy', side: 'left', other: { speaker: 'takumi', expr: 'smile' },
            text: 'ぜぇ、はぁ……ママの腕力、ナメんなよ……。次は床と壁、ピカピカにしよ……' },
        ],
      },
      {
        id: 'ch4_repair', title: '床と壁を張り替える',
        desc: '穴だらけの床と剥がれた壁を、清潔なタイルと木の壁に張り替えよう！', cost: 140,
        pin: { x: 50, y: 50, zoom: 1.45 },
        after: [
          { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'takumi', expr: 'smile' },
            text: 'わぁ〜！おみせっぽくなった〜！' },
          { speaker: 'takumi', expr: 'smile', side: 'right', other: { speaker: 'momo', expr: 'smile' },
            text: 'あとは揚げ場だ！ここに最高のフライヤーを置きたいっす！' },
        ],
      },
      {
        id: 'ch4_counter', title: '揚げ場カウンターを置く',
        desc: '揚げたてを並べるカウンターとフライヤーを置こう！3択から選べるよ。', cost: 160,
        pin: { x: 50, y: 48, zoom: 1.55 },
        choices: [
          { id: 0, label: '銀のフライヤー＆木のカウンター', desc: '揚げたてコロッケが並ぶ王道スタイル', stageImg: 'assets/story/iso/fry_counter_0.png', thumb: 'assets/story/iso/fry_counter_0.png' },
          { id: 1, label: '昭和レトロな赤カウンター', desc: 'ガラスのショーケースが懐かしい', stageImg: 'assets/story/iso/fry_counter_1.png', thumb: 'assets/story/iso/fry_counter_1.png' },
          { id: 2, label: 'ポップな黄色カウンター', desc: '可愛いメニュー板つき', stageImg: 'assets/story/iso/fry_counter_2.png', thumb: 'assets/story/iso/fry_counter_2.png' },
        ],
        after: [
          { speaker: 'takumi', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smug' },
            text: 'うおおお！オレの揚げ場だ……！さっそく試しにコロッケ揚げてみます！' },
        ],
      },
      {
        id: 'ch4_seat', title: 'イートイン席を置く',
        desc: '揚げたてをその場で食べられる席を置こう！3択から選べるよ。', cost: 170,
        pin: { x: 50, y: 52, zoom: 1.55 },
        choices: [
          { id: 0, label: '木の立ち食いカウンター', desc: '丸椅子つきの粋な立ち食い席', stageImg: 'assets/story/iso/fry_seat_0.png', thumb: 'assets/story/iso/fry_seat_0.png' },
          { id: 1, label: '赤いテーブル席', desc: '丸椅子2脚のレトロな席', stageImg: 'assets/story/iso/fry_seat_1.png', thumb: 'assets/story/iso/fry_seat_1.png' },
          { id: 2, label: '黄色いベンチ席', desc: '明るい小さなテーブル席', stageImg: 'assets/story/iso/fry_seat_2.png', thumb: 'assets/story/iso/fry_seat_2.png' },
        ],
        after: [
          { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'takumi', expr: 'smile' },
            text: 'コロッケ、あっつあつでサクサク〜！モモ、ここにまいにちくる！' },
        ],
      },
      {
        id: 'ch4_front', title: '店先にベンチと飾りを置く',
        desc: '通りの人が足を止めたくなるベンチと飾りを店先に置こう！3択から選べるよ。', cost: 180,
        pin: { x: 50, y: 45, zoom: 1.4 },
        choices: [
          { id: 0, label: '赤い縁台と提灯', desc: '下町らしいあたたかい店先', stageImg: 'assets/story/iso/fry_deco_0.png', thumb: 'assets/story/iso/fry_deco_0.png' },
          { id: 1, label: '木のベンチと行灯', desc: '落ち着いた和の店先', stageImg: 'assets/story/iso/fry_deco_1.png', thumb: 'assets/story/iso/fry_deco_1.png' },
          { id: 2, label: '黄色いベンチと立て看板', desc: '明るくポップな店先', stageImg: 'assets/story/iso/fry_deco_2.png', thumb: 'assets/story/iso/fry_deco_2.png' },
        ],
        after: [
          { speaker: 'gorou', expr: 'smile', side: 'right', other: { speaker: 'takumi', expr: 'smile' },
            text: '向かいからいい匂いがしてきやがる！タクミ、うちのパンとコロッケでコロッケパンを作ろうぜ！' },
        ],
      },
    ],
    outro: [
      { speaker: 'ryoji', expr: 'smug', side: 'right', other: { speaker: 'reina', expr: 'smug' },
        text: 'な、なんで空き家が店になってるんだ……！？しかも行列ができてるだと……！？' },
      { speaker: 'reina', expr: 'smug', side: 'left', other: { speaker: 'ryoji', expr: 'smug' },
        text: 'タクミの夢、ウチらで叶えたんだよね〜。アンタも並べば？最後尾はあっちだけど？' },
      { speaker: 'takumi', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
        text: 'レイナさん、本当にありがとうございました！あ、隣のケーキ屋さんにも、誰か来ているみたいですよ！' },
    ],
    reward: { xp: 200, energy: 90, gems: 70 },
  },
  {
    id: 5,
    title: 'ストーリー5',
    areaName: 'パン屋のとなりのケーキ屋さん',
    subtitle: 'パティシエのミサキと一緒に、閉まったままのケーキ屋さんをもう一度あけよう！',
    baseImg: 'assets/story/iso/cake_wall_gx_dirty.png',
    clouds: [],
    intro: [
      { speaker: 'misaki', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
        text: 'こんにちは……。私、ミサキといいます。昔ここで、祖母がケーキ屋をやっていたんです。' },
      { speaker: 'misaki', expr: 'smile', side: 'right', other: { speaker: 'momo', expr: 'smile' },
        text: 'パン屋さんと揚げ物屋さんがにぎやかになったって聞いて……私も、このお店をもう一度あけたくて。' },
      { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'misaki', expr: 'smile' },
        text: 'ケーキやさん！？いちごのケーキある！？' },
      { speaker: 'reina', expr: 'smile', side: 'left', other: { speaker: 'misaki', expr: 'smile' },
        text: 'そういうことなら任せてよ、ミサキちゃん！まずは店の前と中のゴミからやっつけよ！' },
    ],
    tasks: [
      {
        id: 'ch5_clean', title: '店の前と中のゴミを片付ける',
        desc: 'ケーキ屋の前の通りと店の中にたまったゴミの山を片付けて、通りを磨こう！', cost: 150,
        pin: { x: 50, y: 50, zoom: 1.35 },
        after: [
          { speaker: 'misaki', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
            text: 'わぁ……通りまでこんなにきれいに。祖母が見たら、きっと喜びます。' },
        ],
      },
      {
        id: 'ch5_repair', title: '壁と床を可愛く直す',
        desc: '色あせた壁紙と古い床を、パステルカラーの可愛いお店に直そう！', cost: 170,
        pin: { x: 50, y: 50, zoom: 1.45 },
        after: [
          { speaker: 'reina', expr: 'smug', side: 'left', other: { speaker: 'misaki', expr: 'smile' },
            text: 'ちょ、この壁紙めっちゃ可愛くない！？写真撮りまくれるじゃん！' },
        ],
      },
      {
        id: 'ch5_case', title: 'ケーキのショーケースを置く',
        desc: 'ケーキがずらりと並ぶショーケースを置こう！3択から選べるよ。', cost: 190,
        pin: { x: 50, y: 48, zoom: 1.55 },
        choices: [
          { id: 0, label: '白と木のショーケース', desc: 'ナチュラルでやさしい雰囲気', stageImg: 'assets/story/iso/cake_case_0.png', thumb: 'assets/story/iso/cake_case_0.png' },
          { id: 1, label: 'アンティーク金縁ケース', desc: '老舗の風格ただよう', stageImg: 'assets/story/iso/cake_case_1.png', thumb: 'assets/story/iso/cake_case_1.png' },
          { id: 2, label: 'パステルピンクのケース', desc: 'リボンが可愛い', stageImg: 'assets/story/iso/cake_case_2.png', thumb: 'assets/story/iso/cake_case_2.png' },
        ],
        after: [
          { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'misaki', expr: 'smile' },
            text: 'いちごのケーキ、キラキラしてる〜！' },
        ],
      },
      {
        id: 'ch5_seat', title: 'カフェ席を置く',
        desc: 'ケーキと紅茶を楽しめるカフェ席を置こう！3択から選べるよ。', cost: 200,
        pin: { x: 50, y: 52, zoom: 1.55 },
        choices: [
          { id: 0, label: '白い丸テーブル', desc: 'シンプルで明るい席', stageImg: 'assets/story/iso/cake_seat_0.png', thumb: 'assets/story/iso/cake_seat_0.png' },
          { id: 1, label: 'アンティークの木の席', desc: '落ち着いた大人の席', stageImg: 'assets/story/iso/cake_seat_1.png', thumb: 'assets/story/iso/cake_seat_1.png' },
          { id: 2, label: 'ピンクのハートの椅子', desc: 'とびきり可愛い席', stageImg: 'assets/story/iso/cake_seat_2.png', thumb: 'assets/story/iso/cake_seat_2.png' },
        ],
        after: [
          { speaker: 'misaki', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
            text: 'ここでお茶をしてもらえたら、すてきですね。' },
        ],
      },
      {
        id: 'ch5_front', title: '店先にベンチと飾りを置く',
        desc: 'ケーキ屋の前にベンチと花の飾りを置こう！3択から選べるよ。', cost: 210,
        pin: { x: 50, y: 45, zoom: 1.4 },
        choices: [
          { id: 0, label: '白いアイアンベンチとバラ', desc: '上品なヨーロッパ風', stageImg: 'assets/story/iso/cake_deco_0.png', thumb: 'assets/story/iso/cake_deco_0.png' },
          { id: 1, label: 'ミントのベンチとハーブ', desc: 'さわやかなナチュラル', stageImg: 'assets/story/iso/cake_deco_1.png', thumb: 'assets/story/iso/cake_deco_1.png' },
          { id: 2, label: 'ピンクのベンチとハート', desc: 'とびきりスイートに', stageImg: 'assets/story/iso/cake_deco_2.png', thumb: 'assets/story/iso/cake_deco_2.png' },
        ],
        after: [
          { speaker: 'misaki', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smug' },
            text: 'レイナさん、本当にありがとう。祖母のお店、また甘い香りでいっぱいになりました。' },
        ],
      },
    ],
    outro: [
      { speaker: 'ryoji', expr: 'smug', side: 'right', other: { speaker: 'reina', expr: 'smug' },
        text: 'パン屋に揚げ物屋にケーキ屋だと……？ここ、本当にあのドブみたいな商店街か……？' },
      { speaker: 'reina', expr: 'smug', side: 'left', other: { speaker: 'ryoji', expr: 'smug' },
        text: 'そ。アンタが笑ってた商店街だよ。ケーキ1個くらいなら、定価で売ってあげてもいいけど？' },
      { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'misaki', expr: 'smile' },
        text: 'ママ！つぎは、むかいのおようふくやさんもピカピカにしようよ！' },
    ],
    reward: { xp: 260, energy: 100, gems: 80 },
  },
  {
    id: 6,
    title: 'ストーリー6',
    areaName: '揚げ物屋のとなりの服屋さん',
    subtitle: 'おしゃれなマダム、ユリさんの服屋さんを、通りでいちばん華やかなお店に！',
    baseImg: 'assets/story/iso/cloth_wall_gx_dirty.png',
    clouds: [],
    intro: [
      { speaker: 'yuri', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
        text: 'あら、あなたが噂のレイナさんね。私はユリ。この服屋を40年やってきたの。' },
      { speaker: 'yuri', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
        text: 'お客さんが来なくなって閉めていたけれど……通りがこんなに明るくなったなら、もう一度やってみたくなったわ。' },
      { speaker: 'reina', expr: 'smug', side: 'left', other: { speaker: 'yuri', expr: 'smile' },
        text: '服屋さん！？テンション上がるんですけど！ウチがとびきりおしゃれにしちゃいますよ！' },
    ],
    tasks: [
      {
        id: 'ch6_clean', title: '店の中のガラクタを片付ける',
        desc: '倒れたマネキンや古い段ボールの山を片付けよう！', cost: 180,
        pin: { x: 50, y: 50, zoom: 1.4 },
        after: [
          { speaker: 'yuri', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'lazy' },
            text: 'まあ、手際がいいのね。昔の私を見ているみたいだわ。' },
        ],
      },
      {
        id: 'ch6_repair', title: '壁と床をおしゃれに直す',
        desc: '汚れた壁と床を、明るいブティックの内装に直そう！', cost: 200,
        pin: { x: 50, y: 50, zoom: 1.45 },
        after: [
          { speaker: 'reina', expr: 'smile', side: 'left', other: { speaker: 'yuri', expr: 'smile' },
            text: 'ミントの壁に木のヘリンボーン床……センス良すぎて溶けそう……！' },
        ],
      },
      {
        id: 'ch6_rack', title: '洋服ラックを置く',
        desc: '服がきれいに並ぶラックを置こう！3択から選べるよ。', cost: 220,
        pin: { x: 50, y: 48, zoom: 1.55 },
        choices: [
          { id: 0, label: 'ナチュラルな木のラック', desc: 'やさしい色の服が映える', stageImg: 'assets/story/iso/cloth_rack_0.png', thumb: 'assets/story/iso/cloth_rack_0.png' },
          { id: 1, label: '金のアイアンラック', desc: 'エレガントな大人の服', stageImg: 'assets/story/iso/cloth_rack_1.png', thumb: 'assets/story/iso/cloth_rack_1.png' },
          { id: 2, label: 'カラフルなポップラック', desc: '明るい服がずらり', stageImg: 'assets/story/iso/cloth_rack_2.png', thumb: 'assets/story/iso/cloth_rack_2.png' },
        ],
        after: [
          { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'yuri', expr: 'smile' },
            text: 'モモもおひめさまのおようふく、きてみたーい！' },
        ],
      },
      {
        id: 'ch6_fit', title: '試着室とマネキンを置く',
        desc: '試着室とマネキンを置いて、お店を仕上げよう！3択から選べるよ。', cost: 230,
        pin: { x: 50, y: 52, zoom: 1.55 },
        choices: [
          { id: 0, label: '木の試着室', desc: 'あたたかみのある試着室', stageImg: 'assets/story/iso/cloth_fit_0.png', thumb: 'assets/story/iso/cloth_fit_0.png' },
          { id: 1, label: 'ベルベットの試着室', desc: '高級感のあるカーテン', stageImg: 'assets/story/iso/cloth_fit_1.png', thumb: 'assets/story/iso/cloth_fit_1.png' },
          { id: 2, label: 'パステルの試着室', desc: '可愛い色の試着室', stageImg: 'assets/story/iso/cloth_fit_2.png', thumb: 'assets/story/iso/cloth_fit_2.png' },
        ],
        after: [
          { speaker: 'yuri', expr: 'smile', side: 'right', other: { speaker: 'momo', expr: 'smile' },
            text: 'ふふ、モモちゃんにぴったりのワンピースを用意しておくわね。' },
        ],
      },
      {
        id: 'ch6_front', title: '店先にベンチと飾りを置く',
        desc: '服屋の前にベンチと飾りを置いて、通りを華やかにしよう！3択から選べるよ。', cost: 240,
        pin: { x: 50, y: 45, zoom: 1.4 },
        choices: [
          { id: 0, label: '黒いアイアンベンチ', desc: '観葉植物でシックに', stageImg: 'assets/story/iso/cloth_deco_0.png', thumb: 'assets/story/iso/cloth_deco_0.png' },
          { id: 1, label: '白い木のベンチ', desc: 'ドライフラワーでナチュラルに', stageImg: 'assets/story/iso/cloth_deco_1.png', thumb: 'assets/story/iso/cloth_deco_1.png' },
          { id: 2, label: '水色のベンチ', desc: 'カラフルな花でポップに', stageImg: 'assets/story/iso/cloth_deco_2.png', thumb: 'assets/story/iso/cloth_deco_2.png' },
        ],
        after: [
          { speaker: 'yuri', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
            text: 'レイナさん、あなたのおかげで、この通りにまた人が戻ってきたわ。' },
        ],
      },
    ],
    outro: [
      { speaker: 'ryoji', expr: 'smug', side: 'right', other: { speaker: 'reina', expr: 'smug' },
        text: 'くっ……4軒も店が復活しただと……。お、俺は認めないぞ……！' },
      { speaker: 'reina', expr: 'smug', side: 'left', other: { speaker: 'ryoji', expr: 'smug' },
        text: '認めなくていいよ〜。お客さんはもう、ちゃんと認めてくれてるし！' },
      { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'reina', expr: 'smile' },
        text: 'ママ！このさきに、まるいひろばがあるんだって！ふんすいもあるんだよ！' },
      { speaker: 'reina', expr: 'smile', side: 'left', other: { speaker: 'momo', expr: 'smile' },
        text: 'まだまだ行くよ、モモ！あさひ商店街、ぜんぶぶち上げてくんだから！' },
    ],
    reward: { xp: 325, energy: 110, gems: 90 },
  },
  {
    id: 7,
    title: 'ストーリー7',
    areaName: '噴水の円形広場',
    subtitle: '商店街のまんなかの円形広場。4つの道が集まる広場を、みんなで片付けてよみがえらせよう！',
    baseImg: 'assets/story/iso/fountain_dirty.png',
    clouds: [],
    intro: [
      { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'reina', expr: 'smile' },
        text: 'ママ、みて！まるいひろば！……でも、ふんすい、おみずがでてないよ？' },
      { speaker: 'reina', expr: 'lazy', side: 'left', other: { speaker: 'gorou', expr: 'smile' },
        text: 'うわ……石畳はバキバキだし、屋台は倒れてるし、噴水もカラカラじゃん……。' },
      { speaker: 'gorou', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'lazy' },
        text: 'ここは昔、あさひ商店街のまんなかでな。北は神社の参道、南は駅前、東は川沿いの朝市へ……4つの道がこの広場に集まっていたんだ。' },
      { speaker: 'gorou', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
        text: '噴水のまわりで、みんな待ち合わせをしたもんさ。わしもカミさんと、ここで初めて会ったんだ。' },
      { speaker: 'reina', expr: 'smug', side: 'left', other: { speaker: 'gorou', expr: 'smile' },
        text: 'ちょ、ゴロウさんエモすぎ！決めた、この広場、商店街でいちばんの待ち合わせスポットにしちゃお！' },
    ],
    tasks: [
      {
        id: 'ch7_clean', title: 'ガレキと壊れた屋台を片付ける',
        desc: '広場に散らばったガレキの山と、倒れた屋台やベンチを片付けよう！', cost: 260,
        pin: { x: 50, y: 50, zoom: 1.2 },
        after: [
          { speaker: 'takumi', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
            text: 'レイナさーん！店が落ち着いたんで手伝いに来ました！重いのは俺に任せてください！' },
        ],
      },
      {
        id: 'ch7_paving', title: '割れた石畳と街灯を直す',
        desc: 'はがれた敷石を並べ直して、まるい模様の石畳と街灯をよみがえらせよう！', cost: 280,
        pin: { x: 50, y: 50, zoom: 1.1 },
        after: [
          { speaker: 'misaki', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
            text: 'わあ、石畳がまるい輪になってる……！ケーキのデコレーションみたいで、かわいいですね！' },
        ],
      },
      {
        id: 'ch7_fountain', title: '噴水を直す',
        desc: '広場のまんなかの噴水に、もう一度水を流そう！3択から選べるよ。', cost: 320,
        pin: { x: 50, y: 50, zoom: 1.4 },
        choices: [
          { id: 0, label: '白い石のクラシック噴水', desc: '2段の皿から水があふれる', stageImg: 'assets/story/iso/fountain_0.png', thumb: 'assets/story/iso/fountain_0.png' },
          { id: 1, label: 'レンガと銅のレトロ噴水', desc: '昭和の商店街らしい味わい', stageImg: 'assets/story/iso/fountain_1.png', thumb: 'assets/story/iso/fountain_1.png' },
          { id: 2, label: 'ミントタイルの星の噴水', desc: 'きらきら光る星のオブジェ', stageImg: 'assets/story/iso/fountain_2.png', thumb: 'assets/story/iso/fountain_2.png' },
        ],
        after: [
          { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'reina', expr: 'smile' },
            text: 'おみずでたー！ママ、きらきらしてる！モモ、ここでおべんとうたべたい！' },
          { speaker: 'gorou', expr: 'smile', side: 'right', other: { speaker: 'momo', expr: 'smile' },
            text: '……ああ、この音だ。何十年ぶりかのう。ありがとうな、レイナさん。' },
        ],
      },
      {
        id: 'ch7_seat', title: '噴水のまわりにベンチを置く',
        desc: '噴水を眺めながらひと休みできるベンチと花鉢を置こう！3択から選べるよ。', cost: 300,
        pin: { x: 50, y: 50, zoom: 1.2 },
        choices: [
          { id: 0, label: '黒いアイアンのベンチ', desc: '白い石の花鉢でクラシックに', stageImg: 'assets/story/iso/plaza_seat_0.png', thumb: 'assets/story/iso/plaza_seat_0.png' },
          { id: 1, label: '木のベンチと樽の花鉢', desc: 'あたたかいナチュラルな雰囲気', stageImg: 'assets/story/iso/plaza_seat_1.png', thumb: 'assets/story/iso/plaza_seat_1.png' },
          { id: 2, label: '白いベンチとミントの花鉢', desc: 'さわやかで明るい広場に', stageImg: 'assets/story/iso/plaza_seat_2.png', thumb: 'assets/story/iso/plaza_seat_2.png' },
        ],
        after: [
          { speaker: 'yuri', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
            text: '素敵なベンチね。ここに座って噴水を眺めていたら、若いころを思い出すわ。' },
        ],
      },
      {
        id: 'ch7_signs', title: '3つの道の入口に道しるべを立てる',
        desc: '神社・駅前・朝市へ続く道の入口に、道しるべを立てよう！3択から選べるよ。', cost: 300,
        pin: { x: 50, y: 50, zoom: 1.1 },
        choices: [
          { id: 0, label: 'レトロな木の道しるべ', desc: '小さな屋根つきの木の柱', stageImg: 'assets/story/iso/sign_0.png', thumb: 'assets/story/iso/sign_0.png' },
          { id: 1, label: '黒いアイアンの道しるべ', desc: '金の縁取りとランプつき', stageImg: 'assets/story/iso/sign_1.png', thumb: 'assets/story/iso/sign_1.png' },
          { id: 2, label: 'ポップな道しるべ', desc: 'カラフルな矢印と星', stageImg: 'assets/story/iso/sign_2.png', thumb: 'assets/story/iso/sign_2.png' },
        ],
        after: [
          { speaker: 'reina', expr: 'smile', side: 'left', other: { speaker: 'momo', expr: 'smile' },
            text: 'これで迷子にならないね！北は神社、南は駅前、東は朝市……どの道の先も、まだまだボロボロなんだよね。' },
        ],
      },
    ],
    outro: [
      { speaker: 'ryoji', expr: 'smug', side: 'right', other: { speaker: 'reina', expr: 'smug' },
        text: 'ふん、噴水ひとつで浮かれやがって。この先の道は、どこもシャッター街だぜ？' },
      { speaker: 'reina', expr: 'smug', side: 'left', other: { speaker: 'ryoji', expr: 'smug' },
        text: 'だから行くんじゃん。4つの道ぜんぶ、ウチらがぶち上げてあげるから見てなって！' },
      { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'reina', expr: 'smile' },
        text: 'つぎは、どのみちにいくの？モモ、じんじゃのおまつりみたーい！' },
    ],
    reward: { xp: 375, energy: 120, gems: 100 },
  },
  {
    id: 8,
    title: 'ストーリー8',
    areaName: '神社の参道の喫茶店',
    subtitle: '噴水のむこう、神社へ続く参道。ハルトと一緒に、閉まったままの喫茶店をもう一度あけよう！',
    baseImg: 'assets/story/iso/cafe_deco_dirty.png',
    clouds: [],
    intro: [
      { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'reina', expr: 'smile' },
        text: 'ママ、みて！じんじゃのみちの、くもがはれたよ！' },
      { speaker: 'reina', expr: 'lazy', side: 'left', other: { speaker: 'haruto', expr: 'smile' },
        text: 'うわ、こっちもシャッターだらけ……。お、あそこの喫茶店、誰かいる？' },
      { speaker: 'haruto', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
        text: 'こんにちは。ハルトといいます。ここは父がやっていた喫茶店で……ずっと閉めたままだったんです。' },
      { speaker: 'haruto', expr: 'smile', side: 'right', other: { speaker: 'momo', expr: 'smile' },
        text: '噴水の音が戻ってきたのを聞いて、もう一度、ここでコーヒーをいれたくなって。' },
      { speaker: 'reina', expr: 'smug', side: 'left', other: { speaker: 'haruto', expr: 'smile' },
        text: 'いいじゃん、ハルトくん！参道の一番乗りはカフェで決まり！まずは道のガレキからやっつけよ！' },
    ],
    tasks: [
      {
        id: 'ch8_clean', title: '参道のガレキを片付ける',
        desc: '神社へ続く参道にたまったガレキの山を片付けて、石畳を磨こう！', cost: 330,
        pin: { x: 50, y: 50, zoom: 1.35 },
        after: [
          { speaker: 'gorou', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
            text: 'この参道、昔は初もうでの人でぎっしりじゃったんだよ。' },
        ],
      },
      {
        id: 'ch8_repair', title: '壁と床を直す',
        desc: 'はがれたしっくいと古い床を、落ち着いた喫茶店らしく直そう！', cost: 350,
        pin: { x: 50, y: 50, zoom: 1.45 },
        after: [
          { speaker: 'haruto', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
            text: 'この木の床の色……父の店と同じだ。なんだか、なつかしいです。' },
        ],
      },
      {
        id: 'ch8_counter', title: 'カフェのカウンターを置く',
        desc: 'コーヒーをいれるカウンターを置こう！3択から選べるよ。', cost: 370,
        pin: { x: 50, y: 50, zoom: 1.55 },
        choices: [
          { id: 0, label: '木のカウンター', desc: 'エスプレッソマシンとケーキドーム', stageImg: 'assets/story/iso/cafe_counter_0.png', thumb: 'assets/story/iso/cafe_counter_0.png' },
          { id: 1, label: 'レトロな純喫茶カウンター', desc: '赤いビロードとサイフォン', stageImg: 'assets/story/iso/cafe_counter_1.png', thumb: 'assets/story/iso/cafe_counter_1.png' },
          { id: 2, label: '白いタイルのカウンター', desc: 'ハンドドリップでていねいに', stageImg: 'assets/story/iso/cafe_counter_2.png', thumb: 'assets/story/iso/cafe_counter_2.png' },
        ],
        after: [
          { speaker: 'haruto', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
            text: 'ここに立つと、背すじがのびます。……よし、いい豆をそろえないと。' },
        ],
      },
      {
        id: 'ch8_seat', title: 'テーブル席を置く',
        desc: 'コーヒーをゆっくり楽しめる席を置こう！3択から選べるよ。', cost: 380,
        pin: { x: 50, y: 50, zoom: 1.55 },
        choices: [
          { id: 0, label: '木の丸テーブル席', desc: '曲げ木の椅子でくつろぐ', stageImg: 'assets/story/iso/cafe_seat_0.png', thumb: 'assets/story/iso/cafe_seat_0.png' },
          { id: 1, label: '赤いソファ席', desc: 'プリンが似合う純喫茶', stageImg: 'assets/story/iso/cafe_seat_1.png', thumb: 'assets/story/iso/cafe_seat_1.png' },
          { id: 2, label: '大理石のテーブル席', desc: '黒いアイアンでおしゃれに', stageImg: 'assets/story/iso/cafe_seat_2.png', thumb: 'assets/story/iso/cafe_seat_2.png' },
        ],
        after: [
          { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'haruto', expr: 'smile' },
            text: 'モモ、ここでクリームソーダのみたい！' },
        ],
      },
      {
        id: 'ch8_front', title: '店先にベンチと飾りを置く',
        desc: '喫茶店の前にベンチと飾りを置こう！3択から選べるよ。', cost: 390,
        pin: { x: 50, y: 50, zoom: 1.4 },
        choices: [
          { id: 0, label: '木のベンチと麻袋', desc: 'コーヒー豆の香り', stageImg: 'assets/story/iso/cafe_deco_0.png', thumb: 'assets/story/iso/cafe_deco_0.png' },
          { id: 1, label: 'レトロな赤いベンチ', desc: 'ミルク缶の花びん', stageImg: 'assets/story/iso/cafe_deco_1.png', thumb: 'assets/story/iso/cafe_deco_1.png' },
          { id: 2, label: '白いアイアンのベンチ', desc: 'ラベンダーのプランター', stageImg: 'assets/story/iso/cafe_deco_2.png', thumb: 'assets/story/iso/cafe_deco_2.png' },
        ],
        after: [
          { speaker: 'haruto', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smug' },
            text: 'レイナさん、ありがとうございます。参道に、コーヒーの香りが戻りました。' },
        ],
      },
    ],
    outro: [
      { speaker: 'ryoji', expr: 'smug', side: 'right', other: { speaker: 'reina', expr: 'smug' },
        text: '喫茶店だぁ？参道なんて、誰も歩いてねえだろうが。' },
      { speaker: 'reina', expr: 'smug', side: 'left', other: { speaker: 'ryoji', expr: 'smug' },
        text: 'これから歩かせんの。コーヒー1杯、アンタにはブラックで出してあげる。' },
      { speaker: 'haruto', expr: 'smile', side: 'right', other: { speaker: 'momo', expr: 'smile' },
        text: '向かいの駄菓子屋さん……キヨおばあちゃん、まだお元気かな。' },
    ],
    reward: { xp: 460, energy: 130, gems: 110 },
  },
  {
    id: 9,
    title: 'ストーリー9',
    areaName: '参道の駄菓子屋さん',
    subtitle: 'ケーキ屋のうらの駄菓子屋さん。キヨばあちゃんと一緒に、子どもが集まるお店をよみがえらせよう！',
    baseImg: 'assets/story/iso/dagashi_deco_dirty.png',
    clouds: [],
    intro: [
      { speaker: 'haruto', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
        text: 'レイナさん、向かいの駄菓子屋さんです。子どものころ、毎日通っていました。' },
      { speaker: 'kiyo', expr: 'smile', side: 'right', other: { speaker: 'haruto', expr: 'smile' },
        text: 'おやまあ、ハルちゃんじゃないの！大きくなって……。あたしゃキヨ。この駄菓子屋のばあちゃんだよ。' },
      { speaker: 'kiyo', expr: 'smile', side: 'right', other: { speaker: 'momo', expr: 'smile' },
        text: '腰を痛めてから閉めちまってねえ。でも、子どもの声が聞こえると、また店をあけたくなるよ。' },
      { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'kiyo', expr: 'smile' },
        text: 'だがしやさん！モモ、ラムネのむ！' },
      { speaker: 'reina', expr: 'smile', side: 'left', other: { speaker: 'kiyo', expr: 'smile' },
        text: 'キヨばあちゃん、任せて！ウチら、お店をあけるの得意だから！' },
    ],
    tasks: [
      {
        id: 'ch9_clean', title: '店の前の参道を片付ける',
        desc: '駄菓子屋の前の参道にたまったガレキを片付けて、石畳を磨こう！', cost: 400,
        pin: { x: 50, y: 50, zoom: 1.35 },
        after: [
          { speaker: 'kiyo', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
            text: 'あれまあ、道がぴかぴかだ。こりゃあ子どもたちが走り回れるねえ。' },
        ],
      },
      {
        id: 'ch9_repair', title: '壁と床を直す',
        desc: 'ペンキのはがれた壁と古い床を、昭和の駄菓子屋らしく直そう！', cost: 420,
        pin: { x: 50, y: 50, zoom: 1.45 },
        after: [
          { speaker: 'reina', expr: 'smile', side: 'left', other: { speaker: 'kiyo', expr: 'smile' },
            text: 'このうす緑の壁、エモすぎ！昭和の写真撮れるじゃん！' },
        ],
      },
      {
        id: 'ch9_rack', title: '駄菓子の陳列台を置く',
        desc: '駄菓子がずらりと並ぶ陳列台を置こう！3択から選べるよ。', cost: 440,
        pin: { x: 50, y: 50, zoom: 1.55 },
        choices: [
          { id: 0, label: '駄菓子のひな壇', desc: '小袋がぎっしり', stageImg: 'assets/story/iso/dagashi_rack_0.png', thumb: 'assets/story/iso/dagashi_rack_0.png' },
          { id: 1, label: 'ガラスびんの陳列台', desc: 'ふた付きの角びん', stageImg: 'assets/story/iso/dagashi_rack_1.png', thumb: 'assets/story/iso/dagashi_rack_1.png' },
          { id: 2, label: 'くじ引きの陳列台', desc: 'おもちゃを吊るして', stageImg: 'assets/story/iso/dagashi_rack_2.png', thumb: 'assets/story/iso/dagashi_rack_2.png' },
        ],
        after: [
          { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'kiyo', expr: 'smile' },
            text: 'いっぱいある〜！モモ、ぜんぶたべたい！' },
        ],
      },
      {
        id: 'ch9_game', title: 'あそび場を置く',
        desc: 'ゲーム機やガチャガチャで、子どもが集まる場所を作ろう！3択から選べるよ。', cost: 450,
        pin: { x: 50, y: 50, zoom: 1.55 },
        choices: [
          { id: 0, label: 'テーブルのゲーム機', desc: '昔なつかしい', stageImg: 'assets/story/iso/dagashi_game_0.png', thumb: 'assets/story/iso/dagashi_game_0.png' },
          { id: 1, label: 'ガチャガチャ3台', desc: 'なにが出るかな', stageImg: 'assets/story/iso/dagashi_game_1.png', thumb: 'assets/story/iso/dagashi_game_1.png' },
          { id: 2, label: '縁台とラムネ', desc: 'ひと休みの場所', stageImg: 'assets/story/iso/dagashi_game_2.png', thumb: 'assets/story/iso/dagashi_game_2.png' },
        ],
        after: [
          { speaker: 'kiyo', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
            text: 'これこれ！放課後はここに子どもが鈴なりだったんだよ。' },
        ],
      },
      {
        id: 'ch9_front', title: '店先に縁台と飾りを置く',
        desc: '駄菓子屋の前に縁台と飾りを置こう！3択から選べるよ。', cost: 460,
        pin: { x: 50, y: 50, zoom: 1.4 },
        choices: [
          { id: 0, label: '赤い縁台と朝顔', desc: '夏の店先', stageImg: 'assets/story/iso/dagashi_deco_0.png', thumb: 'assets/story/iso/dagashi_deco_0.png' },
          { id: 1, label: 'アイスの冷凍ケース', desc: '長いすでひと休み', stageImg: 'assets/story/iso/dagashi_deco_1.png', thumb: 'assets/story/iso/dagashi_deco_1.png' },
          { id: 2, label: '金魚鉢とたぬき', desc: 'にぎやかに', stageImg: 'assets/story/iso/dagashi_deco_2.png', thumb: 'assets/story/iso/dagashi_deco_2.png' },
        ],
        after: [
          { speaker: 'kiyo', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smug' },
            text: 'レイナちゃん、ありがとね。また子どもらに「おかえり」って言えるよ。' },
        ],
      },
    ],
    outro: [
      { speaker: 'ryoji', expr: 'smug', side: 'right', other: { speaker: 'kiyo', expr: 'smile' },
        text: '駄菓子なんて10円20円の商売だろ。もうかるかよ。' },
      { speaker: 'kiyo', expr: 'smile', side: 'right', other: { speaker: 'ryoji', expr: 'smug' },
        text: 'もうけじゃないんだよ、ぼうや。子どもの笑い声は、お金じゃ買えないのさ。' },
      { speaker: 'reina', expr: 'smug', side: 'left', other: { speaker: 'kiyo', expr: 'smile' },
        text: 'さすがキヨばあちゃん！……で、カフェのとなりのジム、なんか中から声しない？' },
    ],
    reward: { xp: 555, energy: 140, gems: 120 },
  },
  {
    id: 10,
    title: 'ストーリー10',
    areaName: '参道のおくのジム',
    subtitle: '参道のいちばん奥のジム。ダイゴと一緒に、商店街のみんなが元気になるジムを作ろう！',
    baseImg: 'assets/story/iso/gym_deco_dirty.png',
    clouds: [],
    intro: [
      { speaker: 'daigo', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
        text: '押忍！！あんたがウワサのレイナさんっすね！ダイゴっす！ここで昔、プロレスの道場をやってたっす！' },
      { speaker: 'reina', expr: 'lazy', side: 'left', other: { speaker: 'daigo', expr: 'smile' },
        text: '声でっか……。で、ここをジムにしたいってこと？' },
      { speaker: 'daigo', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
        text: 'そうっす！商店街のみんなが元気になる、町のジムにしたいんす！' },
      { speaker: 'takumi', expr: 'smile', side: 'right', other: { speaker: 'daigo', expr: 'smile' },
        text: 'ダイゴさん！俺、揚げ物屋の配達で鍛えてるんで、手伝います！' },
      { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'daigo', expr: 'smile' },
        text: 'モモも、きんにくつける！' },
    ],
    tasks: [
      {
        id: 'ch10_clean', title: '参道の奥まで片付ける',
        desc: '神社の手前まで残ったガレキを片付けて、参道を最後まで磨こう！', cost: 470,
        pin: { x: 50, y: 50, zoom: 1.35 },
        after: [
          { speaker: 'daigo', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
            text: 'うおお、ガレキがあっという間に！レイナさん、いい腕っぷしっす！' },
        ],
      },
      {
        id: 'ch10_repair', title: '壁と床を直す',
        desc: 'ひび割れたコンクリートと床を、トレーニングできるように直そう！', cost: 490,
        pin: { x: 50, y: 50, zoom: 1.45 },
        after: [
          { speaker: 'daigo', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
            text: 'この赤いライン！道場のころと同じっす……。' },
        ],
      },
      {
        id: 'ch10_rack', title: 'トレーニング用具のラックを置く',
        desc: 'ダンベルやケトルベルを並べるラックを置こう！3択から選べるよ。', cost: 510,
        pin: { x: 50, y: 50, zoom: 1.55 },
        choices: [
          { id: 0, label: 'ダンベルの黒いラック', desc: '本格派', stageImg: 'assets/story/iso/gym_rack_0.png', thumb: 'assets/story/iso/gym_rack_0.png' },
          { id: 1, label: 'ケトルベルの木のラック', desc: 'ナチュラルに', stageImg: 'assets/story/iso/gym_rack_1.png', thumb: 'assets/story/iso/gym_rack_1.png' },
          { id: 2, label: 'カラフルなダンベル', desc: '初心者も楽しく', stageImg: 'assets/story/iso/gym_rack_2.png', thumb: 'assets/story/iso/gym_rack_2.png' },
        ],
        after: [
          { speaker: 'takumi', expr: 'smile', side: 'right', other: { speaker: 'daigo', expr: 'smile' },
            text: 'これ、思ったより重っ！……でもやる気出てきた！' },
        ],
      },
      {
        id: 'ch10_machine', title: 'トレーニングマシンを置く',
        desc: '汗をかけるマシンを置こう！3択から選べるよ。', cost: 520,
        pin: { x: 50, y: 50, zoom: 1.55 },
        choices: [
          { id: 0, label: 'ベンチプレス', desc: '王道の筋トレ', stageImg: 'assets/story/iso/gym_machine_0.png', thumb: 'assets/story/iso/gym_machine_0.png' },
          { id: 1, label: 'ランニングマシン', desc: '走って汗をかく', stageImg: 'assets/story/iso/gym_machine_1.png', thumb: 'assets/story/iso/gym_machine_1.png' },
          { id: 2, label: 'エアロバイク2台', desc: 'ふたりでこげる', stageImg: 'assets/story/iso/gym_machine_2.png', thumb: 'assets/story/iso/gym_machine_2.png' },
        ],
        after: [
          { speaker: 'reina', expr: 'smile', side: 'left', other: { speaker: 'daigo', expr: 'smile' },
            text: 'ウチ、ここで体しぼるわ。マジで。' },
        ],
      },
      {
        id: 'ch10_front', title: '店先にベンチと飾りを置く',
        desc: 'ジムの前にベンチと飾りを置こう！3択から選べるよ。', cost: 530,
        pin: { x: 50, y: 50, zoom: 1.4 },
        choices: [
          { id: 0, label: '木のベンチとクーラー', desc: 'スポーツドリンク', stageImg: 'assets/story/iso/gym_deco_0.png', thumb: 'assets/story/iso/gym_deco_0.png' },
          { id: 1, label: '赤いベンチとタイヤ', desc: 'トレーニングの入口', stageImg: 'assets/story/iso/gym_deco_1.png', thumb: 'assets/story/iso/gym_deco_1.png' },
          { id: 2, label: '黒いベンチとタオルかご', desc: '観葉植物でさわやか', stageImg: 'assets/story/iso/gym_deco_2.png', thumb: 'assets/story/iso/gym_deco_2.png' },
        ],
        after: [
          { speaker: 'daigo', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smug' },
            text: 'レイナさん、ありがとうっす！参道に、かけ声が戻ってきたっす！' },
        ],
      },
    ],
    outro: [
      { speaker: 'ryoji', expr: 'smug', side: 'right', other: { speaker: 'reina', expr: 'smug' },
        text: 'カフェに駄菓子屋にジムかよ……。参道まで人が歩いてやがる。' },
      { speaker: 'reina', expr: 'smug', side: 'left', other: { speaker: 'ryoji', expr: 'smug' },
        text: 'でしょ？アンタもダイゴくんに鍛えてもらえば？その性格もついでにさ。' },
      { speaker: 'momo', expr: 'smile', side: 'left', other: { speaker: 'reina', expr: 'smile' },
        text: 'ママ、じんじゃのほうに、まだボロボロのところがあるよ！' },
      { speaker: 'gorou', expr: 'smile', side: 'right', other: { speaker: 'reina', expr: 'smile' },
        text: '参道の先は、神社の鳥居じゃ。……いつか、あそこでまた祭りがしたいのう。' },
    ],
    reward: { xp: 650, energy: 150, gems: 130 },
  },
];

// ---- 店内の家具を1つずつ選ぶ作業（棚・右の壁ぎわの家具・テーブル・植物・すみの小物・ラグ・壁の絵・看板） ----
type ItemDef = [what: string, title: string, desc: string, labels: [string, string][], after: DialogLine];
function shopItems(ch: number, pre: string, cost0: number, step: number, before: string | null, defs: ItemDef[]) {
  const chapter = CHAPTERS.find((c) => c.id === ch)!;
  const tasks: StoryTask[] = defs.map(([what, title, desc, labels, after], i) => ({
    id: `ch${ch}_${what}`, title, desc: `${desc}3択から選べるよ。`, cost: cost0 + step * i,
    pin: { x: 50, y: 50, zoom: 1.4 },
    choices: labels.map(([label, d], k) => ({ id: k, label, desc: d, stageImg: `assets/story/iso/${pre}_${what}_${k}.png`, thumb: `assets/story/iso/${pre}_${what}_${k}.png` })),
    after: [after],
  }));
  const at = before ? chapter.tasks.findIndex((t) => t.id === before) : -1;
  chapter.tasks.splice(at >= 0 ? at : chapter.tasks.length, 0, ...tasks);
}
const say = (speaker: SpeakerId, expr: Expression, text: string, other: SpeakerId = 'reina'): DialogLine =>
  ({ speaker, expr, side: speaker === 'reina' || speaker === 'momo' ? 'left' : 'right', other: { speaker: other, expr: 'smile' }, text });

shopItems(3, 'bk', 90, 8, 'ch3_counter', [
  ['shelf', '奥の壁に棚を置く', 'パンやお皿を飾る棚を、奥の壁ぎわに置こう！', [['木のパン棚', '焼きたてがずらり'], ['白いペンキの棚', 'バゲットとクロワッサンのかご'], ['アンティークの食器棚', '花柄のお皿とカップ']], say('gorou', 'smile', 'おお、棚があるだけで店らしくなるのう！')],
  ['side', '右の壁ぎわに家具を置く', '右の壁を背にして、お客さんのほうを向く家具を置こう！', [['パンの陳列ラック', '食パンとバゲットの斜めかご'], ['ガラスの冷蔵ケース', 'サンドイッチとケーキ'], ['白い木のベンチ', '待ち時間にひと休み']], say('reina', 'smile', 'こっち向きの家具があると、お店が広く見えるじゃん！', 'gorou')],
  ['table', 'テーブルを置く', '店の左に、パンを並べる台やテーブルを置こう！', [['パンの陳列台', '木箱にパンを山盛り'], ['大理石のカフェテーブル', 'コーヒーとクロワッサン'], ['絵本の読書コーナー', '子どもも楽しめる']], say('momo', 'smile', 'モモ、ここにすわってパンたべたい！', 'gorou')],
  ['plant', '入口のそばに植物を置く', '入口の左のすみに、植物を飾ろう！', [['木箱の観葉植物', '元気なグリーン'], ['オリーブの木', '素焼きの鉢でおしゃれに'], ['ひまわりの花束', '明るい黄色']], say('gorou', 'smile', '緑があると、カミさんがいたころを思い出すわい。')],
  ['corner', '右のすみに小物を置く', '店の右手前のすみに、小物を置こう！', [['小麦粉の袋の木箱', 'パン屋らしく'], ['パンかごのワゴン', '籐のかごを積んで'], ['真ちゅうのはかり', '小麦の穂を挿したつぼ']], say('reina', 'smug', 'すみっこまで抜かりなし！ウチ、才能あるかも？', 'gorou')],
  ['rug', 'ラグを敷く', 'テーブルの下に、ふかふかのラグを敷こう！', [['小麦色の格子ラグ', 'あたたかい色'], ['キリム風のラグ', 'こげ茶と赤の模様'], ['パンの形のラグ', 'かわいい黄色']], say('momo', 'smile', 'ふかふかー！モモ、ここでおひるねする！', 'reina')],
  ['art', '奥の壁に絵を飾る', '入口から正面に見える奥の壁に、絵を飾ろう！', [['小麦畑の油絵', '金の額で上品に'], ['パンのレトロポスター', '木の額で楽しく'], ['小さな額の3枚飾り', 'パンとコーヒーとひまわり']], say('gorou', 'smile', '入ってすぐ目に入る絵か……いい店構えじゃ。')],
  ['sign', '店先に看板を立てる', '入口の横に、パン屋の看板を立てよう！', [['黒板の立て看板', 'チョークのパンの絵'], ['金のパンの吊り看板', '丸い木の板'], ['クロワッサンの置き看板', '花のプランターつき']], say('reina', 'smile', 'これで通りからも、ひと目でパン屋ってわかるね！', 'gorou')],
]);
shopItems(4, 'fr', 120, 6, 'ch4_front', [
  ['shelf', '奥の壁に棚を置く', '調味料やざるを並べる棚を置こう！', [['ソースの並ぶ銀の棚', 'ステンレスで清潔に'], ['提灯つきの木の棚', '醤油とソースの壺'], ['グリーンを飾った銀の棚', '揚げ物のバットと植物']], say('takumi', 'smile', '棚があると仕込みがはかどります！')],
  ['side', '右の壁ぎわに家具を置く', '右の壁を背にして、お客さんのほうを向く家具を置こう！', [['木のカウンター席', '丸いスツール3つ'], ['飲み物の冷蔵庫', '瓶のジュースとお茶'], ['駄菓子の棚', '子どもが喜ぶ']], say('reina', 'smile', 'ここでラムネと揚げたてコロッケ……最高じゃん！', 'takumi')],
  ['table', 'テーブルを置く', '揚げたてを食べられるテーブルを置こう！', [['立ち飲みテーブル', '串カツとソースの缶'], ['ビールケースのテーブル', '下町の雰囲気'], ['ちゃぶ台と座布団', 'おにぎりと唐揚げ']], say('takumi', 'smile', '揚げたてをその場で食べてもらえる店、夢だったんです！')],
  ['plant', '入口のそばに飾りを置く', '左手前のすみに、植物や置物を飾ろう！', [['白いタイル鉢の観葉植物', 'すっきり清潔'], ['たぬきの置物', '商売繁盛'], ['竹の鉢植え', '和の雰囲気']], say('momo', 'smile', 'たぬきさん、モモとおなじくらいのおおきさ！', 'takumi')],
  ['corner', '右のすみに小物を置く', '店の右手前のすみに、小物を置こう！', [['ビールケースと紙袋', 'お持ち帰り用'], ['米びつと招き猫', 'お客さんを呼ぶ'], ['ラムネのたらい', '氷で冷やして']], say('takumi', 'smile', '招き猫、ばあちゃんの店にもありました……！')],
  ['rug', 'ラグを敷く', 'テーブルのまわりに、ござやラグを敷こう！', [['市松模様のござ', 'えんじと白'], ['赤い唐草模様のラグ', 'おめでたい柄'], ['黄色と黒の縞のラグ', '元気が出る']], say('reina', 'smug', '床が映えると、揚げ物までおいしそうに見えるし！', 'takumi')],
  ['sign', '店先に看板を立てる', '通りに向けて、揚げ物屋の看板を立てよう！', [['串カツの立て看板', '木のA形'], ['赤い提灯の看板', '夜も目立つ'], ['エビフライのネオン看板', 'レトロでポップ']], say('takumi', 'smile', 'この看板を見て、お客さんが来てくれますように！')],
]);
shopItems(5, 'ck', 150, 6, 'ch5_front', [
  ['shelf', '奥の壁に棚を置く', '焼き菓子やティーセットを飾る棚を置こう！', [['焼き菓子の飾り棚', 'リボンの箱とクッキー'], ['マカロンの白い棚', 'マカロンのタワー'], ['ミントのティーセット棚', 'ティーポットとカップ']], say('misaki', 'smile', '棚にお菓子が並ぶと、わくわくしますね！')],
  ['side', '右の壁ぎわに家具を置く', '右の壁を背にして、お客さんのほうを向く家具を置こう！', [['白い木のソファベンチ', 'ピンクのクッション'], ['焼き菓子の陳列台', 'クッキーとマドレーヌ'], ['アンティークの食器棚', 'ティーカップがずらり']], say('reina', 'smile', 'ここ、絶対写真撮りたくなるやつじゃん！', 'misaki')],
  ['table', 'テーブルを置く', 'ケーキを食べられるテーブル席を置こう！', [['白い丸テーブル', 'ショートケーキとティーセット'], ['ハートの椅子のカフェ席', '白いアイアン'], ['ピンクのソファ席', '金色の丸テーブル']], say('misaki', 'smile', 'ここでゆっくりケーキを食べてもらえたら、うれしいな。')],
  ['plant', '入口のそばに飾りを置く', '左手前のすみに、花やケーキの見本を飾ろう！', [['ハイビスカスの白い鉢', '明るいピンク'], ['ピンクのバラの木', '上品に'], ['ウェディングケーキの見本', 'お祝いの予約に']], say('momo', 'smile', 'おおきいケーキ！モモのおたんじょうびのケーキ、これがいい！', 'misaki')],
  ['corner', '右のすみに小物を置く', '店の右手前のすみに、小物を置こう！', [['カップケーキのワゴン', '小さな白いワゴン'], ['いちごとりんごの木箱', '新鮮なくだもの'], ['プレゼントの箱の台', 'リボンをかけて']], say('misaki', 'smile', 'くだものの木箱、仕入れのときの気分が上がります！')],
  ['rug', 'ラグを敷く', 'テーブルの下に、かわいいラグを敷こう！', [['ハート模様のラグ', 'ピンクと白'], ['バラの花柄のラグ', '淡いピンク'], ['ミントの水玉ラグ', 'さわやかに']], say('reina', 'smile', 'ラグひとつで、お部屋の空気が変わるんだよね〜。', 'misaki')],
  ['art', '奥の壁に絵を飾る', '入口から正面に見える奥の壁に、絵を飾ろう！', [['ショートケーキの油絵', '金の額'], ['マカロンのポスター', 'パステルカラー'], ['小さな額の3枚飾り', 'ケーキとカップと花']], say('misaki', 'smile', '師匠のお店にも、こんな絵が飾ってあったんです。')],
  ['sign', '店先に看板を立てる', '入口の横に、ケーキ屋の看板を立てよう！', [['白い立て看板', 'ショートケーキの絵'], ['カップケーキの吊り看板', 'ピンクの板'], ['ショートケーキの置き看板', '大きなケーキの形']], say('reina', 'smile', 'かわいすぎ！通る人みんな振り返るって！', 'misaki')],
]);
shopItems(6, 'cl', 170, 6, 'ch6_front', [
  ['shelf', '奥の壁に棚を置く', 'たたんだ服や小物を並べる棚を置こう！', [['たたんだ服の木の棚', 'カラフルなシャツ'], ['ニットと帽子の白い棚', 'やさしい色合い'], ['靴とバッグの金の棚', 'エレガントに']], say('yuri', 'smile', '棚の並べ方ひとつで、お店の品が決まるのよ。')],
  ['side', '右の壁ぎわに家具を置く', '右の壁を背にして、お客さんのほうを向く家具を置こう！', [['ワンピースのハンガーラック', '色とりどり'], ['靴の陳列棚', 'ブーツとパンプス'], ['金縁の姿見', 'ベルベットのスツールつき']], say('reina', 'smile', '全身鏡あるの神！試着がはかどるやつ！', 'yuri')],
  ['table', 'テーブルを置く', '店の中ほどに、商品を並べる台を置こう！', [['シャツとストールの平台', '木の台'], ['木の平台と花びん', 'たたんだシャツとスカーフ'], ['アクセサリーの丸テーブル', 'ネックレスと指輪のトレイ']], say('yuri', 'smile', '手に取って選べる台があると、お客さんが長くいてくれるの。')],
  ['plant', '入口のそばに飾りを置く', '左手前のすみに、マネキンや植物を飾ろう！', [['赤いドレスのマネキン', '店の顔に'], ['モンステラの鉢', '大きなグリーン'], ['帽子掛けのコートスタンド', '帽子とストール']], say('momo', 'smile', 'あかいドレス、モモもきてみたい！', 'yuri')],
  ['corner', '右のすみに小物を置く', '店の右手前のすみに、小物を置こう！', [['からし色のスツール', '紙袋を添えて'], ['スカーフのかご', '籐のかごに'], ['古いトランクの台', '帽子をのせて']], say('yuri', 'smile', 'あのトランク、若いころに旅したときのものなのよ。')],
  ['rug', 'ラグを敷く', '台の下に、おしゃれなラグを敷こう！', [['ヘリンボーン柄のラグ', 'ミントとクリーム'], ['からし色の幾何学ラグ', 'モダンに'], ['ペルシャ絨毯風のラグ', 'クラシックに']], say('reina', 'smug', '床までおしゃれとか、ユリさんの店ぶっちぎりじゃん！', 'yuri')],
  ['art', '右の壁に絵を飾る', '右の壁に、おしゃれな絵を飾ろう！', [['ファッションイラスト', '細い金の額'], ['帽子とドレスのポスター', 'ヴィンテージ'], ['小さな額の3枚飾り', 'くつとかばんとワンピース']], say('yuri', 'smile', '絵があると、お店にお話が生まれるわね。')],
  ['sign', '店先に看板を立てる', '通りに向けて、服屋の看板を立てよう！', [['黒い立て看板', 'ハンガーとワンピースの絵'], ['ハンガーの吊り看板', 'ミント色の板'], ['トルソーの置き看板', 'おしゃれな形']], say('reina', 'smile', 'これで通りの主役は、ユリさんの店だね！', 'yuri')],
]);

shopItems(8, 'cf', 340, 6, 'ch8_front', [
  ['shelf', '奥の壁に棚を置く', '豆やカップを飾る棚を置こう！', [['コーヒー豆の木の棚', 'びんの豆がずらり'], ['レトロな食器棚', '花柄のカップとソーサー'], ['白い木の棚', '本と観葉植物']], say('haruto', 'smile', '豆を並べると、店の空気が変わりますね。')],
  ['side', '左の壁ぎわに家具を置く', '左の壁を背にして、お客さんのほうを向く家具を置こう！', [['木の本棚', '読書ランプつき'], ['ジュークボックス', 'レコードの棚'], ['ケーキの冷蔵ケース', 'ケーキとサンドイッチ']], say('reina', 'smile', '本棚があるカフェとか、一日いられるやつじゃん！', 'haruto')],
  ['table', 'テーブルを置く', '店の手前に、ふたり用のテーブルを置こう！', [['木の丸テーブル', 'ラテアートのカップ'], ['赤いチェックのテーブル', '昔ながらの喫茶店'], ['白いテーブルと籐の椅子', 'パンケーキを添えて']], say('momo', 'smile', 'パンケーキ！モモ、はちみつたっぷりがいい！', 'haruto')],
  ['plant', '入口のそばに飾りを置く', '入口のすみに、植物やメニューを飾ろう！', [['モンステラの鉢', '大きな葉っぱ'], ['コーヒーの木', '赤い実がなる'], ['黒板のメニュー', 'カップの絵']], say('haruto', 'smile', 'コーヒーの木って、白い花も咲くんですよ。')],
  ['corner', 'すみに小物を置く', '店のすみに、小物を置こう！', [['麻袋の木箱', 'コーヒー豆どっさり'], ['小さな焙煎機', '自家焙煎の店に'], ['新聞と雑誌のラック', '木のスツールつき']], say('gorou', 'smile', '自家焙煎か。うちのパンにも合いそうじゃのう。', 'haruto')],
  ['rug', 'ラグを敷く', 'テーブルの下に、ラグを敷こう！', [['ペルシャ風のラグ', 'こげ茶とからし色'], ['しま模様のラグ', 'コーヒー豆の色'], ['チェックのラグ', 'クリームと緑']], say('reina', 'smile', 'ラグ1枚で、ぐっと落ち着くじゃん。', 'haruto')],
  ['art', '奥の壁に絵を飾る', '入口から正面に見える奥の壁に、絵を飾ろう！', [['カップとクロワッサンの油絵', '木の額'], ['レトロな喫茶店のポスター', 'サイフォンの絵'], ['小さな額の3枚飾り', 'カップとポットと花']], say('haruto', 'smile', '父が好きだった絵に、少し似ています。')],
  ['sign', '店先に看板を立てる', '入口の横に、喫茶店の看板を立てよう！', [['黒板の立て看板', 'カップとケーキの絵'], ['木の吊り看板', '金色のカップ'], ['クリーム色の置き看板', '赤いサイフォン']], say('reina', 'smile', 'これで参道のみんな、吸いこまれちゃうって！', 'haruto')],
]);
shopItems(9, 'dg', 410, 6, 'ch9_front', [
  ['shelf', '入口の横に棚を置く', 'おもちゃを並べる棚を、入口の横の壁ぎわに置こう！', [['おもちゃとめんこの棚', '小さなおもちゃがずらり'], ['けん玉とこまの棚', 'ガラス戸の木の棚'], ['ブリキのおもちゃの棚', '昔なつかしい']], say('kiyo', 'smile', 'めんこは、ハルちゃんが一番強かったんだよ。')],
  ['side', '左の壁ぎわに家具を置く', '左の壁を背にして、お客さんのほうを向く家具を置こう！', [['ラムネの冷蔵ケース', 'びんがキンキン'], ['吊り下げ駄菓子のラック', '袋がずらり'], ['昭和のたんす', '招き猫と黒電話']], say('reina', 'smile', '黒電話とか初めて見た！ダイヤル回してみたーい！', 'kiyo')],
  ['table', 'テーブルを置く', '店の中に、ちゃぶ台や台を置こう！', [['ちゃぶ台と座布団', 'ラムネで乾杯'], ['駄菓子の平台', 'かごに山盛り'], ['もんじゃの鉄板テーブル', '丸椅子つき']], say('momo', 'smile', 'もんじゃってなに？モモ、たべてみたい！', 'kiyo')],
  ['plant', 'すみに飾りを置く', '店のすみに、植物や置物を飾ろう！', [['朝顔の鉢', '竹の支柱'], ['たぬきの置物', '信楽焼'], ['ひまわりの鉢', '夏らしく']], say('kiyo', 'smile', 'たぬきはね、「他を抜く」で商売繁盛なんだよ。')],
  ['corner', 'すみに小物を置く', '店のすみに、小物を置こう！', [['ラムネのケース', '積み上げて'], ['たらいのラムネとスイカ', '冷え冷え'], ['ビー玉とめんこの箱', '宝箱みたい']], say('momo', 'smile', 'ビー玉きらきら！モモのたからものにする！', 'kiyo')],
  ['rug', '敷物を敷く', '台の下に、ござや敷物を敷こう！', [['赤と白の市松のござ', '元気な柄'], ['花の刺しゅうのござ', 'い草の香り'], ['麻の葉模様の敷物', '和の柄']], say('reina', 'smile', 'ござの上でごろごろしたくなるやつ〜。', 'kiyo')],
  ['art', '左の壁に絵を飾る', '左の壁に、昭和の絵を飾ろう！', [['夏祭りの絵', '金魚すくいと提灯'], ['ホーロー看板風の絵', '駄菓子とラムネ'], ['小さな額の3枚飾り', 'こまとけん玉とビー玉']], say('kiyo', 'smile', '夏祭りの夜は、店の前まで提灯が並んだもんさ。')],
  ['sign', '店先に看板を立てる', '参道に向けて、駄菓子屋の看板を立てよう！', [['赤い看板', '飴とラムネの絵'], ['ホーロー看板風', '駄菓子とおもちゃ'], ['瓦屋根の看板', '金魚と風鈴']], say('reina', 'smile', 'これで参道の子どもたち、みんな寄り道確定！', 'kiyo')],
]);
shopItems(10, 'gm', 480, 6, 'ch10_front', [
  ['shelf', '奥の壁に棚を置く', 'タオルや道具を並べる棚を置こう！', [['タオルとプロテインの棚', '木の棚'], ['グローブとバンテージの棚', '黒い棚'], ['トロフィーの飾り棚', 'チャンピオンベルト']], say('daigo', 'smile', 'このベルト、現役のころに取ったやつっす！')],
  ['side', '左の壁ぎわに家具を置く', '左の壁を背にして、お客さんのほうを向く家具を置こう！', [['大きな壁の鏡', 'ヨガマットつき'], ['サンドバッグの吊り台', '打ちこみ用'], ['緑のロッカー', '着がえに']], say('reina', 'smile', '鏡があるとフォームも見られるし、自撮りもできるじゃん！', 'daigo')],
  ['table', 'ストレッチの場所を作る', '店の手前に、ストレッチやひと休みの場所を作ろう！', [['ヨガマットとバランスボール', 'ストレッチに'], ['マットとフォームローラー', '体をほぐす'], ['丸テーブルとスツール', 'ひと休みに']], say('momo', 'smile', 'ボールのうえ、ぼよんぼよん！', 'daigo')],
  ['plant', '入口のそばに飾りを置く', '入口のすみに、植物や飾りを置こう！', [['パキラの鉢', '明るいグリーン'], ['サンセベリアの鉢', '空気をきれいに'], ['グローブのスタンド', 'ボクシンググローブ']], say('daigo', 'smile', '緑があると、トレーニングもはかどるっす！')],
  ['corner', 'すみに小物を置く', '店のすみに、トレーニングの道具を置こう！', [['ダンベルの木箱', '重さいろいろ'], ['プロテインのワゴン', 'シェイカーつき'], ['タイヤとロープ', 'パワートレーニング']], say('takumi', 'smile', 'タイヤ押し、配達より全然きつい……！', 'daigo')],
  ['rug', 'マットを敷く', '床に、トレーニング用のマットを敷こう！', [['黒と赤のマット', 'トレーニングに'], ['グレーと黄色のしまのマット', '明るく'], ['緑の人工芝のマット', '外みたいに']], say('reina', 'smile', '床がいいと、気分もアガるよね。', 'daigo')],
  ['art', '奥の壁に絵を飾る', '入口から正面に見える奥の壁に、絵を飾ろう！', [['ボクサーのポスター', '黒い額'], ['チャンピオンベルトの絵', '金色の額'], ['小さな額の3枚飾り', 'ダンベルとグローブとトロフィー']], say('daigo', 'smile', '見るたびに、気合いが入るっす！')],
  ['sign', '店先に看板を立てる', '参道に向けて、ジムの看板を立てよう！', [['黒い看板', '金色のダンベル'], ['赤い看板', '白いボクシンググローブ'], ['木の看板', '力こぶの腕']], say('reina', 'smile', 'これで参道に、マッチョが集まってくるね！', 'daigo')],
]);

// 11〜20章（北の道・西の道・夏祭り）
CHAPTERS.push(...CHAPTERS_11);

// 章の中では、あとのタスクほど値段が高い（お店の家具を途中に入れたので並べ直す。章の合計は変えない）
for (const ch of CHAPTERS) {
  const costs = ch.tasks.map((t) => t.cost).sort((a, b) => a - b);
  ch.tasks.forEach((t, i) => { t.cost = costs[i]!; });
}

export function getChapter(id: number): StoryChapter | undefined {
  return CHAPTERS.find((c) => c.id === id);
}

/** 現在進めるべきチャプター（未完了の最初のチャプター、全完了なら最後） */
export function currentChapter(progress: StoryProgress): StoryChapter {
  for (const ch of CHAPTERS) {
    if (!isChapterComplete(ch, progress)) return ch;
  }
  return CHAPTERS[CHAPTERS.length - 1]!;
}

export function findStoryTask(taskId: string): { chapter: StoryChapter; task: StoryTask; index: number } | undefined {
  for (const chapter of CHAPTERS) {
    const index = chapter.tasks.findIndex((t) => t.id === taskId);
    if (index >= 0) return { chapter, task: chapter.tasks[index]!, index };
  }
  return undefined;
}

export function isChapterComplete(chapter: StoryChapter, progress: StoryProgress): boolean {
  return chapter.tasks.every((t) => progress.done.includes(t.id));
}

export function nextStoryTask(chapter: StoryChapter, progress: StoryProgress): StoryTask | undefined {
  return chapter.tasks.find((t) => !progress.done.includes(t.id));
}

/** 現在の進行状態（＋3択プレビュー中）で表示すべきフルサイズマップ画像パスを返す */
export function currentChapterMapImg(
  chapter: StoryChapter,
  progress: StoryProgress,
  preview?: { taskId: string; choice: number } | null,
): string {
  let img = chapter.baseImg;
  for (const t of chapter.tasks) {
    if (preview && preview.taskId === t.id && t.choices?.length) {
      return (t.choices[preview.choice] ?? t.choices[0])!.stageImg;
    }
    if (!progress.done.includes(t.id)) break;
    if (t.choices?.length) {
      const idx = progress.choices[t.id] ?? 0;
      img = (t.choices[idx] ?? t.choices[0])!.stageImg;
    } else if (t.stageImg) {
      img = t.stageImg;
    }
  }
  return img;
}

// BF6当日オペ用の簡易認証(クルー入場)。
//
// ⚠️ なぜ /staff の管理パスワードを使わないか:
// /staff 配下には会員名簿・収支・決済・台帳がすべてぶら下がっている。
// 当日だけ手伝ってもらうスタッフに `EVENT_PASSWORD` を渡すと、
// リンクを辿るだけでそれらが全部見えてしまう。
// そこで当日オペ(受付・写真・くじ・LED操作)だけを /bf6/crew に切り出し、
// 別のPINで入れるようにする。PINが漏れてもBF6の当日画面より先へは行けない。

export const CREW_COOKIE = 'bf6_crew_auth';

/** イベント前後だけ有効にする。長く残さないことでPIN流出の影響を短く抑える。 */
export const CREW_SESSION_DAYS = 5;

/** 全角数字・空白・ハイフンを吸収する(iPadのキーボードで混ざりやすい)。 */
export function normalizePin(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-ー－]/g, '');
}

/** 4〜8桁の数字のみ。当日iPadで打つので記号は入れさせない。 */
export function isValidPinFormat(pin: string): boolean {
  return /^[0-9]{4,8}$/.test(pin);
}

export function crewSessionExpiry(now: Date): string {
  return new Date(now.getTime() + CREW_SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export type CrewTask = {
  href: string;
  title: string;
  desc: string;
  /** 当日この作業をやる時間帯。メニューの並び順の根拠でもある。 */
  when: string;
};

/**
 * 当日オペのメニュー。ここに無いものはクルーからは触れない
 * (返金・キャンセル・台帳・会員データは /staff 側に残す)。
 */
export const CREW_TASKS: CrewTask[] = [
  {
    href: '/bf6/crew/reception?phase=block',
    title: '受付・くじ引き①',
    desc: 'チェックインと、ビギナーのトーナメント位置 / 小中・一般のA-Bブロック抽選',
    when: '13:30-14:00',
  },
  {
    href: '/bf6/crew/cash',
    title: '当日現金の集金',
    desc: '事前決済をしていない人から現金を受け取り、その場で記録する。お金は注文ごと(きょうだいは1回)',
    when: '13:30-14:00',
  },
  {
    href: '/bf6/crew/photo',
    title: '写真撮影',
    desc: 'VS画面に出す顔写真を撮る。背景はその場で自動で抜ける',
    when: '受付時(ビギナー) / 予選後(ベスト8)',
  },
  {
    href: '/bf6/crew/qualifiers',
    title: '予選通過者',
    desc: '小中・一般の予選が終わったら、通過した8名をチェック。くじ引き②と写真はこの8名だけになる',
    when: '予選終了後',
  },
  {
    href: '/bf6/crew/reception?phase=bracket',
    title: 'くじ引き②(ベスト8)',
    desc: '予選を通過した小中・一般がトーナメントの位置を引く',
    when: '予選終了後',
  },
  {
    href: '/bf6/crew/control',
    title: 'LED操作卓',
    desc: '会場のLEDに映す画面を切り替える。勝者を押すとトーナメント表が進む',
    when: 'バトル中',
  },
];

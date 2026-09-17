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
    href: '/bf6/crew/photo',
    title: '写真撮影',
    desc: 'LEDのVS画面に出す顔写真を撮る。背景はその場で自動で抜ける',
    when: '受付時(ビギナー) / 予選後(ベスト8)',
  },
  {
    href: '/bf6/crew/cash',
    // ⚠️「当日現金の集金」は申込フォーム上の用語で、当日の係には誰のことか伝わらない
    //    (TARO 2026-09-17)。エントリー費という分かる言葉を先に出す。
    // ⚠️ ただし中身はエントリー費だけではない。7件中5件が観覧チケット込みで、
    //    受付で全額まとめて受け取る決定(TARO 2026-09-16)。取り忘れを防ぐため説明文で明記する。
    title: 'エントリー費の集金(当日払い)',
    desc: '申込で「当日払い」を選んだ人から受け取る。観覧チケットも申し込んでいれば、その分も一緒に受け取る。お金は注文ごと(きょうだいは1回)',
    when: '13:30-14:00',
  },
  {
    href: '/bf6/crew/gate',
    title: '入場受付(観覧)',
    desc: '観覧のお客さんを名前で探し、リストバンドを渡して記録する。当日券もここで受け取る',
    when: '14:30-14:45',
  },
  {
    href: '/bf6/crew/qualifiers',
    title: 'ブロック予選',
    desc: '並び順を見ながら人を並ばせ、ジャッジが肩を叩いた人をチェックする。くじ引き②と写真はこの8名だけになる',
    when: '予選終了後',
  },
  {
    href: '/bf6/crew/reception?phase=bracket',
    title: '小中・一般 くじ引き②',
    desc: '予選を通過した小中・一般がトーナメントの位置を引く',
    when: '予選終了後',
  },
  {
    href: '/bf6/crew/control',
    title: 'LED操作卓',
    desc: '会場のLEDに映す画面を切り替える。勝者を押すとトーナメント表が進む',
    when: 'バトル中',
  },
  // ⚠️ 受付とくじ引き①は出場者本人が受付iPadで操作する。遅れて来た人もスタッフが
  //    iPadを代わりに操作すれば済む(TARO 2026-09-17)。これはiPad3台が全部使えなく
  //    なったときの保険なので、メニューの一番下に置いて普段使わないものだと分かるようにする。
  {
    href: '/bf6/crew/reception?phase=block',
    title: '(予備) iPadが使えないときの受付・くじ引き①',
    desc: '受付iPadが不調なときだけ使う。ビギナーはトーナメントの位置、小中・一般はA-Bブロックを引く',
    when: '通常は使わない',
  },
];

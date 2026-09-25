// BOOMER'S FIGHT!!! vol.7 の告知ページ用の純ロジック(DOM・DBに触らない)。
//
// 当日(2026-09-26 BF6)の会場でvol.7を発表する。サイトは先に出しておき、
// エントリー開始までカウントダウン + ウェイトリスト(メール)を集める(TARO 2026-09-24)。
// ⚠️ ゲスト(大阪から招へい)はサイトに名前を出さない。会場で口頭発表する方針。

/** 開催日(JST)。2027年1月30日(土) SSM 9階ホール */
export const BF7_EVENT_DATE = '2027-01-30';
/** エントリー開始(JST 0:00)。開催の約2か月前 */
export const BF7_ENTRY_OPEN_AT = '2026-11-30T00:00:00+09:00';

export const BF7_DIVISIONS = [
  { key: 'beginner', label: 'ビギナー' },
  { key: 'kids', label: '小中学生' },
  { key: 'general', label: '一般' },
] as const;

export type Bf7NotifyInput = { name: string; email: string; divisions: string[]; note?: string };
export type Bf7NotifyValid = { name: string; email: string; divisions: string[]; note: string };

/** エントリー開始までの残り。0以下なら開始済み。 */
export function countdownTo(target: string, now: Date = new Date()): {
  done: boolean; days: number; hours: number; minutes: number; seconds: number;
} {
  const ms = new Date(target).getTime() - now.getTime();
  if (ms <= 0) return { done: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  const s = Math.floor(ms / 1000);
  return {
    done: false,
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

/**
 * ウェイトリストの入力チェック。エラーは文字列で返す(BF6の validateBf6Order と同じ作法)。
 * 部門は「出たい希望」なので未選択でも通す。名前とメールだけ必須。
 */
export function validateBf7Notify(input: Bf7NotifyInput): Bf7NotifyValid | string {
  const name = (input.name ?? '').trim();
  if (!name) return 'お名前を入力してください';
  if (name.length > 40) return 'お名前が長すぎます';
  const email = (input.email ?? '').trim();
  if (!email) return 'メールアドレスを入力してください';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'メールアドレスの形式が正しくありません';
  if (email.length > 120) return 'メールアドレスが長すぎます';
  const keys = BF7_DIVISIONS.map((d) => d.key) as readonly string[];
  const divisions = (input.divisions ?? []).filter((d) => keys.includes(d));
  const note = (input.note ?? '').trim().slice(0, 200);
  return { name, email, divisions, note };
}

/** 完了メールの本文。部門は「希望」であって開催の確約ではないことを必ず書く。 */
export function buildBf7NotifyEmail(v: Bf7NotifyValid): { subject: string; text: string } {
  const labels = v.divisions
    .map((k) => BF7_DIVISIONS.find((d) => d.key === k)?.label)
    .filter(Boolean)
    .join('・');
  const lines = [
    `${v.name} 様`,
    '',
    "BOOMER'S FIGHT!!! vol.7 のウェイトリストにご登録ありがとうございます。",
    'エントリーの受付を開始したら、このメールアドレスにご案内をお送りします。',
    '',
    '■ 開催日  2027年1月30日(土)',
    '■ 会場    SSM(仙台スクールオブミュージック&ダンス専門学校) 9階ホール',
    '■ エントリー開始  2026年11月30日ごろ(予定)',
    '',
    labels ? `■ 出たい部門(ご希望)  ${labels}` : '■ 出たい部門(ご希望)  未選択',
    '  ※ 部門の構成は参加人数を見て決めます。ご希望の部門が開催されない場合があります。',
    '',
    '登録の取り消しや変更は、このメールにご返信ください。',
    '',
    'BOOM DANCE SCHOOL',
    "BOOMER'S FIGHT!!! vol.7",
  ];
  return { subject: "【BOOMER'S FIGHT!!! vol.7】ウェイトリストに登録しました", text: lines.join('\n') };
}

/**
 * BF6のトップページにvol.7への導線(大きなボタン)を出し始める時刻(JST)。
 * 9/26の本番で、MCがvol.7とゲストを発表するタイミングに合わせて自動で出す。
 * これより前は出さない = 会場より先にサイトでネタバレしない、という意図。
 * ⚠️ 18:45→18:30に変更(TARO 2026-09-25)。時刻を動かすときはここ1箇所。
 */
export const BF7_TEASER_AT = '2026-09-26T18:30:00+09:00';

/** BF6トップにvol.7の導線を出してよいか。 */
export function isBf7TeaserVisible(now: Date = new Date()): boolean {
  return now.getTime() >= new Date(BF7_TEASER_AT).getTime();
}

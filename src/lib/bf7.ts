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
    '■ エントリー受付  2026年11月30日 〜(予定)',
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

/** ゲストの経歴(本人提供 2026-09-25)から抜粋。ページでは「プロフィール」を押すと開く */
export const HIRO_CREDITS: { label: string; body: string }[] = [
  // vol.16 の3位は本人の指摘で追加(2026-10-26「プロフィールの頭が抜けていた」)
  { label: 'CONTEST', body: 'JAPAN DANCE DELIGHT vol.16 final 3rd place／JAPAN DANCE DELIGHT FINALIST(vol.11 / 16 / 17 / 19 / 20 / 30)' },
  {
    label: 'BATTLE',
    body: 'LIVING LARGE hiphop solo 優勝(2004)／ULTIMATE 1000 house solo 優勝(2016)／THE GAME 2005 hiphop solo 2nd place／ぐだぐだナイトスペシャル 優勝(2012・2016)',
  },
  {
    label: 'CHOREOGRAPHY',
    // 並びは本人の指定で F.O.H・MASAYA を THE RAMPAGE より前に(2026-10-21)。
    // 「L L brother s」の小文字とスペースは本人指定のまま(2026-10-22・直さないこと)
    body: 'Full Of Harmony／MASAYA from L L brother s／THE RAMPAGE from EXILE TRIBE／PSYCHIC FEVER from EXILE TRIBE／SWEEP',
  },
  { label: 'TV / MAGAZINE', body: 'MTV「ダンスディライト」CM／NIGHT CRUISING／スーパーチャンプル／D.D.D／DANCE STYLE' },
  {
    label: 'EVENT GUEST SHOW',
    body: 'SOUL ATTACK／StYiE JuNcTiOn／SUMMER SONIC OSAKA／EAST SIDE PARTY／OSAKA DANCE DELIGHT／JAPAN DANCE DELIGHT',
  },
  { label: 'OVERSEAS', body: 'シンガポール(2013〜2015)・台湾(2016〜2019)・中国 金華/武漢(2018〜2019)・韓国(2025〜2026)' },
];

/**
 * vol.7のページに出してよいFAQ。
 * ⚠️ vol.6のFAQをそのまま全部は出せない。部門構成・定員・料金はvol.7ではまだ決まっておらず、
 *    vol.6の金額(観覧¥2,000 等)や「ビギナー部門16名」をそのまま載せると嘘になる(TARO方針)。
 *    ここに挙げた「いつでも成り立つ質問」だけを出し、残りは決まってから足す。
 */
export const BF7_FAQ_ALLOW = [
  'レペゼン',
  'エントリージャンル',
  '習っているジャンル',
  'バトルは初めて',
  'ダンスバトルはどういう流れ',
  'どんな服装',
];

export function pickBf7Faqs<T extends { q: string }>(faqs: T[]): T[] {
  return faqs.filter((f) => BF7_FAQ_ALLOW.some((k) => f.q.includes(k)));
}

/**
 * 1/31 HIRO WORKSHOP の告知内容(告知サイト /bf7 の WORKSHOP 欄の正本)。
 *
 * ⚠️ 説明文・クラス名・ステップ名は HIROさん/おっちゃんの正式な文面のまま(2026-10-25〜26 3人トーク)。
 *    言い換え・要約・大文字小文字の変更をしないこと(TARO「修正が入ると大変なので削らない」)。
 * ⚠️ 対象Stepは3つ。3つ目は HIROさんの意向で「???」と伏せる(当日のレベルで4つ目をやることはあるが告知しない)。
 * 料金は一般価格のみ(サイトは誰でも見るため。会員価格は会員向けLINEでだけ案内・TARO 10/25)。
 */
/**
 * WSの詳細(クラス名・内容・Step・料金・定員・受付開始日)をサイトに出すか。
 * ⚠️ 2026-10-26 TARO「内容はまだ言えない。プレ告知で出した情報(日にち・会場・時間)だけにして」→ false。
 *    WSの告知(内部→外部)を出すときに true にする。
 */
export const BF7_WORKSHOP_DETAILS_PUBLIC = false;

export const BF7_WORKSHOP = {
  date: '2027-01-31',
  dateLabel: '2027.1.31 SUN',
  venue: 'エル・パーク仙台 フィットネススタジオ',
  address: '仙台市青葉区一番町4-11-1 141ビル 5・6階',
  access: '地下鉄南北線 勾当台公園駅 南1番出口から地下道でつながっています',
  capacity: 25,
  /** 一般受付の開始日(会員の先行受付は会員向けにだけ案内する) */
  openFrom: '2026-11-23',
  price: { one: 4000, two: 7000 },
  classes: [
    {
      no: '1ST',
      start: '13:30',
      end: '15:00',
      title: 'REGULAR CLASS',
      description: 'リズムトレーニング、STEP、ROUTINEレクチャーのクラス',
      steps: [] as string[],
    },
    {
      no: '2ND',
      start: '15:15',
      end: '16:45',
      title: 'BASIC STEP PREMIUM',
      description:
        'テーマとして特定したStepを細かな体の使い方や質感、バリエーション等をレクチャー。振り付けは行わず、徹底的にStepを深掘りするクラス。',
      steps: ['Robo Cop', 'The Skate (chicken&twist)', '???'],
    },
  ],
} as const;

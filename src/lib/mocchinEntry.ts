// BW6スペシャルナンバー by MOCCHIN の申込(2026-11-08受付開始)の純ロジック(DB非依存・vitest対象)。
// ※ 公開フォーム(クライアント)からも import するので node: 依存を持たない。
//
// 決定の正本: boom-events-hub docs/decisions/2026-10-06_mocchin-number-plan.md(10/29 料金見直し)
// 受付: 11/8〜11/14 = BOOM会員の先行申込(会員かどうかは自己申告) / 11/15〜12/13 = 誰でも(TARO 2026-11-03)
// 参加費は申込時に銀行振込。レッスン代は各日の当日払い(フォームでは案内だけ)。

export const MOCCHIN_FEE = 15000;
export const MOCCHIN_LESSON_FEE_MEMBER = 6000;
export const MOCCHIN_LESSON_FEE_GUEST = 7000;
/** 定員の初期値(20〜30名)。超えても受付は続け、オーディション/キャンセル待ちの案内を出す */
export const MOCCHIN_DEFAULT_CAPACITY = 30;

/** 受付の区切り(JSTの日付・この日を含む) */
export const MOCCHIN_MEMBER_START = '2026-11-08';
export const MOCCHIN_OPEN_START = '2026-11-15';
export const MOCCHIN_DEADLINE = '2026-12-13';

/** 参加費の振込先(BOOMの事業用口座。お客さん向けに案内している口座) */
export const MOCCHIN_BANK = {
  bank: 'GMOあおぞらネット銀行',
  branch: 'ビジネス支店',
  type: '普通',
  number: '1090355',
  holder: 'ブームキムラシンタロウ',
} as const;

export const MOCCHIN_SCHEDULE = [
  { date: '1/17(日)', time: '18:00〜19:30 / 19:45〜21:15', venue: '日立システムズホール仙台' },
  { date: '1/24(日)', time: '18:00〜19:30 / 19:45〜21:15', venue: '日立システムズホール仙台' },
  { date: '2/27(土)', time: '17:30〜19:00 / 19:15〜20:45', venue: '戦災復興記念館' },
  { date: '2/28(日)', time: '18:00〜19:30 / 19:45〜21:15', venue: '日立システムズホール仙台' },
  { date: '3/6(土)', time: '17:30〜19:00 / 19:15〜20:45', venue: '戦災復興記念館' },
  { date: '4/10(土)', time: '時間は後日お知らせ', venue: '若林区文化センター' },
] as const;

export const MOCCHIN_PROMISES = [
  '原則、全日程に参加します',
  '参加できない日がある場合は、必ず事前にBOOMの先生(TARO・KEIKO)に相談します',
  '参加費は返金できないことを了承します',
] as const;

export const CLASS_NUMBER_OPTIONS = ['yes', 'no', 'undecided'] as const;
export type ClassNumberPlan = (typeof CLASS_NUMBER_OPTIONS)[number];
export const CLASS_NUMBER_LABEL: Record<ClassNumberPlan, string> = {
  yes: '出る予定',
  no: '出ない',
  undecided: '未定',
};

/** 受付の状態。before=開始前 / member=会員の先行期間 / open=誰でも / closed=締切後 */
export type MocchinGate = 'before' | 'member' | 'open' | 'closed';

export function mocchinGate(today: string): MocchinGate {
  if (today < MOCCHIN_MEMBER_START) return 'before';
  if (today < MOCCHIN_OPEN_START) return 'member';
  if (today <= MOCCHIN_DEADLINE) return 'open';
  return 'closed';
}

/** 申込番号(画面・メール・振込名義で使う)。例: 1 → MC-001 */
export function formatMocchinNo(id: number): string {
  return `MC-${String(id).padStart(3, '0')}`;
}

/** 振込名義の頭に付ける形(ハイフンなし)。例: 1 → MC001 */
export function mocchinTransferPrefix(id: number): string {
  return formatMocchinNo(id).replace('-', '');
}

/** 'YYYY-MM-DD' に日数を足す(JSTの暦日として扱う) */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 振込期限 = 申込日から7日以内。ただし締切(12/13)を越えない */
export function mocchinPayDeadline(appliedOn: string): string {
  const d = addDays(appliedOn, 7);
  return d < MOCCHIN_DEADLINE ? d : MOCCHIN_DEADLINE;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
/** 'YYYY-MM-DD' → '11月15日(日)' */
export function formatJpDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEK[d.getUTCDay()]})`;
}

export interface MocchinInput {
  name: string;
  kana: string;
  age: string;
  guardianName: string;
  phone: string;
  email: string;
  isMember: boolean | null;
  memberNo: string;
  danceHistory: string;
  classNumber: string;
  note: string;
  agreed: boolean[];
}

export interface ValidatedMocchin {
  name: string;
  kana: string;
  age: string;
  guardianName: string;
  phone: string;
  email: string;
  isMember: boolean;
  memberNo: string;
  danceHistory: string;
  classNumber: ClassNumberPlan;
  note: string;
}

export type FieldErrors = Partial<Record<keyof MocchinInput, string>>;

function clean(v: unknown, max: number): string {
  return (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

const KANA_RE = /^[ぁ-ゖァ-ヿー・　\s]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 18歳未満(または小中高の学年)なら保護者の名前を必須にする */
export function isMinor(age: string): boolean {
  const a = age.normalize('NFKC');
  if (/(小|中|高|年長|年中|年少)/.test(a)) return true;
  const m = a.match(/\d+/);
  return m ? Number(m[0]) < 18 : false;
}

/** 入力チェック。OKなら整えた値、NGなら欄ごとのエラー */
export function validateMocchinInput(raw: MocchinInput): { ok: true; value: ValidatedMocchin } | { ok: false; errors: FieldErrors } {
  const e: FieldErrors = {};
  const name = clean(raw.name, 60);
  const kana = clean(raw.kana, 60);
  const age = clean(raw.age, 20);
  const guardianName = clean(raw.guardianName, 60);
  const phone = clean(raw.phone, 20).normalize('NFKC').replace(/[^\d]/g, '');
  const email = clean(raw.email, 120).normalize('NFKC');
  const memberNo = clean(raw.memberNo, 30);
  const danceHistory = clean(raw.danceHistory, 300);
  const note = clean(raw.note, 500);
  const classNumber = clean(raw.classNumber, 20);

  if (!name) e.name = 'お名前を入力してください';
  if (!kana) e.kana = 'フリガナを入力してください';
  else if (!KANA_RE.test(kana)) e.kana = 'フリガナはカタカナかひらがなで入力してください';
  if (!age) e.age = '年齢または学年を入力してください';
  if (age && isMinor(age) && !guardianName) e.guardianName = '18歳未満の方は保護者のお名前を入力してください';
  if (phone.length < 10 || phone.length > 11) e.phone = '電話番号を正しく入力してください';
  if (!EMAIL_RE.test(email)) e.email = 'メールアドレスを正しく入力してください';
  if (raw.isMember === null) e.isMember = 'BOOM会員かどうかを選んでください';
  if (!(CLASS_NUMBER_OPTIONS as readonly string[]).includes(classNumber)) e.classNumber = 'クラスのナンバーに出る予定かを選んでください';
  if (!Array.isArray(raw.agreed) || raw.agreed.length !== MOCCHIN_PROMISES.length || raw.agreed.some((a) => a !== true)) {
    e.agreed = '参加の約束をすべて確認してチェックしてください';
  }

  if (Object.keys(e).length > 0) return { ok: false, errors: e };
  return {
    ok: true,
    value: {
      name,
      kana,
      age,
      guardianName,
      phone,
      email,
      isMember: raw.isMember === true,
      memberNo,
      danceHistory,
      classNumber: classNumber as ClassNumberPlan,
      note,
    },
  };
}

/** 受付期間の判定(会員の先行期間に会員以外は申し込めない)。OKなら null */
export function mocchinGateError(gate: MocchinGate, isMember: boolean): string | null {
  if (gate === 'before') return `申込の受付は${formatJpDate(MOCCHIN_MEMBER_START)}からです`;
  if (gate === 'closed') return '申込の受付は終了しました';
  if (gate === 'member' && !isMember) {
    return `${formatJpDate(MOCCHIN_OPEN_START)}までは、BOOM会員の方の先行申込期間です。会員以外の方は${formatJpDate(MOCCHIN_OPEN_START)}から申し込めます`;
  }
  return null;
}

export const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

/** 申込完了メール(控え＋振込のご案内) */
export function buildMocchinEmail(p: {
  id: number;
  name: string;
  appliedOn: string;
  isMember: boolean;
  overCapacity: boolean;
}): { subject: string; text: string } {
  const no = formatMocchinNo(p.id);
  const lesson = p.isMember ? MOCCHIN_LESSON_FEE_MEMBER : MOCCHIN_LESSON_FEE_GUEST;
  const L: string[] = [];
  L.push(`${p.name} 様`);
  L.push('');
  L.push('BW6 スペシャルナンバー by MOCCHIN へのお申込みありがとうございます。');
  L.push('お申込みを受け付けました。');
  L.push('');
  L.push(`■ 申込番号: ${no}`);
  L.push('');
  L.push('【参加費のお振込み】');
  L.push(`金額: ${yen(MOCCHIN_FEE)}`);
  L.push(`期限: ${formatJpDate(mocchinPayDeadline(p.appliedOn))} まで`);
  L.push(`振込先: ${MOCCHIN_BANK.bank} ${MOCCHIN_BANK.branch} ${MOCCHIN_BANK.type} ${MOCCHIN_BANK.number}`);
  L.push(`口座名義: ${MOCCHIN_BANK.holder}`);
  L.push(`※振込名義の前に、申込番号「${mocchinTransferPrefix(p.id)}」を付けてください`);
  L.push(`  (例: ${mocchinTransferPrefix(p.id)} ヤマダハナコ)`);
  L.push('※振込手数料はご負担をお願いします');
  L.push('');
  L.push('【レッスン代】');
  L.push(`1日 ${yen(lesson)}(90分のレッスン×2本)。各日、当日のお支払いです。`);
  L.push('');
  L.push('【日程・会場】');
  for (const s of MOCCHIN_SCHEDULE) L.push(`${s.date} ${s.time} ${s.venue}`);
  L.push('2本目のあとは、参加者みんなで練習や質問の時間をとります。');
  L.push('');
  L.push('【参加の約束】');
  for (const s of MOCCHIN_PROMISES) L.push(`・${s}`);
  if (p.overCapacity) {
    L.push('');
    L.push('※定員を超えるお申込みをいただいています。オーディション形式になる場合は、あらためてご連絡します。');
  }
  L.push('');
  L.push('ご不明な点は、BOOMの公式LINEからお問い合わせください。');
  L.push('');
  L.push('BOOM ダンススクール');
  return { subject: `【BOOM】BW6 スペシャルナンバー by MOCCHIN お申込み受付(${no})`, text: L.join('\n') };
}

/** スタッフ一覧のCSV(Excelで開けるようBOM付きは呼び出し側で付ける) */
export function mocchinCsv(
  rows: Array<{
    id: number;
    createdAt: string;
    name: string;
    kana: string;
    age: string;
    guardianName: string;
    phone: string;
    email: string;
    isMember: boolean;
    memberNo: string;
    danceHistory: string;
    classNumber: string;
    note: string;
    paid: boolean;
    status: string;
  }>
): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['申込番号', '申込日時', '状態', '入金', 'お名前', 'フリガナ', '年齢/学年', '保護者', '電話', 'メール', '会員', '会員番号', 'ダンス歴', 'クラスのナンバー', '備考'];
  const lines = rows.map((r) =>
    [
      formatMocchinNo(r.id),
      r.createdAt,
      r.status === 'cancelled' ? '取消' : '有効',
      r.paid ? '入金済' : '未入金',
      r.name,
      r.kana,
      r.age,
      r.guardianName,
      r.phone,
      r.email,
      r.isMember ? '会員' : '会員以外',
      r.memberNo,
      r.danceHistory,
      CLASS_NUMBER_LABEL[r.classNumber as ClassNumberPlan] ?? r.classNumber,
      r.note,
    ]
      .map(esc)
      .join(',')
  );
  return [head.join(','), ...lines].join('\n');
}

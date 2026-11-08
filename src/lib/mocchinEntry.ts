// BW6スペシャルナンバー by MOCCHIN の申込(2026-11-08受付開始)の純ロジック(DB非依存・vitest対象)。
// ※ 公開フォーム(クライアント)からも import するので node: 依存を持たない。
//
// 決定の正本: boom-events-hub docs/decisions/2026-10-06_mocchin-number-plan.md(10/29 料金見直し)
// 受付: 11/8〜11/14 = BOOM会員の先行申込(会員かどうかは自己申告) / 11/15〜12/13 = 誰でも(TARO 2026-11-03)
// 支払いは銀行振込かカード(手数料はBOOM負担)。
// 2026-11-08 TARO: 申込時は参加費だけ(pending)。参加費の入金を確認したらすぐ、メールで
// レッスン代の払い方(一括・2回・3回)を選んでもらう(締切を待たない)。旧4択(full など)の値も読めるように残す。
// レッスン代は全6日分。休んでも減らない(来た日だけ払う形だと収入が読めないため)。

export const MOCCHIN_FEE = 15000;
export const MOCCHIN_LESSON_FEE_MEMBER = 6000;
export const MOCCHIN_LESSON_FEE_GUEST = 7000;
export const MOCCHIN_LESSON_DAYS = 6;
/** レッスン代の分割の期限(1回目は初日1/17の1週間前。最終は3/6より前に終える) */
export const MOCCHIN_LESSON_DUES = ['2027-01-10', '2027-02-10', '2027-03-01'] as const;
/** お知らせメールを送る日(期限の何日前か) */
export const MOCCHIN_REMIND_DAYS_BEFORE = 3;
/** プレビューから送ったテスト申込のカード金額(本物の請求になるので少額で試す) */
export const MOCCHIN_TEST_CARD_AMOUNT = 100;
const MOCCHIN_PUBLIC_ORIGIN = 'https://event.boom-sendai.com';

export function mocchinPayUrl(token: string): string {
  return `${MOCCHIN_PUBLIC_ORIGIN}/mocchin/pay?t=${token}`;
}
/** 定員の初期値(20〜30名)。超えても受付は続け、オーディション/キャンセル待ちの案内を出す */
export const MOCCHIN_DEFAULT_CAPACITY = 30;

/** 受付の区切り(JSTの日付・この日を含む) */
export const MOCCHIN_MEMBER_START = '2026-11-08';
export const MOCCHIN_OPEN_START = '2026-11-15';
export const MOCCHIN_DEADLINE = '2026-12-13';

/** BOOMの事業用口座(お客さん向けに案内している口座)。BF7など他イベントの振込先 */
export const BOOM_BANK = {
  bank: 'GMOあおぞらネット銀行',
  branch: 'ビジネス支店',
  type: '普通',
  number: '1090355',
  holder: 'ブームキムラシンタロウ',
} as const;

/** モッチンナンバー専用の振込入金口座(2026-11-06発行・TARO) */
export const MOCCHIN_BANK = {
  bank: 'GMOあおぞらネット銀行',
  branch: 'デネブ支店',
  type: '普通',
  number: '6041735',
  holder: 'キムラ シンタロウＢＷ６モツチンナンバー',
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
  '参加できない日程がある場合は、必ず事前にスクールに相談します',
  '参加費は返金できないことを了承します',
  'BW6でクラスのナンバーにも出る場合は、そちらの参加費などが別途かかることを了承します',
  'レッスン代は全6日分のお支払いです。お休みしたり途中でやめたりしても、返金・減額はないことを了承します',
] as const;

export const PAY_METHODS = ['transfer', 'card'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { transfer: '銀行振込', card: 'カード' };

export const PAYMENT_PLANS = ['pending', 'full', 'lesson_once', 'lesson_two', 'lesson_three'] as const;
export type PaymentPlan = (typeof PAYMENT_PLANS)[number];
/** 締切後に選んでもらうレッスン代の払い方 */
export const LESSON_PLANS = ['lesson_once', 'lesson_two', 'lesson_three'] as const;
export type LessonPlan = (typeof LESSON_PLANS)[number];
export const LESSON_PLAN_LABEL: Record<LessonPlan, string> = {
  lesson_once: '一括(1回)',
  lesson_two: '2回に分ける',
  lesson_three: '3回に分ける',
};
/** レッスン代の払い方を選ぶ期限(過ぎても選べる。未選択の人にはスタッフが個別に連絡する) */
export const MOCCHIN_PLAN_CHOOSE_BY = '2026-12-27';
/** reminded 列に入れる印(支払いの回とぶつからない番号): 払い方の案内を送った / 選ぶ期限前のお知らせを送った */
export const MOCCHIN_MARK_PLAN_INVITE = 90;
export const MOCCHIN_MARK_PLAN_REMIND = 91;
export const PAYMENT_PLAN_LABEL: Record<PaymentPlan, string> = {
  pending: '参加費(レッスン代の払い方は締切後に選ぶ)',
  full: '全額を一括',
  lesson_once: '参加費のあと、レッスン代を一括',
  lesson_two: '参加費のあと、レッスン代を2回に分ける',
  lesson_three: '参加費のあと、レッスン代を3回に分ける',
};

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

export interface MocchinPayStep {
  /** 0=申込後の1回目(参加費または全額) / 1〜=レッスン代の分割 */
  step: number;
  label: string;
  amount: number;
  due: string;
}

/** 支払い方法ごとの「いつ・いくら」。金額と期限はここだけで決める */
export function mocchinPaySteps(planRaw: string, isMember: boolean, appliedOn: string): MocchinPayStep[] {
  const plan: PaymentPlan = (PAYMENT_PLANS as readonly string[]).includes(planRaw) ? (planRaw as PaymentPlan) : 'lesson_once';
  const lessonTotal = (isMember ? MOCCHIN_LESSON_FEE_MEMBER : MOCCHIN_LESSON_FEE_GUEST) * MOCCHIN_LESSON_DAYS;
  const first = mocchinPayDeadline(appliedOn);
  if (plan === 'pending') {
    return [{ step: 0, label: '参加費', amount: MOCCHIN_FEE, due: first }];
  }
  if (plan === 'full') {
    return [{ step: 0, label: '参加費＋レッスン代(全6日分)', amount: MOCCHIN_FEE + lessonTotal, due: first }];
  }
  const times = plan === 'lesson_three' ? 3 : plan === 'lesson_two' ? 2 : 1;
  const steps: MocchinPayStep[] = [{ step: 0, label: '参加費', amount: MOCCHIN_FEE, due: first }];
  for (let i = 0; i < times; i++) {
    steps.push({
      step: i + 1,
      label: times === 1 ? 'レッスン代(全6日分)' : `レッスン代 ${i + 1}回目`,
      amount: lessonTotal / times,
      due: MOCCHIN_LESSON_DUES[i],
    });
  }
  return steps;
}

/** 次に払う回(未入金のうち一番早い回)。全部済みなら null */
export function mocchinNextStep(steps: MocchinPayStep[], paid: Set<number>): MocchinPayStep | null {
  return steps.find((s) => !paid.has(s.step)) ?? null;
}

/** 'lesson_paid' / 'reminded' 列('1,2' 形式)を読む */
export function parseSteps(s: string): number[] {
  if (!s.trim()) return [];
  return s
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0);
}

/** 入金済みの回(0=paid列 / 1〜=lesson_paid列) */
export function paidStepSet(paid: boolean, lessonPaid: string): Set<number> {
  const set = new Set(parseSteps(lessonPaid));
  if (paid) set.add(0);
  return set;
}

/**
 * 今日お知らせメールを送る回。未入金で、期限の3日前〜期限当日で、まだ送っていないもの。
 * 期限の3日前より後に申し込んだ人の1回目は、申込直後の控えメールがあるので送らない。
 */
export function mocchinRemindSteps(
  e: { paymentPlan: string; isMember: boolean; appliedOn: string; paid: boolean; lessonPaid: string; reminded: string },
  today: string
): MocchinPayStep[] {
  const paid = paidStepSet(e.paid, e.lessonPaid);
  const sent = new Set(parseSteps(e.reminded));
  return mocchinPaySteps(e.paymentPlan, e.isMember, e.appliedOn).filter((s) => {
    const from = addDays(s.due, -MOCCHIN_REMIND_DAYS_BEFORE);
    if (paid.has(s.step) || sent.has(s.step)) return false;
    if (today < from || today > s.due) return false;
    return e.appliedOn < from;
  });
}

/** レッスン代の払い方を選べる状態か(参加費が済んでいて、まだ選んでいない) */
export function mocchinNeedsLessonPlan(e: { paymentPlan: string; paid: boolean }): boolean {
  return e.paymentPlan === 'pending' && e.paid;
}

/** 今日送る「レッスン代の払い方」のメール。invite=案内 / remind=選ぶ期限前のお知らせ / null=送らない */
export function mocchinPlanMailToday(
  e: { paymentPlan: string; paid: boolean; reminded: string },
  today: string
): 'invite' | 'remind' | null {
  if (!mocchinNeedsLessonPlan(e)) return null;
  const sent = new Set(parseSteps(e.reminded));
  if (!sent.has(MOCCHIN_MARK_PLAN_INVITE)) return 'invite';
  const from = addDays(MOCCHIN_PLAN_CHOOSE_BY, -MOCCHIN_REMIND_DAYS_BEFORE);
  if (today >= from && today <= MOCCHIN_PLAN_CHOOSE_BY && !sent.has(MOCCHIN_MARK_PLAN_REMIND)) return 'remind';
  return null;
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
  paymentPlan: string;
  payMethod: string;
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
  classNumber: ClassNumberPlan | '';
  paymentPlan: PaymentPlan;
  payMethod: PayMethod;
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
  const paymentPlan = clean(raw.paymentPlan, 20);
  const payMethod = clean(raw.payMethod, 20);

  if (!name) e.name = 'お名前を入力してください';
  if (!kana) e.kana = 'フリガナを入力してください';
  else if (!KANA_RE.test(kana)) e.kana = 'フリガナはカタカナかひらがなで入力してください';
  if (!age) e.age = '年齢または学年を入力してください';
  if (age && isMinor(age) && !guardianName) e.guardianName = '18歳未満の方は保護者のお名前を入力してください';
  if (phone.length < 10 || phone.length > 11) e.phone = '電話番号を正しく入力してください';
  if (!EMAIL_RE.test(email)) e.email = 'メールアドレスを正しく入力してください';
  if (raw.isMember === null) e.isMember = 'BOOM会員かどうかを選んでください';
  // クラスのナンバーの質問は 2026-11-08 にフォームから外した(TARO)。空欄で受け付け、値が来たときだけ形を確かめる
  if (classNumber && !(CLASS_NUMBER_OPTIONS as readonly string[]).includes(classNumber)) e.classNumber = 'クラスのナンバーの予定の値が正しくありません';
  if (!(PAYMENT_PLANS as readonly string[]).includes(paymentPlan)) e.paymentPlan = 'お支払い方法を選んでください';
  if (!(PAY_METHODS as readonly string[]).includes(payMethod)) e.payMethod = '銀行振込かカードかを選んでください';
  if (!Array.isArray(raw.agreed) || raw.agreed.length !== MOCCHIN_PROMISES.length || raw.agreed.some((a) => a !== true)) {
    e.agreed = 'ご確認事項をすべて読んで、チェックしてください';
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
      classNumber: classNumber as ClassNumberPlan | '',
      paymentPlan: paymentPlan as PaymentPlan,
      payMethod: payMethod as PayMethod,
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

function pushCardLines(L: string[], token: string): void {
  L.push('【カードでのお支払い】');
  L.push('こちらのページからお支払いいただけます(手数料はかかりません)。');
  L.push(mocchinPayUrl(token));
}

function pushBankLines(L: string[], id: number): void {
  L.push('【銀行振込の振込先】');
  L.push(`${MOCCHIN_BANK.bank} ${MOCCHIN_BANK.branch} ${MOCCHIN_BANK.type} ${MOCCHIN_BANK.number}`);
  L.push(`口座名義: ${MOCCHIN_BANK.holder}`);
  L.push(`※振込名義の前に、申込番号「${mocchinTransferPrefix(id)}」を付けてください`);
  L.push(`  (例: ${mocchinTransferPrefix(id)} ヤマダハナコ)`);
  L.push('※振込手数料はご負担をお願いします');
}

/** 申込時は参加費だけ、という説明(メール用) */
function pushLessonLaterLines(L: string[]): void {
  L.push('【レッスン代について】');
  L.push('参加費のお支払いを確認したら、レッスン代(全6日分)の払い方を選んでいただくご案内をメールでお送りします。');
  L.push(`一括・2回・3回から選べます(選ぶ期限: ${formatJpDate(MOCCHIN_PLAN_CHOOSE_BY)} / 1回目のお支払い期限: ${formatJpDate(MOCCHIN_LESSON_DUES[0])})。`);
}

/** レッスン代の払い方を選んでもらうメール(締切後・参加費を払った人) */
export function buildMocchinPlanEmail(p: { id: number; name: string; payToken: string; isMember: boolean; kind: 'invite' | 'remind' }): { subject: string; text: string } {
  const no = formatMocchinNo(p.id);
  const L: string[] = [];
  L.push(`${p.name} 様`);
  L.push('');
  if (p.kind === 'invite') {
    L.push('BW6 スペシャルナンバー by MOCCHIN の参加費のお支払いを確認しました。ありがとうございます。');
    L.push('続いて、レッスン代(全6日分)の払い方を選んでください。');
  } else {
    L.push(`レッスン代の払い方が、まだ選ばれていません。${formatJpDate(MOCCHIN_PLAN_CHOOSE_BY)}までに選んでください。`);
  }
  L.push('');
  L.push(`■ 申込番号: ${no}`);
  L.push(`■ 選ぶ期限: ${formatJpDate(MOCCHIN_PLAN_CHOOSE_BY)}`);
  L.push('');
  L.push('【選べる払い方】');
  for (const k of LESSON_PLANS) {
    const steps = mocchinPaySteps(k, p.isMember, MOCCHIN_DEADLINE).filter((s) => s.step > 0);
    L.push(`・${LESSON_PLAN_LABEL[k]}: ${steps.map((s) => `${yen(s.amount)}(${formatJpDate(s.due)}まで)`).join(' / ')}`);
  }
  L.push('');
  L.push('▼こちらのページで選べます(選んだあと、そのままカードでも払えます)');
  L.push(mocchinPayUrl(p.payToken));
  L.push('');
  L.push('ご不明な点は、BOOMの公式LINEからお問い合わせください。');
  L.push('');
  L.push('BOOM ダンススクール');
  const subject = p.kind === 'invite' ? 'レッスン代の払い方を選んでください' : 'レッスン代の払い方の選択期限が近づいています';
  return { subject: `【BOOM】${subject} BW6 スペシャルナンバー by MOCCHIN(${no})`, text: L.join('\n') };
}

/** 期限前のお知らせメール(まだ入金が確認できていない回) */
export function buildMocchinReminderEmail(p: { id: number; name: string; payToken: string; steps: MocchinPayStep[] }): { subject: string; text: string } {
  const no = formatMocchinNo(p.id);
  const L: string[] = [];
  L.push(`${p.name} 様`);
  L.push('');
  L.push('BW6 スペシャルナンバー by MOCCHIN のお支払い期限が近づいています。');
  L.push('');
  L.push(`■ 申込番号: ${no}`);
  for (const s of p.steps) L.push(`・${s.label}: ${yen(s.amount)}(${formatJpDate(s.due)} まで)`);
  L.push('');
  pushCardLines(L, p.payToken);
  L.push('');
  pushBankLines(L, p.id);
  L.push('');
  L.push('行き違いでお振込み済みの場合は、ご容赦ください。');
  L.push('ご不明な点は、BOOMの公式LINEからお問い合わせください。');
  L.push('');
  L.push('BOOM ダンススクール');
  return { subject: `【BOOM】お支払い期限のお知らせ BW6 スペシャルナンバー by MOCCHIN(${no})`, text: L.join('\n') };
}

/** カード決済の完了メール(領収の控えと、残りのお支払い) */
export function buildMocchinCardPaidEmail(p: {
  id: number;
  name: string;
  payToken: string;
  step: MocchinPayStep;
  remaining: MocchinPayStep[];
  paymentPlan?: string;
}): { subject: string; text: string } {
  const no = formatMocchinNo(p.id);
  const L: string[] = [];
  L.push(`${p.name} 様`);
  L.push('');
  L.push('BW6 スペシャルナンバー by MOCCHIN のお支払いを確認しました。ありがとうございます。');
  L.push('');
  L.push(`■ 申込番号: ${no}`);
  L.push(`・${p.step.label}: ${yen(p.step.amount)}(カード)`);
  if (p.remaining.length > 0) {
    L.push('');
    L.push('【このあとのお支払い】');
    for (const s of p.remaining) L.push(`・${s.label}: ${yen(s.amount)}(${formatJpDate(s.due)} まで)`);
    L.push('期限の3日前に、メールでお知らせします。');
    L.push(mocchinPayUrl(p.payToken));
  } else if (p.paymentPlan === 'pending') {
    L.push('');
    L.push('【続いて、レッスン代の払い方を選んでください】');
    L.push(`一括・2回・3回から選べます(選ぶ期限: ${formatJpDate(MOCCHIN_PLAN_CHOOSE_BY)} / 1回目のお支払い期限: ${formatJpDate(MOCCHIN_LESSON_DUES[0])})。`);
    L.push(mocchinPayUrl(p.payToken));
  } else {
    L.push('');
    L.push('お支払いはすべて完了しています。');
  }
  L.push('');
  L.push('ご不明な点は、BOOMの公式LINEからお問い合わせください。');
  L.push('');
  L.push('BOOM ダンススクール');
  return { subject: `【BOOM】お支払いを確認しました BW6 スペシャルナンバー by MOCCHIN(${no})`, text: L.join('\n') };
}

/** 申込完了メール(控え＋振込のご案内) */
export function buildMocchinEmail(p: {
  id: number;
  name: string;
  appliedOn: string;
  isMember: boolean;
  paymentPlan: string;
  payMethod: string;
  payToken: string;
  overCapacity: boolean;
}): { subject: string; text: string } {
  const no = formatMocchinNo(p.id);
  const L: string[] = [];
  L.push(`${p.name} 様`);
  L.push('');
  L.push('BW6 スペシャルナンバー by MOCCHIN へのお申込みありがとうございます。');
  L.push('お申込みを受け付けました。');
  L.push('');
  L.push(`■ 申込番号: ${no}`);
  L.push('');
  L.push(p.paymentPlan === 'pending' ? '【お支払い】申込のときは参加費だけです' : `【お支払い】${PAYMENT_PLAN_LABEL[p.paymentPlan as PaymentPlan] ?? ''}`);
  for (const s of mocchinPaySteps(p.paymentPlan, p.isMember, p.appliedOn)) {
    L.push(`・${s.label}: ${yen(s.amount)}(${formatJpDate(s.due)} まで)`);
  }
  if (p.paymentPlan === 'pending') {
    L.push('');
    pushLessonLaterLines(L);
  }
  L.push('');
  if (p.payMethod === 'card') {
    pushCardLines(L, p.payToken);
    L.push('');
    pushBankLines(L, p.id);
  } else {
    pushBankLines(L, p.id);
    L.push('');
    pushCardLines(L, p.payToken);
  }
  L.push('');
  L.push('【日程・会場】');
  for (const s of MOCCHIN_SCHEDULE) L.push(`${s.date} ${s.time} ${s.venue}`);
  L.push('2本目のあとは、参加者みんなで練習や質問の時間をとります。');
  L.push('');
  L.push('【ご確認事項】');
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
    paymentPlan: string;
    lessonPaid: string;
    appliedOn: string;
    payMethod: string;
  }>
): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['申込番号', '申込日時', '状態', '支払い方法', '手段', '入金', 'お名前', 'フリガナ', '年齢/学年', '保護者', '電話', 'メール', '会員', '会員番号', 'ダンス歴', 'クラスのナンバー', '備考'];
  const lines = rows.map((r) =>
    [
      formatMocchinNo(r.id),
      r.createdAt,
      r.status === 'cancelled' ? '取消' : '有効',
      PAYMENT_PLAN_LABEL[r.paymentPlan as PaymentPlan] ?? r.paymentPlan,
      PAY_METHOD_LABEL[r.payMethod as PayMethod] ?? r.payMethod,
      `${paidStepSet(r.paid, r.lessonPaid).size}/${mocchinPaySteps(r.paymentPlan, r.isMember, r.appliedOn).length}回`,
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

/** 「会員」と答えた人の名前が会員データと合わないときの案内(2026-11-08 TARO: 会員以外が会員と名乗る申込を止める) */
export const MOCCHIN_MEMBER_MISMATCH = 'BOOMの会員情報と一致しませんでした。会員登録しているお名前(またはフリガナ)で入力してください。うまくいかない場合は、公式LINEでご相談ください。';

/** 照合用の正規化: NFKC→空白を全部取る→ひらがなをカタカナに */
function normMemberKey(raw: string): string {
  return (raw || '')
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/**
 * 「会員」と答えた人を会員データと照合する(2026-11-08 TARO)。
 * 名前(漢字)かフリガナが、在籍中の会員1人にぴったり合えばOK。
 * 合う人がいない・同じ名前の在籍者が2人以上いるときはNG(公式LINEへの相談を案内する)。
 * BF7の照合と違い「と」「・」で名前を分けない(「まこと」のような名前が落ちるため)、
 * 本人が保護者としても登録されていてもOKにする。
 */
export function mocchinMemberCheck(
  name: string,
  kana: string,
  members: Array<{ id: number; full_name: string; full_name_kana: string; status: string }>
): { ok: true; memberId: number } | { ok: false } {
  const n = normMemberKey(name);
  const k = normMemberKey(kana);
  const active = members.filter((m) => m.status === 'active');
  for (const key of [n, k]) {
    if (!key) continue;
    const hits = active.filter((m) => normMemberKey(m.full_name) === key || (m.full_name_kana && normMemberKey(m.full_name_kana) === key));
    if (hits.length === 1) return { ok: true, memberId: hits[0].id };
  }
  return { ok: false };
}

/** 講師の口座名義(カナ)と比べるための形。銀行のカナは小さい字を大きく書くので、小さい字を大きくそろえる */
function normKanaLoose(raw: string): string {
  const small: Record<string, string> = { ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ッ: 'ツ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ヮ: 'ワ', ヵ: 'カ', ヶ: 'ケ' };
  return normMemberKey(raw).replace(/[ァィゥェォッャュョヮヵヶ]/g, (c) => small[c]).replace(/[ー\-]/g, '');
}

/**
 * 講師も「会員」として申し込めるようにする(2026-11-08 TARO「名前登録すればよい」)。
 * 講師の多くは会員データに居ないので、在籍中の講師の本名(real_name)と名前、または口座名義(カナ)とフリガナが合えばOKにする。
 */
export function mocchinInstructorCheck(
  name: string,
  kana: string,
  instructors: { holder: string | null; realName: string | null }[]
): boolean {
  const k = normKanaLoose(kana);
  const n = normMemberKey(name);
  return instructors.some(
    (i) => (!!k && !!i.holder && normKanaLoose(i.holder) === k) || (!!n && !!i.realName && normMemberKey(i.realName) === n)
  );
}

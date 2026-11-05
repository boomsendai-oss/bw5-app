// BF7 HIRO ワークショップ(2027-01-31)の申込の純ロジック(DB非依存・vitest対象)。
// ※ 公開フォーム(クライアント)からも import するので node: 依存を持たない。
//
// 決定(TARO 2026-11-05): 受付は 11/23〜会員の先行 / 11/30〜誰でも。会員かどうかは自己申告で、
// 「会員」と答えた人だけ名前を会員データベースと照合し、結果はスタッフ画面に出す。
// 会員料金は会員本人だけ(きょうだい・保護者は一般料金)。支払いは事前のカードか銀行振込のみで、当日払いはなし。
// ⚠️ 照合の結果を申込者に見せない(名前を入れて会員かどうかを調べられてしまうため)。
import { BF7_WORKSHOP } from '@/lib/bf7';
import { MOCCHIN_BANK, addDays, isMinor } from '@/lib/mocchinEntry';
import { matchMember, type MatchableMember } from '@/lib/surveyMatch';

export type Bf7WsGate = 'before' | 'member' | 'open' | 'closed';

export function bf7WsGate(today: string): Bf7WsGate {
  if (today < BF7_WORKSHOP.memberFrom) return 'before';
  if (today < BF7_WORKSHOP.openFrom) return 'member';
  if (today <= BF7_WORKSHOP.deadline) return 'open';
  return 'closed';
}

export const BF7_WS_COURSES = ['first', 'second', 'both'] as const;
export type Bf7WsCourse = (typeof BF7_WS_COURSES)[number];
export type Bf7WsPayMethod = 'prepaid' | 'transfer';

export function bf7WsCourseUses(course: Bf7WsCourse): { first: boolean; second: boolean } {
  return { first: course !== 'second', second: course !== 'first' };
}

export function bf7WsPrice(course: Bf7WsCourse, isMember: boolean): number {
  const p = isMember ? BF7_WORKSHOP.memberPrice : BF7_WORKSHOP.price;
  return course === 'both' ? p.two : p.one;
}

/** スタッフの確認用モードでカードを選んだときの金額(本物の請求なので、動作確認に足りる最小限にする) */
export const BF7_WS_CARD_TEST_AMOUNT = 100;

/** 振込先(BOOMの事業用口座。MOCCHINナンバーと同じ) */
export const BF7_WS_BANK = MOCCHIN_BANK;

/** 振込名義の頭に付ける形(ハイフンなし)。例: 1 → WS001 */
export function bf7WsTransferPrefix(id: number): string {
  return formatBf7WsNo(id).replace('-', '');
}

/** 振込期限 = 申込日から7日以内。ただし申込の締切を越えない */
export function bf7WsPayDeadline(appliedOn: string): string {
  const d = addDays(appliedOn, 7);
  return d < BF7_WORKSHOP.deadline ? d : BF7_WORKSHOP.deadline;
}

/** 会員でないと分かったときにいただく差額 */
export function bf7WsMemberDiff(first: boolean, second: boolean): number {
  const course: Bf7WsCourse = first && second ? 'both' : first ? 'first' : 'second';
  return bf7WsPrice(course, false) - bf7WsPrice(course, true);
}

export function formatBf7WsNo(id: number): string {
  return `WS-${String(id).padStart(3, '0')}`;
}

/** クラスの表記。例: 1本目 13:30〜15:00 REGULAR CLASS */
export function bf7WsClassLines(first: boolean, second: boolean): string[] {
  const [a, b] = BF7_WORKSHOP.classes;
  const line = (no: string, c: typeof a | typeof b) => `${no} ${c.start}〜${c.end} ${c.title}`;
  const out: string[] = [];
  if (first) out.push(line('1本目', a));
  if (second) out.push(line('2本目', b));
  return out;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
/** 'YYYY-MM-DD' → '11月30日(月)' */
export function formatBf7WsDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEK[d.getUTCDay()]})`;
}

/** 受講できる地域の案内。告知(画像・投稿文)には書かず、申込フォームにだけ出す(HIRO 2026-11-05) */
export const BF7_WS_AREA_NOTICE = '東北・北陸の方のみ受講でき、今回はその他の地域の方は受講できません。';

export interface Bf7WsInput {
  name: string;
  kana: string;
  age: string;
  guardianName: string;
  phone: string;
  email: string;
  isMember: boolean | null;
  course: string;
  payMethod: string;
  note: string;
  agreed: boolean;
  /** 東北・北陸に住んでいることの確認(HIRO 2026-11-05: 今回の受講は東北・北陸の方のみ) */
  inArea: boolean;
}

export interface ValidatedBf7Ws {
  name: string;
  kana: string;
  age: string;
  guardianName: string;
  phone: string;
  email: string;
  isMember: boolean;
  course: Bf7WsCourse;
  payMethod: Bf7WsPayMethod;
  note: string;
}

export type Bf7WsFieldErrors = Partial<Record<keyof Bf7WsInput, string>>;

function clean(v: unknown, max: number): string {
  return (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

const KANA_RE = /^[ぁ-ゖァ-ヿー・　\s]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateBf7WsInput(raw: Bf7WsInput): { ok: true; value: ValidatedBf7Ws } | { ok: false; errors: Bf7WsFieldErrors } {
  const e: Bf7WsFieldErrors = {};
  const name = clean(raw.name, 60);
  const kana = clean(raw.kana, 60);
  const age = clean(raw.age, 20);
  const guardianName = clean(raw.guardianName, 60);
  const phone = clean(raw.phone, 20).normalize('NFKC').replace(/[^\d]/g, '');
  const email = clean(raw.email, 120).normalize('NFKC');
  const note = clean(raw.note, 500);

  if (!name) e.name = 'お名前を入力してください';
  if (!kana) e.kana = 'フリガナを入力してください';
  else if (!KANA_RE.test(kana)) e.kana = 'フリガナはカタカナかひらがなで入力してください';
  if (!age) e.age = '年齢または学年を入力してください';
  if (age && isMinor(age) && !guardianName) e.guardianName = '18歳未満の方は保護者のお名前を入力してください';
  if (phone.length < 10 || phone.length > 11) e.phone = '電話番号を正しく入力してください';
  if (!EMAIL_RE.test(email)) e.email = 'メールアドレスを正しく入力してください';
  if (raw.isMember !== true && raw.isMember !== false) e.isMember = 'BOOM会員かどうかを選んでください';
  if (!(BF7_WS_COURSES as readonly string[]).includes(raw.course)) e.course = '受講するクラスを選んでください';
  if (raw.payMethod !== 'prepaid' && raw.payMethod !== 'transfer') e.payMethod = 'お支払い方法を選んでください';
  if (raw.agreed !== true) e.agreed = 'キャンセルについて確認してチェックしてください';
  if (raw.inArea !== true) e.inArea = '東北・北陸にお住まいの方のみお申し込みいただけます。お住まいの地域を確認してチェックしてください';

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
      course: raw.course as Bf7WsCourse,
      payMethod: raw.payMethod as Bf7WsPayMethod,
      note,
    },
  };
}

/** 受付期間の判定(会員の先行期間に会員以外は申し込めない)。OKなら null */
export function bf7WsGateError(gate: Bf7WsGate, isMember: boolean): string | null {
  if (gate === 'before') return 'お申込みの受付はまだ始まっていません';
  if (gate === 'closed') return 'お申込みの受付は終了しました';
  if (gate === 'member' && !isMember) {
    return `${formatBf7WsDate(BF7_WORKSHOP.openFrom)}までは、BOOM会員の方の先行受付期間です。会員以外の方は${formatBf7WsDate(BF7_WORKSHOP.openFrom)}から申し込めます`;
  }
  return null;
}

export interface Bf7WsRemaining {
  first: number;
  second: number;
}

export function calcBf7WsRemaining(used: { first: number; second: number }): Bf7WsRemaining {
  return {
    first: Math.max(0, BF7_WORKSHOP.capacity - used.first),
    second: Math.max(0, BF7_WORKSHOP.capacity - used.second),
  };
}

/** 選んだクラスに空きがなければ、その案内文を返す。OKなら null */
export function bf7WsCapacityError(course: Bf7WsCourse, remaining: Bf7WsRemaining): string | null {
  const use = bf7WsCourseUses(course);
  if (use.first && use.second && remaining.first <= 0 && remaining.second <= 0) return '申し訳ありません。2本とも満員になりました';
  if (use.first && remaining.first <= 0) return '申し訳ありません。1本目は満員になりました';
  if (use.second && remaining.second <= 0) return '申し訳ありません。2本目は満員になりました';
  return null;
}

/** ひらがな→カタカナ(会員データのフリガナはカタカナで入っている) */
export function toKatakana(s: string): string {
  return (s || '').normalize('NFKC').replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

export type Bf7WsMemberCheck = { check: 'confirmed'; memberId: number } | { check: 'review'; candidateIds: number[] };

/**
 * 「会員」と申告した人の名前を会員データと照合する。
 * 在籍中の会員1人にぴったり一致したときだけ確認済みにし、それ以外(同姓同名・退会者・保護者の名前・
 * 一部一致・見つからない)はスタッフの確認に回す。申込そのものは止めない。
 */
export function checkBf7WsMember(name: string, kana: string, members: MatchableMember[]): Bf7WsMemberCheck {
  const byName = matchMember(name, members);
  if (byName.status === 'auto') return { check: 'confirmed', memberId: byName.memberId };
  const byKana = matchMember(toKatakana(kana), members);
  if (byKana.status === 'auto') return { check: 'confirmed', memberId: byKana.memberId };
  const ids = [
    ...(byName.status === 'pending' ? byName.candidateIds : []),
    ...(byKana.status === 'pending' ? byKana.candidateIds : []),
  ];
  return { check: 'review', candidateIds: Array.from(new Set(ids)) };
}

export const yenBf7Ws = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

/** 控えのメール。送るタイミング: 銀行振込=申込直後(振込のご案内)と入金確認時 / カード=決済の確定時 */
export function buildBf7WsEmail(p: {
  id: number;
  name: string;
  first: boolean;
  second: boolean;
  amountTotal: number;
  payMethod: Bf7WsPayMethod;
  isMember: boolean;
  /** 支払いが確認できているか(false=振込待ち) */
  paid: boolean;
  appliedOn: string;
}): { subject: string; text: string } {
  const no = formatBf7WsNo(p.id);
  const ws = BF7_WORKSHOP;
  const L: string[] = [];
  L.push(`${p.name} 様`);
  L.push('');
  L.push('HIRO WORKSHOP(BOOMER\'S FIGHT!!! vol.7)へのお申込みありがとうございます。');
  L.push(p.paid ? 'お支払いを確認し、お申込みが確定しました。' : 'お申込みを受け付けました。期限までにお振込みをお願いします。');
  L.push('');
  L.push(`■ 受付番号: ${no}`);
  L.push('');
  L.push('【受講するクラス】');
  for (const c of bf7WsClassLines(p.first, p.second)) L.push(c);
  L.push('');
  L.push('【日時・会場】');
  L.push('2027年1月31日(日)');
  L.push(ws.venue);
  L.push(ws.address);
  L.push(ws.access);
  L.push('');
  L.push('【受講料】');
  L.push(p.paid ? `${yenBf7Ws(p.amountTotal)}(お支払い済み)` : yenBf7Ws(p.amountTotal));
  if (p.isMember) {
    L.push('※会員料金は、BOOM会員ご本人様に適用されます。会員情報を確認のうえ、差額が生じる場合はご連絡いたします。');
  }
  if (!p.paid) {
    L.push('');
    L.push('【お振込み先】');
    L.push(`期限: ${formatBf7WsDate(bf7WsPayDeadline(p.appliedOn))} まで`);
    L.push(`${BF7_WS_BANK.bank} ${BF7_WS_BANK.branch} ${BF7_WS_BANK.type} ${BF7_WS_BANK.number}`);
    L.push(`口座名義: ${BF7_WS_BANK.holder}`);
    L.push(`※振込名義の前に、受付番号「${bf7WsTransferPrefix(p.id)}」を付けてください(例: ${bf7WsTransferPrefix(p.id)} ヤマダハナコ)`);
    L.push('※振込手数料はご負担をお願いします');
    L.push('※期限までにご入金を確認できない場合、お申込みを取り消すことがあります');
  }
  L.push('');
  L.push('お客様のご都合によるキャンセル・返金はお受けできません。');
  L.push('ご不明な点は、BOOMの公式LINEからお問い合わせください。');
  L.push('');
  L.push('BOOM ダンススクール');
  return { subject: `【BOOM】HIRO WORKSHOP お申込み${p.paid ? '確定' : '受付・お振込みのご案内'}(${no})`, text: L.join('\n') };
}

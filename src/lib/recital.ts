// BW6 発表会（段階1）の純関数と定数。DB にさわらない。
// 名前と型の正本は .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
// 設定の日時は JST 'YYYY-MM-DD HH:MM'、日付は 'YYYY-MM-DD'。比べるときは jstToMs/deadlineMs でミリ秒にしてから。
// 記録の日時は UTC ISO（nowUtcIso）。

import { isIsoDate, nowUtcIso } from './dateJst';

export const RECITAL_EVENT = { live: 'bw6', test: 'bw6-test', smoke: 'bw6-smoke' } as const;

export type CastStatus = 'in' | 'maybe' | 'out' | 'passed';
export type FeeClass = 'free' | 'no_coop' | 'tshirt_only' | null;
export type HouseholdView = 'none' | 'tentative' | 'complete' | 'complete_extra';
export type EntryPhase = 'suspended' | 'before' | 'open' | 'closed';
export type PayGate = 'before' | 'preparing' | 'open';
export type MoneySummary = { total: number; paid: number; remaining: number; overpaid: number };

export interface RecitalSettings {
  entry_open_at: string;
  entry_close_at: string;
  change_close_at: string;
  pay_open_at: string;
  pay_ok_at: string | null;
  pay_due: string;
  max_works_per_person: number;
  min_self_apply_age: number;
  suspended: boolean;
  fee_check_first: number[];
  fee_check_family: number;
  goal_people: number;
  breakeven_people: number;
  cap_people: number;
  tshirt_sizes: string[];
  tshirt_close_at: string;
  extra_costs_text: string;
  schedule_text: string;
  privacy_text: string;
  consent_items: string;
  line_url: string;
  bank_text: string;
  ref_skip: string[];
  bank_ask_at: string[];
  bank_rest_from: string;
  bank_rest_to: string;
  pay_remind_stop_hours: number;
  bank_audit_on: string;
  bank_audit_done_at: string | null;
  bank_close_on: string;
  mail_bcc_staff: boolean;
  test_mail_to: string;
  stripe_mode: 'test' | 'live';
  roster_fix_on: string | null;
  tshirt_order_on: string | null;
  name_fix_close_at: string | null;
  tshirt_give_to: string;
  raw: Record<string, string>;
}

// 設計書 3-4 の設定の表の初めの値。suspended='1'・stripe_mode='test' は、種の書き忘れで
// 「受付が開く」「本番の鍵で動く」を起こさないため。
export const RECITAL_SETTING_DEFAULTS: Record<string, string> = {
  entry_open_at: '2026-12-15 12:00',
  entry_close_at: '2027-01-31 23:59',
  change_close_at: '2027-01-31 23:59',
  pay_open_at: '2026-12-15 12:00',
  pay_ok_at: '',
  pay_due: '2027-02-10',
  roster_fix_on: '',
  tshirt_order_on: '',
  min_self_apply_age: '18',
  tshirt_close_at: '2027-01-31 23:59',
  name_fix_close_at: '',
  max_works_per_person: '5',
  suspended: '1',
  fee_check_first: '26500,32500,35500,38500,41500',
  fee_check_family: '8000',
  goal_people: '150',
  breakeven_people: '77',
  cap_people: '175',
  tshirt_sizes: '130,140,150,S,M,L,XL,XXL,XXXL',
  tshirt_give_to: '',
  extra_costs_text: '',
  schedule_text: '',
  privacy_text: '',
  bank_text: '',
  ref_skip: '',
  pay_remind_stop_hours: '15',
  bank_ask_at: '19:00,20:30',
  bank_rest_from: '2026-12-30',
  bank_rest_to: '2027-01-03',
  bank_audit_on: '2027-02-12',
  bank_audit_done_at: '',
  bank_close_on: '2027-03-31',
  consent_items: '',
  line_url: '',
  mail_bcc_staff: '0',
  test_mail_to: '',
  stripe_mode: 'test',
};

// 段階1の設定の画面に出す鍵（R-19）。suspended（ボタン）・LOCKED・stripe_mode（種でだけ入れる）・【1空】の鍵は出さない。
export const RECITAL_SETTING_KEYS_SHOWN: readonly string[] = [
  'entry_open_at', 'entry_close_at', 'change_close_at', 'pay_open_at', 'pay_due', 'roster_fix_on',
  'tshirt_order_on', 'min_self_apply_age', 'tshirt_close_at', 'name_fix_close_at', 'max_works_per_person',
  'fee_check_first', 'fee_check_family', 'goal_people', 'breakeven_people', 'cap_people', 'tshirt_sizes',
  'tshirt_give_to', 'extra_costs_text', 'schedule_text', 'privacy_text', 'bank_text', 'ref_skip',
  'pay_remind_stop_hours', 'bank_ask_at', 'bank_rest_from', 'bank_rest_to', 'bank_audit_on', 'bank_close_on',
  'consent_items', 'line_url', 'mail_bcc_staff', 'test_mail_to',
];

export const RECITAL_SETTING_KEYS_LOCKED = ['pay_ok_at', 'bank_audit_done_at'] as const;

/** [max, windowSec] */
export const RECITAL_RATE: {
  submit: [number, number];
  precheck: [number, number];
  resendIp: [number, number];
  resendEmail: [number, number];
} = {
  submit: [30, 3600],
  precheck: [60, 3600],
  resendIp: [10, 3600],
  resendEmail: [3, 3600],
};

export const RECITAL_STAFF_NAMES: readonly string[] = ['TARO', 'KEIKO', '作る人'];
export const FIRST5_LIMIT = 5;
export const BANK_TOLD_WAIT_DAYS = 3;
export const MAIL_SEND_FROM = '08:00';
export const MAIL_SEND_UNTIL = '21:00';

// 家庭に渡すマイページの URL のドメイン（partyEmail.ts の BASE_URL・mocchinEntry.ts と同じ）。
// NEXT_PUBLIC_BASE_URL はスタッフ・cron 向けの URL だけが使う。
export const RECITAL_PUBLIC_ORIGIN = 'https://event.boom-sendai.com';

export function recitalMyUrl(token: string, opts?: { fromMail?: boolean }): string {
  const base = `${RECITAL_PUBLIC_ORIGIN}/bw6/my?t=${encodeURIComponent(token)}`;
  return opts?.fromMail ? `${base}&from=mail` : base;
}

export function normalizePhone(x: string): string {
  return x.normalize('NFKC').replace(/\D/g, '');
}

export function normalizeEmail(x: string): string {
  return x.normalize('NFKC').trim().toLowerCase();
}

// ---------- 設定の読み ----------

function splitList(v: string): string[] {
  return v.split(',').map((t) => t.trim()).filter((t) => t !== '');
}

function emptyToNull(v: string): string | null {
  return v.trim() === '' ? null : v;
}

export function parseRecitalSettings(rows: { key: string; value: string }[]): RecitalSettings {
  const raw: Record<string, string> = { ...RECITAL_SETTING_DEFAULTS };
  for (const r of rows) raw[r.key] = r.value;

  const int = (key: string): number => {
    const n = parseInt(raw[key], 10);
    return Number.isNaN(n) ? parseInt(RECITAL_SETTING_DEFAULTS[key], 10) : n;
  };
  const feeFirst = (): number[] => {
    const nums = splitList(raw.fee_check_first).map((t) => parseInt(t, 10));
    if (nums.some((n) => Number.isNaN(n))) return splitList(RECITAL_SETTING_DEFAULTS.fee_check_first).map((t) => parseInt(t, 10));
    return nums;
  };

  return {
    entry_open_at: raw.entry_open_at,
    entry_close_at: raw.entry_close_at,
    change_close_at: raw.change_close_at,
    pay_open_at: raw.pay_open_at,
    pay_ok_at: emptyToNull(raw.pay_ok_at),
    pay_due: raw.pay_due,
    max_works_per_person: int('max_works_per_person'),
    min_self_apply_age: int('min_self_apply_age'),
    suspended: raw.suspended !== '0',
    fee_check_first: feeFirst(),
    fee_check_family: int('fee_check_family'),
    goal_people: int('goal_people'),
    breakeven_people: int('breakeven_people'),
    cap_people: int('cap_people'),
    tshirt_sizes: splitList(raw.tshirt_sizes),
    tshirt_close_at: raw.tshirt_close_at,
    extra_costs_text: raw.extra_costs_text,
    schedule_text: raw.schedule_text,
    privacy_text: raw.privacy_text,
    consent_items: raw.consent_items,
    line_url: raw.line_url,
    bank_text: raw.bank_text,
    ref_skip: splitList(raw.ref_skip),
    bank_ask_at: splitList(raw.bank_ask_at),
    bank_rest_from: raw.bank_rest_from,
    bank_rest_to: raw.bank_rest_to,
    pay_remind_stop_hours: int('pay_remind_stop_hours'),
    bank_audit_on: raw.bank_audit_on,
    bank_audit_done_at: emptyToNull(raw.bank_audit_done_at),
    bank_close_on: raw.bank_close_on,
    mail_bcc_staff: raw.mail_bcc_staff === '1',
    test_mail_to: raw.test_mail_to,
    stripe_mode: raw.stripe_mode === 'live' ? 'live' : 'test',
    roster_fix_on: emptyToNull(raw.roster_fix_on),
    tshirt_order_on: emptyToNull(raw.tshirt_order_on),
    name_fix_close_at: emptyToNull(raw.name_fix_close_at),
    tshirt_give_to: raw.tshirt_give_to,
    raw,
  };
}

// ---------- 設定の値の確かめ（6 の保存と 18 の画面の両方が使う） ----------

const DATETIME_KEYS: Record<string, { optional: boolean }> = {
  entry_open_at: { optional: false },
  entry_close_at: { optional: false },
  change_close_at: { optional: false },
  pay_open_at: { optional: false },
  tshirt_close_at: { optional: false },
  name_fix_close_at: { optional: true },
};
const DATE_KEYS: Record<string, { optional: boolean }> = {
  pay_due: { optional: false },
  bank_rest_from: { optional: false },
  bank_rest_to: { optional: false },
  bank_audit_on: { optional: false },
  bank_close_on: { optional: false },
  roster_fix_on: { optional: true },
  tshirt_order_on: { optional: true },
};
const INT_KEYS: Record<string, [number, number]> = {
  max_works_per_person: [1, 10],
  min_self_apply_age: [0, 30],
  goal_people: [1, 1000],
  breakeven_people: [1, 1000],
  cap_people: [1, 1000],
  pay_remind_stop_hours: [1, 72],
  fee_check_family: [0, 100000],
};
const TEXT_KEYS = new Set([
  'consent_items', 'privacy_text', 'extra_costs_text', 'schedule_text', 'line_url', 'bank_text', 'tshirt_give_to',
]);
const TEXT_MAX = 4000;

function isHhmmStrict(s: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

function isJstDateTime(s: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(s);
  return !!m && isIsoDate(m[1]) && isHhmmStrict(m[2]);
}

/** カンマで割って前後の空白を取る。空の要素は残す（あとで弾く）。 */
function splitStrict(v: string): string[] {
  return v.split(',').map((t) => t.trim());
}

/** null＝入れてよい。だめなら画面に出す文。 */
export function checkSettingValue(key: string, value: string): string | null {
  if ((RECITAL_SETTING_KEYS_LOCKED as readonly string[]).includes(key) || key === 'suspended' || key === 'stripe_mode')
    return 'この欄からは直せません';
  if (!RECITAL_SETTING_KEYS_SHOWN.includes(key)) return 'この画面では直せない鍵です';

  if (key in DATETIME_KEYS) {
    if (value === '' && DATETIME_KEYS[key].optional) return null;
    return isJstDateTime(value) ? null : '日時は「2026-12-15 12:00」の形で、ある日時を入れてください';
  }
  if (key in DATE_KEYS) {
    if (value === '' && DATE_KEYS[key].optional) return null;
    return isIsoDate(value) ? null : '日付は「2027-02-10」の形で、ある日付を入れてください';
  }
  if (key in INT_KEYS) {
    const [min, max] = INT_KEYS[key];
    if (!/^\d+$/.test(value)) return `半角の整数（${min}〜${max}）を入れてください`;
    const n = Number(value);
    return n >= min && n <= max ? null : `${min}〜${max} の整数を入れてください`;
  }
  if (key === 'mail_bcc_staff') return value === '0' || value === '1' ? null : '0 か 1 を入れてください';
  if (key === 'fee_check_first') {
    const xs = splitStrict(value);
    return xs.length === 5 && xs.every((t) => /^\d+$/.test(t)) ? null : '半角の整数5つをカンマで区切って入れてください';
  }
  if (key === 'tshirt_sizes') {
    const xs = splitStrict(value);
    return xs.every((t) => t !== '') ? null : 'サイズをカンマで区切って入れてください（空の項目は入れられません）';
  }
  if (key === 'ref_skip') {
    if (value.trim() === '') return null;
    const xs = splitStrict(value);
    return xs.every((t) => /^\d{4}$/.test(t)) ? null : '4けたの数字をカンマで区切って入れてください';
  }
  if (key === 'bank_ask_at') {
    const xs = splitStrict(value);
    return xs.every((t) => isHhmmStrict(t)) ? null : '時刻を「19:00」の形でカンマで区切って入れてください';
  }
  if (key === 'test_mail_to') {
    if (value === '') return null;
    return value.split('@').length === 2 && !/\s/.test(value) ? null : 'メールアドレスの形で入れてください';
  }
  if (TEXT_KEYS.has(key)) {
    return [...value].length <= TEXT_MAX ? null : `${TEXT_MAX}字までにしてください`;
  }
  // SHOWN に足したのに確かめ方を決めていない鍵は、入れさせない
  return 'この鍵の確かめ方が決まっていません';
}

// ---------- 日時 ----------

const JST_RE = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/;

/** 'YYYY-MM-DD HH:MM' か 'YYYY-MM-DD'（0:00）の JST → UTC ミリ秒。形が合わなければ NaN。 */
export function jstToMs(jst: string): number {
  const m = JST_RE.exec(jst);
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0) - 9, Number(mi ?? 0));
}

/** その分の終わり／日付だけならその日 23:59:59.999（JST）。 */
export function deadlineMs(jst: string): number {
  const base = jstToMs(jst);
  const m = JST_RE.exec(jst);
  if (!m) return NaN;
  return m[4] !== undefined ? base + 60_000 - 1 : base + 86_400_000 - 1;
}

// ---------- 受付と支払いの鍵 ----------

export function entryPhase(s: RecitalSettings, nowMs: number, extendUntil?: string | null): EntryPhase {
  if (s.suspended) return 'suspended';
  const open = jstToMs(s.entry_open_at);
  const close = deadlineMs(s.entry_close_at);
  if (Number.isNaN(open) || Number.isNaN(close)) return 'suspended';
  if (nowMs < open) return 'before';
  if (nowMs <= close) return 'open';
  if (extendUntil && nowMs <= deadlineMs(extendUntil)) return 'open';
  return 'closed';
}

/** 家庭が作品を足す・やめる・迷っている→出る、をしてよいか（4-2・K219）。判定はここだけに書く。 */
export function canFamilyEdit(s: RecitalSettings, nowMs: number, extendUntil?: string | null): boolean {
  if (entryPhase(s, nowMs, extendUntil) !== 'open') return false;
  if (nowMs <= deadlineMs(s.change_close_at)) return true;
  return !!extendUntil && nowMs <= deadlineMs(extendUntil);
}

/** 支払いの鍵2つ（K224）：時刻の鍵 pay_open_at と、スタッフのボタンの鍵 pay_ok_at。 */
export function payGate(s: RecitalSettings, nowMs: number): PayGate {
  const open = jstToMs(s.pay_open_at);
  if (Number.isNaN(open) || nowMs < open) return 'before';
  if (s.pay_ok_at === null) return 'preparing';
  return 'open';
}

// ---------- お金 ----------

/** お金に数える出演（D4 2-3）。 */
export function isCountedCast(work: { fee_type: string; status: string }, cast: { status: CastStatus }): boolean {
  return work.fee_type === 'counted' && work.status !== 'dropped' && cast.status === 'in';
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** 式4行（5章頭・K199・K228）。 */
export function moneySummary(x: { chargeAmounts: number[]; paymentAmounts: number[]; refundTodoAmounts: number[] }): MoneySummary {
  const total = Math.max(0, sum(x.chargeAmounts));
  const paid = sum(x.paymentAmounts) - sum(x.refundTodoAmounts);
  return { total, paid, remaining: Math.max(0, total - paid), overpaid: Math.max(0, paid - total) };
}

/** 世帯の見え方（5行の順・K218・K222）。 */
export function householdView(x: { hasIn: boolean; hasMaybe: boolean; paid: number; remaining: number }): HouseholdView {
  if (!x.hasIn && !x.hasMaybe) return 'none';
  if (x.paid <= 0 && !x.hasIn && x.hasMaybe) return 'tentative';
  if (x.remaining === 0) return 'complete';
  if (x.paid > 0 && x.remaining > 0) return 'complete_extra';
  return 'tentative';
}

export function householdViewLabel(v: HouseholdView, remaining: number): string {
  switch (v) {
    case 'none': return '出演なし';
    case 'tentative': return '仮受付';
    case 'complete': return '申込完了';
    case 'complete_extra': return `申込完了（追加分 ${remaining.toLocaleString('ja-JP')}円のお支払い待ち）`;
  }
}

/** K204：振り込みましたの印が開いていて残り＞印の金額なら 残り−印の金額。 */
export function payableAmount(m: MoneySummary, told: { amount: number } | null): number {
  if (told && m.remaining > told.amount) return m.remaining - told.amount;
  return m.remaining;
}

/** 「払う」の出し方（K207）。 */
export function payButtonState(x: { gate: PayGate; view: HouseholdView; m: MoneySummary; refundTodo: number }): 'hidden' | 'before' | 'preparing' | 'refund_hold' | 'show' {
  if (x.view === 'none' || x.m.remaining <= 0) return 'hidden';
  if (x.gate === 'before' || x.gate === 'preparing') return x.gate;
  if (x.refundTodo > 0 && x.refundTodo >= x.m.remaining) return 'refund_hold';
  return 'show';
}

// ---------- 人数（5-9） ----------

export type CountPerson = { category: string; feeClass: FeeClass; countedIn: number; maybeCount: number; householdRemaining: number; isTestEvent: boolean };
export type PeopleCounts = { going: number; paid: number; unpaid: number; maybe: number; special: number; countedAt: string };

export function countPeople(people: CountPerson[], now: Date): PeopleCounts {
  const c: PeopleCounts = { going: 0, paid: 0, unpaid: 0, maybe: 0, special: 0, countedAt: nowUtcIso(now) };
  for (const p of people) {
    if (p.isTestEvent) continue;
    const special = p.feeClass === 'free' || p.feeClass === 'tshirt_only';
    if (special && p.countedIn >= 1) c.special++;
    if (!special && (p.category === 'student' || p.category === 'non_member') && p.countedIn >= 1) {
      c.going++;
      if (p.householdRemaining === 0) c.paid++;
      else if (p.householdRemaining > 0) c.unpaid++;
    }
    if (p.countedIn === 0 && p.maybeCount >= 1) c.maybe++;
  }
  return c;
}

// ---------- 学年と年齢（5-10） ----------

const GRADE_LABELS: Record<number, string> = {
  [-2]: '年少', [-1]: '年中', 0: '年長',
  1: '小1', 2: '小2', 3: '小3', 4: '小4', 5: '小5', 6: '小6',
  7: '中1', 8: '中2', 9: '中3', 10: '高1', 11: '高2', 12: '高3',
};

function ymd(s: string): [number, number, number] {
  const [y, m, d] = s.split('-').map(Number);
  return [y, m, d];
}

/** 学年の言葉。年度は 4/1 から。1/1〜4/1 生まれは前の年の学年。 */
export function schoolGrade(birthday: string, onDate: string): string {
  if (!isIsoDate(birthday) || !isIsoDate(onDate)) return '';
  const [by, bm, bd] = ymd(birthday);
  const [oy, om] = ymd(onDate);
  const birthYear = bm < 4 || (bm === 4 && bd === 1) ? by - 1 : by;
  const fiscalYear = om >= 4 ? oy : oy - 1;
  const k = fiscalYear - birthYear - 6;
  if (k <= -3) return '未就学';
  if (k >= 13) return '大人';
  return GRADE_LABELS[k];
}

/** 満年齢（誕生日の当日に1つ上がる）。 */
export function ageOn(birthday: string, onDate: string): number {
  if (!isIsoDate(birthday) || !isIsoDate(onDate)) return NaN;
  const [by, bm, bd] = ymd(birthday);
  const [oy, om, od] = ymd(onDate);
  return oy - by - (om < bm || (om === bm && od < bd) ? 1 : 0);
}

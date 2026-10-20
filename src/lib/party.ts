// パーティー申込(クリスマスパーティー等)の純ロジック。vitest対象・DBに触らない。
// BF6(bf_*)とは別建て。イベントは event_key で分け、今年のクリパは 'xmas2026'。
// 設計書: docs/superpowers/specs/2026-10-14-xmas-party-design.md
//
// BF6の事故を最初から潰すための約束:
//   - 受付の開閉は商品ごとに別の関数(カード前売/当日現金予約/出演エントリー)。1本のゲートにまとめない
//   - 金額はこのファイルの計算関数と設定値からだけ出す。説明文に金額を直書きしない

export const PARTY_EVENT_KEY = 'xmas2026';

export type PartyKind = 'ticket' | 'entry';
export type PartyPayMethod = 'card' | 'cash';
export type PartyStatus = 'pending' | 'paid' | 'cash_due' | 'expired' | 'canceled' | 'refunded';
export type GateState = 'before' | 'open' | 'closed' | 'full' | 'suspended';

/**
 * 日時はすべて JST の壁時計 'YYYY-MM-DDTHH:mm'。
 * openAt = 出演エントリーの受付開始(空=未公開)。ticketOpenAt = チケット予約の受付開始(空=openAtと同じ)。
 * チケットとエントリーの開始を分けたのは TARO 2026-10-15(チケットは先に開け、先着のエントリーは時刻を決めて一斉に開ける)。
 */
export interface PartySettings {
  openAt: string;
  ticketOpenAt: string;
  ticketCardDeadline: string;
  ticketCashDeadline: string;
  entryDeadline: string;
  audioDeadline: string;
  presalePrice: number;
  doorPrice: number;
  performerFee: number;
  teamCap: number;
  venueFee: number;
  suspended: boolean;
}

export const DEFAULT_PARTY_SETTINGS: PartySettings = {
  openAt: '',
  ticketOpenAt: '',
  ticketCardDeadline: '2026-12-16T20:00',
  ticketCashDeadline: '2026-12-16T20:00',
  entryDeadline: '2026-12-01T23:59',
  audioDeadline: '2026-12-12T23:59',
  presalePrice: 2000,
  doorPrice: 2500,
  performerFee: 2000,
  teamCap: 8,
  venueFee: 99000,
  suspended: false,
};

/** 開催情報(表示用の固定値)。料金はここに書かない。 */
export const XMAS_EVENT_INFO = {
  title: 'BOOM クリスマスパーティー 2026',
  dateLabel: '2026年12月19日(土)',
  timeLabel: '11:00〜16:00(予定)',
  venue: 'SPACE ZERO',
  venueAddress: '仙台市青葉区本町1丁目9-23(GOATスタジオビル内)',
  drinkLabel: '1ドリンク ¥600(会場のキャッシャーで別途お支払い)',
  barLabel: 'バーカウンターあり(ソフトドリンク・お酒OK)。みんなで乾杯しましょう',
  showTimeLimit: '1チーム3分半まで',
} as const;

const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function isValidJstLocal(v: string): boolean {
  const ms = jstLocalToMs(v);
  if (ms == null) return false;
  // 2026-02-30 のような存在しない日付(翌月に繰り越される)を弾く
  const back = new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
  return back === v;
}

/** 'YYYY-MM-DDTHH:mm'(JST) → epoch ms。不正/空は null。 */
export function jstLocalToMs(v: string): number | null {
  if (!v || !LOCAL_RE.test(v)) return null;
  const ms = new Date(`${v}:00+09:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** 締切の「分」までは受付に含める(20:00締切 → 20:00:59 まで受付)。 */
export function isBeforeDeadline(deadline: string, now: Date): boolean {
  const ms = jstLocalToMs(deadline);
  if (ms == null) return false;
  return now.getTime() < ms + 60_000;
}

function isOpened(openAt: string, now: Date): boolean {
  const ms = jstLocalToMs(openAt);
  return ms != null && now.getTime() >= ms;
}

/** チケット予約の受付開始(未設定ならエントリーと同じ)。 */
export function ticketOpenAtOf(s: PartySettings): string {
  return s.ticketOpenAt || s.openAt;
}

function gate(s: PartySettings, now: Date, deadline: string, openAt: string): GateState {
  if (s.suspended) return 'suspended';
  if (!isOpened(openAt, now)) return 'before';
  if (!isBeforeDeadline(deadline, now)) return 'closed';
  return 'open';
}

export function ticketCardState(s: PartySettings, now: Date): GateState {
  return gate(s, now, s.ticketCardDeadline, ticketOpenAtOf(s));
}

export function ticketCashState(s: PartySettings, now: Date): GateState {
  return gate(s, now, s.ticketCashDeadline, ticketOpenAtOf(s));
}

/** holdingTeams = 確定(paid/cash_due)＋決済中(期限内pending)のチーム数。 */
export function entryState(s: PartySettings, now: Date, holdingTeams: number): GateState {
  const g = gate(s, now, s.entryDeadline, s.openAt);
  if (g !== 'open') return g;
  return holdingTeams >= s.teamCap ? 'full' : 'open';
}

export function audioOpen(s: PartySettings, now: Date): boolean {
  return isBeforeDeadline(s.audioDeadline, now);
}

export function ticketTotal(peopleCount: number, s: PartySettings): number {
  return peopleCount * s.presalePrice;
}

/**
 * 出演者1人あたり = 出演料だけ。入場は出演者もチケット予約で別に払う(TARO 2026-10-15)。
 * 先にチケットを取った人が後から出演を決めても二重払いにならないようにするため。
 */
export function entryUnitPrice(s: PartySettings): number {
  return s.performerFee;
}

/**
 * 出演エントリーの合計 = 出演料×メンバー数 + 入場チケット(前売)×まとめ買いの枚数。
 * 入場チケットはエントリーと同じ決済でまとめて買える(TARO 2026-10-20)。先にチケットを
 * 予約済みのメンバーの分は枚数を減らせるので、二重払いにはならない。
 */
export function entryTotal(memberCount: number, s: PartySettings, ticketCount = 0): number {
  return memberCount * entryUnitPrice(s) + ticketCount * s.presalePrice;
}

// ---- 設定(party_settings の key-value)の解釈 ----

const KEY_MAP: Record<keyof PartySettings, string> = {
  openAt: 'open_at',
  ticketOpenAt: 'ticket_open_at',
  ticketCardDeadline: 'ticket_card_deadline',
  ticketCashDeadline: 'ticket_cash_deadline',
  entryDeadline: 'entry_deadline',
  audioDeadline: 'audio_deadline',
  presalePrice: 'presale_price',
  doorPrice: 'door_price',
  performerFee: 'performer_fee',
  teamCap: 'team_cap',
  venueFee: 'venue_fee',
  suspended: 'suspended',
};

function intOr(raw: string | undefined, fallback: number, min = 0): number {
  if (raw == null || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw);
  return n >= min ? n : fallback;
}

function dtOr(raw: string | undefined, fallback: string): string {
  if (raw == null) return fallback;
  return isValidJstLocal(raw.trim()) ? raw.trim() : fallback;
}

export function resolvePartySettings(rows: Record<string, string>): PartySettings {
  const d = DEFAULT_PARTY_SETTINGS;
  const openRaw = rows[KEY_MAP.openAt];
  const ticketOpenRaw = rows[KEY_MAP.ticketOpenAt];
  return {
    openAt: openRaw != null && isValidJstLocal(openRaw.trim()) ? openRaw.trim() : '',
    ticketOpenAt: ticketOpenRaw != null && isValidJstLocal(ticketOpenRaw.trim()) ? ticketOpenRaw.trim() : '',
    ticketCardDeadline: dtOr(rows[KEY_MAP.ticketCardDeadline], d.ticketCardDeadline),
    ticketCashDeadline: dtOr(rows[KEY_MAP.ticketCashDeadline], d.ticketCashDeadline),
    entryDeadline: dtOr(rows[KEY_MAP.entryDeadline], d.entryDeadline),
    audioDeadline: dtOr(rows[KEY_MAP.audioDeadline], d.audioDeadline),
    presalePrice: intOr(rows[KEY_MAP.presalePrice], d.presalePrice),
    doorPrice: intOr(rows[KEY_MAP.doorPrice], d.doorPrice),
    performerFee: intOr(rows[KEY_MAP.performerFee], d.performerFee),
    teamCap: intOr(rows[KEY_MAP.teamCap], d.teamCap, 1),
    venueFee: intOr(rows[KEY_MAP.venueFee], d.venueFee),
    suspended: rows[KEY_MAP.suspended] === '1',
  };
}

export function partySettingsToRows(s: PartySettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(KEY_MAP) as (keyof PartySettings)[]) {
    const v = s[k];
    out[KEY_MAP[k]] = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
  }
  return out;
}

// ---- 入力検証 ----

export function isValidEmail(v: string): boolean {
  const email = (v ?? '').trim();
  return email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toHalfWidthDigits(v: string): string {
  return v.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

export function normalizePhone(v: string): string {
  return toHalfWidthDigits(v ?? '').replace(/[^0-9]/g, '');
}

/** カタカナ→ひらがな。全角スペースは半角に。 */
export function normalizeKana(v: string): string {
  return (v ?? '')
    .trim()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ');
}

const KANA_RE = /^[ぁ-ゖー・ ]+$/;

interface ContactInput {
  buyerName?: unknown;
  buyerKana?: unknown;
  email?: unknown;
  phone?: unknown;
  payMethod?: unknown;
}

interface ValidatedContact {
  buyerName: string;
  buyerKana: string;
  email: string;
  phone: string;
  payMethod: PartyPayMethod;
}

function validateContact(input: ContactInput): ValidatedContact | string {
  const buyerName = String(input.buyerName ?? '').trim();
  if (!buyerName || buyerName.length > 50) return 'お名前を50文字以内で入力してください';
  const buyerKana = normalizeKana(String(input.buyerKana ?? ''));
  if (!buyerKana || buyerKana.length > 50 || !KANA_RE.test(buyerKana)) {
    return 'ふりがなをひらがなで入力してください';
  }
  const email = String(input.email ?? '').trim();
  if (!isValidEmail(email)) return 'メールアドレスの形式が正しくありません';
  const phone = normalizePhone(String(input.phone ?? ''));
  if (!/^0\d{9,10}$/.test(phone)) return '電話番号を正しく入力してください(数字10〜11桁)';
  const pm = input.payMethod;
  if (pm !== 'card' && pm !== 'cash') return 'お支払い方法を選んでください';
  return { buyerName, buyerKana, email, phone, payMethod: pm };
}

export interface TicketInput extends ContactInput {
  isMember?: unknown;
  peopleCount?: unknown;
  infantCount?: unknown;
}

export interface ValidatedTicket extends ValidatedContact {
  isMember: boolean;
  peopleCount: number;
  infantCount: number;
}

export const MAX_PEOPLE = 20;
export const MAX_INFANTS = 10;

export function validateTicketInput(input: TicketInput): ValidatedTicket | string {
  const c = validateContact(input);
  if (typeof c === 'string') return c;
  if (input.isMember !== 'member' && input.isMember !== 'non_member') {
    return 'BOOMの会員かどうかを選んでください';
  }
  const people = Number(input.peopleCount);
  if (!Number.isInteger(people) || people < 1 || people > MAX_PEOPLE) {
    return `人数(小学生以上)を1〜${MAX_PEOPLE}人で選んでください`;
  }
  const infants = Number(input.infantCount ?? 0);
  if (!Number.isInteger(infants) || infants < 0 || infants > MAX_INFANTS) {
    return `未就学児の人数を0〜${MAX_INFANTS}人で選んでください`;
  }
  return { ...c, isMember: input.isMember === 'member', peopleCount: people, infantCount: infants };
}

/** 出演メンバーの学年区分(TARO 2026-10-15)。 */
export const GRADES = [
  ['g1_3', '小学1〜3年生'],
  ['g4_6', '小学4〜6年生'],
  ['jhs', '中学生'],
  ['hs', '高校生'],
  ['adult', 'それ以上'],
] as const;
export type GradeKey = (typeof GRADES)[number][0];

/** 入力欄(スマホ幅)用の短い表記。 */
export const GRADE_SHORT: Record<GradeKey, string> = {
  g1_3: '小1〜3年',
  g4_6: '小4〜6年',
  jhs: '中学生',
  hs: '高校生',
  adult: 'それ以上',
};

export function gradeLabel(g: string): string {
  return GRADES.find(([k]) => k === g)?.[1] ?? '';
}

/** 'あ(小学1〜3年生)、い(中学生)' 形式。学年が無い行は名前だけ。 */
export function formatMembers(ms: { name: string; grade: string }[], sep = '、'): string {
  return ms.map((m) => (gradeLabel(m.grade) ? `${m.name}(${gradeLabel(m.grade)})` : m.name)).join(sep);
}

function isGrade(v: unknown): v is GradeKey {
  return GRADES.some(([k]) => k === v);
}

export interface EntryMember {
  name: string;
  grade: string;
}

export interface EntryInput extends ContactInput {
  teamName?: unknown;
  teamKana?: unknown;
  genre?: unknown;
  members?: unknown;
  /** 入場チケットのまとめ買い枚数(0〜メンバー数) */
  ticketCount?: unknown;
}

export interface ValidatedEntry extends ValidatedContact {
  teamName: string;
  teamKana: string;
  genre: string;
  members: EntryMember[];
  ticketCount: number;
}

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 20;

export function validateEntryInput(input: EntryInput): ValidatedEntry | string {
  const teamName = String(input.teamName ?? '').trim();
  if (!teamName || teamName.length > 40) return 'チーム名を40文字以内で入力してください';
  const teamKana = normalizeKana(String(input.teamKana ?? ''));
  if (!teamKana || teamKana.length > 60 || !KANA_RE.test(teamKana)) {
    return 'チーム名のふりがなをひらがなで入力してください';
  }
  const genre = String(input.genre ?? '').trim();
  if (!genre || genre.length > 30) return 'ジャンルを30文字以内で入力してください';
  const raw = Array.isArray(input.members) ? input.members : [];
  const members: EntryMember[] = [];
  for (const m of raw) {
    const name = String((m as { name?: unknown })?.name ?? '').trim();
    if (!name) continue;
    if (name.length > 50) return 'メンバーの名前は50文字以内で入力してください';
    const grade = (m as { grade?: unknown })?.grade;
    if (!isGrade(grade)) return `${name} さんの学年を選んでください`;
    members.push({ name, grade });
  }
  if (members.length < MIN_MEMBERS) return `メンバーは${MIN_MEMBERS}人以上で入力してください(1人での出演はできません)`;
  if (members.length > MAX_MEMBERS) return `メンバーは${MAX_MEMBERS}人までです`;
  const tc = input.ticketCount ?? 0;
  const ticketCount = typeof tc === 'number' ? tc : Number(String(tc).trim());
  if (!Number.isInteger(ticketCount) || ticketCount < 0 || ticketCount > members.length) {
    return `入場チケットの枚数は0〜${members.length}枚で選んでください`;
  }
  const c = validateContact(input);
  if (typeof c === 'string') return c;
  // 出演は後からのキャンセルで枠が空くと困るため、カード払いのみ(TARO 2026-10-15)
  if (c.payMethod !== 'card') return '出演エントリーはカード払いのみです';
  return { ...c, teamName, teamKana, genre, members, ticketCount };
}

// ---- 名簿・精算・表示 ----

export function sortRosterByKana<T extends { buyerKana: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.buyerKana.localeCompare(b.buyerKana, 'ja'));
}

export interface SettlementInput {
  expectedCash: number;
  walkinCount: number;
  actualCash: number;
  doorPrice: number;
  venueFee: number;
}

export interface SettlementResult {
  walkinExpected: number;
  expectedTotal: number;
  /** 実額 − 期待額。マイナス = 足りない */
  diff: number;
  /** 実額 − 会場費。プラス = BOOMが受け取る / マイナス = BOOMが払う */
  netToBoom: number;
}

export function calcSettlement(i: SettlementInput): SettlementResult {
  const walkinExpected = i.walkinCount * i.doorPrice;
  const expectedTotal = i.expectedCash + walkinExpected;
  return {
    walkinExpected,
    expectedTotal,
    diff: i.actualCash - expectedTotal,
    netToBoom: i.actualCash - i.venueFee,
  };
}

export function formatPartyReceiptNo(orderId: number): string {
  return `X26-${String(orderId).padStart(3, '0')}`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** '2026-12-16T20:00' → '12/16(水) 20:00'。 */
export function formatJstLabel(v: string): string {
  if (!LOCAL_RE.test(v)) return '';
  const [date, time] = v.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}(${wd}) ${time}`;
}

export const yen = (n: number) => (n < 0 ? `−¥${(-n).toLocaleString('ja-JP')}` : `¥${n.toLocaleString('ja-JP')}`);

/** 差額表示用: +¥1,000 / −¥1,000 / ¥0 */
export const signedYen = (n: number) => (n > 0 ? `+${yen(n)}` : yen(n));

export function partyStatusLabel(s: string): string {
  switch (s) {
    case 'paid':
      return '支払済み';
    case 'cash_due':
      return '当日現金';
    case 'pending':
      return '決済待ち';
    case 'expired':
      return '期限切れ';
    case 'canceled':
      return '取消';
    case 'refunded':
      return '返金済み';
    default:
      return s;
  }
}

// ---- スタッフ画面の集計(純関数) ----

export interface SummarizableOrder {
  kind: PartyKind;
  status: string;
  payMethod: PartyPayMethod;
  peopleCount: number;
  infantCount: number;
  memberCount: number;
  amountTotal: number;
  isMember: boolean | null;
}

export interface PartySummary {
  ticketOrders: number;
  people: number;
  infants: number;
  nonMemberOrders: number;
  teams: number;
  performers: number;
  /** カードで支払い済みの合計 */
  cardPaid: number;
  /** 当日キャッシャーに入るはずの現金(cash_due の合計) */
  cashDue: number;
  /** 当日の来場見込み(小学生以上のチケット。出演者もチケットを取るので出演者は足さない) */
  headcount: number;
}

const CONFIRMED = new Set(['paid', 'cash_due']);

export function summarizePartyOrders(orders: SummarizableOrder[]): PartySummary {
  const s: PartySummary = { ticketOrders: 0, people: 0, infants: 0, nonMemberOrders: 0, teams: 0, performers: 0, cardPaid: 0, cashDue: 0, headcount: 0 };
  for (const o of orders) {
    if (!CONFIRMED.has(o.status)) continue;
    if (o.kind === 'ticket') {
      s.ticketOrders += 1;
      s.people += o.peopleCount;
      s.infants += o.infantCount;
      if (o.isMember === false) s.nonMemberOrders += 1;
    } else {
      s.teams += 1;
      s.performers += o.memberCount;
      // エントリーと一緒に買った入場チケット(出演者の分)も来場者として数える
      s.people += o.peopleCount;
    }
    if (o.status === 'paid') s.cardPaid += o.amountTotal;
    else s.cashDue += o.amountTotal;
  }
  s.headcount = s.people;
  return s;
}

/** 名簿に載せるのは確定(支払済み/当日現金)だけ。ふりがなの50音順。 */
export function rosterRows<T extends SummarizableOrder & { buyerKana: string }>(orders: T[]): T[] {
  return sortRosterByKana(orders.filter((o) => CONFIRMED.has(o.status)));
}

/** Stripe手数料(国内カード3.6%)。収支の見込みに使う。 */
export const STRIPE_FEE_RATE = 0.036;

// ---- 画伯コーナー(練習問題) ----

/** 答え合わせ用の正規化: カタカナ→ひらがな・空白や記号を除く・英字は小文字。 */
export function normalizeQuizAnswer(v: string): string {
  return normalizeKana(v).toLowerCase().replace(/[\s・!！?？。、.,'’〜~]/g, '');
}

/** 正解とみなす答え(TARO 2026-10-15)。Q1=プーさん系 / Q2=ロバ(ひらがな・カタカナどちらでも)。 */
const GAHAKU_ACCEPT: Record<'Q1' | 'Q2', string[]> = {
  Q1: ['くまのぷーさん', '熊のぷーさん', 'ぷーさん', 'ぷー', 'pooh', 'winniethepooh'],
  Q2: ['ろば', 'ろばさん', '驢馬', 'donkey'],
};

export function checkGahakuAnswer(q: 'Q1' | 'Q2', input: string): boolean {
  const v = normalizeQuizAnswer(input);
  return v.length > 0 && GAHAKU_ACCEPT[q].some((a) => normalizeQuizAnswer(a) === v);
}

// ---- 入力中のその場チェック(欄を離れたとき) ----

export type ContactField = 'kana' | 'email' | 'phone';

/** 形式が違えばエラー文、正しい/空なら ''(空は送信時にまとめて知らせる)。 */
export function contactFieldError(field: ContactField, value: string): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  if (field === 'email') return isValidEmail(v) ? '' : 'メールアドレスの形式が正しくありません(例: boom@example.com)';
  if (field === 'phone') return /^0\d{9,10}$/.test(normalizePhone(v)) ? '' : '電話番号は数字10〜11桁で入力してください(ハイフンはあってもなくてもOK)';
  return KANA_RE.test(normalizeKana(v)) ? '' : 'ひらがなで入力してください';
}

/** チーム名の照合用キー: 全角半角・大小文字・カタカナ/ひらがな・空白や記号の違いを吸収する。 */
export function normalizeTeamKey(v: string): string {
  return normalizeKana(String(v ?? '').normalize('NFKC'))
    .toLowerCase()
    .replace(/[\s・\-_'’.,!！?？。、☆★♪〜~]/g, '');
}

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

/** 日時はすべて JST の壁時計 'YYYY-MM-DDTHH:mm'。openAt が空 = 未公開。 */
export interface PartySettings {
  openAt: string;
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
  showTimeLimit: '1チーム3分半まで',
} as const;

const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function isValidJstLocal(v: string): boolean {
  return LOCAL_RE.test(v) && jstLocalToMs(v) != null;
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

function gate(s: PartySettings, now: Date, deadline: string): GateState {
  if (s.suspended) return 'suspended';
  if (!isOpened(s.openAt, now)) return 'before';
  if (!isBeforeDeadline(deadline, now)) return 'closed';
  return 'open';
}

export function ticketCardState(s: PartySettings, now: Date): GateState {
  return gate(s, now, s.ticketCardDeadline);
}

export function ticketCashState(s: PartySettings, now: Date): GateState {
  return gate(s, now, s.ticketCashDeadline);
}

/** holdingTeams = 確定(paid/cash_due)＋決済中(期限内pending)のチーム数。 */
export function entryState(s: PartySettings, now: Date, holdingTeams: number): GateState {
  const g = gate(s, now, s.entryDeadline);
  if (g !== 'open') return g;
  return holdingTeams >= s.teamCap ? 'full' : 'open';
}

export function audioOpen(s: PartySettings, now: Date): boolean {
  return isBeforeDeadline(s.audioDeadline, now);
}

export function ticketTotal(peopleCount: number, s: PartySettings): number {
  return peopleCount * s.presalePrice;
}

/** 出演者1人あたり = 出演料 + 参加費(前売)。 */
export function entryUnitPrice(s: PartySettings): number {
  return s.performerFee + s.presalePrice;
}

export function entryTotal(memberCount: number, s: PartySettings): number {
  return memberCount * entryUnitPrice(s);
}

// ---- 設定(party_settings の key-value)の解釈 ----

const KEY_MAP: Record<keyof PartySettings, string> = {
  openAt: 'open_at',
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
  return {
    openAt: openRaw != null && isValidJstLocal(openRaw.trim()) ? openRaw.trim() : '',
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

const KANA_RE = /^[ぁ-ゖー ]+$/;

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

export interface EntryInput extends ContactInput {
  teamName?: unknown;
  genre?: unknown;
  members?: unknown;
}

export interface ValidatedEntry extends ValidatedContact {
  teamName: string;
  genre: string;
  members: string[];
}

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 20;

export function validateEntryInput(input: EntryInput): ValidatedEntry | string {
  const teamName = String(input.teamName ?? '').trim();
  if (!teamName || teamName.length > 40) return 'チーム名を40文字以内で入力してください';
  const genre = String(input.genre ?? '').trim();
  if (!genre || genre.length > 30) return 'ジャンルを30文字以内で入力してください';
  const rawMembers = Array.isArray(input.members) ? input.members : [];
  const members = rawMembers.map((m) => String(m ?? '').trim()).filter((m) => m.length > 0);
  if (members.length < MIN_MEMBERS) return `メンバーは${MIN_MEMBERS}人以上で入力してください(1人での出演はできません)`;
  if (members.length > MAX_MEMBERS) return `メンバーは${MAX_MEMBERS}人までです`;
  if (members.some((m) => m.length > 50)) return 'メンバーの名前は50文字以内で入力してください';
  const c = validateContact(input);
  if (typeof c === 'string') return c;
  return { ...c, teamName, genre, members };
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
  /** 当日の来場見込み(小学生以上+出演者) */
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
    }
    if (o.status === 'paid') s.cardPaid += o.amountTotal;
    else s.cashDue += o.amountTotal;
  }
  s.headcount = s.people + s.performers;
  return s;
}

/** 名簿に載せるのは確定(支払済み/当日現金)だけ。ふりがなの50音順。 */
export function rosterRows<T extends SummarizableOrder & { buyerKana: string }>(orders: T[]): T[] {
  return sortRosterByKana(orders.filter((o) => CONFIRMED.has(o.status)));
}

/** Stripe手数料(国内カード3.6%)。収支の見込みに使う。 */
export const STRIPE_FEE_RATE = 0.036;

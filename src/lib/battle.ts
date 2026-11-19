// 月1回の校内プチバトル(/battle)の共通ロジック(純関数・vitest対象)。
//
// - 回ごとの設定(名前・説明・日付・部門・料金・定員・締切)は battle_events に持つ。ここに直書きしない
// - 会員・外部の区別なし(料金も同じ)。会員確認はしない
// - 決済はBF7と同じ: カード事前決済のみ・30分の仮押さえ・確定はStripeのWebhookが正本
// - 金額は必ずサーバ側でこのファイルの関数から計算する(クライアント申告額は使わない)
import { isValidBf6Email, isValidBf6Phone, normalizeInstagramHandle } from './bf6';

export interface BattleDivision {
  key: string;
  name: string;
  note: string;
  capacity: number;
  /** 開催日時点の満年齢の上限(U12なら12)。null=年齢制限なし */
  maxAge: number | null;
}

export interface BattleEvent {
  eventKey: string;
  title: string;
  subtitle: string;
  description: string;
  /** YYYY-MM-DD(JST) */
  eventDate: string;
  openTime: string;
  startTime: string;
  endTime: string;
  venue: string;
  venueAddress: string;
  moveSeconds: number;
  divisions: BattleDivision[];
  entryFee: number;
  entryFeeLate: number;
  /** この日時(JST 'YYYY-MM-DDTHH:MM')以降はエントリー料が entryFeeLate になる */
  lateFeeFrom: string;
  spectatorFee: number;
  spectatorNote: string;
  /** オンライン申込の締切(JST 'YYYY-MM-DDTHH:MM')。この時刻以降は受け付けない */
  entryDeadline: string;
  entryOpen: boolean;
  rules: string;
  cancelPolicy: string;
}

export type BattlePaymentStatus = 'pending' | 'paid' | 'expired' | 'canceled' | 'refunded' | 'test';

/** 枠を消費する状態(確定+30分の仮押さえ)。 */
export const BATTLE_HOLDING_STATUSES: BattlePaymentStatus[] = ['paid', 'pending'];

export const BATTLE_HOLD_MINUTES = 30;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 今のJST日時 'YYYY-MM-DDTHH:MM'。締切の比較に使う。 */
export function nowJstMinute(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);
}

/** divisions列(JSON)を読む。壊れた行は捨てる。 */
export function parseBattleDivisions(raw: unknown): BattleDivision[] {
  try {
    const arr = JSON.parse(String(raw ?? '[]'));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((d) => d && typeof d.key === 'string' && d.key)
      .map((d) => ({
        key: String(d.key),
        name: String(d.name ?? d.key),
        note: String(d.note ?? ''),
        capacity: Math.max(0, Number(d.capacity) || 0),
        maxAge: d.maxAge == null || d.maxAge === '' ? null : Number(d.maxAge),
      }));
  } catch {
    return [];
  }
}

/** 申込の部門キー配列(JSON)を読む。 */
export function parseDivisionKeys(raw: unknown): string[] {
  try {
    const arr = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

/** 基準日(YYYY-MM-DD)時点の満年齢。生年月日が不正なら null。 */
export function ageOn(birthdate: string, onDate: string): number | null {
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthdate);
  const o = /^(\d{4})-(\d{2})-(\d{2})$/.exec(onDate);
  if (!b || !o) return null;
  const [by, bm, bd] = [Number(b[1]), Number(b[2]), Number(b[3])];
  const [oy, om, od] = [Number(o[1]), Number(o[2]), Number(o[3])];
  if (bm < 1 || bm > 12 || bd < 1 || bd > 31) return null;
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}

/** 部門に出られる年齢か(開催日時点の満年齢で判定)。 */
export function isAgeEligible(div: BattleDivision, birthdate: string, eventDate: string): boolean {
  if (div.maxAge == null) return true;
  const age = ageOn(birthdate, eventDate);
  return age != null && age >= 0 && age <= div.maxAge;
}

/** 申込時点で18歳未満か(保護者の同意が要るか)。 */
export function needsGuardian(birthdate: string, today: string): boolean {
  const age = ageOn(birthdate, today);
  return age != null && age < 18;
}

/** その時点のエントリー料(1部門あたり)。 */
export function entryUnitPrice(ev: Pick<BattleEvent, 'entryFee' | 'entryFeeLate' | 'lateFeeFrom'>, now: string): number {
  if (ev.lateFeeFrom && now >= ev.lateFeeFrom && ev.entryFeeLate > 0) return ev.entryFeeLate;
  return ev.entryFee;
}

export interface BattleAmount {
  entryUnit: number;
  spectatorUnit: number;
  entryTotal: number;
  spectatorTotal: number;
  total: number;
}

/** 合計金額。エントリー料は部門ごと・観覧は小学生以上1人ごと(未就学児は無料)。 */
export function calcBattleAmount(
  ev: Pick<BattleEvent, 'entryFee' | 'entryFeeLate' | 'lateFeeFrom' | 'spectatorFee'>,
  divisionCount: number,
  spectators: number,
  now: string
): BattleAmount {
  const entryUnit = entryUnitPrice(ev, now);
  const spectatorUnit = ev.spectatorFee;
  const entryTotal = entryUnit * divisionCount;
  const spectatorTotal = spectatorUnit * spectators;
  return { entryUnit, spectatorUnit, entryTotal, spectatorTotal, total: entryTotal + spectatorTotal };
}

/** 受付中か(フラグと締切)。 */
export function isBattleAccepting(ev: Pick<BattleEvent, 'entryOpen' | 'entryDeadline'>, now: string): boolean {
  return ev.entryOpen && !(ev.entryDeadline && now >= ev.entryDeadline);
}

/** 受付できない理由(受付中なら null)。 */
export function battleGateError(ev: Pick<BattleEvent, 'entryOpen' | 'entryDeadline'>, now: string): string | null {
  if (ev.entryDeadline && now >= ev.entryDeadline) {
    return `事前申込は${formatJpDateTime(ev.entryDeadline)}で締め切りました`;
  }
  if (!ev.entryOpen) return '現在エントリーは受け付けていません';
  return null;
}

export interface BattleEntryInput {
  email: string;
  dancerName: string;
  dancerKana: string;
  realName: string;
  birthdate: string;
  rep: string;
  genre: string;
  phone: string;
  instagram: string;
  divisions: string[];
  noWinConfirmed: boolean;
  spectators: number;
  spectatorsPreschool: number;
  guardianName: string;
  guardianConsent: boolean;
  agreePolicy: boolean;
}

export type ValidatedBattleEntry = BattleEntryInput;

const MAX_SPECTATORS = 10;

function clean(v: unknown, max = 100): string {
  return String(v ?? '').trim().slice(0, max);
}

function toCount(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_SPECTATORS) : 0;
}

/**
 * 入力チェック(サーバ側で必ず通す)。OKなら整えた値、NGならエラー文。
 * today=申込日(JST)。18歳未満の判定に使う。部門の年齢判定は開催日で行う。
 */
export function validateBattleEntry(raw: Partial<BattleEntryInput>, ev: BattleEvent, today: string): ValidatedBattleEntry | string {
  const v: BattleEntryInput = {
    email: clean(raw.email),
    dancerName: clean(raw.dancerName, 40),
    dancerKana: clean(raw.dancerKana, 60),
    realName: clean(raw.realName, 60),
    birthdate: clean(raw.birthdate, 10),
    rep: clean(raw.rep, 60),
    genre: clean(raw.genre, 40),
    phone: clean(raw.phone, 20),
    instagram: normalizeInstagramHandle(clean(raw.instagram, 60)),
    divisions: Array.isArray(raw.divisions) ? [...new Set(raw.divisions.map(String))] : [],
    noWinConfirmed: raw.noWinConfirmed === true,
    spectators: toCount(raw.spectators),
    spectatorsPreschool: toCount(raw.spectatorsPreschool),
    guardianName: clean(raw.guardianName, 60),
    guardianConsent: raw.guardianConsent === true,
    agreePolicy: raw.agreePolicy === true,
  };
  if (!v.email || !isValidBf6Email(v.email)) return 'メールアドレスを正しく入力してください';
  if (!v.dancerName) return 'ダンサー名を入力してください';
  if (!v.dancerKana) return 'ダンサー名のよみがなを入力してください';
  if (!v.realName) return '本名を入力してください';
  if (ageOn(v.birthdate, today) == null) return '生年月日を正しく入力してください';
  const age = ageOn(v.birthdate, today)!;
  if (age < 3 || age > 100) return '生年月日を正しく入力してください';
  if (!v.rep) return '所属(レペゼン)を入力してください';
  if (!v.genre) return 'メインジャンルを入力してください';
  if (!v.phone || !isValidBf6Phone(v.phone)) return '電話番号は数字10〜11桁で入力してください';
  if (v.divisions.length === 0) return '出る部門を1つ以上選んでください';
  for (const key of v.divisions) {
    const div = ev.divisions.find((d) => d.key === key);
    if (!div) return '部門の選び方が正しくありません。ページを読み込み直してください';
    if (!isAgeEligible(div, v.birthdate, ev.eventDate)) {
      return `${div.name}は開催日に${div.maxAge}歳以下の方のみです`;
    }
  }
  if (!v.noWinConfirmed) return '「優勝未経験」の確認にチェックしてください';
  if (needsGuardian(v.birthdate, today)) {
    if (!v.guardianName) return '18歳未満の方は保護者の方のお名前を入力してください';
    if (!v.guardianConsent) return '18歳未満の方は保護者の方の同意にチェックしてください';
  } else {
    v.guardianName = '';
    v.guardianConsent = false;
  }
  if (!v.agreePolicy) return 'キャンセル規定と個人情報の取り扱いへの同意にチェックしてください';
  return v;
}

/** 受付番号の表記(例 BT1226-003)。回ごとに分かるよう開催月日を入れる。 */
export function formatBattleReceiptNo(entryId: number, eventKey: string): string {
  const md = eventKey.replace(/^\d{4}-(\d{2})-(\d{2}).*$/, '$1$2');
  return `BT${md}-${String(entryId).padStart(3, '0')}`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 2026-12-26 → 2026年12月26日(土) */
export function formatJpDateLong(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日(${WEEKDAYS[d.getUTCDay()]})`;
}

/** 2026-12-25T18:00 → 12/25(金) 18:00 */
export function formatJpDateTime(dt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(dt);
  if (!m) return dt;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${Number(m[2])}/${Number(m[3])}(${WEEKDAYS[d.getUTCDay()]}) ${m[4]}:${m[5]}`;
}

export const yen = (n: number) => `¥${n.toLocaleString()}`;

export const BATTLE_STATUS_LABEL: Record<string, string> = {
  paid: '支払済',
  pending: '決済待ち',
  expired: '期限切れ',
  canceled: 'キャンセル',
  refunded: '返金済',
  test: 'テスト',
};

export interface BattleMailEntry {
  entryId: number;
  eventKey: string;
  dancerName: string;
  dancerKana: string;
  divisions: string[];
  spectators: number;
  spectatorsPreschool: number;
  entryUnit: number;
  spectatorUnit: number;
  amountTotal: number;
}

/** 確定メールの文面(Webhookで決済確定した瞬間に送る)。 */
export function buildBattleConfirmEmail(
  e: BattleMailEntry,
  ev: BattleEvent,
  links: { completeUrl: string; entriesUrl: string }
): { subject: string; text: string } {
  const receiptNo = formatBattleReceiptNo(e.entryId, e.eventKey);
  const divNames = e.divisions.map((k) => ev.divisions.find((d) => d.key === k)?.name ?? k);
  const lines: string[] = [];
  lines.push(`${e.dancerName} 様`);
  lines.push('');
  lines.push(`${ev.title} へのエントリーありがとうございます。`);
  lines.push('お支払いが完了し、エントリーが確定しました!');
  lines.push('');
  lines.push(`■ 受付番号: ${receiptNo}`);
  lines.push(`■ ダンサー名: ${e.dancerName}(${e.dancerKana})`);
  for (const n of divNames) lines.push(`■ 部門: ${n} — ${yen(e.entryUnit)}`);
  if (e.spectators > 0) lines.push(`■ 同行の観覧 ${e.spectators}名 — ${yen(e.spectators * e.spectatorUnit)}`);
  if (e.spectatorsPreschool > 0) lines.push(`■ 同行の観覧(未就学児) ${e.spectatorsPreschool}名 — 無料`);
  lines.push(`■ 合計: ${yen(e.amountTotal)}(カード決済でお支払い済み)`);
  lines.push('');
  lines.push(`日時: ${formatJpDateLong(ev.eventDate)} ${ev.openTime}〜${ev.endTime}`);
  if (ev.openTime) lines.push(`  ${ev.openTime} 受付開始${ev.startTime ? ` / ${ev.startTime} 開始` : ''}`);
  lines.push(`会場: ${ev.venue}`);
  if (ev.venueAddress) lines.push(`  ${ev.venueAddress}`);
  lines.push('');
  lines.push('▼ お申し込み内容の確認');
  lines.push(links.completeUrl);
  lines.push('');
  lines.push('▼ エントリー一覧');
  lines.push(links.entriesUrl);
  lines.push('');
  lines.push('当日は受付で受付番号かダンサー名をお伝えください。');
  lines.push('内容の変更・キャンセルはBOOM公式LINEまでご連絡ください。');
  lines.push('');
  lines.push('BOOM DANCE SCHOOL');
  return { subject: `【${ev.title}】エントリー確定(受付番号 ${receiptNo})`, text: lines.join('\n') };
}


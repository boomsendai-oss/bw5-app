// 月1回の校内プチバトル(/dojo)の共通ロジック(純関数・vitest対象)。
//
// - 回ごとの設定(名前・説明・日付・部門・料金・定員・締切)は battle_events に持つ。ここに直書きしない
// - 会員・外部の区別なし(料金も同じ)。会員確認はしない
// - 支払いは「カード事前決済」か「当日会場で現金(onsite)」を選ぶ(料金は同じ・TARO 11/20)
//   カードはBF7と同じ: 30分の仮押さえ・確定はStripeのWebhookが正本
//   当日払いは申込の時点で枠を確保して確定(onsite=未収)。受付で受け取ったらスタッフ画面で paid にする
//   キャンセル料への同意(cancelFeeAgreed)を必須にする
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

/** 出演者(ジャッジ・DJ・MC)。announced=false の間は公開ページで「近日発表」と出す。 */
export interface BattleCast {
  role: string;
  /** 木札に大きく入れる役職の漢字1文字(審判=裁・DJ=音 など) */
  mark: string;
  name: string;
  /** アーティスト写真のURL(空なら写真の枠だけ出す) */
  photo: string;
  note: string;
  instagram: string;
  announced: boolean;
}

export function parseBattleCast(raw: unknown): BattleCast[] {
  try {
    const arr = JSON.parse(String(raw ?? '[]'));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c) => c && typeof c.role === 'string' && c.role)
      .map((c) => ({
        role: String(c.role),
        mark: String(c.mark ?? '').slice(0, 2),
        name: String(c.name ?? ''),
        photo: String(c.photo ?? ''),
        note: String(c.note ?? ''),
        instagram: String(c.instagram ?? '').replace(/^@/, ''),
        announced: Boolean(c.announced),
      }));
  } catch {
    return [];
  }
}

export interface BattleEvent {
  eventKey: string;
  /** 第何回か(其の一=1・其の二=2…)。受付番号 BD01-001 の 01。0=回の番号なし(テスト回など) */
  roundNo: number;
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
  cast: BattleCast[];
}

export type BattlePaymentStatus = 'pending' | 'paid' | 'onsite' | 'expired' | 'canceled' | 'refunded' | 'test';
export type BattlePayMethod = 'card' | 'onsite';

/** 枠を消費する状態(確定+当日払いの確定+30分の仮押さえ)。 */
export const BATTLE_HOLDING_STATUSES: BattlePaymentStatus[] = ['paid', 'onsite', 'pending'];
/** エントリーが確定している状態(公開一覧に載る)。 */
export const BATTLE_CONFIRMED_STATUSES: BattlePaymentStatus[] = ['paid', 'onsite'];

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

/** 基準日(YYYY-MM-DD)時点の満年齢。生年月日が不正なら null。2026-11-21以前の申込(生年月日で受けていた分)の表示用。 */
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

export const BATTLE_MIN_AGE = 3;
export const BATTLE_MAX_AGE = 100;

/** 入力された「開催日の年齢」を整数に。空・数字でない・範囲外は null。全角数字も受ける。 */
export function parseBattleAge(raw: unknown): number | null {
  const s = String(raw ?? '')
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/歳$/, '')
    .trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= BATTLE_MIN_AGE && n <= BATTLE_MAX_AGE ? n : null;
}

/** 部門に出られる年齢か(開催日の年齢=申込者が入力した数字で判定)。 */
export function isAgeEligible(div: BattleDivision, age: number | null): boolean {
  if (div.maxAge == null) return true;
  return age != null && age >= 0 && age <= div.maxAge;
}

/** 18歳未満か(保護者の同意が要るか)。開催日の年齢で判定する(TARO 2026-11-21)。 */
export function needsGuardian(age: number | null): boolean {
  return age != null && age < 18;
}

/** 申込の「開催日の年齢」。新しい申込は age 列、2026-11-21以前の申込は生年月日から出す。 */
export function entryAge(e: { age: number | null; birthdate: string }, eventDate: string): number | null {
  if (e.age != null) return e.age;
  return e.birthdate ? ageOn(e.birthdate, eventDate) : null;
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
  /** 開催日の年齢(申込者が数字で入力)。生年月日はもう聞かない(TARO 2026-11-21) */
  age: number | null;
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
  /** 支払い方法(カード事前決済／当日会場で現金) */
  payMethod: BattlePayMethod;
  /** 申込後のキャンセルにはキャンセル料がかかることへの同意 */
  cancelFeeAgreed: boolean;
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
 * 年齢は「開催日の年齢」の数字。部門の年齢判定・保護者の同意の要否はこの数字で行う。
 */
export function validateBattleEntry(
  raw: Partial<Omit<BattleEntryInput, 'age'>> & { age?: unknown },
  ev: BattleEvent
): ValidatedBattleEntry | string {
  const v: BattleEntryInput = {
    email: clean(raw.email),
    dancerName: clean(raw.dancerName, 40),
    dancerKana: clean(raw.dancerKana, 60),
    realName: clean(raw.realName, 60),
    age: parseBattleAge(raw.age),
    rep: clean(raw.rep, 60),
    genre: clean(raw.genre, 40),
    phone: clean(raw.phone, 20),
    instagram: normalizeInstagramHandle(clean(raw.instagram, 60)),
    divisions: Array.isArray(raw.divisions) ? [...new Set(raw.divisions.map(String))] : [],
    noWinConfirmed: raw.noWinConfirmed === true,
    spectators: toCount(raw.spectators),
    // 未就学児は無料・申込不要(TARO 2026-11-21)。人数は聞かない(列は残して0)
    spectatorsPreschool: 0,
    guardianName: clean(raw.guardianName, 60),
    guardianConsent: raw.guardianConsent === true,
    agreePolicy: raw.agreePolicy === true,
    payMethod: raw.payMethod === 'onsite' ? 'onsite' : 'card',
    cancelFeeAgreed: raw.cancelFeeAgreed === true,
  };
  if (!v.email || !isValidBf6Email(v.email)) return 'メールアドレスを正しく入力してください';
  if (!v.dancerName) return 'ダンサー名を入力してください';
  if (!v.dancerKana) return 'ダンサー名のよみがなを入力してください';
  if (!v.realName) return '本名を入力してください';
  if (v.age == null) return '開催日の年齢を数字で入力してください(例: 11)';
  if (!v.rep) return '活動地域(レペゼン)を入力してください';
  if (!v.genre) return 'ジャンルを入力してください';
  if (!v.phone || !isValidBf6Phone(v.phone)) return '電話番号は数字10〜11桁で入力してください';
  if (v.divisions.length === 0) return '出る部門を1つ以上選んでください';
  for (const key of v.divisions) {
    const div = ev.divisions.find((d) => d.key === key);
    if (!div) return '部門の選び方が正しくありません。ページを読み込み直してください';
    if (!isAgeEligible(div, v.age)) {
      return `${div.name}は開催日に${div.maxAge}歳以下の方のみです`;
    }
  }
  if (!v.noWinConfirmed) return '「優勝未経験」の確認にチェックしてください';
  if (needsGuardian(v.age)) {
    if (!v.guardianName) return '18歳未満の方は保護者の方のお名前を入力してください';
    if (!v.guardianConsent) return '18歳未満の方は保護者の方の同意にチェックしてください';
  } else {
    v.guardianName = '';
    v.guardianConsent = false;
  }
  if (!v.cancelFeeAgreed) return 'キャンセル料についての同意にチェックしてください';
  if (!v.agreePolicy) return 'キャンセル規定と個人情報の取り扱いへの同意にチェックしてください';
  return v;
}

/**
 * 受付番号の表記(例 BD01-003)。BD=BOOM DOJO・01=第何回(battle_events.round_no)・003=その回の確定した順(receipt_seq)。
 * 確定前(決済待ち・期限切れ)は番号が無いので「—」。スタッフの確認用テストは「テスト」。
 */
export function formatBattleReceiptNo(e: { receiptSeq: number | null; paymentStatus?: string }, roundNo: number): string {
  if (e.receiptSeq != null && e.receiptSeq > 0) {
    return `BD${String(Math.max(0, roundNo || 0)).padStart(2, '0')}-${String(e.receiptSeq).padStart(3, '0')}`;
  }
  if (e.paymentStatus === 'test') return 'テスト';
  return '—';
}

const KANJI_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 回の番号を漢数字に(1→一・10→十・12→十二・21→二十一)。1〜99。 */
export function roundKanji(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(n);
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${t === 0 ? '' : t === 1 ? '十' : `${KANJI_DIGITS[t]}十`}${KANJI_DIGITS[o]}`;
}

/** 新しい回のタイトル: 「其の一」を次の回の「其の二」に書き換える(其のN が無ければそのまま)。 */
export function nextRoundTitle(title: string, nextRound: number): string {
  return title.replace(/其の[一二三四五六七八九十]+/, `其の${roundKanji(nextRound)}`);
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
  onsite: '当日払い(未収)',
  pending: '決済待ち',
  expired: '期限切れ',
  canceled: 'キャンセル',
  refunded: '返金済',
  test: 'テスト',
};

/** 申込内容の表示(完了画面・確定メール・確認画面で同じ並びにする)。 */
export interface BattleSummary {
  /** バトルエントリー: 出る部門ごとに1行 */
  entries: { name: string; amount: number }[];
  entryTotal: number;
  /** 観覧チケット(小学生以上のみ。未就学児は無料・申込不要なので載せない)。0名なら空 */
  tickets: { label: string; count: number; unit: number; amount: number }[];
  ticketTotal: number;
  total: number;
}

export function buildBattleSummary(
  e: { divisions: string[]; spectators: number; spectatorsPreschool: number; entryUnit: number; spectatorUnit: number },
  ev: Pick<BattleEvent, 'divisions'>
): BattleSummary {
  // 部門名の頭の「優勝未経験」は全部門共通なので明細では省く(例: 優勝未経験 U12 ALL STYLE 1on1 → U12 ALL STYLE 1on1)
  const entries = e.divisions.map((k) => ({
    name: (ev.divisions.find((d) => d.key === k)?.name ?? k).replace(/^優勝未経験\s*/, ''),
    amount: e.entryUnit,
  }));
  const tickets: BattleSummary['tickets'] = [];
  if (e.spectators > 0) tickets.push({ label: '小学生以上', count: e.spectators, unit: e.spectatorUnit, amount: e.spectators * e.spectatorUnit });
  const entryTotal = entries.reduce((a, x) => a + x.amount, 0);
  const ticketTotal = tickets.reduce((a, x) => a + x.amount, 0);
  return { entries, entryTotal, tickets, ticketTotal, total: entryTotal + ticketTotal };
}

/** 支払い方法・状態のひとこと(完了画面・メールで使う)。 */
export function battlePayLabel(e: { paymentStatus?: string; amountTotal: number; stripeSessionId?: string; note?: string }): string {
  const st = e.paymentStatus ?? 'paid';
  if (st === 'onsite') return '当日、受付で現金でお支払い(未払い)';
  if (st === 'pending') return 'カード決済待ち';
  if (st === 'test') return 'テスト申込(決済なし)';
  if (st === 'paid') {
    if (e.amountTotal === 0) return 'お支払いなし(無料)';
    if (e.note?.includes('当日現金で受領')) return '当日現金でお支払い済み';
    return 'カードでお支払い済み';
  }
  return BATTLE_STATUS_LABEL[st] ?? st;
}

export interface BattleMailEntry {
  receiptSeq: number | null;
  dancerName: string;
  dancerKana: string;
  divisions: string[];
  spectators: number;
  spectatorsPreschool: number;
  entryUnit: number;
  spectatorUnit: number;
  amountTotal: number;
  paymentStatus?: string;
  stripeSessionId?: string;
  note?: string;
}

/** 確定メールの文面(Webhookで決済確定した瞬間・当日払いは申込直後に送る)。 */
export function buildBattleConfirmEmail(
  e: BattleMailEntry,
  ev: BattleEvent,
  links: { completeUrl: string; entriesUrl: string; /** 画像(ロゴ・BOOMくん)の置き場の origin。無ければ画像なし */ assetOrigin?: string }
): { subject: string; text: string; html: string } {
  const receiptNo = formatBattleReceiptNo(e, ev.roundNo);
  const sum = buildBattleSummary(e, ev);
  const onsite = e.paymentStatus === 'onsite';
  const lines: string[] = [];
  lines.push(`${e.dancerName} 様`);
  lines.push('');
  lines.push(`${ev.title} へのエントリーありがとうございます。`);
  lines.push(onsite ? 'エントリーが確定しました!(お支払いは当日会場で)' : 'お支払いが完了し、エントリーが確定しました!');
  lines.push('');
  lines.push(`受付番号: ${receiptNo}`);
  lines.push(`ダンサー名: ${e.dancerName}(${e.dancerKana})`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━');
  lines.push('■ バトルエントリー');
  for (const x of sum.entries) lines.push(`  ${x.name}  ${yen(x.amount)}`);
  lines.push('');
  lines.push('■ 観覧チケット');
  if (sum.tickets.length === 0) lines.push('  なし');
  for (const t of sum.tickets) {
    lines.push(t.amount > 0 ? `  ${t.label} ${t.count}名  ${yen(t.unit)} × ${t.count} = ${yen(t.amount)}` : `  ${t.label} ${t.count}名  無料`);
  }
  lines.push('━━━━━━━━━━━━━━');
  lines.push(`■ 合計  ${yen(e.amountTotal)}`);
  lines.push(`■ お支払い  ${battlePayLabel(e)}`);
  if (onsite) lines.push('  当日、受付で現金でお支払いください。おつりの出ないようご用意いただけると助かります。');
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
  if (onsite) lines.push('※お申し込み後のキャンセルには、当日払いの方もキャンセル料(エントリー料と同額)がかかります。');
  lines.push('');
  lines.push('BOOM DANCE SCHOOL');
  return {
    subject: `【${ev.title}】エントリー確定(受付番号 ${receiptNo})`,
    text: lines.join('\n'),
    html: buildBattleConfirmHtml(e, ev, links, receiptNo, sum),
  };
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 確定メールのHTML版(申込ページ /dojo と同じ世界観: 夜の道場の墨色・生成りの和紙カード・朱)。
 * Gmail・iPhoneのメールで崩れないよう、表組み＋インラインCSSだけで組む(<style>・flex・背景画像は使わない)。
 * 文面の構成はテキスト版と同じ。利用者の入力(ダンサー名など)は必ず esc() を通す。
 */
function buildBattleConfirmHtml(
  e: BattleMailEntry,
  ev: BattleEvent,
  links: { completeUrl: string; entriesUrl: string; assetOrigin?: string },
  receiptNo: string,
  sum: BattleSummary
): string {
  const INK = '#1d140c';
  const PAPER = '#efe4cf';
  const NIGHT = '#0d0906';
  const BOARD = '#16100b';
  const SHU = '#b8261c';
  const AKA = '#7a2a1c';
  const SUB = '#6b5a44';
  const LINE = '#d8c8aa';
  const KINARI = '#f3eadb';
  const MINCHO = "'Hiragino Mincho ProN','Yu Mincho','YuMincho',serif";
  const GOTHIC = "'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Meiryo',sans-serif";
  const onsite = e.paymentStatus === 'onsite';
  const img = (path: string) => (links.assetOrigin ? `${links.assetOrigin.replace(/\/$/, '')}${path}` : '');
  const logo = img('/dojo/mail/logo_dojo.png');
  const bow = img('/dojo/mail/boomkun_bow.png');
  const T = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';

  const heading = (t: string) =>
    `<tr><td style="padding:18px 0 6px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="width:4px;background:${SHU};font-size:0;line-height:0;">&nbsp;</td>` +
    `<td style="padding-left:8px;font-family:${GOTHIC};font-size:14px;font-weight:bold;letter-spacing:0.08em;color:${INK};">${esc(t)}</td>` +
    `</tr></table></td></tr>`;
  const row = (left: string, right: string) =>
    `<tr><td style="padding:0;"><table ${T}><tr>` +
    `<td style="padding:8px 0;border-bottom:1px solid ${LINE};font-family:${GOTHIC};font-size:15px;color:${INK};">${left}</td>` +
    `<td align="right" style="padding:8px 0;border-bottom:1px solid ${LINE};font-family:${GOTHIC};font-size:15px;font-weight:bold;color:${INK};white-space:nowrap;">${right}</td>` +
    `</tr></table></td></tr>`;
  const card = (inner: string) =>
    `<tr><td style="padding:0 16px 16px 16px;"><table ${T} style="background:${PAPER};border-radius:6px;">` +
    `<tr><td style="padding:20px 18px;">${inner}</td></tr></table></td></tr>`;
  const cardTitle = (t: string) =>
    `<div style="font-family:${MINCHO};font-size:20px;font-weight:bold;color:${INK};border-bottom:2px solid ${INK};padding-bottom:6px;margin-bottom:4px;">${esc(t)}</div>`;
  const button = (href: string, label: string, primary: boolean) =>
    `<table ${T} style="margin-top:10px;"><tr>` +
    `<td align="center" style="border-radius:4px;background:${primary ? SHU : BOARD};border:${primary ? `2px solid ${SHU}` : '1px solid #6b5f52'};">` +
    `<a href="${esc(href)}" style="display:block;padding:13px 10px;font-family:${GOTHIC};font-size:15px;font-weight:bold;letter-spacing:0.1em;color:${primary ? '#ffffff' : KINARI};text-decoration:none;">${esc(label)}</a>` +
    `</td></tr></table>`;

  const entryRows = sum.entries.map((x) => row(`<b>${esc(x.name)}</b>`, esc(yen(x.amount)))).join('');
  const ticketRows =
    sum.tickets.length === 0
      ? `<tr><td style="padding:8px 0;font-family:${GOTHIC};font-size:14px;color:${SUB};">なし</td></tr>`
      : sum.tickets
          .map((t) =>
            row(
              `<b>${esc(t.label)} ${t.count}名</b>${t.amount > 0 ? ` <span style="font-size:12px;color:${SUB};">${esc(yen(t.unit))} × ${t.count}</span>` : ''}`,
              t.amount > 0 ? esc(yen(t.amount)) : '無料'
            )
          )
          .join('');

  const parts: string[] = [];
  // 見出し(夜の道場): ロゴ・回の名前・BOOMくんのお辞儀
  parts.push(
    `<tr><td align="center" style="padding:28px 16px 4px 16px;">` +
      `<div style="font-family:${GOTHIC};font-size:10px;letter-spacing:0.3em;color:#bfb3a2;">BOOM DANCE SCHOOL PRESENTS</div>` +
      (logo
        ? `<img src="${esc(logo)}" width="300" alt="BOOM DOJO ROAD TO BLACK BELT" style="display:block;width:300px;max-width:100%;height:auto;margin:14px auto 0 auto;border:0;">`
        : `<div style="font-family:${MINCHO};font-size:30px;font-weight:bold;color:${KINARI};margin-top:12px;">BOOM DOJO</div>`) +
      `<div style="font-family:${MINCHO};font-size:15px;color:${KINARI};margin-top:10px;">${esc(ev.title)}</div>` +
      `</td></tr>`
  );
  if (bow) {
    parts.push(
      `<tr><td align="center" style="padding:10px 16px 0 16px;">` +
        `<img src="${esc(bow)}" width="240" alt="BOOMくん(お辞儀)" style="display:block;width:240px;max-width:70%;height:auto;margin:0 auto;border:0;">` +
        `</td></tr>`
    );
  }
  parts.push(
    `<tr><td align="center" style="padding:14px 16px 20px 16px;">` +
      `<div style="font-family:${MINCHO};font-size:28px;font-weight:bold;letter-spacing:0.1em;color:${KINARI};">エントリー完了</div>` +
      `<div style="font-family:${GOTHIC};font-size:14px;line-height:1.7;color:${KINARI};margin-top:6px;">${esc(e.dancerName)} 様<br>` +
      `${esc(ev.title)} へのエントリーありがとうございます。<br>` +
      `${onsite ? 'エントリーが確定しました。お支払いは当日、会場で。' : 'お支払いが完了し、エントリーが確定しました。'}</div>` +
      `</td></tr>`
  );
  // 受付番号
  parts.push(
    card(
      `<table ${T}><tr><td align="center">` +
        `<div style="font-family:${GOTHIC};font-size:12px;font-weight:bold;letter-spacing:0.3em;color:${AKA};">受付番号</div>` +
        `<div style="font-family:${GOTHIC};font-size:38px;font-weight:bold;letter-spacing:0.04em;color:${INK};margin-top:4px;">${esc(receiptNo)}</div>` +
        `<div style="font-family:${GOTHIC};font-size:13px;color:${SUB};margin-top:6px;">当日は受付で受付番号かダンサー名をお伝えください</div>` +
        `</td></tr></table>`
    )
  );
  // 申込内容
  parts.push(
    card(
      cardTitle('申込内容') +
        `<div style="font-family:${GOTHIC};font-size:20px;font-weight:bold;color:${INK};padding-top:8px;">${esc(e.dancerName)} ` +
        `<span style="font-size:13px;color:${SUB};">${esc(e.dancerKana)}</span></div>` +
        `<table ${T}>` +
        heading('バトルエントリー') +
        entryRows +
        heading('観覧チケット') +
        ticketRows +
        `<tr><td style="padding:14px 0 0 0;"><table ${T} style="border-top:2px solid ${INK};"><tr>` +
        `<td style="padding-top:12px;font-family:${GOTHIC};font-size:14px;font-weight:bold;letter-spacing:0.2em;color:${INK};">合計</td>` +
        `<td align="right" style="padding-top:8px;font-family:${GOTHIC};font-size:30px;font-weight:bold;color:${INK};white-space:nowrap;">${esc(yen(e.amountTotal))}</td>` +
        `</tr></table></td></tr>` +
        `<tr><td align="right" style="padding-top:4px;font-family:${GOTHIC};font-size:14px;font-weight:bold;color:${AKA};">${esc(battlePayLabel(e))}</td></tr>` +
        (onsite
          ? `<tr><td style="padding-top:8px;font-family:${GOTHIC};font-size:13px;line-height:1.6;color:${INK};">当日、受付で現金でお支払いください。おつりの出ないようご用意いただけると助かります。</td></tr>`
          : '') +
        `</table>`
    )
  );
  // 開催
  const timeLine = `${ev.openTime ? `${esc(ev.openTime)} 受付開始` : ''}${ev.startTime ? ` / ${esc(ev.startTime)} 開始` : ''}`;
  const infoRow = (k: string, v: string) =>
    `<tr><td width="56" valign="top" style="padding:6px 0;font-family:${GOTHIC};font-size:13px;font-weight:bold;color:${AKA};">${k}</td>` +
    `<td style="padding:6px 0;font-family:${GOTHIC};font-size:14px;line-height:1.6;color:${INK};">${v}</td></tr>`;
  parts.push(
    card(
      cardTitle('開催') +
        `<table ${T} style="margin-top:6px;">` +
        infoRow(
          '日時',
          `${esc(formatJpDateLong(ev.eventDate))} ${esc(ev.openTime)}〜${esc(ev.endTime)}${timeLine ? `<br><span style="font-size:12px;color:${SUB};">${timeLine}</span>` : ''}`
        ) +
        infoRow('会場', `${esc(ev.venue)}${ev.venueAddress ? `<br><span style="font-size:12px;color:${SUB};">${esc(ev.venueAddress)}</span>` : ''}`) +
        `</table>`
    )
  );
  // リンクと案内
  parts.push(`<tr><td style="padding:0 16px 8px 16px;">${button(links.completeUrl, 'お申し込み内容の確認', true)}${button(links.entriesUrl, 'エントリー一覧', false)}</td></tr>`);
  parts.push(
    `<tr><td style="padding:12px 20px 28px 20px;font-family:${GOTHIC};font-size:12px;line-height:1.8;color:${KINARI};">` +
      `当日は受付で受付番号かダンサー名をお伝えください。<br>内容の変更・キャンセルはBOOM公式LINEまでご連絡ください。` +
      (onsite ? `<br>※お申し込み後のキャンセルには、当日払いの方もキャンセル料(エントリー料と同額)がかかります。` : '') +
      `<div style="margin-top:14px;font-family:${MINCHO};font-size:13px;letter-spacing:0.2em;color:#bfb3a2;text-align:center;">BOOM DANCE SCHOOL</div>` +
      `</td></tr>`
  );

  return (
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(ev.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${NIGHT};">` +
    `<table ${T} style="background:${NIGHT};"><tr><td align="center" style="padding:0;">` +
    `<table ${T} style="max-width:480px;background:${BOARD};">` +
    parts.join('') +
    `</table></td></tr></table></body></html>`
  );
}

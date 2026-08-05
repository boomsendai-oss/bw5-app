// BOOMER'S FIGHT!!! vol.6 (2026-09-26) エントリー＆事前決済の共通ロジック。
// 料金・定員は bf_settings で上書きできるが、既定値はここに集約する。
// 設計書: ~/BOOM/BOOMERS_FIGHT_2026/エントリーアプリ_設計書_v2.md

export type Bf6PayMethod = 'prepaid' | 'onsite';

export type Bf6Division = 'beginner' | 'kids' | 'general';

export type Bf6Grade =
  | 'preschool'
  | 'es1' | 'es2' | 'es3' | 'es4' | 'es5' | 'es6'
  | 'jhs1' | 'jhs2' | 'jhs3'
  | 'hs1' | 'hs2' | 'hs3'
  | 'adult';

export interface Bf6Pricing {
  entryBase: number;
  entryPerExtraDivision: number;
  prepaidDiscount: number;
  ticketAdultPrepaid: number;
  ticketAdultOnsite: number;
  ticketChild: number;
  stream: number;
  showcase: number;
}

export interface Bf6Settings {
  pricing: Bf6Pricing;
  capacity: Record<Bf6Division, number>;
  hallCapacity: number;
  entryOpen: boolean;
  ticketOpen: boolean;
  entryDeadline: string;
  ticketDeadline: string;
}

export const DEFAULT_BF6_SETTINGS: Bf6Settings = {
  pricing: {
    entryBase: 2500,
    entryPerExtraDivision: 1500,
    prepaidDiscount: 500,
    ticketAdultPrepaid: 2000,
    ticketAdultOnsite: 2500,
    ticketChild: 1000,
    stream: 1500,
    showcase: 2000,
  },
  capacity: { beginner: 16, kids: 32, general: 32 },
  hallCapacity: 200,
  entryOpen: false,
  ticketOpen: false,
  entryDeadline: '2026-09-24',
  ticketDeadline: '2026-09-25',
};

/** JSTの今日の日付(YYYY-MM-DD)が締切を過ぎていたらtrue。 */
export function isPastDeadlineJst(deadline: string, now: Date = new Date()): boolean {
  if (!deadline) return false;
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return jst > deadline;
}

/** バトルエントリー1人分の料金。1部門¥2,500 + 追加部門¥1,500、事前決済は一律−¥500。 */
export function calcEntryFee(
  divisionCount: number,
  payMethod: Bf6PayMethod,
  pricing: Bf6Pricing = DEFAULT_BF6_SETTINGS.pricing
): number {
  if (divisionCount <= 0) return 0;
  const base = pricing.entryBase + (divisionCount - 1) * pricing.entryPerExtraDivision;
  return payMethod === 'prepaid' ? base - pricing.prepaidDiscount : base;
}

/** 観覧チケット単価。大人のみ事前/当日で価格差、小学生は一律。 */
export function calcTicketUnitPrice(
  itemType: 'ticket_adult' | 'ticket_child',
  payMethod: Bf6PayMethod,
  pricing: Bf6Pricing = DEFAULT_BF6_SETTINGS.pricing
): number {
  if (itemType === 'ticket_child') return pricing.ticketChild;
  return payMethod === 'prepaid' ? pricing.ticketAdultPrepaid : pricing.ticketAdultOnsite;
}

export interface Bf6Cart {
  entries: { divisions: Bf6Division[] }[];
  adultTickets: number;
  childTickets: number;
  streamTickets?: number;
}

/** カート合計。エントリー複数人(きょうだい)+観覧同時購入を1決済に載せる。 */
export function calcOrderTotal(
  cart: Bf6Cart,
  payMethod: Bf6PayMethod,
  pricing: Bf6Pricing = DEFAULT_BF6_SETTINGS.pricing
): number {
  const entryTotal = cart.entries.reduce(
    (sum, e) => sum + calcEntryFee(e.divisions.length, payMethod, pricing),
    0
  );
  return (
    entryTotal +
    cart.adultTickets * calcTicketUnitPrice('ticket_adult', payMethod, pricing) +
    cart.childTickets * calcTicketUnitPrice('ticket_child', payMethod, pricing) +
    (cart.streamTickets ?? 0) * pricing.stream
  );
}

const ELEMENTARY_GRADES: ReadonlySet<string> = new Set(['es1', 'es2', 'es3', 'es4', 'es5', 'es6']);

export function isElementaryGrade(grade: string): boolean {
  return ELEMENTARY_GRADES.has(grade);
}

/** 初心者部門の出場資格 = 小学生かつバトル初出場のみ。 */
export function canEnterBeginner(grade: string, isFirstBattle: boolean): boolean {
  return isElementaryGrade(grade) && isFirstBattle;
}

/** 部門残枠。確定(=決済済み+当日現金選択)人数を定員から引く。 */
export function divisionRemaining(capacity: number, confirmedCount: number): number {
  return Math.max(0, capacity - confirmedCount);
}

/** 観覧残数 = ホール定員 − 出演者数 − 販売済枚数(出演者本人は無料入場のため枠を食う)。 */
export function ticketRemaining(
  hallCapacity: number,
  performerCount: number,
  soldTickets: number
): number {
  return Math.max(0, hallCapacity - performerCount - soldTickets);
}

// accentText/accentBg はTailwindのJIT対象になるためクラス名をリテラルで持つ
export const BF6_DIVISIONS: {
  key: Bf6Division;
  label: string;
  note: string;
  accentText: string;
  accentBg: string;
}[] = [
  { key: 'beginner', label: 'ビギナー部門', note: '小学生・バトル初出場限定', accentText: 'text-emerald-600', accentBg: 'bg-gradient-to-b from-emerald-500 to-emerald-700' },
  { key: 'kids', label: '小中学生部門', note: '小学生・中学生', accentText: 'text-orange-500', accentBg: 'bg-gradient-to-b from-orange-400 to-orange-600' },
  { key: 'general', label: '一般部門', note: '年齢制限なし', accentText: 'text-red-600', accentBg: 'bg-gradient-to-b from-red-500 to-red-700' },
];

export function bf6DivisionLabel(key: string): string {
  return BF6_DIVISIONS.find((d) => d.key === key)?.label ?? key;
}

export const BF6_GRADE_OPTIONS: { key: Bf6Grade; label: string }[] = [
  { key: 'preschool', label: '未就学児' },
  { key: 'es1', label: '小1' },
  { key: 'es2', label: '小2' },
  { key: 'es3', label: '小3' },
  { key: 'es4', label: '小4' },
  { key: 'es5', label: '小5' },
  { key: 'es6', label: '小6' },
  { key: 'jhs1', label: '中1' },
  { key: 'jhs2', label: '中2' },
  { key: 'jhs3', label: '中3' },
  { key: 'hs1', label: '高1' },
  { key: 'hs2', label: '高2' },
  { key: 'hs3', label: '高3' },
  { key: 'adult', label: '大人' },
];

export function bf6GradeLabel(key: string): string {
  return BF6_GRADE_OPTIONS.find((g) => g.key === key)?.label ?? key;
}

function isBf6Grade(v: string): v is Bf6Grade {
  return BF6_GRADE_OPTIONS.some((g) => g.key === v);
}

function isBf6Division(v: string): v is Bf6Division {
  return BF6_DIVISIONS.some((d) => d.key === v);
}

/** 小中学生部門の資格 = 小1〜中3。 */
export function canEnterKids(grade: string): boolean {
  return isElementaryGrade(grade) || grade === 'jhs1' || grade === 'jhs2' || grade === 'jhs3';
}

// 本名・フリガナは全角カタカナのみ(長音符・中点・スペース許容)。
// 当日受付の照合とMC読み上げを楽にするため。
const KATAKANA_NAME_RE = /^[゠-ヿ　\s]+$/;

/** 全角カタカナか(クライアントの即時バリデーションでも使う)。 */
export function isKatakanaText(v: string): boolean {
  return KATAKANA_NAME_RE.test(v);
}

export function isValidBf6Email(v: string): boolean {
  const s = v.trim();
  return /^\S+@\S+\.\S+$/.test(s) && s.length <= 100;
}

export function isValidBf6Phone(v: string): boolean {
  const digits = v.trim().replace(/[-‐−ー()（）\s]/g, '');
  return /^0\d{9,10}$/.test(digits);
}

export interface Bf6EntryInput {
  performerName: string;
  dancerName: string;
  dancerKana: string;
  grade: string;
  genre?: string;
  rep?: string;
  instagram?: string;
  isFirstBattle?: boolean;
  divisions: string[];
}

export interface Bf6OrderInput {
  buyerName: string;
  email: string;
  phone: string;
  payMethod: string;
  entries: Bf6EntryInput[];
  adultTickets: number;
  childTickets: number;
  streamTickets?: number;
  note?: string;
}

export interface ValidatedBf6Entry {
  performerName: string;
  dancerName: string;
  dancerKana: string;
  grade: Bf6Grade;
  genre: string;
  rep: string;
  instagram: string;
  isFirstBattle: boolean;
  divisions: Bf6Division[];
}

export interface ValidatedBf6Order {
  buyerName: string;
  email: string;
  phone: string;
  payMethod: Bf6PayMethod;
  entries: ValidatedBf6Entry[];
  adultTickets: number;
  childTickets: number;
  streamTickets: number;
  note: string;
}

function isValidTicketCount(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 20;
}

/** 検証OKなら ValidatedBf6Order、NGなら日本語エラー文字列を返す(太白まつり方式)。 */
export function validateBf6Order(input: Bf6OrderInput): ValidatedBf6Order | string {
  const buyerName = (input.buyerName ?? '').trim();
  if (!buyerName) return '申込者のお名前を入力してください';
  if (buyerName.length > 50) return '申込者名が長すぎます(50文字以内)';

  const email = (input.email ?? '').trim();
  if (!isValidBf6Email(email)) return 'メールアドレスの形式が正しくありません';

  const phone = (input.phone ?? '').trim();
  if (!isValidBf6Phone(phone)) return '電話番号は当日連絡が取れる番号を数字で入力してください';

  if (input.payMethod !== 'prepaid' && input.payMethod !== 'onsite') return '支払い方法を選択してください';

  if (!isValidTicketCount(input.adultTickets) || !isValidTicketCount(input.childTickets)) {
    return '観覧チケットの枚数が正しくありません(0〜20枚)';
  }

  const streamTickets = input.streamTickets ?? 0;
  if (!Number.isInteger(streamTickets) || streamTickets < 0 || streamTickets > 10) {
    return '配信チケットの枚数が正しくありません(0〜10枚)';
  }
  if (streamTickets > 0 && input.payMethod !== 'prepaid') {
    return '配信チケットは事前カード決済のみご利用いただけます';
  }

  const rows = Array.isArray(input.entries) ? input.entries : [];
  const entries: ValidatedBf6Entry[] = [];
  for (const e of rows) {
    const performerName = (e?.performerName ?? '').trim();
    if (!performerName) return '出場者の本名(カタカナ)を入力してください';
    if (performerName.length > 50) return '出場者名が長すぎます(50文字以内)';
    if (!KATAKANA_NAME_RE.test(performerName)) return `「${performerName}」はカタカナで入力してください`;

    const dancerName = (e?.dancerName ?? '').trim();
    if (!dancerName) return `${performerName} さんのダンサーネームを入力してください`;
    if (dancerName.length > 30) return 'ダンサーネームが長すぎます(30文字以内)';

    const dancerKana = (e?.dancerKana ?? '').trim();
    if (!dancerKana) return `${dancerName} の呼び方(フリガナ)を入力してください`;
    if (dancerKana.length > 30) return '呼び方が長すぎます(30文字以内)';
    if (!isKatakanaText(dancerKana)) return `フリガナ「${dancerKana}」はカタカナで入力してください`;

    const grade = (e?.grade ?? '').trim();
    if (!isBf6Grade(grade)) return `${dancerName} さんの学年を選んでください`;

    const rawDivisions = Array.isArray(e?.divisions) ? e.divisions : [];
    const divisions: Bf6Division[] = [];
    for (const d of rawDivisions) {
      if (!isBf6Division(d)) return '出場部門の指定が正しくありません';
      if (!divisions.includes(d)) divisions.push(d);
    }
    if (divisions.length === 0) return `${dancerName} さんの出場部門を1つ以上選んでください`;

    const isFirstBattle = Boolean(e?.isFirstBattle);
    if (divisions.includes('beginner') && !canEnterBeginner(grade, isFirstBattle)) {
      return `ビギナー部門は「小学生」かつ「バトル初出場」の方のみエントリーできます(${dancerName} さん)`;
    }
    if (divisions.includes('kids') && !canEnterKids(grade)) {
      return `小中学生部門は小学生・中学生のみエントリーできます(${dancerName} さん)`;
    }

    let instagram = (e?.instagram ?? '').trim();
    if (instagram && !instagram.startsWith('@')) instagram = `@${instagram}`;
    if (instagram.length > 50) return 'Instagramアカウントが長すぎます(50文字以内)';

    const genre = (e?.genre ?? '').trim();
    if (!genre) return `${dancerName} さんのエントリージャンルを入力してください`;
    const rep = (e?.rep ?? '').trim();
    if (!rep) return `${dancerName} さんのレペゼン(チーム名・地域・スクールなど)を入力してください`;

    entries.push({
      performerName,
      dancerName,
      dancerKana,
      grade,
      genre: genre.slice(0, 50),
      rep: rep.slice(0, 50),
      instagram,
      isFirstBattle,
      divisions,
    });
  }

  if (entries.length > 5) return '一度にエントリーできるのは5人までです';
  if (entries.length === 0 && input.adultTickets === 0 && input.childTickets === 0 && streamTickets === 0) {
    return '出場者またはチケットを1つ以上入力してください';
  }

  return {
    buyerName,
    email,
    phone,
    payMethod: input.payMethod,
    entries,
    adultTickets: input.adultTickets,
    childTickets: input.childTickets,
    streamTickets,
    note: (input.note ?? '').trim().slice(0, 500),
  };
}

/** 部門ごとのエントリー人数を数える(残枠チェック用)。 */
export function countEntriesByDivision(entries: { divisions: Bf6Division[] }[]): Record<Bf6Division, number> {
  const out: Record<Bf6Division, number> = { beginner: 0, kids: 0, general: 0 };
  for (const e of entries) {
    for (const d of e.divisions) out[d] += 1;
  }
  return out;
}

export interface Bf6OrderItemRow {
  itemType: 'entry' | 'ticket_adult' | 'ticket_child' | 'stream';
  performerName: string;
  dancerName: string;
  dancerKana: string;
  grade: string;
  genre: string;
  rep: string;
  instagram: string;
  isFirstBattle: boolean;
  divisions: Bf6Division[];
  qty: number;
  unitAmount: number;
}

/** 明細行を生成する。単価は必ずサーバ側(この関数)で確定し、クライアント申告額は使わない。 */
export function buildBf6OrderItems(
  order: ValidatedBf6Order,
  payMethod: Bf6PayMethod,
  pricing: Bf6Pricing = DEFAULT_BF6_SETTINGS.pricing
): Bf6OrderItemRow[] {
  const items: Bf6OrderItemRow[] = order.entries.map((e) => ({
    itemType: 'entry' as const,
    performerName: e.performerName,
    dancerName: e.dancerName,
    dancerKana: e.dancerKana,
    grade: e.grade,
    genre: e.genre,
    rep: e.rep,
    instagram: e.instagram,
    isFirstBattle: e.isFirstBattle,
    divisions: e.divisions,
    qty: 1,
    unitAmount: calcEntryFee(e.divisions.length, payMethod, pricing),
  }));
  const emptyPerformer = {
    performerName: '', dancerName: '', dancerKana: '', grade: '',
    genre: '', rep: '', instagram: '', isFirstBattle: false, divisions: [] as Bf6Division[],
  };
  if (order.adultTickets > 0) {
    items.push({
      itemType: 'ticket_adult', ...emptyPerformer,
      qty: order.adultTickets,
      unitAmount: calcTicketUnitPrice('ticket_adult', payMethod, pricing),
    });
  }
  if (order.childTickets > 0) {
    items.push({
      itemType: 'ticket_child', ...emptyPerformer,
      qty: order.childTickets,
      unitAmount: calcTicketUnitPrice('ticket_child', payMethod, pricing),
    });
  }
  if (order.streamTickets > 0) {
    items.push({
      itemType: 'stream', ...emptyPerformer,
      qty: order.streamTickets,
      unitAmount: pricing.stream,
    });
  }
  return items;
}

/** 受付番号の表記(完了画面・完了メール・スタッフ画面で共通)。 */
export function formatReceiptNo(orderId: number): string {
  return `BF6-${String(orderId).padStart(3, '0')}`;
}

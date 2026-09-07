// BOOM オフィシャルTシャツ 注文フォームの純ロジック(DB非依存・vitest対象)。
// ※ 公開フォーム(クライアント)からも import されるため node: 依存を持たない
//   (トークン生成は Web Crypto)。

export const TSHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL'] as const;
export type TshirtSize = (typeof TSHIRT_SIZES)[number];

export function isTshirtSize(v: unknown): v is TshirtSize {
  return typeof v === 'string' && (TSHIRT_SIZES as readonly string[]).includes(v);
}

export interface TshirtSettings {
  productName: string;
  unitPrice: number;
  shippingFee: number;
  imageUrl: string;
  openAt: string;
  closeAt: string;
  isOpen: boolean;
  introMd: string;
  pickupNote: string;
  thanksNote: string;
  sizeChart: SizeChartRow[];
}

export function defaultTshirtSettings(): TshirtSettings {
  return {
    productName: 'BOOM オフィシャルTシャツ（黒×黒モデル）',
    unitPrice: 3500,
    shippingFee: 800,
    imageUrl: '/merch/tshirt_black_black.png',
    openAt: '2026-08-22',
    closeAt: '2026-08-29',
    isOpen: true,
    introMd: [
      '黒のボディに、黒でロゴをのせた一枚。',
      '光の角度で、ロゴが浮かび上がります。',
      'レッスンでも、そのまま街でも。',
    ].join('\n'),
    pickupNote: '9/15(火)以降、順次お渡しを開始します。',
    thanksNote: '現金（お渡し時）または、事前のカード決済が選べます。',
    sizeChart: defaultSizeChart(),
  };
}

export type PaymentMethod = 'cash' | 'stripe';
export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return v === 'cash' || v === 'stripe';
}

export interface OrderInput {
  name: string;
  size: string;
  qty: number;
  wantsShipping: boolean;
  address?: string;
  phone?: string;
  paymentMethod?: string;
  email?: string;
}

export interface ValidatedOrder {
  name: string;
  size: TshirtSize;
  qty: number;
  wantsShipping: boolean;
  address: string;
  phone: string;
  paymentMethod: PaymentMethod;
  email: string;
}

const MAX_QTY = 20;

// メール形式の判定。入力欄の即時チェック(クライアント)と送信時の検証(サーバ)で共有する。
export function isValidEmail(v: string): boolean {
  const email = (v ?? '').trim().toLowerCase();
  return email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// 検証OKなら ValidatedOrder、NGなら日本語エラー文字列を返す。
export function validateOrderInput(input: OrderInput): ValidatedOrder | string {
  const name = (input?.name ?? '').trim();
  if (!name) return 'お名前を入力してください';
  if (name.length > 50) return 'お名前が長すぎます（50文字以内）';

  const size = input?.size ?? '';
  if (!isTshirtSize(size)) return 'サイズを選んでください';

  const qty = Number(input?.qty);
  if (!Number.isInteger(qty) || qty < 1) return '枚数は1枚以上で入力してください';
  if (qty > MAX_QTY) return `一度に注文できるのは${MAX_QTY}枚までです`;

  // 連絡先。注文確定・支払い完了の通知に使う(必須)。
  const email = (input?.email ?? '').trim().toLowerCase();
  if (!email) return 'メールアドレスを入力してください';
  if (!isValidEmail(email)) return 'メールアドレスの形式が正しくありません';

  // 支払い方法。未指定は現金(従来どおり)。
  const paymentMethod = input?.paymentMethod ?? 'cash';
  if (!isPaymentMethod(paymentMethod)) return 'お支払い方法を選んでください';

  const wantsShipping = input?.wantsShipping === true;
  // 郵送を希望しない注文では住所・電話を一切保持しない(PII最小化)。
  if (!wantsShipping) {
    return { name, size, qty, wantsShipping: false, address: '', phone: '', paymentMethod, email };
  }

  // 郵送は手渡しの機会がなく現金を集金できないため、事前決済(カード)のみ受け付ける
  if (paymentMethod !== 'stripe') {
    return '郵送をご希望の場合は、カード決済（事前のお支払い）のみとなります';
  }

  const address = (input?.address ?? '').trim();
  if (!address) return '郵送先のご住所を入力してください';
  if (address.length > 200) return 'ご住所が長すぎます（200文字以内）';

  const phone = (input?.phone ?? '').trim();
  if (!phone) return 'お電話番号を入力してください';
  const digits = phone.replace(/[-‐－ 　]/g, '');
  if (!/^\d{10,11}$/.test(digits)) return 'お電話番号の形式が正しくありません';

  return { name, size, qty, wantsShipping: true, address, phone, paymentMethod, email };
}

// 合計金額。送料は1注文につき1回だけ加算する(枚数分ではない)。
export function calcOrderTotal(qty: number, wantsShipping: boolean, settings: TshirtSettings): number {
  return settings.unitPrice * qty + (wantsShipping ? settings.shippingFee : 0);
}

// 受付状態。'before'=開始前 / 'open'=受付中 / 'closed'=締切後 / 'suspended'=手動停止。
export type AcceptState = 'before' | 'open' | 'closed' | 'suspended';

// today は JST の 'YYYY-MM-DD'。openAt/closeAt は両端を含む(締切日いっぱいまで受付)。
export function acceptanceState(settings: TshirtSettings, today: string): AcceptState {
  if (!settings.isOpen) return 'suspended';
  if (settings.openAt && today < settings.openAt) return 'before';
  if (settings.closeAt && today > settings.closeAt) return 'closed';
  return 'open';
}

// 発注用のサイズ別合計枚数。注文が無いサイズも 0 で必ず埋める。
export function summarizeBySize(rows: { size: TshirtSize; qty: number }[]): Record<TshirtSize, number> {
  const out = {} as Record<TshirtSize, number>;
  for (const s of TSHIRT_SIZES) out[s] = 0;
  for (const r of rows) out[r.size] = (out[r.size] ?? 0) + r.qty;
  return out;
}

export interface OrderRow {
  id: number;
  name: string;
  size: TshirtSize;
  qty: number;
  wantsShipping: boolean;
  address: string;
  phone: string;
  totalAmount: number;
  createdAt: string;
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

export function buildOrderCsv(rows: OrderRow[]): string {
  const header = ['注文番号', 'お名前', 'サイズ', '枚数', '受け取り方法', '住所', '電話番号', '合計金額', '注文日時'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        String(r.id),
        csvCell(r.name),
        csvCell(r.size),
        String(r.qty),
        r.wantsShipping ? '郵送' : 'レッスンで受け取り',
        csvCell(r.address),
        csvCell(r.phone),
        String(r.totalAmount),
        csvCell(r.createdAt),
      ].join(',')
    );
  }
  return lines.join('\n');
}

export function generateOrderToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// サイズチャート(平置き実寸・cm)
// ============================================================

export interface SizeChartRow {
  size: TshirtSize;
  length: number;   // 身丈
  width: number;    // 身幅
  shoulder: number; // 肩幅
  sleeve: number;   // 袖丈
}

// ボディ=ユナイテッドアスレ 4230-01(6.2oz オープンエンド フェードウォッシュTシャツ)。
// 数値は公式サイズ表そのまま(united-athle.jp/ua/item/423001/ 2026-08-30取得)。
// メーカー表記はXXLだが、注文フォームのサイズ名に合わせ 2XL と表示する(同一サイズ)。
export function defaultSizeChart(): SizeChartRow[] {
  return [
    { size: 'S', length: 65, width: 49, shoulder: 46, sleeve: 22 },
    { size: 'M', length: 68, width: 52, shoulder: 49, sleeve: 23 },
    { size: 'L', length: 71, width: 55, shoulder: 52, sleeve: 24 },
    { size: 'XL', length: 74, width: 58, shoulder: 55, sleeve: 25 },
    { size: '2XL', length: 77, width: 61, shoulder: 58, sleeve: 26 },
  ];
}

// 保存済みJSONを読む。壊れていたら初期値に落とす(公開ページを絶対に壊さない)。
export function parseSizeChart(json: string): SizeChartRow[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return defaultSizeChart();
    const rows = parsed.filter(
      (r): r is SizeChartRow =>
        r != null &&
        isTshirtSize(r.size) &&
        [r.length, r.width, r.shoulder, r.sleeve].every((n) => typeof n === 'number' && n > 0)
    );
    // 5サイズ揃っていない(重複・欠け)場合も初期値に落とす
    if (rows.length !== TSHIRT_SIZES.length) return defaultSizeChart();
    if (new Set(rows.map((r) => r.size)).size !== TSHIRT_SIZES.length) return defaultSizeChart();
    return rows;
  } catch {
    return defaultSizeChart();
  }
}

// ============================================================
// 概算利益
// ============================================================

// 1枚あたりの原価。プリント業者(佐藤氏)のLINE見積もりで確定した実額
// = フェードTシャツ 1,600円/枚(プリント込み)。2026-09-07にTAROが実額を確認。
// ⚠️ 別途「色変え1回 900円」と「送料 1式 1,000円」がかかるが、これは枚数に比例しない
//    ので単価には含めない(発注ロットの固定費として別建てで見る)。
// 発注枚数で変動する可能性は残るので、確定したら呼び出し側で差し替える。
export const DEFAULT_UNIT_COST = 1600;

export interface ProfitRow {
  qty: number;
  totalAmount: number;
  shippingFee: number;
}

export interface ProfitSummary {
  qty: number;        // 総枚数
  revenue: number;    // 商品の売上(送料を除く)
  shipping: number;   // 預かった送料(実費なので利益に含めない)
  cost: number;       // 原価(枚数 × 単価)
  profit: number;     // 概算利益 = revenue - cost
}

// 送料は郵送業者へ払う実費の預かりなので、売上からも利益からも除外する。
// 無料配布は売上0・原価だけかかるので、そのぶん利益が減る(実態どおり)。
export function calcProfitSummary(rows: ProfitRow[], unitCost = DEFAULT_UNIT_COST): ProfitSummary {
  let qty = 0, revenue = 0, shipping = 0;
  for (const r of rows) {
    qty += r.qty;
    shipping += r.shippingFee;
    revenue += r.totalAmount - r.shippingFee;
  }
  const cost = qty * unitCost;
  return { qty, revenue, shipping, cost, profit: revenue - cost };
}

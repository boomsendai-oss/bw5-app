'use server';

// スタッフ専用 Server Actions。/staff/* は proxy(cookie存在チェック)で覆われているが、
// proxyはedgeでDBを見られないため、ここで isAuthorizedServer() による本検証を必ず行う
// (CLAUDE.md 4.5「UIガードをクライアント側だけで書かない」)。
// 注文者の住所・電話を返すのはこのファイル(スタッフ画面)だけ。
import { isAuthorizedServer } from '@/lib/eventAuth';
import { todayJst } from '@/lib/dateJst';
import {
  acceptanceState,
  buildOrderCsv,
  calcProfitSummary,
  DEFAULT_UNIT_COST,
  summarizeBySize,
  TSHIRT_SIZES,
  type ProfitSummary,
  type AcceptState,
  type TshirtSettings,
  type TshirtSize,
} from '@/lib/tshirtOrder';
import {
  deleteOrder,
  listOrders,
  resolveTshirtSettings,
  saveTshirtSettings,
  setOrderFlags,
  type StoredOrder,
} from '@/lib/tshirtOrderDb';

async function requireStaff(): Promise<void> {
  if (!(await isAuthorizedServer())) throw new Error('Unauthorized');
}

export interface StaffOrdersView {
  orders: StoredOrder[];
  settings: TshirtSettings;
  state: AcceptState;
  bySize: Record<TshirtSize, number>;
  totalQty: number;
  totalAmount: number;
  shippingCount: number;
  sizes: readonly TshirtSize[];
  profit: ProfitSummary;
  unitCost: number;
}

export async function getStaffOrders(): Promise<StaffOrdersView> {
  await requireStaff();
  const [orders, settings] = await Promise.all([listOrders(), resolveTshirtSettings()]);
  const bySize = summarizeBySize(orders);
  return {
    orders,
    settings,
    state: acceptanceState(settings, todayJst()),
    bySize,
    totalQty: orders.reduce((n, o) => n + o.qty, 0),
    totalAmount: orders.reduce((n, o) => n + o.totalAmount, 0),
    shippingCount: orders.filter((o) => o.wantsShipping).length,
    sizes: TSHIRT_SIZES,
    // 概算利益。原価は1枚あたりの概算(発注枚数で変動するため確定後に見直す)
    profit: calcProfitSummary(
      orders.map((o) => ({ qty: o.qty, totalAmount: o.totalAmount, shippingFee: o.shippingFee })),
      DEFAULT_UNIT_COST
    ),
    unitCost: DEFAULT_UNIT_COST,
  };
}

export async function markOrder(id: number, flags: { handedOver?: boolean; paid?: boolean }): Promise<void> {
  await requireStaff();
  await setOrderFlags(id, flags);
}

export async function removeOrder(id: number): Promise<void> {
  await requireStaff();
  await deleteOrder(id);
}

// CSVは文字列で返し、ブラウザ側でダウンロードさせる(Excel向けにBOMを付ける)。
export async function exportOrdersCsv(): Promise<string> {
  await requireStaff();
  const orders = await listOrders();
  return buildOrderCsv(
    orders.map((o) => ({
      id: o.id,
      name: o.name,
      size: o.size,
      qty: o.qty,
      wantsShipping: o.wantsShipping,
      address: o.address,
      phone: o.phone,
      totalAmount: o.totalAmount,
      createdAt: o.createdAt,
    }))
  );
}

export async function getTshirtSettings(): Promise<TshirtSettings> {
  await requireStaff();
  return resolveTshirtSettings();
}

export async function putTshirtSettings(s: TshirtSettings): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaff();
  const unitPrice = Number(s.unitPrice);
  const shippingFee = Number(s.shippingFee);
  if (!Number.isInteger(unitPrice) || unitPrice < 0) return { ok: false, error: '価格は0以上の整数で入力してください' };
  if (!Number.isInteger(shippingFee) || shippingFee < 0) return { ok: false, error: '送料は0以上の整数で入力してください' };
  const isDate = (v: string) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!isDate(s.openAt) || !isDate(s.closeAt)) return { ok: false, error: '日付の形式が正しくありません' };
  await saveTshirtSettings({ ...s, unitPrice, shippingFee });
  return { ok: true };
}

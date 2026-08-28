'use server';

// 無人物販kiosk スタッフ専用 Server Actions。/staff/* はproxy(cookie存在チェック)で
// 覆われているが、proxyはedgeでDBを見られないため isAuthorizedServer() による
// 本検証をここで必ず行う(CLAUDE.md 4.5)。
import { isAuthorizedServer } from '@/lib/eventAuth';
import {
  addKioskProduct,
  addKioskVariantCS,
  createKioskSale,
  updateKioskSale,
  deleteKioskVariant,
  getKioskCatalog,
  getKioskSalesReport,
  importBaseProductToSale,
  listKioskSales,
  setActiveKioskSale,
  setKioskProductStock,
  setKioskVariantStock,
  updateKioskProduct,
  voidKioskOrder,
  type KioskProductView,
  type KioskSale,
  type KioskSalesReport,
} from '@/lib/kioskDb';
import { buildKioskOrdersCsv, type KioskCsvRow } from '@/lib/kioskCsv';
import { getAll } from '@/lib/db';
import { fetchItem, fetchItems } from '@/lib/base';
import { mapBaseItemToKioskProduct } from '@/lib/kioskBaseImport';

async function requireStaff(): Promise<void> {
  if (!(await isAuthorizedServer())) throw new Error('Unauthorized');
}

export interface KioskStaffProduct extends KioskProductView {
  sortOrder: number;
}

export interface KioskStaffView {
  sales: Array<KioskSale & { createdAt: string }>;
  selectedSaleId: number | null;
  products: KioskStaffProduct[];
  report: KioskSalesReport | null;
}

export async function getKioskStaffView(saleId?: number): Promise<KioskStaffView> {
  await requireStaff();
  const sales = await listKioskSales();
  const selected = saleId != null ? sales.find((s) => s.id === saleId) : (sales.find((s) => s.active) ?? sales[0]);
  if (!selected) return { sales, selectedSaleId: null, products: [], report: null };
  const [catalog, report, sortRows] = await Promise.all([
    getKioskCatalog(selected.id),
    getKioskSalesReport(selected.id),
    getAll('SELECT id, sort_order FROM kiosk_products WHERE sale_id = ?', [selected.id]),
  ]);
  const sortMap = new Map(sortRows.map((r) => [Number(r.id), Number(r.sort_order)]));
  return {
    sales,
    selectedSaleId: selected.id,
    products: catalog.map((p) => ({ ...p, sortOrder: sortMap.get(p.id) ?? 0 })),
    report,
  };
}

export async function staffCreateSale(name: string, eventDate: string): Promise<number> {
  await requireStaff();
  if (!name.trim()) throw new Error('販売会の名前を入れてください');
  return createKioskSale(name.trim(), eventDate.trim());
}

export async function staffActivateSale(saleId: number): Promise<void> {
  await requireStaff();
  await setActiveKioskSale(saleId);
}

export async function staffAddProduct(
  saleId: number,
  p: { name: string; price: number; stock: number; imageUrl: string; description: string }
): Promise<number> {
  await requireStaff();
  if (!p.name.trim()) throw new Error('商品名を入れてください');
  if (!Number.isInteger(p.price) || p.price <= 0) throw new Error('価格が不正です');
  return addKioskProduct(saleId, { ...p, name: p.name.trim() });
}

export async function staffUpdateProduct(
  id: number,
  p: { name: string; price: number; imageUrl: string; description: string; sortOrder: number; active: boolean }
): Promise<void> {
  await requireStaff();
  if (!p.name.trim()) throw new Error('商品名を入れてください');
  if (!Number.isInteger(p.price) || p.price <= 0) throw new Error('価格が不正です');
  await updateKioskProduct(id, { ...p, name: p.name.trim() });
}

export async function staffSetProductStock(productId: number, stock: number): Promise<void> {
  await requireStaff();
  if (!Number.isInteger(stock) || stock < 0) throw new Error('在庫数が不正です');
  await setKioskProductStock(productId, stock);
}

export async function staffUpdateSale(saleId: number, name: string, eventDate: string): Promise<void> {
  await requireStaff();
  if (!name.trim()) throw new Error('販売会の名前を入れてください');
  await updateKioskSale(saleId, name.trim(), eventDate.trim());
}

export async function staffAddVariant(productId: number, color: string, size: string, stock: number): Promise<number> {
  await requireStaff();
  if (!size.trim()) throw new Error('サイズ名を入れてください');
  return addKioskVariantCS(productId, { color: color.trim(), size: size.trim(), stock: Math.max(0, stock) });
}

export async function staffSetVariantStock(variantId: number, stock: number): Promise<void> {
  await requireStaff();
  if (!Number.isInteger(stock) || stock < 0) throw new Error('在庫数が不正です');
  await setKioskVariantStock(variantId, stock);
}

export async function staffDeleteVariant(variantId: number): Promise<void> {
  await requireStaff();
  await deleteKioskVariant(variantId);
}

export async function staffVoidOrder(orderId: number, reason: string): Promise<boolean> {
  await requireStaff();
  return voidKioskOrder(orderId, reason.trim() || 'スタッフ取消');
}

// ───────────────── BASEネットショップからの取り込み ─────────────────

export interface StaffBaseItem {
  itemId: number;
  name: string;
  price: number;
  stock: number;
  imageUrl: string;
  variationSummary: string;
  alreadyImported: boolean;
}

/** BASEの公開商品一覧(取り込み候補)。BASE未認可時はthrowし、UI側で案内する。 */
export async function staffListBaseItems(saleId: number): Promise<StaffBaseItem[]> {
  await requireStaff();
  const items = await fetchItems({ limit: 50 });
  const importedRows = await getAll('SELECT base_item_id FROM kiosk_products WHERE sale_id = ? AND base_item_id IS NOT NULL', [saleId]);
  const imported = new Set(importedRows.map((r) => Number(r.base_item_id)));
  return items
    .filter((it) => it.visible !== 0)
    .map((it) => {
      const m = mapBaseItemToKioskProduct(it);
      const totalStock = m.variants.length > 0 ? m.variants.reduce((s, v) => s + v.stock, 0) : m.stock;
      return {
        itemId: it.item_id,
        name: m.name,
        price: m.price,
        stock: totalStock,
        imageUrl: m.imageUrl,
        variationSummary: m.variants.map((v) => `${[v.color, v.size].filter(Boolean).join(' ')}:${v.stock}`).join(' / '),
        alreadyImported: imported.has(it.item_id),
      };
    });
}

/** BASE商品1件を販売会へ取り込む(既存なら在庫・価格を上書き)。 */
export async function staffImportBaseItem(saleId: number, itemId: number): Promise<{ created: boolean }> {
  await requireStaff();
  const item = await fetchItem(itemId);
  if (!item) throw new Error('BASEの商品が見つかりません');
  const mapped = mapBaseItemToKioskProduct(item);
  const res = await importBaseProductToSale(saleId, itemId, mapped);
  return { created: res.created };
}

/** 注文明細CSV(クライアント側でBlobダウンロードする)。 */
export async function staffOrdersCsv(saleId: number): Promise<string> {
  await requireStaff();
  const report = await getKioskSalesReport(saleId);
  const rows: KioskCsvRow[] = report.orders.flatMap((o) =>
    o.items.map((it) => ({
      orderId: o.orderId,
      createdAt: o.createdAt,
      paymentMethod: o.paymentMethod,
      status: o.status,
      productName: it.productName,
      variantLabel: it.variantLabel,
      unitPrice: it.unitPrice,
      qty: it.qty,
      lineAmount: it.unitPrice * it.qty,
    }))
  );
  return buildKioskOrdersCsv(rows);
}

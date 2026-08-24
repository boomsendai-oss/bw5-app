// kiosk 注文明細のCSV出力(純関数)。スタッフ画面のダウンロードで使う。

export interface KioskCsvRow {
  orderId: number;
  createdAt: string;
  paymentMethod: string;
  status: string;
  productName: string;
  variantLabel: string;
  unitPrice: number;
  qty: number;
  lineAmount: number;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const METHOD_LABEL: Record<string, string> = { cash: '現金', stripe: 'オンライン' };
const STATUS_LABEL: Record<string, string> = { paid: '支払い済み', pending: '支払い待ち', voided: '取消', expired: '期限切れ' };

export function buildKioskOrdersCsv(rows: KioskCsvRow[]): string {
  const header = ['注文番号', '注文日時', '決済方法', '状態', '商品名', 'サイズ', '単価', '数量', '金額'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        String(r.orderId),
        csvCell(r.createdAt),
        METHOD_LABEL[r.paymentMethod] ?? r.paymentMethod,
        STATUS_LABEL[r.status] ?? r.status,
        csvCell(r.productName),
        csvCell(r.variantLabel),
        String(r.unitPrice),
        String(r.qty),
        String(r.lineAmount),
      ].join(',')
    );
  }
  return lines.join('\n') + '\n';
}

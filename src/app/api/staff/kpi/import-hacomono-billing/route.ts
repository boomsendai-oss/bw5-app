import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, rowsToDicts, parseDate } from '@/lib/csvUtil';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function pick(rec: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (rec[k] !== undefined && rec[k] !== '') return rec[k];
    for (const recKey of Object.keys(rec)) {
      if (recKey.includes(k) && rec[recKey] !== '') return rec[recKey];
    }
  }
  return '';
}
function parseAmt(s: string): number {
  if (!s) return 0;
  const c = s.replace(/[,円¥\s]/g, '').trim();
  const n = parseInt(c, 10);
  return isNaN(n) ? 0 : n;
}

// 商品名から経費カテゴリ推定 (HACOMONO命名規則ベース)
function guessProductCategory(productName: string): string {
  const p = productName.toLowerCase();
  if (/入会金|enrollment|signup/.test(p)) return 'enrollment_fee';
  if (/プラン|plan|月会費|月額|定額|サブスク/.test(p)) return 'plan';
  if (/チケット|ticket|単発|回数券|ドロップイン/.test(p)) return 'ticket';
  return 'other';
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  let csvText = '';
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (file instanceof File) {
      const buf = await file.arrayBuffer();
      csvText = new TextDecoder('utf-8').decode(buf);
      if ((csvText.match(/�/g)?.length ?? 0) > 10) {
        csvText = new TextDecoder('shift-jis').decode(buf);
      }
    }
  } else {
    csvText = await req.text();
  }
  if (!csvText) return NextResponse.json({ error: 'CSV body required' }, { status: 400 });

  const rows = parseCSV(csvText);
  if (rows.length < 2) return NextResponse.json({ error: 'CSV has no data rows' }, { status: 400 });
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const r = rows[i].join('|');
    if (/(課金日|決済日|請求日|billing).*商品|商品.*金額/.test(r)) { headerIdx = i; break; }
  }
  const records = rowsToDicts(rows, headerIdx);

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const rec of records) {
    try {
      const billingDate = parseDate(pick(rec, '課金日', '決済日', '請求日', '購入日', '日付'));
      const amount = parseAmt(pick(rec, '金額', '販売額', '請求金額', 'amount'));
      if (!billingDate || amount === 0) { skipped++; continue; }
      const productName = pick(rec, '商品名', 'プラン名', 'チケット名', '商品', '販売商品');
      const memberId = pick(rec, 'メンバーID', '会員ID', 'メンバー');
      const kaiinNo = pick(rec, '会員番号', '会員No');
      const paymentMethod = pick(rec, '決済方法', '支払方法');
      const status = pick(rec, 'ステータス', '状態');
      const category = guessProductCategory(productName);

      await execute(
        `INSERT INTO hacomono_billing_records
         (billing_date, member_id, kaiin_no, product_name, product_category, amount, payment_method, status, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(billing_date, member_id, product_name, amount) DO UPDATE SET
           product_category=excluded.product_category,
           payment_method=excluded.payment_method,
           status=excluded.status,
           imported_at=CURRENT_TIMESTAMP`,
        [billingDate, memberId || null, kaiinNo || null, productName || null, category, amount, paymentMethod || null, status || null]
      );
      imported++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      skipped++;
    }
  }
  return NextResponse.json({ ok: true, total_rows: records.length, imported, skipped, errors: errors.slice(0, 5) });
}

import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, rowsToDicts, parseDate } from '@/lib/csvUtil';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GMO青空ネット銀行 取引CSV取込
// 想定カラム(GMO標準): 取引日, 摘要, お引出金額, お預入金額, 残高, 振込依頼人 など
function pick(rec: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (rec[k] !== undefined && rec[k] !== '') return rec[k];
    for (const recKey of Object.keys(rec)) {
      if (recKey.includes(k) && rec[recKey] !== '') return rec[recKey];
    }
  }
  return '';
}
function parseAmount(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/[,円¥\s]/g, '').trim();
  if (!cleaned || cleaned === '-') return 0;
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? 0 : n;
}

// 摘要から経費カテゴリを推定
// NFKC正規化(T-167): 銀行明細は「Ｖｅｒｃｅｌ」「ＡＭＡＺＯＮ」等の全角表記が多く、
// 正規化しないとASCIIパターンに一致せず自動推定が効かない。
function guessCategory(desc: string, counterparty: string): string | null {
  const all = `${desc} ${counterparty}`.normalize('NFKC').toLowerCase();
  if (/vercel|turso|claude|anthropic|github|notion|hacomono|lstep|linestep|google.*workspace|wix|cloudflare|openai|figma/i.test(all)) return 'システム費';
  if (/google.*ads|meta|facebook|instagram.*広告|line.*広告|yahoo.*広告|広告/i.test(all)) return '広告費';
  if (/docomo|au|softbank|楽天モバイル|nuro|フレッツ|ocn|biglobe|sakura|aws/i.test(all)) return '通信費';
  if (/amazon|楽天|yodobashi|ヨドバシ|ロフト|無印|ニトリ|ikea/i.test(all)) return '備品';
  if (/^給与|payroll/i.test(all)) return '給与';
  if (/^スタジオ|レンタル|貸し|京スタジオ|ゴート|アクアリーナ|国際村|コナスポ|TS|マイダンス/i.test(all)) return 'スタジオ料';
  return null;
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
  // ヘッダー行を探す (1行目がメタデータの可能性)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const r = rows[i].join('|');
    if (/取引日|日付|year_month|date/.test(r)) { headerIdx = i; break; }
  }
  const records = rowsToDicts(rows, headerIdx);

  // recurring_expenses をロード (摘要マッチ用)
  type Recurring = { id: number; category: string; subcategory: string | null; match_pattern: string | null };
  const recurring = (await getAll(
    `SELECT id, category, subcategory, match_pattern FROM recurring_expenses WHERE active = 1 AND match_pattern IS NOT NULL AND match_pattern != ''`
  )) as Recurring[];

  let imported = 0;
  let skipped = 0;
  let autoConfirmed = 0;
  const errors: string[] = [];

  for (const rec of records) {
    try {
      const txnDate = parseDate(pick(rec, '取引日', '日付', 'date'));
      if (!txnDate) { skipped++; continue; }
      const withdraw = parseAmount(pick(rec, 'お引出金額', '引出金額', '出金'));
      const deposit = parseAmount(pick(rec, 'お預入金額', '預入金額', '入金'));
      const amount = deposit - withdraw;
      if (amount === 0) { skipped++; continue; }
      const description = pick(rec, '摘要', '内容', 'description');
      const counterparty = pick(rec, '振込依頼人', '振込先', 'counterparty');
      const balance = parseAmount(pick(rec, '残高', 'balance'));
      // recurring_expenses の摘要マッチパターン優先 → なければヒューリスティック
      // 全角表記対策でNFKC正規化してから照合する(T-167)
      const all = `${description} ${counterparty}`.normalize('NFKC').toLowerCase();
      let matchedRecurring: Recurring | null = null;
      for (const r of recurring) {
        const pat = (r.match_pattern ?? '').normalize('NFKC').toLowerCase();
        if (pat && all.includes(pat)) { matchedRecurring = r; break; }
      }
      const category = matchedRecurring?.category ?? guessCategory(description, counterparty);
      const subcategory = matchedRecurring?.subcategory ?? null;

      // 銀行明細に登録 (出金 かつ recurring 一致なら confirmed=1)
      const autoConfirm = amount < 0 && matchedRecurring;
      await execute(
        `INSERT INTO bank_transactions (txn_date, amount, description, counterparty, balance_after, expense_category, confirmed, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(txn_date, amount, description) DO UPDATE SET
           counterparty=excluded.counterparty,
           balance_after=excluded.balance_after,
           expense_category=COALESCE(bank_transactions.expense_category, excluded.expense_category)`,
        [txnDate, amount, description || null, counterparty || null, balance || null, category, autoConfirm ? 1 : 0]
      );

      // 自動確定 → expenses にも登録 (重複チェック)
      if (autoConfirm && matchedRecurring) {
        const dup = await getOne(
          `SELECT id FROM expenses WHERE source = 'bank_txn' AND expense_date = ? AND amount = ? AND COALESCE(description, '') = COALESCE(?, '')`,
          [txnDate, Math.abs(amount), description ?? '']
        );
        if (!dup) {
          await execute(
            `INSERT INTO expenses (expense_date, category, subcategory, amount, description, source, source_ref_id)
             VALUES (?, ?, ?, ?, ?, 'bank_txn', ?)`,
            [txnDate, category, subcategory, Math.abs(amount), description ?? null, matchedRecurring.id]
          );
          autoConfirmed++;
        }
      }
      imported++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, total_rows: records.length, imported, skipped, auto_confirmed: autoConfirmed, errors: errors.slice(0, 5) });
}

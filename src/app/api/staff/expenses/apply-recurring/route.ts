import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 給与・スタジオ料は payroll_runs / studio_billing_runs で別管理(T-166)。
// confirm-bank と同値のブロックリスト。歴史的にマスタへ入っていても一括計上しない。
const BLOCKED_CATEGORIES = ['給与', '人件費', 'スタジオ料', 'スタジオ使用料', 'スタジオ代'];

// POST /api/staff/expenses/apply-recurring
// body: { year_month: 'YYYY-MM', dry_run?: boolean }
//
// recurring_expenses から該当月の expense を一括計上 (重複防止: same category+subcategory+expense_date は既存スキップ)
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const ym = body.year_month;
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return NextResponse.json({ error: 'year_month required' }, { status: 400 });
  const expenseDate = `${ym}-01`;
  const dry = body.dry_run === true;

  type Rec = { id: number; category: string; subcategory: string | null; amount: number; description: string | null };
  const recurring = (await getAll(`SELECT id, category, subcategory, amount, description FROM recurring_expenses WHERE active = 1`)) as Rec[];

  let inserted = 0;
  const items: Array<{ category: string; subcategory: string | null; amount: number; skipped: boolean; reason?: string }> = [];

  for (const r of recurring) {
    // 二重計上ブロック (INSERT前にチェックしskip扱い)
    if (BLOCKED_CATEGORIES.includes(r.category)) {
      items.push({ category: r.category, subcategory: r.subcategory, amount: r.amount, skipped: true, reason: 'blocked_category' });
      continue;
    }
    // 重複チェック
    const dup = await getAll(
      `SELECT id FROM expenses WHERE expense_date = ? AND category = ? AND COALESCE(subcategory, '') = COALESCE(?, '') AND source = 'recurring'`,
      [expenseDate, r.category, r.subcategory ?? '']
    );
    if (dup.length > 0) {
      items.push({ category: r.category, subcategory: r.subcategory, amount: r.amount, skipped: true, reason: 'already_inserted' });
      continue;
    }
    if (!dry) {
      await execute(
        `INSERT INTO expenses (expense_date, category, subcategory, amount, description, source, source_ref_id, is_recurring)
         VALUES (?, ?, ?, ?, ?, 'recurring', ?, 1)`,
        [expenseDate, r.category, r.subcategory ?? null, r.amount, r.description ?? null, r.id]
      );
    }
    inserted++;
    items.push({ category: r.category, subcategory: r.subcategory, amount: r.amount, skipped: false });
  }

  return NextResponse.json({ ok: true, year_month: ym, inserted, items, dry_run: dry });
}

// GET: 一覧
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const rows = await getAll(`SELECT * FROM recurring_expenses ORDER BY category, subcategory`);
  return NextResponse.json({ recurring: rows });
}

import { NextRequest, NextResponse } from 'next/server';
import { getAll, execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

// 月初に正規化 (YYYY-MM-01)
function normalizeDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = /^(\d{4})-(\d{2})/.exec(input);
  if (!m) return null;
  return `${m[1]}-${m[2]}-01`;
}

// GET /api/staff/kpi/snapshots — 月降順
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const snapshots = await getAll(
    'SELECT * FROM kpi_snapshots ORDER BY snapshot_date DESC'
  );
  return NextResponse.json({ snapshots });
}

// POST /api/staff/kpi/snapshots — 新規月次追加
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  try {
    const body = await req.json();
    const snapshot_date = normalizeDate(body?.snapshot_date);
    if (!snapshot_date) {
      return NextResponse.json({ error: 'snapshot_date (YYYY-MM) is required' }, { status: 400 });
    }
    const existing = await getOne(
      'SELECT id FROM kpi_snapshots WHERE snapshot_date = ?',
      [snapshot_date]
    );
    if (existing) {
      return NextResponse.json({ error: 'この月のデータは既に存在します' }, { status: 409 });
    }
    const toInt = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : 0;
    };
    const result = await execute(
      `INSERT INTO kpi_snapshots (
        snapshot_date, line_friends,
        hacomono_members_active, hacomono_members_retired,
        monthly_revenue, monthly_expense, monthly_profit,
        trial_count, new_signup_count, retention_count, churn_count, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot_date,
        toInt(body.line_friends),
        toInt(body.hacomono_members_active),
        toInt(body.hacomono_members_retired),
        toInt(body.monthly_revenue),
        toInt(body.monthly_expense),
        toInt(body.monthly_profit),
        toInt(body.trial_count),
        toInt(body.new_signup_count),
        toInt(body.retention_count),
        toInt(body.churn_count),
        typeof body.notes === 'string' ? body.notes : '',
      ]
    );
    const id = Number(result.lastInsertRowid);
    const created = await getOne('SELECT * FROM kpi_snapshots WHERE id = ?', [id]);
    return NextResponse.json({ snapshot: created }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create snapshot' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

const ALLOWED_FIELDS = [
  'line_friends',
  'hacomono_members_active',
  'hacomono_members_retired',
  'monthly_revenue',
  'monthly_expense',
  'monthly_profit',
  'trial_count',
  'new_signup_count',
  'retention_count',
  'churn_count',
  'notes',
] as const;

// PATCH /api/staff/kpi/snapshots/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await params;
  try {
    const body = await req.json();
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const field of ALLOWED_FIELDS) {
      if (field in body) {
        sets.push(`${field} = ?`);
        if (field === 'notes') {
          args.push(typeof body[field] === 'string' ? body[field] : '');
        } else {
          const n = Number(body[field]);
          args.push(Number.isFinite(n) ? Math.trunc(n) : 0);
        }
      }
    }
    if (sets.length === 0) {
      return NextResponse.json({ error: 'no updatable fields' }, { status: 400 });
    }
    sets.push("updated_at = datetime('now', 'localtime')");
    args.push(id);
    await execute(
      `UPDATE kpi_snapshots SET ${sets.join(', ')} WHERE id = ?`,
      args
    );
    const snapshot = await getOne('SELECT * FROM kpi_snapshots WHERE id = ?', [id]);
    if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ snapshot });
  } catch {
    return NextResponse.json({ error: 'Failed to update snapshot' }, { status: 500 });
  }
}

// DELETE
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await params;
  await execute('DELETE FROM kpi_snapshots WHERE id = ?', [id]);
  return NextResponse.json({ success: true });
}

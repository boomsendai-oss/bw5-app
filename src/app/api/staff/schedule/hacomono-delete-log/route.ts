import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { execute, getAll } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// HACOMONO で枠を削除した実績を記録/取消する。
// これにより 調整リスト(hacomono-tasks) は処理済みを除外でき、二重処理を防ぐ。

// GET ?month=YYYY-MM → その月のログ一覧
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const month = new URL(req.url).searchParams.get('month') ?? '';
  const rows = await getAll(
    `SELECT * FROM hacomono_delete_log ${/^\d{4}-\d{2}$/.test(month) ? 'WHERE instance_date LIKE ?' : ''} ORDER BY instance_date`,
    /^\d{4}-\d{2}$/.test(month) ? [`${month}%`] : []
  );
  return NextResponse.json({ rows });
}

// POST { items: [{date, start_time, class_name, pg_code?, action?, note?}] }
//   action: 'deleted' (既定) / 'skipped_reserved' (予約ありで削除しなかった)
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: 'items required' }, { status: 400 });

  let recorded = 0;
  for (const it of items) {
    if (!it.date) continue;
    await execute(
      `INSERT INTO hacomono_delete_log (instance_date, start_time, class_name, pg_code, action, note)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(instance_date, start_time, class_name)
       DO UPDATE SET action = excluded.action, note = excluded.note, created_at = CURRENT_TIMESTAMP`,
      [
        it.date,
        (it.start_time ?? '').slice(0, 5),
        it.class_name ?? null,
        it.pg_code ?? null,
        it.action === 'skipped_reserved' ? 'skipped_reserved' : 'deleted',
        it.note ?? null,
      ]
    );
    recorded++;
  }
  return NextResponse.json({ ok: true, recorded });
}

// DELETE ?date=&start_time=&class_name=  → 1件の記録を取消(誤記録のundo)
export async function DELETE(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const sp = new URL(req.url).searchParams;
  const date = sp.get('date');
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });
  await execute(
    `DELETE FROM hacomono_delete_log WHERE instance_date = ? AND start_time = ? AND class_name = ?`,
    [date, (sp.get('start_time') ?? '').slice(0, 5), sp.get('class_name') ?? null]
  );
  return NextResponse.json({ ok: true });
}

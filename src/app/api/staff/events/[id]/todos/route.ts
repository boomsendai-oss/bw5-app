import { NextRequest, NextResponse } from 'next/server';
import { getAll, execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

// GET /api/staff/events/[id]/todos
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await params;
  const rows = await getAll(
    `SELECT * FROM event_todos
     WHERE event_id = ?
     ORDER BY
       CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
       CASE priority WHEN '高' THEN 0 WHEN '中' THEN 1 WHEN '低' THEN 2 ELSE 3 END,
       id ASC`,
    [id]
  );
  return NextResponse.json({ todos: rows });
}

// POST /api/staff/events/[id]/todos — 追加
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await params;
  try {
    const body = await req.json();
    const { category, fact, cause, action, assignee, priority, due_period, status } = body ?? {};
    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }
    const result = await execute(
      `INSERT INTO event_todos
        (event_id, category, fact, cause, action, assignee, priority, due_period, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        category ?? null,
        fact ?? null,
        cause ?? null,
        action,
        assignee ?? null,
        priority ?? null,
        due_period ?? null,
        status ?? 'open',
      ]
    );
    const newId = Number(result.lastInsertRowid);
    const todo = await getOne('SELECT * FROM event_todos WHERE id = ?', [newId]);
    return NextResponse.json({ todo }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create todo' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

const ALLOWED_FIELDS = [
  'category',
  'fact',
  'cause',
  'action',
  'assignee',
  'priority',
  'due_period',
  'status',
] as const;

// PATCH /api/staff/events/[id]/todos/[todoId] — 部分更新
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; todoId: string }> }
) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id, todoId } = await params;

  try {
    const body = await req.json();
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const field of ALLOWED_FIELDS) {
      if (field in body) {
        sets.push(`${field} = ?`);
        args.push(body[field]);
      }
    }
    if (sets.length === 0) {
      return NextResponse.json({ error: 'no updatable fields' }, { status: 400 });
    }
    args.push(todoId, id);
    await execute(
      `UPDATE event_todos SET ${sets.join(', ')} WHERE id = ? AND event_id = ?`,
      args
    );
    const todo = await getOne(
      'SELECT * FROM event_todos WHERE id = ? AND event_id = ?',
      [todoId, id]
    );
    if (!todo) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ todo });
  } catch {
    return NextResponse.json({ error: 'Failed to update todo' }, { status: 500 });
  }
}

// DELETE
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; todoId: string }> }
) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id, todoId } = await params;
  await execute('DELETE FROM event_todos WHERE id = ? AND event_id = ?', [todoId, id]);
  return NextResponse.json({ success: true });
}

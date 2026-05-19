import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/staff/master/lessons/bulk-update
// body: { updates: [{ id, start_time?, end_time?, duration_minutes?, active?, notes? }] }
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.updates)) return NextResponse.json({ error: 'updates array required' }, { status: 400 });
  const fields = ['default_start_time', 'default_end_time', 'duration_minutes', 'active', 'notes'];
  let updated = 0;
  for (const u of body.updates) {
    if (!u.id) continue;
    const sets: string[] = [];
    const args: (string | number | null)[] = [];
    if (u.start_time !== undefined) { sets.push('default_start_time = ?'); args.push(u.start_time); }
    if (u.end_time !== undefined) { sets.push('default_end_time = ?'); args.push(u.end_time); }
    if (u.duration_minutes !== undefined) { sets.push('duration_minutes = ?'); args.push(u.duration_minutes); }
    if (u.active !== undefined) { sets.push('active = ?'); args.push(u.active); }
    if (u.notes !== undefined) { sets.push('notes = ?'); args.push(u.notes); }
    if (sets.length === 0) continue;
    sets.push('updated_at = CURRENT_TIMESTAMP');
    args.push(Number(u.id));
    await execute(`UPDATE lesson_master SET ${sets.join(', ')} WHERE id = ?`, args);
    updated++;
    // unused fields list to satisfy lint
    void fields;
  }
  return NextResponse.json({ ok: true, updated });
}

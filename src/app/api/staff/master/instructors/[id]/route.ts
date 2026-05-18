import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const row = await getOne(`SELECT * FROM instructors WHERE id = ?`, [Number(id)]);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ instructor: row });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const allowed = ['name','name_kana','contact_email','contact_phone','instagram_handle','profile_text','profile_photo_url','shared_folder_url','bank_name','bank_branch','bank_account_type','bank_account_number','bank_account_holder','notes','active'];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) if (k in body) { sets.push(`${k} = ?`); vals.push(body[k]); }
  if (sets.length === 0) return NextResponse.json({ error: 'no fields' }, { status: 400 });
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  vals.push(Number(id));
  await execute(`UPDATE instructors SET ${sets.join(', ')} WHERE id = ?`, vals);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  await execute(`DELETE FROM instructors WHERE id = ?`, [Number(id)]);
  return NextResponse.json({ ok: true });
}

// 単価 (instructor_rates) 一括更新 - POST /<id>/rates
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  // body: { rates: [{duration_minutes, rate}], transit_fees: [{studio_id, amount}] }
  const instructorId = Number(id);
  if (Array.isArray(body.rates)) {
    await execute(`DELETE FROM instructor_rates WHERE instructor_id = ?`, [instructorId]);
    for (const r of body.rates) {
      if (r.duration_minutes && r.rate !== undefined) {
        await execute(
          `INSERT INTO instructor_rates (instructor_id, duration_minutes, rate) VALUES (?, ?, ?)`,
          [instructorId, Number(r.duration_minutes), Number(r.rate)]
        );
      }
    }
  }
  if (Array.isArray(body.transit_fees)) {
    await execute(`DELETE FROM instructor_transit_fees WHERE instructor_id = ?`, [instructorId]);
    for (const t of body.transit_fees) {
      if (t.studio_id && t.amount !== undefined) {
        await execute(
          `INSERT INTO instructor_transit_fees (instructor_id, studio_id, amount) VALUES (?, ?, ?)`,
          [instructorId, Number(t.studio_id), Number(t.amount)]
        );
      }
    }
  }
  return NextResponse.json({ ok: true });
}

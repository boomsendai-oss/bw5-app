import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne, batch } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import type { InStatement } from '@libsql/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** パスのidを正の整数として検証。不正なら null (呼び出し側で400) */
function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const row = await getOne(`SELECT * FROM instructors WHERE id = ?`, [numId]);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ instructor: row });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const allowed = ['name','name_kana','contact_email','contact_phone','instagram_handle','profile_text','profile_photo_url','shared_folder_url','bank_name','bank_branch','bank_account_type','bank_account_number','bank_account_holder','notes','active','salary_type','monthly_fixed_amount','slug','genre','crews','career_text','public_display_order','video_url'];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) if (k in body) { sets.push(`${k} = ?`); vals.push(body[k]); }
  if (sets.length === 0) return NextResponse.json({ error: 'no fields' }, { status: 400 });
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  vals.push(numId);
  await execute(`UPDATE instructors SET ${sets.join(', ')} WHERE id = ?`, vals);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  await execute(`DELETE FROM instructors WHERE id = ?`, [numId]);
  return NextResponse.json({ ok: true });
}

// 単価 (instructor_rates) 一括更新 - POST /<id>/rates
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const instructorId = parseId(id);
  if (instructorId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  // body: { rates: [{duration_minutes, rate}], transit_fees: [{studio_id, amount}] }
  // A-5: 事前に全行を検証してから DELETE+INSERT を単一batchで原子化する。
  //   旧実装は DELETE→逐次INSERTが非トランザクションで、途中失敗すると単価が
  //   消えて resolveRate が¥0にフォールバック→¥0給与→無警告で振込、の経路があった。
  const stmts: InStatement[] = [];
  if (Array.isArray(body.rates)) {
    const rows: { dur: number; rate: number }[] = [];
    for (const r of body.rates) {
      const dur = Number(r.duration_minutes);
      const rate = Number(r.rate);
      if (!Number.isFinite(dur) || dur <= 0 || !Number.isFinite(rate) || rate < 0) {
        return NextResponse.json({ error: `不正な単価行があります (duration_minutes>0, rate>=0)` }, { status: 400 });
      }
      rows.push({ dur, rate });
    }
    stmts.push({ sql: `DELETE FROM instructor_rates WHERE instructor_id = ?`, args: [instructorId] });
    for (const r of rows) {
      stmts.push({ sql: `INSERT INTO instructor_rates (instructor_id, duration_minutes, rate) VALUES (?, ?, ?)`, args: [instructorId, r.dur, r.rate] });
    }
  }
  if (Array.isArray(body.transit_fees)) {
    const rows: { studioId: number; amount: number }[] = [];
    for (const t of body.transit_fees) {
      const studioId = Number(t.studio_id);
      const amount = Number(t.amount);
      if (!Number.isFinite(studioId) || studioId <= 0 || !Number.isFinite(amount) || amount < 0) {
        return NextResponse.json({ error: `不正な交通費行があります (studio_id>0, amount>=0)` }, { status: 400 });
      }
      rows.push({ studioId, amount });
    }
    stmts.push({ sql: `DELETE FROM instructor_transit_fees WHERE instructor_id = ?`, args: [instructorId] });
    for (const r of rows) {
      stmts.push({ sql: `INSERT INTO instructor_transit_fees (instructor_id, studio_id, amount) VALUES (?, ?, ?)`, args: [instructorId, r.studioId, r.amount] });
    }
  }
  if (stmts.length > 0) await batch(stmts, 'write');
  return NextResponse.json({ ok: true });
}

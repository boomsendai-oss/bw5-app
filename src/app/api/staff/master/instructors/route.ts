import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/master/instructors
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const instructors = await getAll(`SELECT * FROM instructors ORDER BY active DESC, name ASC`);
  const rates = await getAll(`SELECT * FROM instructor_rates ORDER BY instructor_id, duration_minutes`);
  const fees = await getAll(`SELECT * FROM instructor_transit_fees ORDER BY instructor_id, studio_id`);
  return NextResponse.json({ instructors, rates, transit_fees: fees });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const cols = ['name','name_kana','contact_email','contact_phone','instagram_handle','profile_text','profile_photo_url','shared_folder_url','bank_name','bank_branch','bank_account_type','bank_account_number','bank_account_holder','notes'];
  const vals = cols.map(k => body[k] ?? null);
  const result = await execute(
    `INSERT INTO instructors (${cols.join(', ')}) VALUES (${cols.map(()=>'?').join(', ')})`,
    vals
  );
  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}

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
  // 写真枚数 (instructor_photos) を一緒に返す
  const photoCounts = await getAll(`SELECT instructor_id, COUNT(*) as count FROM instructor_photos WHERE is_active = 1 GROUP BY instructor_id`);
  return NextResponse.json({ instructors, rates, transit_fees: fees, photo_counts: photoCounts });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const cols = ['name','name_kana','contact_email','contact_phone','instagram_handle','profile_text','profile_photo_url','shared_folder_url','bank_name','bank_branch','bank_account_type','bank_account_number','bank_account_holder','notes','slug','genre','crews','career_text','public_display_order'];
  const vals = cols.map(k => body[k] ?? null);
  const result = await execute(
    `INSERT INTO instructors (${cols.join(', ')}) VALUES (${cols.map(()=>'?').join(', ')})`,
    vals
  );
  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}

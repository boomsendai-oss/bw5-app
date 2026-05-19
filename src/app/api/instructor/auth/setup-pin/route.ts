import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getInstructorBySession, hashPin } from '@/lib/instructorAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/instructor/auth/setup-pin
// body: { pin: '1234', contact_email?, contact_phone? }
export async function POST(req: NextRequest) {
  const me = await getInstructorBySession(req);
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const pin = String(body.pin ?? '');
  if (!/^\d{4,6}$/.test(pin)) return NextResponse.json({ error: 'PIN は4〜6桁の数字' }, { status: 400 });
  const hash = hashPin(pin);
  const updates: string[] = ['pin_hash = ?', 'pin_set_at = CURRENT_TIMESTAMP'];
  const args: (string | null | number)[] = [hash];
  if (body.contact_email) { updates.push('contact_email = ?'); args.push(String(body.contact_email)); }
  if (body.contact_phone) { updates.push('contact_phone = ?'); args.push(String(body.contact_phone)); }
  updates.push('updated_at = CURRENT_TIMESTAMP');
  args.push(me.id);
  await execute(`UPDATE instructors SET ${updates.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}

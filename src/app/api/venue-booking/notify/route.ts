import { NextRequest, NextResponse } from 'next/server';
import { notifyVenueBooking, type VenueNotifyInput } from '@/lib/venueBookingNotify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.VENUE_NOTIFY_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: VenueNotifyInput;
  try {
    body = (await req.json()) as VenueNotifyInput;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body?.date || !body?.subject || !body?.body) {
    return NextResponse.json({ error: 'date, subject, body は必須' }, { status: 400 });
  }
  try {
    const result = await notifyVenueBooking(body);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

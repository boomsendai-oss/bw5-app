import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getAdLineClickTimeline } from '@/lib/ga4';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// GET /api/staff/insights/ad-line-clicks?start=YYYY-MM-DD&end=YYYY-MM-DD[&all=1]
//   広告(google/cpc)経由の line_click を分単位で返す。
//   Lステップの友だち追加日時と突き合わせて「広告経由の体験申込/入会」を推定するための素材
//   (docs/decisions/2026-10-02_google-ads-review.md §計測)。all=1 で全チャネル。
//   認証は他のinsights APIと同じ(staffセッションcookie または x-admin-password)。
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const sp = new URL(req.url).searchParams;
  const start = sp.get('start');
  const end = sp.get('end');
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ ok: false, error: 'start/end は YYYY-MM-DD で指定' }, { status: 400 });
  }
  const r = await getAdLineClickTimeline(start, end, { allChannels: sp.get('all') === '1' });
  return NextResponse.json({ ok: r.available, error: r.error, start, end, rows: r.rows, total: r.rows.reduce((s, x) => s + x.count, 0) });
}

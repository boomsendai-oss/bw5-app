import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getChannelFunnel } from '@/lib/ga4';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// GET /api/staff/insights/traffic-channels?start=YYYY-MM-DD&end=YYYY-MM-DD
//   GA4の流入チャネル別ファネル(セッション/エンゲージ率/平均滞在/LINEクリック)。
//   用途: ディスプレイ広告など各チャネルが「人を運ぶだけ」か「行動まで運ぶ」かを判定する(2026-09-03)。
//   既定期間: 新HPにGA4タグが入った 2026-08-24 〜 昨日。
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const sp = new URL(req.url).searchParams;
  const start = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('start') ?? '') ? sp.get('start')! : '2026-08-24';
  const end = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('end') ?? '') ? sp.get('end')! : 'yesterday';
  const data = await getChannelFunnel(start, end);
  return NextResponse.json(data, { status: data.available ? 200 : 502 });
}

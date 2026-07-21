import { NextRequest, NextResponse } from 'next/server';
import { configured } from '@/lib/instagram';
import { buildReelScorecard, formatScorecardText } from '@/lib/reelScorecard';
import { notifyTaro } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/insights-monthly
// 月1回(月初)、リール成績サマリーをTAROへメール。「画面を見に行かないと分からない」を解消する。
// media_insights(collect-insightsが毎日貯める)から集計。データが無ければ静かにスキップ。
// 認証: Bearer CRON_SECRET または x-cron-secret(GH Actions)。
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const bearerOk = req.headers.get('authorization') === `Bearer ${secret}`;
  const xcronOk = req.headers.get('x-cron-secret') === secret;
  if (!bearerOk && !xcronOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!configured()) {
    return NextResponse.json({ ok: true, configured: false });
  }

  const sc = await buildReelScorecard();
  if (sc.count === 0) {
    // データがまだ無い月は送らない(ノイズ回避)
    return NextResponse.json({ ok: true, sent: false, note: 'リール成績データなし' });
  }

  let sent = false;
  try {
    await notifyTaro({
      subjectPrefix: '[BOOM SNS]',
      subject: `リール月次サマリー（${sc.count}本）`,
      body: formatScorecardText(sc),
    });
    sent = true;
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sent, count: sc.count, reachMedian: sc.reachMedian });
}

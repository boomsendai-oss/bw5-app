import { NextRequest, NextResponse } from 'next/server';
import { getOne, execute } from '@/lib/db';
import { todayJst } from '@/lib/dateJst';
import { configured } from '@/lib/instagram';
import { buildReelScorecard, formatScorecardText } from '@/lib/reelScorecard';
import { notifyTaro } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/reel-decision-reminder
// 2026-08-25 以降に一度だけ発火し、リールの成績サマリー付きで
// 「YouTube Shorts / TikTok へ拡大するかの判断タイミングです」をTAROへ通知する。
// フェーズ2判断(発表会リール制作フロー_v1.md)を"見忘れ"にしないための保険。
// settings に送信済みフラグを1回だけ立てて重複送信を防ぐ。GH cronが毎朝叩いてよい。
const DECISION_DATE = '2026-08-25';
const SENT_KEY = 'reel_decision_reminder_sent';

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

  const today = todayJst();
  if (today < DECISION_DATE) {
    return NextResponse.json({ ok: true, sent: false, note: `判断日(${DECISION_DATE})前` });
  }

  // 送信済みなら二度と送らない
  const already = await getOne('SELECT value FROM settings WHERE key = ?', [SENT_KEY]).catch(() => null);
  if (already?.value) {
    return NextResponse.json({ ok: true, sent: false, note: '送信済み' });
  }

  if (!configured()) {
    return NextResponse.json({ ok: true, configured: false });
  }

  const sc = await buildReelScorecard();
  const body = [
    'リールを一定期間運用してきました。YouTube Shorts / TikTok へ拡大するかの判断タイミングです。',
    '',
    formatScorecardText(sc),
    '',
    '【判断の目安】',
    '・リーチ中央値が伸びていて保存率も高い → 拡大の価値あり。まず YouTube Shorts(無料・SEO資産)から。TikTokは審査が重いのでデータが強ければ。',
    '・リーチが伸び悩み → プラットフォームを増やすより、素材(冒頭2秒/クラス選び)の改善が先。',
    '※入会はローカル/LINE/紹介も絡むため、リール単体の数字は"認知の広さ"の参考値。',
  ].join('\n');

  try {
    await notifyTaro({ subjectPrefix: '[BOOM SNS]', subject: 'リール拡大の判断タイミングです', body });
    await execute(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [SENT_KEY, today]
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sent: true, count: sc.count });
}

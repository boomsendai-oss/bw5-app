import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import { execute } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/cron/shift-sync-report
//
// Lステップのシフト自動同期(boom-events-hub の GitHub Actions)の実行結果を
// TARO へメールで届けるだけのエンドポイント。
//
// 宛先は固定・件名も固定接頭辞。任意の宛先へ任意のメールを送れる口にはしない。
// 認証は既存のcronルートと同じ(REPORT_SECRET / CRON_SECRET)。
//
// 同期が成功したら notify の有無にかかわらず必ず呼ばれ、最終成功時刻を記録する。
// メールは notify=true のときだけ送る。「何も来ない＝正常」にしたうえで、
// 止まったことは story-watchdog 側のデッドマンスイッチが鳴らす。
const TARO_EMAIL = 'boom.sendai@gmail.com';
const SUBJECT_PREFIX = '[BOOM] Lステップ シフト同期';
const MAX_BODY = 20_000;
const LAST_OK_KEY = 'lstep_shift_sync_last_ok';

function authorized(req: NextRequest): boolean {
  const secrets = [process.env.REPORT_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (secrets.length === 0) return false;
  const bearer = req.headers.get('authorization');
  const header = req.headers.get('x-cron-secret');
  return secrets.some((s) => bearer === `Bearer ${s}` || header === s);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let payload: { summary?: unknown; body?: unknown; notify?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSONが読めません' }, { status: 400 });
  }
  const summary = typeof payload.summary === 'string' ? payload.summary.slice(0, 120) : '';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, MAX_BODY) : '';
  if (!body) return NextResponse.json({ ok: false, error: 'body が空です' }, { status: 400 });
  // 省略時は従来どおり送る(呼び出し側を壊さない)
  const notify = payload.notify !== false;

  // 心拍の記録。メールを送らない日でもここは必ず通る。
  // 記録に失敗してもレポート送信は続ける(見張りが鳴るだけで済む)。
  try {
    await execute(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [LAST_OK_KEY, new Date().toISOString()],
    );
  } catch (e) {
    console.warn(`シフト同期の最終成功時刻を記録できませんでした: ${e instanceof Error ? e.message : e}`);
  }

  // ?dry=1 で送信せず本文だけ返す(疎通確認用)
  const subject = summary ? `${SUBJECT_PREFIX} — ${summary}` : SUBJECT_PREFIX;
  if (req.nextUrl.searchParams.get('dry') === '1') {
    return NextResponse.json({ ok: true, dry: true, to: TARO_EMAIL, subject, body });
  }
  if (!notify) return NextResponse.json({ ok: true, notified: false, recorded: true });
  await sendEmail({ to: TARO_EMAIL, subject, text: body });
  return NextResponse.json({ ok: true, to: TARO_EMAIL, subject });
}

import { NextRequest, NextResponse } from 'next/server';
import { syncLessons, ensureLessonCalendar, isConnected, restoreBf7WsCalendarUrl } from '@/lib/googleCalendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/sync-lesson-calendar
// Vercel Cron から1時間ごとに呼ばれ、アプリのレッスン予定を公開Googleカレンダーへ差分同期する。
// 手動同期 (/api/staff/schedule/sync-lesson-calendar) と同じ処理を、管理パスワード無しで
// Cron専用に実行する。認証は CRON_SECRET (Vercelが Authorization: Bearer で送る) で行う。
export async function GET(req: NextRequest) {
  // フェイルクローズ (T-168): CRON_SECRET未設定なら実行拒否、Bearer不一致は401。
  // VercelのcronはCRON_SECRET環境変数を自動でBearerとして送ってくる
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // 未連携なら静かにスキップ (cronがエラーで埋まらないように)
    if (!(await isConnected())) {
      return NextResponse.json({ ok: false, skipped: 'google-not-connected' });
    }
    await ensureLessonCalendar();
    const result = await syncLessons(3);
    // BF7 HIRO WS の申込URLを、告知(11/17 20:00)のあとに公開カレンダーへ戻す(1回限り・失敗しても同期は止めない)
    let bf7WsUrl = '';
    try {
      bf7WsUrl = await restoreBf7WsCalendarUrl();
    } catch (e) {
      console.error('[sync-lesson-calendar] bf7 ws url restore failed', e instanceof Error ? e.message : e);
    }
    return NextResponse.json({ ok: true, ...result, bf7WsUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `cron lesson sync failed: ${msg}` }, { status: 500 });
  }
}

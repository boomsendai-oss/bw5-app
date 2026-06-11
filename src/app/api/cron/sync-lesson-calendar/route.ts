import { NextRequest, NextResponse } from 'next/server';
import { syncLessons, ensureLessonCalendar, isConnected } from '@/lib/googleCalendar';

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
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `cron lesson sync failed: ${msg}` }, { status: 500 });
  }
}

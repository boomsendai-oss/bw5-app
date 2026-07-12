import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { faqLogDb } from '@/lib/faqLogDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// WS O: FAQボットの匿名会話ログ集計(読み取り専用)。
// ログはボット専用DB(FAQBOT_LOG_DB_*)にあり、会員DB(bw5)とは別系のまま。ここは読むだけで書かない。
// created_atはUTC保存のため、表示・日別集計はJST(+9時間)へ補正する。

// periodはこの表引きでしかSQLに入らない(自由文字列を式に混ぜない)
const PERIODS: Record<string, string | null> = {
  '7': "-7 days",
  '30': "-30 days",
  all: null,
};

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const db = faqLogDb();
  if (!db) {
    return NextResponse.json({ error: 'FAQBOT_LOG_DB_URLが未設定です' }, { status: 503 });
  }
  const periodKey = req.nextUrl.searchParams.get('period') ?? '30';
  const mod = PERIODS[periodKey] ?? PERIODS['30'];
  const where = mod ? `AND created_at >= datetime('now', '${mod}')` : '';
  try {
    const [byCategory, byDay, recent, totals] = await Promise.all([
      db.execute(
        `SELECT COALESCE(category, '未分類') AS category, COUNT(*) AS n
         FROM chat_logs WHERE role = 'assistant' ${where}
         GROUP BY 1 ORDER BY n DESC`
      ),
      db.execute(
        `SELECT substr(datetime(created_at, '+9 hours'), 1, 10) AS day, COUNT(*) AS n
         FROM chat_logs WHERE role = 'user' ${where}
         GROUP BY 1 ORDER BY 1 DESC LIMIT 31`
      ),
      db.execute(
        `SELECT substr(datetime(created_at, '+9 hours'), 1, 16) AS at, content
         FROM chat_logs WHERE role = 'user' ${where}
         ORDER BY id DESC LIMIT 50`
      ),
      db.execute(
        `SELECT COUNT(*) AS questions, COUNT(DISTINCT session_id) AS sessions
         FROM chat_logs WHERE role = 'user' ${where}`
      ),
    ]);
    return NextResponse.json({
      byCategory: byCategory.rows,
      byDay: byDay.rows,
      recent: recent.rows,
      totals: totals.rows[0] ?? { questions: 0, sessions: 0 },
    });
  } catch (e) {
    console.error('[faq/stats] ログDB照会失敗:', e);
    return NextResponse.json({ error: 'ログDBに接続できませんでした' }, { status: 502 });
  }
}

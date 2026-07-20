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
  // audience: real=実ユーザーのみ(既定) / test=Claudeの品質テストのみ / all=両方。
  // is_test は「sessionIdがUUID形式でない=テストスクリプト投入」で自動判定してボット側が保存する。
  // 自由文字列をSQLに混ぜないよう、この表引きでしか式に入れない。
  const AUDIENCES: Record<string, string> = { real: 'AND is_test = 0', test: 'AND is_test = 1', all: '' };
  const audKey = req.nextUrl.searchParams.get('audience') ?? 'real';
  const aud = AUDIENCES[audKey] ?? AUDIENCES.real;
  const where = `${mod ? `AND created_at >= datetime('now', '${mod}')` : ''} ${aud}`;
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
      // 質問と「その質問への回答」をセットで返す。
      // 回答は同一セッション内で当該質問より後の最初のassistant行(=直接の返答)を相関サブクエリで引く。
      // 分類(category)もassistant行に付くのでここで一緒に拾う(質問単位で分類が見える)。
      db.execute(
        `SELECT substr(datetime(u.created_at, '+9 hours'), 1, 16) AS at,
                u.content AS content,
                (SELECT a.content  FROM chat_logs a
                  WHERE a.session_id = u.session_id AND a.role = 'assistant' AND a.id > u.id
                  ORDER BY a.id LIMIT 1) AS answer,
                (SELECT a.category FROM chat_logs a
                  WHERE a.session_id = u.session_id AND a.role = 'assistant' AND a.id > u.id
                  ORDER BY a.id LIMIT 1) AS category
         FROM chat_logs u
         WHERE u.role = 'user' ${where}
         ORDER BY u.id DESC LIMIT 50`
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

// WS O: FAQボットの「エラー報告」一覧＋仕分け(要修正/エラーではない)。
// 報告はボット専用DB(FAQBOT_LOG_DB_*)のerror_reportsにあり、会員DB(bw5)とは別系のまま。
// ここは読み取りに加えてstatusの更新だけ行う(報告本文は書き換えない)。
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { faqLogDb } from '@/lib/faqLogDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 自由文字列をSQL/更新値に混ぜないための許可リスト
const STATUSES = new Set(['new', 'fixed', 'not_error']);
const FILTERS: Record<string, string> = {
  new: "WHERE status = 'new'",
  all: '',
};

export const GET = withAuth(async (req: NextRequest) => {
  const db = faqLogDb();
  if (!db) return NextResponse.json({ error: 'FAQBOT_LOG_DB_URLが未設定です' }, { status: 503 });

  const filterKey = req.nextUrl.searchParams.get('filter') ?? 'new';
  const where = FILTERS[filterKey] ?? FILTERS.new;
  try {
    // error_reportsはボット側が初回起動時に作る。未作成でも画面が落ちないよう保険で用意する。
    await db
      .execute(
        `CREATE TABLE IF NOT EXISTS error_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, content TEXT NOT NULL,
          context TEXT, status TEXT NOT NULL DEFAULT 'new', is_test INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')))`
      )
      .catch(() => {});
    const [rows, counts] = await Promise.all([
      db.execute(
        `SELECT id, substr(datetime(created_at,'+9 hours'),1,16) AS at, content, context, status, is_test
         FROM error_reports ${where} ORDER BY id DESC LIMIT 100`
      ),
      db.execute(`SELECT status, COUNT(*) AS n FROM error_reports GROUP BY status`),
    ]);
    return NextResponse.json({ reports: rows.rows, counts: counts.rows });
  } catch (e) {
    console.error('[faq/reports GET]', e);
    return NextResponse.json({ error: 'ログDBに接続できませんでした' }, { status: 502 });
  }
});

export const PATCH = withAuth(async (req: NextRequest) => {
  const db = faqLogDb();
  if (!db) return NextResponse.json({ error: 'FAQBOT_LOG_DB_URLが未設定です' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
  const id = Number(body?.id);
  const status = String(body?.status ?? '');
  if (!Number.isInteger(id) || id <= 0 || !STATUSES.has(status)) {
    return NextResponse.json({ error: 'idまたはstatusが不正です' }, { status: 400 });
  }
  try {
    const r = await db.execute({ sql: 'UPDATE error_reports SET status = ? WHERE id = ?', args: [status, id] });
    if (r.rowsAffected === 0) return NextResponse.json({ error: '対象が見つかりません' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[faq/reports PATCH]', e);
    return NextResponse.json({ error: '更新できませんでした' }, { status: 502 });
  }
});

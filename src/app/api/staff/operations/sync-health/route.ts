import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { notifyTaro } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// T-165: daily_sync の実行結果報告。失敗はスタッフ通知にも流す。
// POST body: { status: 'ok'|'error', message?: string, lstep_state_age_days?: number }
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const status = body.status === 'ok' ? 'ok' : 'error';
  const message = typeof body.message === 'string' ? body.message.slice(0, 2000) : null;
  const age = Number.isFinite(body.lstep_state_age_days) ? Math.floor(body.lstep_state_age_days) : null;

  await execute(
    `INSERT INTO sync_runs (status, message, lstep_state_age_days) VALUES (?,?,?)`,
    [status, message, age]
  );

  // 失敗は staff_notifications にも (同日重複は抑止)
  if (status === 'error') {
    const inserted = await execute(
      `INSERT INTO staff_notifications (type, title, detail, severity)
       SELECT 'sync_failure', '⚠️ 自動同期が失敗しました', ?, 'error'
       WHERE NOT EXISTS (
         SELECT 1 FROM staff_notifications
         WHERE type='sync_failure' AND created_at > datetime('now','-12 hours')
       )`,
      [message ?? '詳細は事務所Macの auto_sync/logs を確認']
    );

    // アプリ内通知が実際に入った時だけプッシュする。
    // 12h抑止をそのまま流用するので、1日4回失敗してもメールは12hに1通に収まる。
    // 通知の失敗で同期本体を巻き込まないよう、必ず握りつぶす。
    if (inserted.rowsAffected > 0) {
      try {
        await notifyTaro({
          subjectPrefix: '[BOOM 同期]',
          subject: '日次同期が失敗しました',
          body:
            `${message ?? '詳細不明'}\n\n` +
            `確認先: ${process.env.NEXT_PUBLIC_BASE_URL ?? 'https://bw5-app.vercel.app'}/staff/notifications\n` +
            `ログ: 事務所Mac の auto_sync/logs/`,
        });
      } catch (e) {
        console.error(`同期失敗のプッシュ通知に失敗: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  // storageState の鮮度警告 (20日超・1日1回まで)
  if (age !== null && age >= 20) {
    await execute(
      `INSERT INTO staff_notifications (type, title, detail, severity)
       SELECT 'lstep_state_aging', '🔑 Lstepセッションの再生成が近づいています', ?, 'warn'
       WHERE NOT EXISTS (
         SELECT 1 FROM staff_notifications
         WHERE type='lstep_state_aging' AND created_at > datetime('now','-1 day')
       )`,
      [`storageState 経過 ${age} 日。30日前後で失効する傾向のため setup_lstep_session.py での再生成を検討してください`]
    );
  }
  return NextResponse.json({ ok: true });
}

// GET: 最終同期状態 (insightsの鮮度バッジ用)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const lastRun = await getOne(
    `SELECT ran_at, status, lstep_state_age_days FROM sync_runs ORDER BY id DESC LIMIT 1`
  );
  const lastOk = await getOne(
    `SELECT ran_at FROM sync_runs WHERE status='ok' ORDER BY id DESC LIMIT 1`
  );
  const utilization = await getOne(
    `SELECT MAX(lesson_date) AS last_date FROM lesson_utilization`
  );
  const reservations = await getOne(
    // 未来の予約(status=予約済み)も取り込むようになったので、
    // 「データの鮮度」の指標としては今日までに絞る(2026-09-01)
    `SELECT MAX(lesson_date) AS last_date FROM hacomono_reservations WHERE lesson_date <= date('now')`
  );
  return NextResponse.json({
    last_run: lastRun ?? null,
    last_ok_at: (lastOk as { ran_at?: string } | null)?.ran_at ?? null,
    utilization_last_date: (utilization as { last_date?: string } | null)?.last_date ?? null,
    reservations_last_date: (reservations as { last_date?: string } | null)?.last_date ?? null,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/staff/operations/noshow-candidates?hours=12
 *
 * 体験予約 (trial_records) で「予約日時 < now - N時間」かつ status='予約済' のままの
 * レコードを抽出する。Lstep には自動キャンセル機能がないため、daily_sync.py の
 * 通知メールで「ノーショー候補」として一覧化し、運営が手動でフェーズタグを
 * 「体験キャンセル」に切り替える運用を想定。
 *
 * レスポンス:
 *   {
 *     hours_threshold: number,
 *     count: number,
 *     candidates: [
 *       {
 *         trial_id, lstep_id, member_id, reserved_at, lesson_name, status,
 *         full_name, full_name_kana, lstep_display_name
 *       }, ...
 *     ]
 *   }
 *
 * 認証: x-admin-password ヘッダー (eventAuth)
 */

type Row = {
  trial_id: number;
  lstep_id: string | null;
  member_id: number | null;
  reserved_at: string;
  lesson_name: string | null;
  status: string | null;
  full_name: string | null;
  full_name_kana: string | null;
  lstep_display_name: string | null;
};

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  try {
    const url = new URL(req.url);
    const hoursParam = url.searchParams.get('hours');
    let hours = Number(hoursParam ?? 12);
    if (!Number.isFinite(hours) || hours < 0) hours = 12;

    // SQLite/libSQL の datetime('now', '-N hours') を使う
    // (reserved_at は ISO/SQL datetime 文字列の前提)
    const rows = (await getAll(
      `SELECT
         tr.id          AS trial_id,
         tr.lstep_id    AS lstep_id,
         tr.member_id   AS member_id,
         tr.reserved_at AS reserved_at,
         tr.lesson_name AS lesson_name,
         tr.status      AS status,
         m.full_name      AS full_name,
         m.full_name_kana AS full_name_kana,
         COALESCE(lf.system_display_name, lf.display_name, lf.real_name) AS lstep_display_name
       FROM trial_records tr
       LEFT JOIN boom_members m  ON m.id = tr.member_id
       LEFT JOIN lstep_friends lf ON lf.lstep_id = tr.lstep_id
       WHERE COALESCE(tr.status, '予約済') = '予約済'
         AND datetime(tr.reserved_at) < datetime('now', ?)
       ORDER BY tr.reserved_at DESC
       LIMIT 50`,
      [`-${hours} hours`]
    )) as Row[];

    return NextResponse.json({
      hours_threshold: hours,
      count: rows.length,
      candidates: rows.map((r) => ({
        trial_id: r.trial_id,
        lstep_id: r.lstep_id,
        member_id: r.member_id,
        reserved_at: r.reserved_at,
        lesson_name: r.lesson_name,
        status: r.status ?? '予約済',
        full_name: r.full_name,
        full_name_kana: r.full_name_kana,
        lstep_display_name: r.lstep_display_name,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `ノーショー候補抽出エラー: ${msg}` },
      { status: 500 }
    );
  }
}

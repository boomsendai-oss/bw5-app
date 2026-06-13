import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getAll } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/staff/members/dormant-outreach?days=90
 *   T-175 step2: 休眠チケット会員へ「おかえり」配信するための対象リストを生成 (読み取り専用)。
 *   配信そのものは行わない。LINE=LSTEPでのセグメント配信(API無しのため手動)、
 *   メール=Gmail SMTPで送信可能。文面はTAROが別途用意。
 *
 *   対象: member_type='ticket' かつ status='active' で
 *     最終チェックインが days 日より前 (または1度も受講なし)。
 *   返却: 氏名・連絡手段カバレッジ・lstep_id(セグメント用)・最終受講・経過日数。
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const url = new URL(req.url);
  let days = Number(url.searchParams.get('days'));
  if (!Number.isFinite(days) || days <= 0) days = 90;

  const rows = await getAll(
    `SELECT
       m.id              AS member_id,
       m.full_name       AS full_name,
       m.full_name_kana  AS full_name_kana,
       CASE WHEN m.email IS NOT NULL AND TRIM(m.email) <> '' THEN 1 ELSE 0 END AS has_email,
       (SELECT MAX(r.lesson_date) FROM hacomono_reservations r
          WHERE r.boom_member_id = m.id AND r.status = 'チェックイン') AS last_checkin,
       (SELECT COUNT(*) FROM hacomono_reservations r
          WHERE r.boom_member_id = m.id AND r.status = 'チェックイン') AS checkin_count,
       (SELECT l.lstep_id FROM member_lstep_links l WHERE l.member_id = m.id AND l.relation = '本人' LIMIT 1) AS lstep_id_self,
       (SELECT COUNT(*) FROM member_lstep_links l WHERE l.member_id = m.id) AS line_links
     FROM boom_members m
     WHERE m.member_type = 'ticket' AND m.status = 'active'`
  );

  const today = new Date();
  const dormant = rows
    .map((r) => {
      const last = r.last_checkin ? String(r.last_checkin).slice(0, 10) : null;
      let daysSince: number | null = null;
      if (last) {
        const lc = new Date(last + 'T00:00:00Z');
        daysSince = Math.floor((today.getTime() - lc.getTime()) / 86400000);
      }
      return {
        member_id: r.member_id,
        full_name: r.full_name,
        full_name_kana: r.full_name_kana,
        has_email: !!r.has_email,
        has_line: r.line_links > 0,
        lstep_id: r.lstep_id_self ?? null,
        last_checkin: last,
        checkin_count: r.checkin_count,
        days_since_checkin: daysSince,
      };
    })
    .filter((r) => r.checkin_count === 0 || (r.days_since_checkin !== null && r.days_since_checkin >= days))
    .sort((a, b) => (b.days_since_checkin ?? 99999) - (a.days_since_checkin ?? 99999));

  return NextResponse.json({
    ok: true,
    threshold_days: days,
    total: dormant.length,
    coverage: {
      email: dormant.filter((d) => d.has_email).length,
      line: dormant.filter((d) => d.has_line).length,
    },
    members: dormant,
  });
}

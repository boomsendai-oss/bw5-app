import { NextRequest, NextResponse } from 'next/server';
import { getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getActiveMemberCount } from '@/lib/kpiMetrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/hub-stats
// 各機能カードに表示するライブ件数をまとめて返す
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  // 各テーブルから件数取得 (テーブル無い場合は0)
  async function count(sql: string): Promise<number> {
    try {
      const r = await getOne(sql);
      return Number((r as { n?: number } | undefined)?.n ?? 0);
    } catch {
      return 0;
    }
  }

  // 在籍数は正準ロジック(当月末・日付ウィンドウ方式)で算出し経営インサイトと統一。
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [
    membersActive,
    membersWithdrew,
    lessonsActive,
    videoPreorders,
    videoPreordersUnsent,
    merchOrders,
    merchOrdersPending,
    events,
    trialRecords,
    unlinkedMembers,
    monthlyReports,
    xPostsDraft,
    blogDrafts,
    blogAutoDrafts,
  ] = await Promise.all([
    getActiveMemberCount(currentYm).catch(() => 0),
    count(`SELECT COUNT(*) as n FROM boom_members WHERE status = 'withdrew'`),
    count(`SELECT COUNT(*) as n FROM lesson_schedule WHERE status = 'active'`),
    count(`SELECT COUNT(*) as n FROM video_preorders WHERE (status IS NULL OR status != 'duplicate')`),
    count(`SELECT COUNT(*) as n FROM video_preorders WHERE confirmation_email_sent_at IS NULL AND (status IS NULL OR status != 'duplicate') AND email IS NOT NULL AND email != ''`),
    count(`SELECT COUNT(*) as n FROM merch_orders`),
    count(`SELECT COUNT(*) as n FROM merch_orders WHERE status IN ('pending','pending_cash','awaiting_payment')`),
    count(`SELECT COUNT(*) as n FROM events`),
    count(`SELECT COUNT(*) as n FROM trial_records`),
    count(`SELECT COUNT(*) as n FROM boom_members WHERE status = 'active' AND id NOT IN (SELECT member_id FROM member_lstep_links)`),
    count(`SELECT COUNT(*) as n FROM monthly_reports`),
    count(`SELECT COUNT(*) as n FROM x_posts WHERE status = 'draft'`),
    count(`SELECT COUNT(*) as n FROM blog_posts WHERE is_published = 0`),
    // auto-blog v2 の未レビュー下書き(TAROが読んで公開判断するもの)
    count(`SELECT COUNT(*) as n FROM blog_posts WHERE is_published = 0 AND auto_generated = 1`),
  ]);

  return NextResponse.json({
    members: { active: membersActive, withdrew: membersWithdrew, unlinked: unlinkedMembers },
    lessons: { active: lessonsActive },
    videoPreorders: { total: videoPreorders, unsent: videoPreordersUnsent },
    merch: { total: merchOrders, pending: merchOrdersPending },
    events: { total: events },
    trials: { total: trialRecords },
    monthly: { reports: monthlyReports },
    xPosts: { draft: xPostsDraft },
    blog: { drafts: blogDrafts, autoDrafts: blogAutoDrafts },
    generated_at: new Date().toISOString(),
  });
}

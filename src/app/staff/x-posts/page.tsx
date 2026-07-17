// X投稿 承認キュー (Server Component)
// Claudeが生成した投稿下書きをTAROがスマホでまとめて承認する画面(月2回運用)。
// 承認済み+予約時刻到来分は /api/cron/x-autopost が自動ポストする。
import StaffPageHeader from '@/components/StaffPageHeader';
import { getAll } from '@/lib/db';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { parsePartsJson, parseTweetIdsJson, type XPostRow, type XPostStatus } from '@/lib/xPosts';
import XPostsList, { type XPostView } from './XPostsList';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KNOWN_STATUSES: XPostStatus[] = ['draft', 'approved', 'posting', 'posted', 'failed', 'rejected'];

export default async function XPostsPage() {
  const authed = await isAuthorizedServer();
  if (!authed) {
    return (
      <div>
        <StaffPageHeader title="X投稿 承認キュー" backHref="/staff" />
        <div className="p-4 max-w-3xl mx-auto">
          <p className="text-sm text-muted-foreground">
            ログインが必要です。<a href="/staff" className="text-brand-600 underline">スタッフトップ</a>からログインしてください。
          </p>
        </div>
      </div>
    );
  }

  // 未投稿(draft/approved/posting/failed/rejected)は全件、posted は直近50件に絞る
  const rows = (await getAll(
    `SELECT * FROM x_posts
     WHERE status != 'posted'
     UNION ALL
     SELECT * FROM (SELECT * FROM x_posts WHERE status = 'posted' ORDER BY id DESC LIMIT 50)
     ORDER BY id DESC`
  )) as XPostRow[];

  const posts: XPostView[] = rows.map((r) => ({
    id: r.id,
    account: r.account,
    parts: parsePartsJson(r.parts),
    scheduledAt: r.scheduled_at,
    status: (KNOWN_STATUSES as string[]).includes(r.status) ? (r.status as XPostStatus) : 'failed',
    postedTweetIds: parseTweetIdsJson(r.posted_tweet_ids),
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return (
    <div>
      <StaffPageHeader
        title="X投稿 承認キュー"
        description="Claude下書き→承認→予約時刻にcronが自動ポスト。承認は月2回まとめてでOK"
        backHref="/staff"
      />
      <div className="p-4 max-w-3xl mx-auto space-y-4">
        <XPostsList posts={posts} />
      </div>
    </div>
  );
}

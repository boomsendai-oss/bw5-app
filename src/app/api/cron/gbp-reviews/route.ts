import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { gbpConfigured, getGbpAccessToken, listGbpReviews, STAR_TO_NUM } from '@/lib/gbp';
import { draftConfigured, generateReplyDraft } from '@/lib/gbpDraft';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GBPクチコミ取込+ドラフト生成 (T-178)。1日4回 (JST 6/12/18/24時) Cloudflare Worker cronから叩かれる。
// 認証: Authorization: Bearer <CRON_SECRET> または x-cron-secret ヘッダ
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // 未設定なら拒否 (無認証公開を防ぐ)
  const bearer = req.headers.get('authorization');
  if (bearer === `Bearer ${secret}`) return true;
  if (req.headers.get('x-cron-secret') === secret) return true;
  return false;
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!gbpConfigured()) {
    // GBP APIアクセス承認待ちの間はno-opで成功扱い (cron自体は先に稼働させておく)
    return NextResponse.json({ ok: true, configured: false, note: 'GBP env未設定のためスキップ' });
  }

  const token = await getGbpAccessToken();
  const reviews = await listGbpReviews(token);

  // 差分upsert: ローカルの status/draft は保持しつつ、リモートの返信状態を反映
  let upserted = 0;
  for (const r of reviews) {
    if (!r.reviewId) continue;
    await execute(
      `INSERT INTO gbp_reviews
        (review_id, reviewer_name, star_rating, comment, create_time, update_time,
         reply_comment, reply_time, status, raw_json)
       VALUES (?,?,?,?,?,?,?,?, CASE WHEN ? IS NOT NULL THEN 'posted' ELSE 'new' END, ?)
       ON CONFLICT(review_id) DO UPDATE SET
         reviewer_name=excluded.reviewer_name,
         star_rating=excluded.star_rating,
         comment=excluded.comment,
         update_time=excluded.update_time,
         reply_comment=excluded.reply_comment,
         reply_time=excluded.reply_time,
         raw_json=excluded.raw_json,
         -- リモートに返信が付いたらposted扱いに昇格。スキップ済みはそのまま
         status=CASE
           WHEN excluded.reply_comment IS NOT NULL THEN 'posted'
           ELSE gbp_reviews.status
         END`,
      [
        r.reviewId,
        r.reviewer?.displayName ?? null,
        STAR_TO_NUM[r.starRating ?? ''] ?? null,
        r.comment ?? null,
        r.createTime ?? null,
        r.updateTime ?? null,
        r.reviewReply?.comment ?? null,
        r.reviewReply?.updateTime ?? null,
        r.reviewReply?.comment ?? null,
        JSON.stringify(r),
      ]
    );
    upserted++;
  }

  // 未返信の新着にドラフト生成
  const pending = (await getAll(
    `SELECT review_id, reviewer_name, star_rating, comment FROM gbp_reviews
     WHERE status='new' AND reply_comment IS NULL ORDER BY create_time ASC LIMIT 10`
  )) as { review_id: string; reviewer_name: string | null; star_rating: number | null; comment: string | null }[];

  let drafted = 0;
  const draftErrors: string[] = [];
  if (pending.length > 0 && !draftConfigured()) {
    draftErrors.push('ANTHROPIC_API_KEY未設定のためドラフト生成スキップ');
  } else {
    for (const p of pending) {
      try {
        const draft = await generateReplyDraft({
          reviewerName: p.reviewer_name ?? '',
          starRating: p.star_rating ?? 5,
          comment: p.comment,
        });
        await execute(
          `UPDATE gbp_reviews SET draft=?, drafted_at=datetime('now'), status='draft_ready' WHERE review_id=?`,
          [draft, p.review_id]
        );
        drafted++;
      } catch (e) {
        draftErrors.push(`${p.review_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    remote_total: reviews.length,
    upserted,
    drafted,
    draft_errors: draftErrors,
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

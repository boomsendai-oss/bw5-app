import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { gbpConfigured, getGbpAccessToken, listGbpReviews, putGbpReply, STAR_TO_NUM } from '@/lib/gbp';
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

  // 文体の手本: 最近公開した返信3件 (TARO が手直ししたものを含む)
  const styleExamples = pending.length
    ? ((await getAll(
        `SELECT comment, reply_comment AS reply FROM gbp_reviews
         WHERE reply_comment IS NOT NULL AND comment IS NOT NULL
         ORDER BY COALESCE(reply_time, posted_at) DESC LIMIT 3`
      )) as { comment: string | null; reply: string }[])
    : [];

  let drafted = 0;
  const draftErrors: string[] = [];
  if (pending.length > 0 && !draftConfigured()) {
    draftErrors.push('ANTHROPIC_API_KEY未設定のためドラフト生成スキップ');
  } else {
    for (const p of pending) {
      try {
        const { text: draft, holdReason } = await generateReplyDraft({
          reviewerName: p.reviewer_name ?? '',
          starRating: p.star_rating ?? 5,
          comment: p.comment,
          styleExamples,
        });
        await execute(
          `UPDATE gbp_reviews SET draft=?, drafted_at=datetime('now'), status='draft_ready', hold_reason=? WHERE review_id=?`,
          [draft, holdReason, p.review_id]
        );
        drafted++;
      } catch (e) {
        draftErrors.push(`${p.review_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // 自動公開 (2026-11-14 TARO決定・試し運用。docs: boom-events-hub/docs/BOOM業務ルール.md)
  // ★4以上で未返信のドラフトはそのまま公開する。★3以下と、下書き作成時に「確認:要」と判定したもの
  // (hold_reason あり: 費用・特定の講師や出来事・家庭の事情など) は人の承認を待つ (スタッフ画面)。
  // 止めたいときは Vercel の環境変数 GBP_AUTO_POST=off。
  // 公開したものは auto_posted_at に記録し、朝のまとめで一覧にする。
  let autoPosted = 0;
  const postErrors: string[] = [];
  if (process.env.GBP_AUTO_POST !== 'off') {
    const ready = (await getAll(
      `SELECT review_id, draft FROM gbp_reviews
       WHERE status='draft_ready' AND reply_comment IS NULL AND star_rating >= 4
         AND hold_reason IS NULL AND draft IS NOT NULL AND TRIM(draft) <> ''
       ORDER BY create_time ASC LIMIT 10`
    )) as { review_id: string; draft: string }[];
    for (const r of ready) {
      try {
        await putGbpReply(token, r.review_id, r.draft.trim());
        await execute(
          `UPDATE gbp_reviews SET status='posted', reply_comment=?, posted_at=datetime('now'),
             auto_posted_at=datetime('now') WHERE review_id=?`,
          [r.draft.trim(), r.review_id]
        );
        autoPosted++;
      } catch (e) {
        postErrors.push(`${r.review_id}: ${e instanceof Error ? e.message : String(e)}`);
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
    auto_posted: autoPosted,
    post_errors: postErrors,
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

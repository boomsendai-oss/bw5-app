import { NextRequest, NextResponse } from 'next/server';
import {
  createGbpScheduledPost,
  gbpConfigured,
  getGbpAccessToken,
  listGbpLocalPosts,
} from '@/lib/gbp';
import {
  GBP_CTA_URL,
  nextMonthJst,
  parseGbpDraftMarkdown,
  planPostCreation,
} from '@/lib/gbpPosts';
import { notifyTaro } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GBP月次予約投稿の自動登録 (2026-07-25)。
// クラウドルーティン(毎月20日9:00 JST)が boom-events-hub に翌月分ドラフト
// docs/gbp-drafts/YYYY-MM.md をpushすると、同リポジトリのGH Actions
// (gbp-schedule-posts.yml) がその内容をこのエンドポイントへPOSTし、
// v4 localPosts へ scheduledTime 付きの予約投稿(非公開・SCHEDULED)を作成する。
// 冪等: 同じ予約時刻の投稿が既にあればskip (TARO手動予約・再実行と衝突しない)。
// 認証: x-cron-secret (または Bearer) が CRON_SECRET / GBP_SCHEDULER_SECRET の
//       いずれかに一致 (後者は boom-events-hub 側Actionsに配布した専用シークレット)
//
// リクエスト: POST body = JSON { markdown: string } (ドラフトMD全文)
// クエリ:
//   ?month=YYYY-MM  対象月 (ログ/通知の表示用。既定: JST今日の翌月)
//   ?dry=1          作成せず計画だけ返す (疎通テスト用)
//   ?final=1        この月の最終試行 (ドラフト未着でもTAROへ通知して人間にバトンを渡す)

function cronAuthorized(req: NextRequest): boolean {
  const secrets = [process.env.CRON_SECRET, process.env.GBP_SCHEDULER_SECRET].filter(Boolean);
  if (secrets.length === 0) return false; // 未設定なら拒否 (無認証公開を防ぐ)
  const bearer = req.headers.get('authorization');
  const header = req.headers.get('x-cron-secret');
  return secrets.some((s) => bearer === `Bearer ${s}` || header === s);
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!gbpConfigured()) {
    return NextResponse.json({ ok: false, error: 'GBP env未設定' }, { status: 500 });
  }

  const params = req.nextUrl.searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '')
    ? params.get('month')!
    : nextMonthJst();
  const dry = params.get('dry') === '1';
  const isFinal = params.get('final') === '1';

  try {
    let markdown = '';
    try {
      const body = (await req.json()) as { markdown?: string };
      markdown = typeof body.markdown === 'string' ? body.markdown : '';
    } catch {
      // bodyなし/非JSON → draft_missing 扱い
    }

    if (!markdown.trim()) {
      if (isFinal && !dry) {
        await notifyTaro({
          subjectPrefix: '[BOOM GBP]',
          subject: `⚠️ ${month}のGBP投稿ドラフト未生成`,
          body:
            `boom-events-hub/docs/gbp-drafts/${month}.md が見つからないため、` +
            `GBP予約投稿の自動登録ができませんでした。\n` +
            `クラウドルーティン(毎月20日9:00)の実行状況を確認してください:\n` +
            `https://claude.ai/code/routines/trig_01JQfjoKtmhgq2juDtzrtsq6\n\n` +
            `※月初までに手動で予約すれば投稿自体は間に合います。`,
        });
      }
      return NextResponse.json({
        ok: false,
        month,
        error: 'draft_missing',
        notified: isFinal && !dry,
      });
    }

    const { posts, errors: parseErrors } = parseGbpDraftMarkdown(markdown);
    const token = await getGbpAccessToken();
    const existing = await listGbpLocalPosts(token);
    const plan = planPostCreation(posts, existing, new Date().toISOString());

    const created: { index: number; scheduledTimeUtc: string; state?: string }[] = [];
    const createErrors: string[] = [];
    if (!dry) {
      for (const p of plan.toCreate) {
        try {
          const res = await createGbpScheduledPost(token, {
            summary: p.summary,
            scheduledTimeUtc: p.scheduledTimeUtc,
            ctaUrl: GBP_CTA_URL,
          });
          created.push({ index: p.index, scheduledTimeUtc: p.scheduledTimeUtc, state: res.state });
        } catch (e) {
          createErrors.push(`投稿${p.index}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    const allErrors = [...parseErrors, ...createErrors];
    if (!dry && (created.length > 0 || allErrors.length > 0)) {
      const jst = (iso: string) =>
        new Date(new Date(iso).getTime() + 9 * 3600_000)
          .toISOString()
          .slice(0, 16)
          .replace('T', ' ');
      const lines = [
        created.length > 0
          ? `${month}のGBP予約投稿 ${created.length}本を自動登録しました。\n` +
            created.map((c) => `・${jst(c.scheduledTimeUtc)} JST公開予定`).join('\n') +
            `\n\n写真を付ける場合はGBP管理画面から各投稿を編集してください(任意・月初まで猶予あり)。\n` +
            `内容確認: https://business.google.com/`
          : '',
        plan.skipped.length > 0
          ? `スキップ${plan.skipped.length}本(既存予約と重複 or 時刻超過)`
          : '',
        allErrors.length > 0 ? `⚠️ エラー:\n${allErrors.join('\n')}` : '',
      ].filter(Boolean);
      await notifyTaro({
        subjectPrefix: '[BOOM GBP]',
        subject:
          allErrors.length > 0
            ? `⚠️ ${month}の予約投稿 自動登録に一部問題 (${created.length}本成功)`
            : `✅ ${month}の予約投稿${created.length}本を自動登録`,
        body: lines.join('\n\n'),
      });
    }

    return NextResponse.json({
      ok: allErrors.length === 0,
      month,
      dry,
      parsed: posts.length,
      created,
      skipped: plan.skipped.map((s) => ({
        index: s.post.index,
        scheduledTimeUtc: s.post.scheduledTimeUtc,
        reason: s.reason,
      })),
      to_create_dry: dry
        ? plan.toCreate.map((p) => ({ index: p.index, scheduledTimeUtc: p.scheduledTimeUtc }))
        : undefined,
      errors: allErrors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dry) {
      await notifyTaro({
        subjectPrefix: '[BOOM GBP]',
        subject: `⚠️ ${month}のGBP予約投稿 自動登録が失敗`,
        body: `エラー: ${msg}\n\n再実行はGitHub Actions (boom-events-hub / gbp-schedule-posts) のRun workflowから。\n手動予約のフォールバックも可能です(ドラフト: boom-events-hub/docs/gbp-drafts/${month}.md)。`,
      }).catch(() => {});
    }
    return NextResponse.json({ ok: false, month, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return run(req);
}

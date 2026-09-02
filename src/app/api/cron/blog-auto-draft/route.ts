import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import {
  MODEL,
  collectDraftBatch,
  countAutoDrafts,
  countUnreviewedAutoDrafts,
  getLastSubmitted,
  getPending,
  isGenerationDay,
  loadExistingPosts,
  loadFacts,
  loadGscQueries,
  buildCoverageCorpus,
  pickStructure,
  pickTopicClusters,
  submitDraftBatch,
  todayJst,
} from '@/lib/blogAutoDraft';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// ブログ自動下書き v2 の起動口 (2026-09-02)。
// GitHub Actions(blog-auto-draft.yml)から2時間おきに叩かれる。1回の呼び出しでやることは1つだけ:
//   ①投入済みバッチがある → 回収を試みる(終わっていれば下書きを blog_posts に入れてTAROへメール)
//   ②無ければ、生成日(月水金)で今日まだ投入していない → GSCから題材を選んでバッチ投入
//   ③どちらでもない → 何もしない
// どの経路も数秒で終わる(Vercel Hobbyの60秒制限のため、生成そのものは関数内で待たない)。
//
// クエリ: ?dry=1 = 投入せず選ばれる題材だけ返す / ?force=1 = 曜日・重複ガードを無視して投入
// 認証: CRON_SECRET(Vercel Cron形式の Authorization: Bearer と、GH Actions形式の x-cron-secret の両方を受ける)
// 公開はしない: 下書き(is_published=0)を作るだけ。公開は /staff/blog でTAROが承認する。

const TARO_EMAIL = 'boom.sendai@gmail.com';
const STAFF_URL = 'https://bw5-app.vercel.app/staff/blog';
const MAX_UNREVIEWED = 3;

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true;
  if (req.headers.get('x-cron-secret') === secret) return true;
  return false;
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, skipped: 'ANTHROPIC_API_KEY未設定' });
  }
  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1';
  const force = url.searchParams.get('force') === '1';
  const { ymd, weekday } = todayJst();

  // ① 回収フェーズ
  const pending = await getPending();
  if (pending && !dry) {
    const r = await collectDraftBatch(pending, ymd);
    if (r.status === 'processing') {
      return NextResponse.json({ ok: true, phase: 'collect', status: 'processing', batch_id: pending.batch_id, submitted_at: pending.submitted_at });
    }
    if (r.status === 'failed') {
      await sendEmail({
        to: TARO_EMAIL,
        subject: '⚠️ ブログ自動下書きの生成に失敗しました',
        text: `題材: ${pending.topic_key}\nseed: ${pending.seed_queries.join(' / ')}\n理由: ${r.reason}\n\n次の生成日(月水金)に別の題材で再挑戦します。`,
      }).catch(() => {});
      return NextResponse.json({ ok: false, phase: 'collect', status: 'failed', reason: r.reason });
    }
    await sendEmail({
      to: TARO_EMAIL,
      subject: `📝 ブログ下書きができました: ${r.title}`,
      text: [
        `新しい下書きが1本、ブログ管理画面に入りました(未公開)。`,
        ``,
        `タイトル: ${r.title}`,
        `URL(管理): ${STAFF_URL}`,
        `題材にした検索語: ${pending.seed_queries.join(' / ')}`,
        ``,
        r.memo ? `モデルからTAROへのメモ:\n${r.memo}` : '',
        r.issues.length ? `\n機械検査の指摘(公開前に直してください):\n- ${r.issues.join('\n- ')}` : '\n機械検査: 問題なし',
        ``,
        `読んで、自分の言葉に直して、「公開する」にチェックを入れれば、次の自動ビルド(6時間毎)でHPに出ます。`,
        `本文先頭のコメント(<!-- -->)は公開画面には表示されないので、消さなくても大丈夫です。`,
      ].join('\n'),
    }).catch(() => {});
    return NextResponse.json({ ok: true, phase: 'collect', status: 'inserted', slug: r.slug, title: r.title, issues: r.issues });
  }

  // ② 投入フェーズ
  if (!force && !dry) {
    if (!isGenerationDay(weekday)) return NextResponse.json({ ok: true, phase: 'submit', skipped: 'not-generation-day', weekday });
    if ((await getLastSubmitted()) === ymd) return NextResponse.json({ ok: true, phase: 'submit', skipped: 'already-submitted-today', day: ymd });
    const unreviewed = await countUnreviewedAutoDrafts();
    if (unreviewed >= MAX_UNREVIEWED) {
      return NextResponse.json({ ok: true, phase: 'submit', skipped: 'backlog', unreviewed, note: `未レビューの自動下書きが${unreviewed}件あるので新規生成を止めています` });
    }
  }
  if (pending && dry) {
    // dryでも回収は試さない。投入待ちがあることだけ知らせる
  }

  const gsc = await loadGscQueries();
  if (!gsc.latest.length) return NextResponse.json({ ok: false, phase: 'submit', skipped: 'no-gsc-snapshot' });
  const existing = await loadExistingPosts();
  const corpus = buildCoverageCorpus(existing);
  // 表示5回未満の語は尾のノイズ(講師名のカナ検索・単発の珍しい語)が多いので題材にしない
  const clusters = pickTopicClusters(gsc.latest, corpus, { prevQueries: gsc.prev, minImpressions: 5, limit: 5 });
  if (!clusters.length) return NextResponse.json({ ok: true, phase: 'submit', skipped: 'no-uncovered-topic', measured_on: gsc.measuredOn });

  const structure = pickStructure(await countAutoDrafts());
  if (dry) {
    return NextResponse.json({
      ok: true,
      phase: 'dry',
      measured_on: gsc.measuredOn,
      has_prev_snapshot: !!gsc.prev,
      would_pick: clusters[0],
      candidates: clusters.map((c) => ({ key: c.key, score: c.score, queries: c.queries.map((q) => q.query) })),
      structure,
      model: MODEL,
      pending: pending ? { batch_id: pending.batch_id, submitted_at: pending.submitted_at } : null,
    });
  }

  const facts = await loadFacts();
  const p = await submitDraftBatch(clusters[0], structure, facts, ymd);
  return NextResponse.json({ ok: true, phase: 'submit', status: 'submitted', batch_id: p.batch_id, topic: p.topic_key, seed_queries: p.seed_queries, structure, model: MODEL });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

import { NextRequest, NextResponse } from 'next/server';
import { faqLogDb } from '@/lib/faqLogDb';
import { sendEmail } from '@/lib/email';
import { formatFaqDigest, type FaqDigestInput } from '@/lib/faqDigest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/faq-digest
// Vercel Cron から毎朝(JST 8時)呼ばれ、FAQボット「BOOMくんに質問」の前日ぶんダイジェストを
// TARO本人(boom.sendai@gmail.com)へメールする。TAROが手でログを見にいかなくても、
// 質問数・カテゴリ内訳・未仕分けのエラー報告・空応答の兆候を毎朝1通で把握できるようにするのが目的。
// 顧客宛ではなくTARO本人宛・運用把握用なので、既定はメール(顧客LINEチャネルには触れない)。
// ログはボット専用DB(FAQBOT_LOG_DB_*)にあり会員DB(bw5)とは別系。ここは読むだけ。
// 認証は他cronと同じ CRON_SECRET(Vercelが Authorization: Bearer で送る)。
const TARO_EMAIL = 'boom.sendai@gmail.com';
const BASE_URL = 'https://bw5-app.vercel.app';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// 前日(JST)の "M/D(曜)" ラベル。cronは JST 8時 = 前日UTC 23時に走るが、
// 表示は必ずJSTの前日日付で統一する。
function yesterdayJstLabel(): string {
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = new Date(nowJst.getTime() - 24 * 60 * 60 * 1000);
  const m = y.getUTCMonth() + 1;
  const d = y.getUTCDate();
  return `${m}/${d}(${WEEKDAYS[y.getUTCDay()]})`;
}

export async function GET(req: NextRequest) {
  // フェイルクローズ: CRON_SECRET未設定なら実行拒否、Bearer不一致は401。
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = faqLogDb();
  if (!db) {
    // 未設定でもcronをエラーで埋めない(静かにスキップ)
    return NextResponse.json({ ok: false, skipped: 'FAQBOT_LOG_DB_URL未設定' });
  }

  // 対象は「JSTの前日」1日ぶん。実ユーザー(is_test=0)のみ。
  const dayExpr = "date(created_at, '+9 hours') = date('now', '+9 hours', '-1 day')";
  const real = "AND is_test = 0";

  try {
    const [totals, cats, top, reports, broken] = await Promise.all([
      // 質問数(user行)とユニーク人数
      db.execute(
        `SELECT COUNT(*) AS q, COUNT(DISTINCT session_id) AS ppl
         FROM chat_logs WHERE role='user' AND ${dayExpr} ${real}`
      ),
      // カテゴリ内訳(assistant行にcategoryが付く)
      db.execute(
        `SELECT category, COUNT(*) AS n FROM chat_logs
         WHERE role='assistant' AND ${dayExpr} ${real}
         GROUP BY category ORDER BY n DESC`
      ),
      // 代表的な質問(重複をまとめて多い順、最大8件)
      db.execute(
        `SELECT content, COUNT(*) AS n FROM chat_logs
         WHERE role='user' AND ${dayExpr} ${real}
         GROUP BY content ORDER BY n DESC, MAX(id) DESC LIMIT 8`
      ),
      // 未仕分けのエラー報告(実ユーザー分)。テーブルが無くても落ちないよう保険。
      db
        .execute(
          `SELECT COUNT(*) AS n FROM error_reports WHERE status='new' AND is_test=0`
        )
        .catch(() => ({ rows: [{ n: 0 }] })),
      // 空応答/フォールバック(不具合の兆候)。前日分の実ユーザーassistant行から。
      db.execute(
        `SELECT COUNT(*) AS n FROM chat_logs
         WHERE role='assistant' AND ${dayExpr} ${real}
           AND (length(trim(content))=0 OR content LIKE '%うまく答えられなかった%')`
      ),
    ]);

    const input: FaqDigestInput = {
      dateLabel: yesterdayJstLabel(),
      questions: Number(totals.rows[0]?.q ?? 0),
      people: Number(totals.rows[0]?.ppl ?? 0),
      categories: cats.rows.map((r) => ({
        category: r.category == null ? null : String(r.category),
        n: Number(r.n),
      })),
      topQuestions: top.rows.map((r) => String(r.content)),
      newReports: Number(reports.rows[0]?.n ?? 0),
      brokenAnswers: Number(broken.rows[0]?.n ?? 0),
      reportsUrl: `${BASE_URL}/staff/faq/reports`,
      statsUrl: `${BASE_URL}/staff/faq/stats`,
    };

    const digest = formatFaqDigest(input);
    await sendEmail({ to: TARO_EMAIL, subject: digest.subject, text: digest.text });
    return NextResponse.json({ ok: true, sent: true, ...input });
  } catch (e) {
    console.error('[cron/faq-digest]', e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `faq digest failed: ${msg}` }, { status: 500 });
  }
}

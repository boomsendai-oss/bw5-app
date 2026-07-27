import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import { buildWeeklyReportInput, type StateExtract } from '@/lib/weeklyMetrics';
import { formatWeeklyReport } from '@/lib/weeklyReport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/cron/weekly-report
//
// TARO向け週次経営レポート(月曜朝)をメール送信する。呼び出しは boom-events-hub の
// GitHub Actions (`.github/workflows/weekly-report.yml`・毎週月曜 8:00 JST)。
//
// なぜ Vercel Cron ではなく GH Actions からかというと、レポートの「来週の注目」は
// boom-events-hub の STATE.md(締切表・TAROボトルネック一覧)が要るため。STATE.md は
// 非公開リポジトリにあり Vercel から読めないので、リポジトリを持っている GH Actions 側で
// 抽出して body で渡す。数字(会員・売上・利益・入口)はこちらで本番Tursoから集計する。
//
// 認証: x-cron-secret または Authorization: Bearer が REPORT_SECRET / CRON_SECRET のいずれかに一致。
// 未設定なら拒否(無認証公開を防ぐ)。
//
// ?dry=1 でメールを送らず本文だけ返す(GH Actions からの疎通テスト用)。
const TARO_EMAIL = 'boom.sendai@gmail.com';

function authorized(req: NextRequest): boolean {
  const secrets = [process.env.REPORT_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (secrets.length === 0) return false;
  const bearer = req.headers.get('authorization');
  const header = req.headers.get('x-cron-secret');
  return secrets.some((s) => bearer === `Bearer ${s}` || header === s);
}

/** GH Actions から来た state を検証して正規化する(壊れた入力でレポート全体を落とさない)。 */
function normalizeState(raw: unknown): StateExtract {
  if (!raw || typeof raw !== 'object') return { bottlenecks: [], deadlines: [], available: false };
  const o = raw as Record<string, unknown>;
  const bottlenecks = Array.isArray(o.bottlenecks)
    ? o.bottlenecks.filter((b): b is string => typeof b === 'string').slice(0, 6)
    : [];
  const deadlines = Array.isArray(o.deadlines)
    ? o.deadlines
        .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
        .filter((d) => typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
        .map((d) => ({
          date: String(d.date),
          title: String(d.title ?? ''),
          owner: String(d.owner ?? ''),
        }))
        .slice(0, 8)
    : [];
  return { bottlenecks, deadlines, available: o.available === true };
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dry = new URL(req.url).searchParams.get('dry') === '1';
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // body なしでも数字だけのレポートは出せる(STATE由来の節は「未取得」と明記される)
    body = null;
  }
  const state = normalizeState((body as Record<string, unknown> | null)?.state);

  try {
    const input = await buildWeeklyReportInput(state);
    const report = formatWeeklyReport(input);

    if (dry) {
      return NextResponse.json({ ok: true, sent: false, dry: true, ...report, data_gaps: input.data_gaps });
    }

    await sendEmail({ to: TARO_EMAIL, subject: report.subject, text: report.text });
    return NextResponse.json({
      ok: true,
      sent: true,
      subject: report.subject,
      text: report.text,
      week: { start: input.week_start, end: input.week_end },
      data_gaps: input.data_gaps,
    });
  } catch (e) {
    console.error('[cron/weekly-report]', e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `weekly report failed: ${msg}` }, { status: 500 });
  }
}

// GET は疎通確認用(常に dry)。誤ってブラウザで開いてもメールが飛ばないようにする。
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const input = await buildWeeklyReportInput({ bottlenecks: [], deadlines: [], available: false });
  const report = formatWeeklyReport(input);
  return NextResponse.json({ ok: true, sent: false, dry: true, ...report, data_gaps: input.data_gaps });
}

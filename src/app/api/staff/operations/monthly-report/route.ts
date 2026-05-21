import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/staff/operations/monthly-report
 * body: { year_month?: "YYYY-MM" }  // 省略時は当月
 *
 * 月次サマリを Markdown 生成 → monthly_reports に UPSERT して返す。
 */

type SnapshotRow = {
  snapshot_date: string;
  line_friends: number;
  hacomono_members_active: number;
  hacomono_members_retired: number;
  trial_count: number;
  new_signup_count: number;
  churn_count: number;
  retention_count: number;
  notes: string | null;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function resolveYearMonth(input: string | undefined | null): { ym: string; start: string; nextStart: string; prevYm: string } {
  let yy: number, mm: number;
  if (input && /^\d{4}-\d{2}$/.test(input)) {
    [yy, mm] = input.split('-').map(Number) as [number, number];
  } else {
    const now = new Date();
    yy = now.getFullYear();
    mm = now.getMonth() + 1;
  }
  const ym = `${yy}-${pad2(mm)}`;
  const start = `${ym}-01 00:00:00`;
  const nd = new Date(yy, mm, 1); // mm=次月 (0-indexed)
  const nextStart = `${nd.getFullYear()}-${pad2(nd.getMonth() + 1)}-01 00:00:00`;
  const pd = new Date(yy, mm - 2, 1);
  const prevYm = `${pd.getFullYear()}-${pad2(pd.getMonth() + 1)}`;
  return { ym, start, nextStart, prevYm };
}

function fmtDelta(curr: number | null | undefined, prev: number | null | undefined): string {
  if (curr === null || curr === undefined) return '-';
  if (prev === null || prev === undefined) return `${curr} (前月比 -)`;
  const diff = curr - prev;
  const sign = diff > 0 ? '+' : '';
  return `${curr} (前月比 ${sign}${diff})`;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  try {
    let body: { year_month?: string } = {};
    try {
      body = await req.json();
    } catch {
      // 空ボディ OK
    }
    const { ym, start, nextStart, prevYm } = resolveYearMonth(body?.year_month);

    // 当月新規入会者
    type MemRow = {
      hacomono_member_id: string;
      full_name: string;
      plan_name: string | null;
      enrolled_at: string | null;
      withdrew_at: string | null;
    };
    const newSignups = (await getAll(
      `SELECT hacomono_member_id, full_name, plan_name, enrolled_at, withdrew_at
       FROM boom_members
       WHERE enrolled_at >= ? AND enrolled_at < ?
       ORDER BY enrolled_at ASC`,
      [start, nextStart]
    )) as MemRow[];

    const withdrews = (await getAll(
      `SELECT hacomono_member_id, full_name, plan_name, enrolled_at, withdrew_at
       FROM boom_members
       WHERE withdrew_at >= ? AND withdrew_at < ?
       ORDER BY withdrew_at ASC`,
      [start, nextStart]
    )) as MemRow[];

    // 体験来店者
    type TrialRow = {
      reserved_at: string;
      lesson_name: string | null;
      status: string | null;
      enrolled_after: number;
      member_name: string | null;
      lstep_display: string | null;
    };
    const trials = (await getAll(
      `SELECT t.reserved_at, t.lesson_name, t.status, t.enrolled_after,
              m.full_name AS member_name,
              lf.system_display_name AS lstep_display
       FROM trial_records t
       LEFT JOIN boom_members m ON m.id = t.member_id
       LEFT JOIN lstep_friends lf ON lf.lstep_id = t.lstep_id
       WHERE t.reserved_at >= ? AND t.reserved_at < ?
       ORDER BY t.reserved_at ASC`,
      [start, nextStart]
    )) as TrialRow[];

    const trialConverted = trials.filter((t) => Number(t.enrolled_after) === 1);

    // プラン変更者: 当月内で boom_members.updated_at が変化したものを抽出するのは難しいため
    // 当月入会以外の人で updated_at が当月内にあって plan_name がある人を「候補」として並べる
    type PlanChangeRow = {
      hacomono_member_id: string;
      full_name: string;
      plan_name: string | null;
      updated_at: string | null;
    };
    const planChanges = (await getAll(
      `SELECT hacomono_member_id, full_name, plan_name, updated_at
       FROM boom_members
       WHERE updated_at >= ? AND updated_at < ?
         AND (enrolled_at IS NULL OR enrolled_at < ?)
         AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT 50`,
      [start, nextStart, start]
    )) as PlanChangeRow[];

    // KPI 推移 (当月 + 前月)
    const currSnap = (await getOne(
      `SELECT * FROM kpi_snapshots WHERE snapshot_date = ?`,
      [`${ym}-01`]
    )) as SnapshotRow | null;
    const prevSnap = (await getOne(
      `SELECT * FROM kpi_snapshots WHERE snapshot_date = ?`,
      [`${prevYm}-01`]
    )) as SnapshotRow | null;

    // Markdown 生成
    const lines: string[] = [];
    lines.push(`# BOOM 月次運用レポート ${ym}`);
    lines.push('');
    lines.push(`_自動生成: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}_`);
    lines.push('');

    lines.push('## サマリ');
    lines.push('');
    lines.push(`- 在籍会員数: ${fmtDelta(currSnap?.hacomono_members_active ?? null, prevSnap?.hacomono_members_active ?? null)}`);
    lines.push(`- LINE友だち (ブロック除く): ${fmtDelta(currSnap?.line_friends ?? null, prevSnap?.line_friends ?? null)}`);
    lines.push(`- 今月の新規入会: ${newSignups.length}人`);
    lines.push(`- 今月の退会: ${withdrews.length}人`);
    lines.push(`- 今月の体験来店: ${trials.length}人`);
    lines.push(`- 体験→入会転換: ${trialConverted.length}人` + (trials.length ? ` (CVR ${((trialConverted.length / trials.length) * 100).toFixed(1)}%)` : ''));
    lines.push('');

    lines.push('## 今月の新規入会者');
    lines.push('');
    if (newSignups.length === 0) {
      lines.push('_該当者なし_');
    } else {
      lines.push('| 入会日 | 氏名 | プラン | メンバーID |');
      lines.push('| --- | --- | --- | --- |');
      for (const m of newSignups) {
        lines.push(`| ${m.enrolled_at?.slice(0, 10) ?? '-'} | ${m.full_name} | ${m.plan_name ?? '-'} | ${m.hacomono_member_id} |`);
      }
    }
    lines.push('');

    lines.push('## 今月の退会者');
    lines.push('');
    if (withdrews.length === 0) {
      lines.push('_該当者なし_');
    } else {
      lines.push('| 退会日 | 氏名 | 直前プラン | メンバーID |');
      lines.push('| --- | --- | --- | --- |');
      for (const m of withdrews) {
        lines.push(`| ${m.withdrew_at?.slice(0, 10) ?? '-'} | ${m.full_name} | ${m.plan_name ?? '-'} | ${m.hacomono_member_id} |`);
      }
    }
    lines.push('');

    lines.push('## 今月のプラン変更 (候補)');
    lines.push('');
    lines.push('_※ boom_members.updated_at ベースの候補。誤検出を含む可能性あり_');
    lines.push('');
    if (planChanges.length === 0) {
      lines.push('_該当者なし_');
    } else {
      lines.push('| 更新日 | 氏名 | 現プラン | メンバーID |');
      lines.push('| --- | --- | --- | --- |');
      for (const m of planChanges) {
        lines.push(`| ${m.updated_at?.slice(0, 10) ?? '-'} | ${m.full_name} | ${m.plan_name ?? '-'} | ${m.hacomono_member_id} |`);
      }
    }
    lines.push('');

    lines.push('## 今月の体験来店者');
    lines.push('');
    if (trials.length === 0) {
      lines.push('_該当者なし_');
    } else {
      lines.push('| 体験日 | 氏名 (DB / LINE) | レッスン | ステータス | 入会 |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const t of trials) {
        const name = t.member_name ?? t.lstep_display ?? '-';
        const conv = Number(t.enrolled_after) === 1 ? '✅' : '-';
        lines.push(`| ${t.reserved_at?.slice(0, 10) ?? '-'} | ${name} | ${t.lesson_name ?? '-'} | ${t.status ?? '-'} | ${conv} |`);
      }
    }
    lines.push('');

    lines.push('## 体験→入会 転換者');
    lines.push('');
    if (trialConverted.length === 0) {
      lines.push('_該当者なし_');
    } else {
      for (const t of trialConverted) {
        const name = t.member_name ?? t.lstep_display ?? '-';
        lines.push(`- ${t.reserved_at?.slice(0, 10) ?? '-'} ${name} (${t.lesson_name ?? '-'})`);
      }
    }
    lines.push('');

    lines.push('## KPI 推移 (前月比)');
    lines.push('');
    lines.push('| 指標 | 当月 | 前月 |');
    lines.push('| --- | --- | --- |');
    const row = (label: string, c: number | null | undefined, p: number | null | undefined) =>
      lines.push(`| ${label} | ${c ?? '-'} | ${p ?? '-'} |`);
    row('在籍会員', currSnap?.hacomono_members_active, prevSnap?.hacomono_members_active);
    row('退会会員', currSnap?.hacomono_members_retired, prevSnap?.hacomono_members_retired);
    row('LINE友だち', currSnap?.line_friends, prevSnap?.line_friends);
    row('体験予約', currSnap?.trial_count, prevSnap?.trial_count);
    row('新規入会', currSnap?.new_signup_count, prevSnap?.new_signup_count);
    row('退会', currSnap?.churn_count, prevSnap?.churn_count);
    row('体験→入会', currSnap?.retention_count, prevSnap?.retention_count);
    lines.push('');

    const md = lines.join('\n');

    // UPSERT
    await execute(
      `INSERT INTO monthly_reports (year_month, report_markdown, generated_at)
       VALUES (?, ?, datetime('now', 'localtime'))
       ON CONFLICT(year_month) DO UPDATE SET
         report_markdown = excluded.report_markdown,
         generated_at = excluded.generated_at`,
      [ym, md]
    );

    return NextResponse.json({
      ok: true,
      year_month: ym,
      report_markdown: md,
      counts: {
        new_signups: newSignups.length,
        withdrews: withdrews.length,
        plan_changes: planChanges.length,
        trials: trials.length,
        trial_converted: trialConverted.length,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `月次レポート生成エラー: ${msg}` }, { status: 500 });
  }
}

/**
 * GET /api/staff/operations/monthly-report?year_month=YYYY-MM
 * 保存済みレポートを取得 (なければ 404)
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const ym = url.searchParams.get('year_month');
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    return NextResponse.json({ error: 'year_month=YYYY-MM が必要です' }, { status: 400 });
  }
  const row = (await getOne(
    `SELECT year_month, report_markdown, generated_at FROM monthly_reports WHERE year_month = ?`,
    [ym]
  )) as { year_month: string; report_markdown: string; generated_at: string } | null;
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, ...row });
}

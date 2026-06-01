import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getActiveMemberCount, getMonthlyRevenue } from '@/lib/kpiMetrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/staff/operations/snapshot-kpi
 *
 * 現時点の boom_members / lstep_friends / member_lstep_links / trial_records から
 * KPI を集計し、kpi_snapshots テーブルに UPSERT (snapshot_date は当月の月初)。
 *
 * kpi_snapshots は元々「手動入力ベース」の MVP テーブル。
 * 既存スキーマを壊さないため:
 *   - line_friends                = 総友だち数 (block除く)
 *   - hacomono_members_active     = 在籍会員数
 *   - hacomono_members_retired    = 退会会員数
 *   - trial_count                 = 当月の体験予約数
 *   - new_signup_count            = 当月の新規入会数 (enrolled_at が当月)
 *   - churn_count                 = 当月の退会数 (withdrew_at が当月)
 *   - retention_count             = 体験→入会転換数
 *   - notes                       = 内訳 JSON (auto)
 */

type DetailBreakdown = {
  year_month: string;
  members: {
    total_active: number;
    ticket: number;
    monthly: number;
    rest: number;
    other: number;
    withdrew_total: number;
  };
  lstep: {
    total: number;
    blocked: number;
    phase_4a_member: number;
    phase_4b_parent: number;
    phase_trial_reserved: number;
    phase_trial_done: number;
    phase_line_only: number;
  };
  links: {
    linked_members: number;
    by_relation: { honnin: number; hogosha: number; koushi: number };
    unlinked_members: number;
  };
  trial: {
    month_reserved: number;
    month_attended: number;
    month_canceled: number;
    month_converted: number;
    cvr_pct: number | null;
  };
};

function classifyPlan(planName: string | null): 'ticket' | 'monthly' | 'rest' | 'other' {
  const n = (planName ?? '').trim();
  if (!n) return 'other';
  if (/休会|休止|お休み|キュウカイ/.test(n)) return 'rest';
  if (/チケット|回数|回券|ticket/i.test(n)) return 'ticket';
  if (/月会費|マンスリー|月額|月謝|通い放題|フリーパス/i.test(n)) return 'monthly';
  return 'other';
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  try {
    const now = new Date();
    const yy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const ym = `${yy}-${mm}`;
    const snapshotDate = `${ym}-01`;
    const monthStart = `${ym}-01 00:00:00`;
    // 翌月1日
    const next = new Date(yy, now.getMonth() + 1, 1);
    const nextStart = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;

    // ---- 会員 ----
    type MemberRow = { status: string; plan_name: string | null; enrolled_at: string | null; withdrew_at: string | null };
    const members = (await getAll(
      `SELECT status, plan_name, enrolled_at, withdrew_at FROM boom_members`
    )) as MemberRow[];

    // 在籍数は正準ロジック(日付ウィンドウ方式)で算出。
    // status='active' でのカウントは過去月でズレるため使わない(経営インサイトと統一)。
    const totalActive = await getActiveMemberCount(ym);

    // プラン内訳(ticket/monthly/rest/other)は現在 active な会員の plan_name で分類。
    // 当月末在籍数(totalActive)とは母数が一致しないことがあるが、内訳の参考値として保持。
    let ticket = 0;
    let monthly = 0;
    let rest = 0;
    let other = 0;
    let withdrewTotal = 0;
    let newSignup = 0;
    let churn = 0;

    for (const m of members) {
      if (m.status === 'active') {
        const c = classifyPlan(m.plan_name);
        if (c === 'ticket') ticket += 1;
        else if (c === 'monthly') monthly += 1;
        else if (c === 'rest') rest += 1;
        else other += 1;
      } else if (m.status === 'withdrew') {
        withdrewTotal += 1;
      }
      if (m.enrolled_at && m.enrolled_at >= monthStart && m.enrolled_at < nextStart) newSignup += 1;
      if (m.withdrew_at && m.withdrew_at >= monthStart && m.withdrew_at < nextStart) churn += 1;
    }

    // 当月売上(正準: hacomono_billing_records 実集計)
    const monthlyRevenue = await getMonthlyRevenue(ym);

    // ---- Lstep 友だち ----
    type LstepRow = { blocked: number; role: string | null };
    const lstepRows = (await getAll(
      `SELECT blocked, role FROM lstep_friends`
    )) as LstepRow[];
    const lstepTotal = lstepRows.length;
    const lstepBlocked = lstepRows.filter((r) => Number(r.blocked) === 1).length;

    // フェーズ別: lstep_phase_history の最新フェーズで分類
    // 履歴がない場合は role を簡易マッピング
    type PhaseRow = { lstep_id: string; new_phase: string };
    const phaseRows = (await getAll(
      `SELECT lstep_id, new_phase
       FROM lstep_phase_history ph
       WHERE changed_at = (
         SELECT MAX(changed_at) FROM lstep_phase_history WHERE lstep_id = ph.lstep_id
       )`
    )) as PhaseRow[];
    const phaseByLid = new Map<string, string>();
    for (const r of phaseRows) phaseByLid.set(r.lstep_id, r.new_phase);

    let p4a = 0, p4b = 0, pTrialReserved = 0, pTrialDone = 0, pLineOnly = 0;
    // link 経由のフォールバック分類
    type LidRoleRow = { lstep_id: string; relation: string | null };
    const linkRoleRows = (await getAll(
      `SELECT lstep_id, relation FROM member_lstep_links`
    )) as LidRoleRow[];
    const relByLid = new Map<string, string>();
    for (const r of linkRoleRows) {
      const cur = relByLid.get(r.lstep_id);
      const rel = (r.relation ?? '').trim();
      if (!cur) relByLid.set(r.lstep_id, rel);
      else if (cur === '本人') continue;
      else if (rel === '本人') relByLid.set(r.lstep_id, rel);
    }
    // trial の状態でも判定
    type TrialMinRow = { lstep_id: string | null; status: string | null };
    const trialMin = (await getAll(
      `SELECT lstep_id, status FROM trial_records WHERE lstep_id IS NOT NULL`
    )) as TrialMinRow[];
    const trialStateByLid = new Map<string, 'reserved' | 'done'>();
    for (const t of trialMin) {
      const lid = t.lstep_id!;
      const st = (t.status ?? '').trim();
      if (/受講|完了|attended|done/i.test(st)) trialStateByLid.set(lid, 'done');
      else if (!trialStateByLid.has(lid)) trialStateByLid.set(lid, 'reserved');
    }

    type LstepIdRow = { lstep_id: string; blocked: number };
    const lstepIds = (await getAll(
      `SELECT lstep_id, blocked FROM lstep_friends`
    )) as LstepIdRow[];
    for (const r of lstepIds) {
      if (Number(r.blocked) === 1) continue;
      const phase = phaseByLid.get(r.lstep_id) ?? '';
      const rel = relByLid.get(r.lstep_id) ?? '';
      const tstate = trialStateByLid.get(r.lstep_id);
      if (phase.includes('4-A') || rel === '本人') p4a += 1;
      else if (phase.includes('4-B') || rel === '保護者') p4b += 1;
      else if (tstate === 'done') pTrialDone += 1;
      else if (tstate === 'reserved') pTrialReserved += 1;
      else pLineOnly += 1;
    }

    // ---- 紐付け ----
    type LinkAggRow = { relation: string | null; cnt: number };
    const linkAgg = (await getAll(
      `SELECT relation, COUNT(DISTINCT member_id) AS cnt FROM member_lstep_links GROUP BY relation`
    )) as LinkAggRow[];
    let lkH = 0, lkP = 0, lkT = 0;
    for (const r of linkAgg) {
      const rel = (r.relation ?? '').trim();
      const c = Number(r.cnt) || 0;
      if (rel === '本人') lkH = c;
      else if (rel === '保護者') lkP = c;
      else if (rel === '講師') lkT = c;
    }
    const linkedMembersRow = (await getOne(
      `SELECT COUNT(DISTINCT member_id) AS cnt FROM member_lstep_links`
    )) as { cnt: number } | null;
    const linkedMembers = Number(linkedMembersRow?.cnt ?? 0);
    const unlinkedMembers = Math.max(totalActive - linkedMembers, 0);

    // ---- 体験 ----
    type TrialRow = { reserved_at: string; status: string | null; enrolled_after: number };
    const trials = (await getAll(
      `SELECT reserved_at, status, enrolled_after FROM trial_records
       WHERE reserved_at >= ? AND reserved_at < ?`,
      [monthStart, nextStart]
    )) as TrialRow[];
    const tReserved = trials.length;
    let tAttended = 0;
    let tCanceled = 0;
    let tConverted = 0;
    for (const t of trials) {
      const s = (t.status ?? '').trim();
      if (/キャンセル|cancel/i.test(s)) tCanceled += 1;
      else if (/受講|完了|attended|done/i.test(s)) tAttended += 1;
      if (Number(t.enrolled_after) === 1) tConverted += 1;
    }
    const cvr = tReserved > 0 ? Math.round((tConverted / tReserved) * 1000) / 10 : null;

    const detail: DetailBreakdown = {
      year_month: ym,
      members: {
        total_active: totalActive,
        ticket,
        monthly,
        rest,
        other,
        withdrew_total: withdrewTotal,
      },
      lstep: {
        total: lstepTotal,
        blocked: lstepBlocked,
        phase_4a_member: p4a,
        phase_4b_parent: p4b,
        phase_trial_reserved: pTrialReserved,
        phase_trial_done: pTrialDone,
        phase_line_only: pLineOnly,
      },
      links: {
        linked_members: linkedMembers,
        by_relation: { honnin: lkH, hogosha: lkP, koushi: lkT },
        unlinked_members: unlinkedMembers,
      },
      trial: {
        month_reserved: tReserved,
        month_attended: tAttended,
        month_canceled: tCanceled,
        month_converted: tConverted,
        cvr_pct: cvr,
      },
    };

    // ---- UPSERT kpi_snapshots ----
    const existing = await getOne(
      `SELECT id, monthly_revenue, monthly_expense, monthly_profit FROM kpi_snapshots WHERE snapshot_date = ?`,
      [snapshotDate]
    );
    const notesJson = JSON.stringify({ auto: true, generated_at: new Date().toISOString(), detail });

    // monthly_expense は既存値(手動入力されている可能性)を尊重。無ければ0。
    const monthlyExpense = Number(
      (existing as { monthly_expense?: number } | null)?.monthly_expense ?? 0
    );
    const monthlyProfit = monthlyRevenue - monthlyExpense;

    if (existing) {
      // 売上は正準ロジックで上書き(従来は0固定で保存されダッシュボード/月次が¥0になっていた)。
      // monthly_expense は既存値を保持し、profit = revenue - expense で再計算。
      await execute(
        `UPDATE kpi_snapshots SET
          line_friends = ?,
          hacomono_members_active = ?,
          hacomono_members_retired = ?,
          monthly_revenue = ?,
          monthly_profit = ?,
          trial_count = ?,
          new_signup_count = ?,
          retention_count = ?,
          churn_count = ?,
          notes = ?,
          updated_at = datetime('now', 'localtime')
         WHERE snapshot_date = ?`,
        [
          lstepTotal - lstepBlocked,
          totalActive,
          withdrewTotal,
          monthlyRevenue,
          monthlyProfit,
          tReserved,
          newSignup,
          tConverted,
          churn,
          notesJson,
          snapshotDate,
        ]
      );
    } else {
      await execute(
        `INSERT INTO kpi_snapshots (
           snapshot_date, line_friends,
           hacomono_members_active, hacomono_members_retired,
           monthly_revenue, monthly_expense, monthly_profit,
           trial_count, new_signup_count, retention_count, churn_count, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshotDate,
          lstepTotal - lstepBlocked,
          totalActive,
          withdrewTotal,
          monthlyRevenue,
          monthlyExpense,
          monthlyProfit,
          tReserved,
          newSignup,
          tConverted,
          churn,
          notesJson,
        ]
      );
    }

    return NextResponse.json({ ok: true, snapshot_date: snapshotDate, detail });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `KPI集計エラー: ${msg}` }, { status: 500 });
  }
}

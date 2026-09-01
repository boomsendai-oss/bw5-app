import { NextRequest, NextResponse } from 'next/server';
import { notifyTaro } from '@/lib/notify';
import { findMissingRecurringExpenses } from '@/lib/recurringExpenseWatch';
import { getAll } from '@/lib/db';
import { syncCalendarActuals, type SyncResult } from '@/lib/calendarSync';
import { recalcPayroll, recalcStudioBilling, getCloseStatus, detectRoomConflicts } from '@/lib/monthlyClose';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/monthly-close
//
// 月次締めの自動実行。TAROがボタンを押さなくても数字が出ている状態にする。
//   毎日: 当月(と月初は前月も)のカレンダー実績を lesson_instances へ同期
//   月初: 前月の給与draftとスタジオ料を生成し、結果をTAROへメール
//   常時: 締めが進んでいなければ催促
//
// 2026-08時点で経理系の定期実行は1本も無く、給与・スタジオ料・経費が2ヶ月止まっていても
// 誰にも通知が飛ばなかった。**止まったことに気づける**のがこのcronの主目的。
//
// 確定・明細配布・振込CSVは自動化しない(お金が動く操作は人間のゲート)。
// 認証: Bearer CRON_SECRET または x-cron-secret(GH Actions)。
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  const ok = req.headers.get('authorization') === `Bearer ${secret}` || req.headers.get('x-cron-secret') === secret;
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const force = req.nextUrl.searchParams.get('force') === '1'; // 手動確認用
  // 月初は 前月同期+当月同期+前月集計+当月再計算+メール を全部やると
  // Vercelの maxDuration=60秒 を超えて504になる(2026-09-01の初回月初で実測)。
  // phase を指定して分割実行する(GH Actionsが順に呼ぶ)。未指定なら従来どおり全部。
  const phase = req.nextUrl.searchParams.get('phase'); // 'sync-prev' | 'sync-this' | 'close' | null
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const day = Number(today.slice(8, 10));
  const thisYm = today.slice(0, 7);
  const prev = new Date(`${thisYm}-01T00:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevYm = prev.toISOString().slice(0, 7);

  // 月初の数日は前月も同期する。月末ぎりぎりの予定変更を拾うため。
  const syncPrev = (day <= 5 || force) && (!phase || phase === 'sync-prev');
  const syncThis = !phase || phase === 'sync-this';
  // 月初(1〜3日)は前月ぶんを締めにいく
  const doClose = (day <= 3 || force) && (!phase || phase === 'close');

  const syncs: SyncResult[] = [];
  const errors: string[] = [];
  for (const ym of [...(syncPrev ? [prevYm] : []), ...(syncThis ? [thisYm] : [])]) {
    try {
      syncs.push(await syncCalendarActuals(ym, { apply: true }));
    } catch (e) {
      errors.push(`${ym} の同期に失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  let payroll = null, studio = null;
  if (doClose) {
    try { payroll = await recalcPayroll(prevYm); } catch (e) { errors.push(`${prevYm} の給与計算に失敗: ${e instanceof Error ? e.message : e}`); }
    try { studio = await recalcStudioBilling(prevYm); } catch (e) { errors.push(`${prevYm} のスタジオ料集計に失敗: ${e instanceof Error ? e.message : e}`); }
  }

  // 当月のdraftも毎日作り直す(2026-08-30 TARO確認で「毎日自動」に格上げ)。
  // persistPayrollRun/persistStudioBillingRun は draft しか触らないので、
  // 確定済み・支払済みの金額がこのcronで変わることは構造的にない。
  if (syncThis) {
    try { await recalcPayroll(thisYm); } catch (e) { errors.push(`${thisYm} の給与計算に失敗: ${e instanceof Error ? e.message : e}`); }
    try { await recalcStudioBilling(thisYm); } catch (e) { errors.push(`${thisYm} のスタジオ料集計に失敗: ${e instanceof Error ? e.message : e}`); }
  }

  const status = await getCloseStatus(prevYm);
  // 同じ部屋・同じ時間の重複(物理的に不可能=部屋の記録がどこか間違っている)
  const conflicts = [
    ...(await detectRoomConflicts(prevYm)),
    ...(await detectRoomConflicts(thisYm)),
  ];
  // 毎月出るはずの固定費が今月だけ消えていないか。
  // リベシティ¥3,300が7-8月と2ヶ月抜けていた(2026-09-01発覚)。
  // 業務の固定費でも支払いが個人カードだと業務口座のCSVに載らず、静かに落ちる。
  const missingRecurring = doClose
    ? findMissingRecurringExpenses(
        (await getAll(
          `SELECT expense_date, description, category, amount FROM expenses
           WHERE expense_date >= date(? || '-01', '-4 months')`,
          [prevYm]
        )) as { expense_date: string; description: string | null; category: string | null; amount: number }[],
        prevYm
      )
    : [];

  // 決済手数料は hacomono が入金処理をして初めて確定する(当月後半ぶんは翌月15日頃)。
  // 未確定のあいだPLは手数料ぶん過大に出る。放置すると、PL001の取込範囲が
  // 当月+前月なので、確定が遅れた月はそのまま永久に欠ける(2026-09-01に気づいた)。
  const pendingFees = doClose
    ? ((await getAll(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amt
           FROM hacomono_billing_records
          WHERE billing_date LIKE ? AND payment_method LIKE '%カード%' AND fee_amount IS NULL`,
        [`${prevYm}%`]
      )) as { n: number; amt: number }[])[0]
    : null;

  const review = syncs.flatMap((s) => s.needsReview);
  const unregistered = [...new Set(syncs.flatMap((s) => s.unregisteredVenues))];

  // 催促の条件: 前月の給与がまだdraftのまま月の半ばを過ぎた(支払日は翌月15日)
  const overdue = day >= 10 && status.payrollRuns > 0 && status.payrollDraft === status.payrollRuns;

  const yen = (n: number) => `¥${n.toLocaleString()}`;
  const notifyAllowed = !phase || phase === 'close';
  const shouldNotify = notifyAllowed && (doClose || errors.length > 0 || overdue || review.length > 0 || unregistered.length > 0 || conflicts.length > 0 || missingRecurring.length > 0);
  let notified = false;
  if (shouldNotify) {
    const lines: string[] = [];
    lines.push(`【月次締め】${prevYm} の状況`);
    lines.push('');
    lines.push(`給与: ${status.payrollRuns}名 ${yen(status.payrollTotal)}${status.payrollDraft > 0 ? `（うち未確定 ${status.payrollDraft}名）` : '（確定済み）'}`);
    lines.push(`スタジオ・会場費: ${status.studioRuns}件 ${yen(status.studioTotal)}`);
    if (status.awaitingReceipt.length > 0) {
      lines.push('');
      lines.push(`■ 領収書の金額待ち（公共施設）`);
      for (const n of status.awaitingReceipt) lines.push(`  - ${n}`);
    }
    if (review.length > 0) {
      lines.push('');
      lines.push(`■ カレンダーが読めなかった予定（給与に入っていません）`);
      for (const r of review.slice(0, 20)) lines.push(`  - ${r.date} ${r.start} ${r.class_name} … ${r.issues.join(' / ')}`);
    }
    if (pendingFees && pendingFees.n > 0) {
      const est = Math.round(pendingFees.amt * 0.0348); // 実効率3.47〜3.49%の実測から概算
      lines.push('');
      lines.push('■ 決済手数料がまだ確定していません（PLはその分だけ利益が多く出ています）');
      lines.push(`  - ${prevYm}: ${pendingFees.n}件 / 対象売上 ${yen(pendingFees.amt)} → 手数料はおよそ ${yen(est)} 見込み`);
      lines.push('  - hacomonoが入金処理をすると自動で入ります（当月後半ぶんは翌月15日頃）');
    }
    if (missingRecurring.length > 0) {
      lines.push('');
      lines.push('■ 毎月出ているのに今月だけ無い固定費（払い忘れ or 取り込み漏れ）');
      for (const m of missingRecurring.slice(0, 15)) {
        lines.push(`  - ${m.key}（いつも約${yen(m.typicalAmount)}／最後は${m.lastSeen}）`);
      }
    }
    if (unregistered.length > 0) {
      lines.push('');
      lines.push(`■ studios に未登録の会場（スタジオ料が付きません）`);
      for (const n of unregistered) lines.push(`  - ${n}`);
    }
    if (conflicts.length > 0) {
      lines.push('');
      lines.push('■ 同じ部屋・同じ時間に2つのレッスンが入っています(物理的に不可能=どちらかの部屋が違うはず)');
      for (const c of conflicts.slice(0, 10)) {
        lines.push(`  - ${c.date} ${c.studio_name ?? c.studio_id}: 「${c.a.label}」(${c.a.time}) と 「${c.b.label}」(${c.b.time}) が ${c.overlap} で重複`);
      }
    }
    if (payroll && payroll.warnings.length > 0) {
      lines.push('');
      lines.push('■ 給与計算の警告');
      for (const w of payroll.warnings) lines.push(`  - ${w.instructor_name}: ${w.reason}`);
    }
    if (overdue) {
      lines.push('');
      lines.push(`⚠️ ${prevYm} の給与がまだ未確定です。支払日は ${prevYm.slice(0, 4)}-${String(Number(prevYm.slice(5, 7)) + 1).padStart(2, '0')}-15 です。`);
    }
    if (errors.length > 0) {
      lines.push('');
      lines.push('🔴 エラー');
      for (const e of errors) lines.push(`  - ${e}`);
    }
    lines.push('');
    lines.push('確定・明細配布・振込CSVは https://bw5-app.vercel.app/staff/payroll から。');

    await notifyTaro({
      subject: `[月次締め] ${prevYm} 給与${yen(status.payrollTotal)} / スタジオ${yen(status.studioTotal)}${errors.length ? ' ※エラーあり' : ''}`,
      body: lines.join('\n'),
    });
    notified = true;
  }

  return NextResponse.json({
    ok: errors.length === 0,
    today, phase: phase ?? 'all', closed: doClose, notified, overdue,
    missingRecurring: missingRecurring.length,
    pendingFeeCount: pendingFees?.n ?? 0,
    syncs: syncs.map((s) => ({
      year_month: s.year_month, range: s.range, skipped: s.skippedReason ?? null,
      held: s.held, notHeld: s.notHeld, extra: s.extra, written: s.written,
      needsReview: s.needsReview.length, untouchedSlots: s.untouchedSlots,
    })),
    payroll: payroll && { calculated: payroll.calculated, warnings: payroll.warnings.length },
    studio: studio && { calculated: studio.calculated },
    status,
    roomConflicts: conflicts,
    errors,
  });
}

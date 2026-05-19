import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/staff/master/lessons/backfill-times
// lesson_utilization (RS002) のデータから lesson_master の時間データを自動補完
//
// マッチング:
//   1. lesson_master.class_name と lesson_utilization.program_name の部分一致 (双方向)
//   2. lesson_master.default_day_of_week と lesson_utilization の曜日 が一致
//   3. 一致した中で頻度最多の (start_time, end_time) を採用
//
// 既に時間が入っているmasterは上書きしない (force=true で上書き)
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const force = body.force === true;

  type Master = { id: number; class_name: string; default_day_of_week: number | null; default_start_time: string | null; default_end_time: string | null };
  const masters = (await getAll(
    `SELECT id, class_name, default_day_of_week, default_start_time, default_end_time FROM lesson_master WHERE active = 1`
  )) as Master[];

  type Util = { lesson_date: string; start_time: string; end_time: string; program_name: string };
  const utils = (await getAll(`SELECT lesson_date, start_time, end_time, program_name FROM lesson_utilization`)) as Util[];

  // utilに曜日列を付与
  const utilsWithDow = utils.map(u => {
    const d = new Date(u.lesson_date);
    return { ...u, dow: d.getDay() };
  });

  let updated = 0;
  const results: { id: number; class_name: string; start_time: string; end_time: string; matched_program: string; count: number }[] = [];
  for (const m of masters) {
    if (!force && m.default_start_time && m.default_end_time) continue;
    if (m.default_day_of_week === null) continue;

    // 部分一致マッチ
    const candidates = utilsWithDow.filter(u => {
      if (u.dow !== m.default_day_of_week) return false;
      const mn = (m.class_name ?? '').replace(/\s+/g, '').toLowerCase();
      const pn = (u.program_name ?? '').replace(/\s+/g, '').toLowerCase();
      if (!mn || !pn) return false;
      // どちらかが他方に部分マッチ
      return mn.includes(pn.substring(0, Math.min(6, pn.length))) || pn.includes(mn.substring(0, Math.min(6, mn.length)));
    });
    if (candidates.length === 0) continue;

    // (start_time, end_time) の最頻値
    const counts = new Map<string, number>();
    for (const c of candidates) {
      const key = `${c.start_time}_${c.end_time}_${c.program_name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) continue;
    const [bestKey, bestCount] = best;
    const [start, end, prog] = bestKey.split('_');
    if (!start || !end) continue;

    const duration = minBetween(start, end);
    await execute(
      `UPDATE lesson_master SET default_start_time = ?, default_end_time = ?, duration_minutes = COALESCE(duration_minutes, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [start, end, duration, m.id]
    );
    updated++;
    results.push({ id: m.id, class_name: m.class_name, start_time: start, end_time: end, matched_program: prog, count: bestCount });
  }

  return NextResponse.json({ ok: true, updated, results, total_masters: masters.length, total_utilization_rows: utils.length });
}

function minBetween(s: string, e: string): number {
  const [sh, sm] = s.split(':').map(Number);
  const [eh, em] = e.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { todayJst, shiftDays } from '@/lib/dateJst';
import { TRACKED_QUERIES } from '@/lib/seoTracking';
import {
  fetchDailyMetrics,
  configured as gbpPerfConfigured,
  PerformanceApiDisabledError,
} from '@/lib/gbpPerformance';
import {
  fetchQueryStats,
  filterTracked,
  configured as gscConfigured,
} from '@/lib/searchConsole';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// SEO順位・GBPパフォーマンスの定期記録 (週1想定)。
//
// 2つのソースを独立に取りに行き、**片方が落ちてももう片方は記録する**。
// (GSCは移管完了まで使えず、GBPパフォーマンスはAPI有効化までは403になるため、
//  「片方だけ動く」期間が実際に存在する)
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true;
  return req.headers.get('x-cron-secret') === secret;
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = todayJst();
  /** JSTの今日からN日前 */
  const daysAgoJst = (n: number) => shiftDays(today, -n);
  const result: Record<string, unknown> = { date: today };

  // ---- GBPパフォーマンス ----
  // 反映が数日遅れるので、過去35日を毎回取り直して UPSERT する(遅れて埋まる分を拾う)
  if (!gbpPerfConfigured()) {
    result.gbp = { ok: false, note: 'GBP連携env未設定' };
  } else {
    try {
      const rows = await fetchDailyMetrics(daysAgoJst(35), daysAgoJst(1));
      let n = 0;
      for (const r of rows) {
        const res = await execute(
          `INSERT INTO gbp_performance_daily (metric_date, metric, value)
           VALUES (?, ?, ?)
           ON CONFLICT(metric_date, metric) DO UPDATE SET value = excluded.value`,
          [r.metric_date, r.metric, r.value]
        );
        n += res.rowsAffected ?? 0;
      }
      result.gbp = { ok: true, rows: rows.length, upserted: n };
    } catch (e) {
      const disabled = e instanceof PerformanceApiDisabledError;
      result.gbp = {
        ok: false,
        needsApiEnable: disabled,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // ---- Search Console ----
  // GSCはデータ確定が2〜3日遅れるので、直近28日の平均で見る
  if (!gscConfigured()) {
    result.gsc = { ok: false, note: 'Search Console連携env未設定(ドメイン移管の完了待ち)' };
  } else {
    try {
      const all = await fetchQueryStats(daysAgoJst(30), daysAgoJst(3));
      const tracked = filterTracked(all, TRACKED_QUERIES);
      let n = 0;
      for (const r of tracked) {
        const res = await execute(
          `INSERT INTO seo_rank_snapshots
             (measured_on, source, query, target, position, out_of_range, impressions, clicks, note)
           VALUES (?, 'gsc', ?, 'hp', ?, 0, ?, ?, ?)
           ON CONFLICT(measured_on, source, query, target) DO UPDATE SET
             position = excluded.position,
             impressions = excluded.impressions,
             clicks = excluded.clicks`,
          [today, r.query, r.position, r.impressions, r.clicks, '直近28日の平均掲載順位']
        );
        n += res.rowsAffected ?? 0;
      }
      // GSCに出てこなかった追跡キーワード = 表示ゼロ = 圏外として記録する
      // (行が来ないことを「データ無し」で流すと、圏外なのか計測漏れなのか分からなくなる)
      const seen = new Set(tracked.map((r) => r.query.replace(/[\s　]/g, '')));
      for (const t of TRACKED_QUERIES) {
        if (seen.has(t.query.replace(/[\s　]/g, ''))) continue;
        await execute(
          `INSERT INTO seo_rank_snapshots
             (measured_on, source, query, target, position, out_of_range, impressions, clicks, note)
           VALUES (?, 'gsc', ?, 'hp', NULL, 1, 0, 0, ?)
           ON CONFLICT(measured_on, source, query, target) DO NOTHING`,
          [today, t.query, 'GSCに表示実績なし(=圏外)']
        );
      }
      result.gsc = { ok: true, total: all.length, tracked: tracked.length, upserted: n };
    } catch (e) {
      result.gsc = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({ ok: true, ...result });
}

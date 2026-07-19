import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { todayJst, weekdayJst } from '@/lib/dateJst';
import { configured, connectionStatus, refreshTokenIfStale } from '@/lib/instagram';
import { findChainMediaList, loadSidecar, checkSchedule } from '@/lib/storyPlan';
import { notifyTaro } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/story-watchdog
// GitHub Actions とは別の故障ドメイン(Vercel Cron)で毎朝 JST~9:10 に走る監視+自己修復役。
//   (1) トークン延命(無条件): refreshTokenIfStale(投稿が無い日でも60日失効を防ぐ)。
//   (2) 自己修復: 「素材はあるのに未投稿」を検知したら post-story を1回叩いて欠落を埋める
//        (GH cron不発の自動復旧)。二重投稿は post-story 側の claim ロックで構造的に防止。
//   (3) 通知: 自己修復後もなお残る異常(mismatch/エラー/タグ劣化/トークン)だけを1通。
//        GH不発を自動復旧した場合は低刺激の情報通知(GHの不調をTAROが把握できるように)。
//   (4) ハートビート: HEALTHCHECKS_URL 設定時、通知が必要なのに送れた時だけ success ping。
// 全て正常なら無音。素材が無い日(火曜など)も無音。壁時計JST9時前は投稿判定しない。
// 認証: sync-lesson-calendar と同じ CRON_SECRET(Vercelが Authorization: Bearer で送る)。

type PlanEval = {
  expectedCount: number;
  postedCount: number;
  missing: string[]; // 未投稿スロットの理由文
  tagDegraded: string[];
  attemptedAny: boolean;
};

async function evaluatePlan(origin: string, date: string, weekday: number): Promise<PlanEval> {
  const expected = await findChainMediaList(origin, date, weekday);
  if (expected.length === 0) {
    return { expectedCount: 0, postedCount: 0, missing: [], tagDegraded: [], attemptedAny: false };
  }

  const rows = await getAll('SELECT video_path, status, error FROM story_post_log WHERE date = ?', [date]);
  const byPath = new Map<string, Array<{ status: string; error: string | null }>>();
  for (const r of rows) {
    const p = String(r.video_path);
    if (!byPath.has(p)) byPath.set(p, []);
    byPath.get(p)!.push({ status: String(r.status), error: r.error ? String(r.error) : null });
  }

  const missing: string[] = [];
  let postedCount = 0;
  let attemptedAny = false;

  for (const media of expected) {
    const logs = byPath.get(media.url) ?? [];
    if (logs.length > 0) attemptedAny = true;
    if (logs.some((l) => l.status === 'posted')) {
      postedCount++;
      continue;
    }
    const mismatch = logs.find((l) => l.status === 'skipped_schedule_mismatch');
    const errored = logs.find((l) => l.status === 'error');
    if (mismatch) {
      missing.push(`❌ ${media.base}: スケジュール不一致で未投稿 — ${mismatch.error ?? ''}`);
    } else if (errored) {
      missing.push(`❌ ${media.base}: 投稿エラー — ${errored.error ?? ''}`);
    } else {
      const sc = await checkSchedule(date, (await loadSidecar(origin, media.base)).lessons).catch(() => null);
      const hint = sc && sc.result === 'mismatch' ? `(照合: ${sc.problems.join(' / ')})` : '(未起動→自己修復対象)';
      missing.push(`❌ ${media.base}: 未投稿 ${hint}`);
    }
  }

  const tagDegraded: string[] = [];
  try {
    const tagRows = await getAll(
      "SELECT video_path, mentions_failed FROM story_post_log WHERE date = ? AND status = 'posted' AND mentions_failed IS NOT NULL AND mentions_failed != '' AND mentions_failed != '[]'",
      [date]
    );
    for (const t of tagRows) {
      tagDegraded.push(`△ ${String(t.video_path).split('/').pop()}: タグ付け一部失敗 — ${t.mentions_failed}`);
    }
  } catch {
    // mentions_failed列が未適用なら無視
  }

  return { expectedCount: expected.length, postedCount, missing, tagDegraded, attemptedAny };
}

type ReelEval = {
  overdueHealable: Array<{ id: number; title: string; hours: number }>;
  other: string[]; // 自動修復に回さない異常(超過しすぎ/詰まり/失敗)
};

// リールの見張り。reel_queue は post-reel が1回1件だけ出す設計なので、
// 「予約時刻を過ぎたのに scheduled のまま」= 未投稿。
//   - 超過12時間以内 → 自己修復(post-reelをその件数だけ叩く)
//   - 超過12時間超   → 鮮度の判断が要るので自動投稿せず通知のみ
//   - posting で停止  → 二重投稿の恐れがあるため自動リセットせず通知のみ(IG側の確認が先)
//   - failed(24h以内) → 通知
//   - 1週間以上放置の scheduled は手動整理待ちとみなし鳴らさない(恒久ノイズ回避)
async function evaluateReels(): Promise<ReelEval> {
  const rows = await getAll(
    "SELECT id, title, scheduled_at, status, error, updated_at FROM reel_queue WHERE status IN ('scheduled','posting','failed')"
  );
  const now = Date.now();
  const out: ReelEval = { overdueHealable: [], other: [] };

  for (const r of rows) {
    const status = String(r.status);
    const id = Number(r.id);
    const title = String(r.title ?? `#${id}`);

    if (status === 'scheduled') {
      const at = Date.parse(String(r.scheduled_at));
      if (!Number.isFinite(at) || at > now) continue; // まだ予約時刻前=正常
      const hours = (now - at) / 3600000;
      if (hours > 24 * 7) continue;
      if (hours <= 12) out.overdueHealable.push({ id, title, hours });
      else
        out.other.push(
          `⏰ リール「${title}」(#${id}): 予約時刻を${Math.floor(hours)}時間超過。鮮度の判断が要るため自動投稿は見送りました(手動で公開 or 予約し直しを)。`
        );
    } else if (status === 'posting') {
      const upd = Date.parse(String(r.updated_at ?? ''));
      if (Number.isFinite(upd) && now - upd > 30 * 60 * 1000) {
        out.other.push(
          `🧊 リール「${title}」(#${id}): 「処理中」のまま止まっています。Instagram側に既に出ていないか確認してから手動で再開してください(自動リセットは二重投稿の恐れがあるため行いません)。`
        );
      }
    } else if (status === 'failed') {
      const upd = Date.parse(String(r.updated_at ?? ''));
      if (!Number.isFinite(upd) || now - upd < 24 * 3600 * 1000) {
        out.other.push(`❌ リール「${title}」(#${id}): 投稿失敗 — ${r.error ?? ''}`);
      }
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  // Vercel Cron(Bearer)と GitHub Actions(x-cron-secret)の両方から叩けるようにする。
  // 朝=Vercel Cron(ストーリー中心)/夜=GH Actions(リール中心)の2回運用。
  const bearerOk = req.headers.get('authorization') === `Bearer ${secret}`;
  const xcronOk = req.headers.get('x-cron-secret') === secret;
  if (!bearerOk && !xcronOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const anomalies: string[] = []; // 要対応
  const notes: string[] = []; // 情報(自己修復の報告など)

  // (1) トークン延命(無条件)
  try {
    await refreshTokenIfStale();
  } catch (e) {
    anomalies.push(`⚠️ Instagramトークン更新に失敗: ${e instanceof Error ? e.message : e}(60日失効の恐れ・要再連携確認)`);
  }
  try {
    const cs = await connectionStatus();
    if (cs.connected && typeof cs.tokenAgeDays === 'number' && cs.tokenAgeDays > 50) {
      anomalies.push(`⚠️ Instagramトークンが${cs.tokenAgeDays}日経過(60日で失効)。更新が繰り返し失敗している可能性。`);
    }
  } catch {
    // 非致命
  }

  if (!configured()) {
    if (anomalies.length > 0) await safeNotify('設定未完了', anomalies);
    return NextResponse.json({ ok: true, configured: false, anomalies });
  }

  const date = todayJst();
  const weekday = weekdayJst(date);
  const origin = new URL(req.url).origin;
  const jstHour = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
  const deadmanActive = jstHour >= 9; // JST9時前は「未投稿」を判定しない(朝のcron着地待ち)
  // ストーリーの自己修復は朝のうちだけ。夜のwatchdogが「今日のレッスン」を夜に出してしまう事故を防ぐ。
  const storyHealAllowed = jstHour >= 9 && jstHour < 12;

  let expectedCount = 0;
  let postedCount = 0;
  let selfHealAttempted = false;

  if (deadmanActive) {
    let ev = await evaluatePlan(origin, date, weekday);
    expectedCount = ev.expectedCount;

    // (2) 自己修復: 未投稿があれば post-story を1回叩いて埋める(claimで二重投稿防止)
    if (ev.missing.length > 0 && storyHealAllowed) {
      selfHealAttempted = true;
      const before = ev.missing.length;
      try {
        await fetch(`${origin}/api/cron/post-story`, { method: 'POST', headers: { 'x-cron-secret': secret } });
      } catch (e) {
        anomalies.push(`⚠️ 自己修復の再投稿呼び出しに失敗: ${e instanceof Error ? e.message : e}`);
      }
      ev = await evaluatePlan(origin, date, weekday); // 再評価
      const recovered = before - ev.missing.length;
      if (recovered > 0) {
        notes.push(`ℹ️ 朝のGH Actions cronが未達でしたが、watchdogが自動投稿で${recovered}本を復旧しました。`);
      }
    } else if (ev.missing.length > 0) {
      notes.push('（時間帯が朝を過ぎているため、ストーリーの自動投稿は見送り通知のみにしています）');
    }

    postedCount = ev.postedCount;
    // 自己修復後もなお残る欠落(=mismatch等の要人手)・タグ劣化を通知対象へ
    anomalies.push(...ev.missing, ...ev.tagDegraded);
  }

  // (2b) リールの見張り: 予約時刻を過ぎたのに未投稿なら自己修復、その他の異常は通知
  let reelRecovered = 0;
  try {
    let rev = await evaluateReels();
    if (rev.overdueHealable.length > 0) {
      const before = rev.overdueHealable.length;
      // post-reel は1回1件しか出さないので、期限切れの件数ぶん(最大3回)叩く
      for (let i = 0; i < Math.min(before, 3); i++) {
        try {
          await fetch(`${origin}/api/cron/post-reel`, { method: 'POST', headers: { 'x-cron-secret': secret } });
        } catch (e) {
          anomalies.push(`⚠️ リール自己修復の呼び出しに失敗: ${e instanceof Error ? e.message : e}`);
          break;
        }
      }
      rev = await evaluateReels();
      reelRecovered = before - rev.overdueHealable.length;
      if (reelRecovered > 0) {
        notes.push(`ℹ️ 予約時刻を過ぎていたリール${reelRecovered}本を、watchdogが自動投稿で復旧しました。`);
      }
    }
    anomalies.push(
      ...rev.overdueHealable.map(
        (o) => `❌ リール「${o.title}」(#${o.id}): 予約から${Math.floor(o.hours)}時間経過しても未投稿(自動投稿を試みましたが復旧できず)。`
      ),
      ...rev.other
    );
  } catch (e) {
    console.warn(`リール監視に失敗(ストーリー側は継続): ${e instanceof Error ? e.message : e}`);
  }

  // (3) 通知
  const needNotify = anomalies.length > 0 || notes.length > 0;
  let notifySucceeded = true;
  if (anomalies.length > 0) {
    notifySucceeded = await safeNotify(`要対応 ${date}`, [...anomalies, ...notes]);
  } else if (notes.length > 0) {
    notifySucceeded = await safeNotify(`自動復旧 ${date}`, notes);
  }

  // (4) ハートビート: 通知が要らない or 通知が成功した時だけ success ping
  const hc = process.env.HEALTHCHECKS_URL;
  if (hc && (!needNotify || notifySucceeded)) {
    await fetch(hc, { method: 'GET' }).catch(() => null);
  }

  return NextResponse.json({
    ok: anomalies.length === 0,
    date,
    deadmanActive,
    expected: expectedCount,
    posted: postedCount,
    selfHealAttempted,
    reelRecovered,
    anomalies,
    notes,
    notified: needNotify ? notifySucceeded : undefined,
  });
}

async function safeNotify(subject: string, lines: string[]): Promise<boolean> {
  try {
    await notifyTaro({ subject, body: lines.join('\n') });
    return true;
  } catch (e) {
    console.error(`watchdog通知失敗: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

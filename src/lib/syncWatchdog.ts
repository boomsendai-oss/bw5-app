// src/lib/syncWatchdog.ts — 日次同期(daily_sync.py)のデッドマンスイッチ判定。
//
// 「失敗した」通知だけでは *プロセスが起動すらしなかった場合* を検知できない
// (Macのスリープ・旅行中の停止)。その場合 sync_runs に行が1つも増えないため、
// 「最後に成功してから何時間経ったか」を別の故障ドメイン(Vercel Cron)から見張る。
//
// 時刻を引数で受け取る純関数にしてあるのは、単体テストで固定できるようにするため。

/** 最後の成功からこの時間を超えたら異常とみなす。通常は6h間隔なので1回飛ばしは許容する。 */
export const SYNC_STALE_HOURS = 14;

export type SyncFreshness = {
  stale: boolean;
  /** 最後の成功からの経過時間(時)。判定不能なら null */
  hours: number | null;
  /** 異常時の通知本文。正常なら null */
  message: string | null;
};

/**
 * @param lastOkAt sync_runs で status='ok' の最新 ran_at (UTC 'YYYY-MM-DD HH:MM:SS')。無ければ null
 * @param now 現在時刻
 * @param lastAnyAt status問わず最新の ran_at。渡すと「起動していないのか/動いているが失敗しているのか」を
 *   区別した本文にする(2026-07-29: 実際は連続失敗だったのに「Macがスリープ」と誤診し調査が遠回りした)。
 */
export function evaluateSyncFreshness(
  lastOkAt: string | null,
  now: Date,
  lastAnyAt?: string | null
): SyncFreshness {
  if (!lastOkAt) {
    return {
      stale: true,
      hours: null,
      message:
        '日次同期が一度も成功していません。事務所Macのcronが動いているか確認してください。',
    };
  }

  // sync_runs.ran_at は UTC。'YYYY-MM-DD HH:MM:SS' を ISO に直して解釈する。
  const parsed = Date.parse(`${lastOkAt.replace(' ', 'T')}Z`);
  if (!Number.isFinite(parsed)) {
    return {
      stale: true,
      hours: null,
      message: `日次同期の最終成功時刻を解釈できませんでした (${lastOkAt})。sync_runs を確認してください。`,
    };
  }

  const hours = Math.floor((now.getTime() - parsed) / 3600000);
  // 未来日付(時計ズレ)は異常扱いにしない。誤爆でノイズを出す方が害が大きい。
  if (hours < 0) {
    return { stale: false, hours: 0, message: null };
  }
  if (hours < SYNC_STALE_HOURS) {
    return { stale: false, hours, message: null };
  }

  // 起動自体はしているのに成功しない = 「Macがスリープ」ではなく取得失敗の連続。
  // 直近3時間以内に(status問わず)実行行があるならその旨を明示する。
  const lastAny = lastAnyAt ? Date.parse(`${lastAnyAt.replace(' ', 'T')}Z`) : NaN;
  const ranRecently = Number.isFinite(lastAny) && now.getTime() - lastAny < 3 * 3600000;
  if (ranRecently) {
    return {
      stale: true,
      hours,
      message:
        `⚠️ 日次同期は動いていますが、${hours}時間"成功"していません(直近の実行は失敗/部分成功)。` +
        'Macのスリープではなく、HACOMONO/LstepのCSV取得が連続で失敗している可能性が高いです。logs/launchd.log を確認してください。',
    };
  }

  return {
    stale: true,
    hours,
    message:
      `⚠️ 日次同期が${hours}時間成功していません(通常は6時間ごと)。` +
      '事務所Macがスリープしている、またはcronが動いていない可能性があります。',
  };
}

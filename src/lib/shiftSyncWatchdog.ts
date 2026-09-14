// src/lib/shiftSyncWatchdog.ts — Lステップ シフト同期のデッドマンスイッチ判定。
//
// シフト同期(boom-events-hub の GitHub Actions・毎朝5時JST)は、動きがあった日しか
// メールを出さない。「何も来ない＝正常」にしないと、毎朝の無変更メールを読まなくなり、
// 肝心な日を見落とすため。
//
// ただしそれだと「止まっていること」に人間が気づけない。人に「無いこと」の検知を
// させてはいけないので、止まったらこちらから鳴らす。
//
// 時刻を引数で受け取る純関数にしてあるのは、単体テストで固定できるようにするため。

/** 最後の成功からこの時間を超えたら異常とみなす。
 *
 * 同期は毎日1回なので正常な間隔は24時間。ただし GitHub Actions の schedule は
 * +1.5〜5時間ずれるのが実測値(reference_gh_actions_cron_drift)なので、正常な
 * 最大間隔は約29時間。
 *
 * 50h にしているのは「2日連続で成功していない」を捕まえる水準にするため。
 * GitHubは負荷時にスケジュール実行を落とすことがあり、1回の取りこぼしで鳴らすと
 * 誤報になる。誤報で通知を無視されるようになる方が危険。
 *
 * 検知が1日遅れても実害はない(このジョブは12週間先までの休講を追うもので、
 * 1〜2日の遅れで予約に影響しない)。 */
export const SHIFT_SYNC_STALE_HOURS = 50;

export type ShiftSyncFreshness = {
  stale: boolean;
  /** 最後の成功からの経過時間(時)。判定不能なら null */
  hours: number | null;
  /** 異常時の通知本文。正常なら null */
  message: string | null;
};

/**
 * @param lastOkAt settings('lstep_shift_sync_last_ok') に入っているISO文字列。無ければ null
 * @param now 現在時刻
 */
export function evaluateShiftSyncFreshness(lastOkAt: string | null, now: Date): ShiftSyncFreshness {
  if (!lastOkAt) {
    return {
      stale: true,
      hours: null,
      message:
        'Lステップのシフト同期が一度も成功していません。boom-events-hub の lstep-shift-sync ワークフローを確認してください。',
    };
  }

  const parsed = Date.parse(lastOkAt);
  if (!Number.isFinite(parsed)) {
    return {
      stale: true,
      hours: null,
      message: `Lステップのシフト同期の最終成功時刻を解釈できませんでした (${lastOkAt})。`,
    };
  }

  const hours = Math.floor((now.getTime() - parsed) / 3600000);
  // 時計ズレによる未来日付は異常扱いにしない。誤爆でノイズを出す方が害が大きい。
  if (hours < 0) return { stale: false, hours: 0, message: null };
  if (hours < SHIFT_SYNC_STALE_HOURS) return { stale: false, hours, message: null };

  return {
    stale: true,
    hours,
    message:
      `Lステップのシフト同期が${hours}時間成功していません。` +
      'GitHub Actions (boom-events-hub / lstep-shift-sync) の実行結果と、' +
      'Lステップのセッションが切れていないかを確認してください。',
  };
}

// 「時間帯別の枠(story_day_slot)」の投稿漏れを見張る純関数(TARO 2026-08-23)。
//
// なぜ要るか: story-watchdog の従来の見張り(evaluatePlan)は「曜日ライブラリ/日付指定の
// レッスン告知」しか対象にしておらず、枠は一切見ていなかった。そのため朝のレッスン告知さえ
// 出ていれば、昼や夜の枠が丸ごと落ちても警報が鳴らない。実際 2026-08-23 12:00 のBW6ティザーが
// 静かに未投稿のまま止まり、TAROが気づくまで誰も検知できなかった。
// バトルのカウントダウン(「あと3日」等)は日付そのものが意味を持つので、1本落ちると
// 後から出しても取り返しがつかない。だから「予定時刻を過ぎても出ていない枠」を明示的に探す。

export type WatchedSlot = {
  slotTime: string; // 'HH:MM' JST
  mediaPath: string;
  note: string | null;
};

export type OverdueSlot = {
  slotTime: string;
  mediaPath: string;
  note: string | null;
  lateMinutes: number;
};

/** 'HH:MM' → 0時からの分。壊れた値は null(呼び出し側で無視する)。 */
export function hhmmToMinutes(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * post-story の冪等判定(同じ日の同じ枠は cron が何度走っても1回しか投稿しない)。
 * postedKeys は story_post_log の slotKey 済みキー(origin非依存の pathname + '#HH:MM')。
 * slotTime が空なら通常素材(朝の告知・pin)、あれば時間帯別の枠。
 *
 * 枠は「時刻つきキー」に加えて「素のパス」とも照合する。冪等キーの形式を
 * 時刻なし→時刻つきへ変えた 2026-08-23、同日中に旧形式で記録済みの行(id=71)と
 * 新キーが一致せず、夕方のcronが同じ枠を再投稿した(id=72)。チェック側が旧形式を
 * 知らないとキー形式の変更が即・二重投稿になるため、判定は findOverdueSlots と
 * 同じ両対応ルールに固定する(watchdogと食い違うと誤警報/二重投稿のどちらかが起きる)。
 * 通常素材は逆に時刻つきキーと照合しない(枠との同日併用は別カウントが仕様)。
 */
export function alreadyPostedToday(postedKeys: string[], pathKey: string, slotTime: string): boolean {
  const posted = new Set(postedKeys);
  if (slotTime !== '') {
    return posted.has(`${pathKey}#${slotTime}`) || posted.has(pathKey);
  }
  return posted.has(pathKey);
}

/**
 * 予定時刻から graceMinutes 以上過ぎたのに投稿ログが無い枠を返す。
 *
 * nowMinutes は「その枠の日付の 0:00 から見た現在の分」。前日ぶんを点検するときは
 * 呼び出し側が +1440 して渡す(翌朝9:10に前夜21:00の枠を評価する等)。
 * postedKeys は story_post_log の投稿済みキー(origin非依存の pathname + '#HH:MM')。
 * 同じ画像を1日に2回出す枠(9/24の締切当日など)を別物として数えるため、キーに時刻を含める。
 */
export function findOverdueSlots(
  slots: WatchedSlot[],
  postedKeys: string[],
  nowMinutes: number,
  graceMinutes = 60
): OverdueSlot[] {
  const out: OverdueSlot[] = [];
  for (const sl of slots) {
    const due = hhmmToMinutes(sl.slotTime);
    if (due === null) continue;
    const late = nowMinutes - due;
    if (late < graceMinutes) continue; // まだ猶予の中(cronの遅延は正常)
    if (alreadyPostedToday(postedKeys, sl.mediaPath, sl.slotTime)) continue;
    out.push({ slotTime: sl.slotTime, mediaPath: sl.mediaPath, note: sl.note, lateMinutes: late });
  }
  return out;
}

/** 通知メールに載せる1行。何を出し損ねたのかが件名だけで分かるようにする。 */
export function describeOverdueSlot(date: string, s: OverdueSlot): string {
  const file = s.mediaPath.split('/').pop() ?? s.mediaPath;
  const h = Math.floor(s.lateMinutes / 60);
  const late = h >= 1 ? `${h}時間${s.lateMinutes % 60}分` : `${s.lateMinutes}分`;
  return `❌ ストーリー枠 ${date} ${s.slotTime}(${file}): 予定時刻を${late}過ぎても未投稿です。${s.note ? ` — ${s.note}` : ''}`;
}

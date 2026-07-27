// src/lib/trialAttendance.ts — 体験予約の「来店したか」判定 (WS AA / 2026-07-27)
//
// 背景: 元は運営がLstepで来店フラグを手で打つ設計だったが実行されておらず、
// 140件中 来店確認済はわずか5件・「ノーショー候補50人」が毎日通知される状態だった。
// 実際に発生しているシグナル(顧客/スタッフが押すキャンセル)だけで自動判定する方式に変えた。
//
// status 列は書き換えない。Lstep CSV が正本で再取込のたびに上書きされるため、
// 書き込んでも次の同期で消える。人が下した訂正だけ attendance_override に永続化する。
//
// 判定は日付単位で行う。reserved_at はJSTの 'YYYY-MM-DD HH:MM:SS'、
// 当日分は日が終わるまで「予約済」に留める(まだ来ていないかもしれないため)。

export type TrialAttendance = '予約済' | '来店' | 'キャンセル' | 'ノーショー';

export type AttendanceInput = {
  /** Lstep CSV 由来のステータス */
  status: string | null;
  /** 人が下した訂正。'noshow' または null */
  attendance_override: string | null;
  /** 'YYYY-MM-DD HH:MM:SS' (JST) */
  reserved_at: string;
};

/**
 * @param todayJstStr 今日の日付(JST) 'YYYY-MM-DD'。lib/dateJst の todayJst() を渡す
 */
export function resolveAttendance(row: AttendanceInput, todayJstStr: string): TrialAttendance {
  // キャンセルは最優先。キャンセル済みをノーショーとして二重に数えない。
  if ((row.status ?? '').trim() === 'キャンセル') return 'キャンセル';
  if ((row.attendance_override ?? '').trim() === 'noshow') return 'ノーショー';
  const day = (row.reserved_at ?? '').slice(0, 10);
  if (day && day < todayJstStr) return '来店';
  return '予約済';
}

/** CVRの分母(=実施済みの体験)に数えるか。 */
export function isTrialDenominator(row: AttendanceInput, todayJstStr: string): boolean {
  return resolveAttendance(row, todayJstStr) === '来店';
}

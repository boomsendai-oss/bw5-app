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
  /** 人が下した訂正。schema上の許容値は 'noshow' のみ(db/schema.ts参照)。未訂正は null */
  attendance_override: 'noshow' | null;
  /** 'YYYY-MM-DD HH:MM:SS' (JST)。parseDateTime(csvUtil.ts)はゼロ埋めも検証もしないため
   *  '2026-7-1 ...' のような非ゼロ埋めや '2026' のような欠損値がそのまま入り得る。 */
  reserved_at: string;
};

// reserved_at の先頭が 'YYYY-MM-DD' 形式かどうか。ゼロ埋め前提の辞書順比較が安全に行える形かの検証。
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/**
 * reserved_at の日付部分がゼロ埋め 'YYYY-MM-DD' として解釈できるか。
 * 集計側で月キーを作る前の検証にも使う (resolveAttendance はキャンセル/ノーショーを
 * 日付検証より先に返すため、その分岐では日付の妥当性が保証されない)。
 */
export function hasParsableTrialDate(reservedAt: string | null | undefined): boolean {
  return ISO_DATE_PREFIX.test((reservedAt ?? '').slice(0, 10));
}

/**
 * @param todayJstStr 今日の日付(JST) 'YYYY-MM-DD'。lib/dateJst の todayJst() を渡す
 */
export function resolveAttendance(row: AttendanceInput, todayJstStr: string): TrialAttendance {
  // キャンセルは最優先。キャンセル済みをノーショーとして二重に数えない。
  if ((row.status ?? '').trim() === 'キャンセル') return 'キャンセル';
  // 人による訂正はカレンダー(未来日か否か)より優先して信頼する。
  // そのため未来日の予約でも override があればここで即座に確定する。
  if (row.attendance_override === 'noshow') return 'ノーショー';

  const day = (row.reserved_at ?? '').slice(0, 10);
  // reserved_at がゼロ埋め 'YYYY-MM-DD' の形でなければ辞書順比較が壊れる
  // (例: '2026-7-1' は '2026-07-27' より大きい扱いになり、7/1の来店が永久に'予約済'のまま=分母の過少計上。
  //      '2026' のような欠損値は逆に常に「過去日」と判定され=分母の過大計上)。
  // 出どころを信用できない日付は集計対象外の'予約済'にfail closedし、分子・分母どちらにも入れない。
  if (!hasParsableTrialDate(day)) return '予約済';
  if (day < todayJstStr) return '来店';
  return '予約済';
}

/** CVRの分母(=実施済みの体験)に数えるか。 */
export function isTrialDenominator(row: AttendanceInput, todayJstStr: string): boolean {
  return resolveAttendance(row, todayJstStr) === '来店';
}

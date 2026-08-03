// 日付リマインダー — 純関数のみ(送信は notify.ts / DBは route 側)。
//
// 「N日後にこれをやる」という約束を、人の記憶とドキュメントに預けないための仕組み。
// STATE.md に書くだけでは、その日に誰かがそこを読まないと気づけない。
//
// 既存の reel-decision-reminder は「1件専用・日付ベタ書き・settingsにフラグ」だった。
// 同じものを増やすたびにルートを増やすのは無駄なので、行を足すだけで済む形にする。

export type ReminderRow = {
  id: number;
  /** JSTの YYYY-MM-DD。この日から送信対象になる */
  due_date: string;
  title: string;
  body: string;
  /** 送信済み時刻(UTC ISO)。入っていたら二度と送らない */
  sent_at: string | null;
};

/**
 * 送信すべきリマインダーを選ぶ。
 *
 * 期日を「過ぎていても」未送信なら拾う。cronが落ちていた日があっても
 * 取りこぼさないため(期日ちょうどの日だけを見ると、その日に失敗したら永久に届かない)。
 */
export function pickDue(rows: ReminderRow[], todayJst: string): ReminderRow[] {
  return rows
    .filter((r) => !r.sent_at && r.due_date <= todayJst)
    .sort((a, b) => (a.due_date !== b.due_date ? (a.due_date < b.due_date ? -1 : 1) : a.id - b.id));
}

/** 通知本文を組み立てる。todayJst を渡すと期日超過を知らせる一行を足す */
export function formatReminderBody(r: ReminderRow, todayJst?: string): string {
  const lines = [r.body ?? '', '', `予定日: ${r.due_date}`];
  if (todayJst && todayJst > r.due_date) {
    lines.push(`※ 予定日を過ぎています(本日 ${todayJst})。`);
  }
  return lines.join('\n').trim();
}

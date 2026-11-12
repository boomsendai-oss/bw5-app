// 仮のファイル：Task 10（メール）がこのファイルを丸ごと置きかえる。Task 7 が import する sendRecitalMail だけを置く。
// 型は split.md ③ のまま（MailKind・MailVia の正本は Task 10 の recitalEmail.ts。ここでは仮に中で持つ）。
type MailKind = 'receipt' | 'change' | 'complete' | 'extra_complete' | 'remaining' | 'resend_url' | 'bank_guide';
type MailVia = 'card' | 'bank' | 'cash' | 'adjust';

export async function sendRecitalMail(
  x: { kind: MailKind; householdId: number; dedupeKey?: string | null; via?: MailVia; deferAtNight?: boolean; forceWait?: boolean },
  now?: Date,
): Promise<{ status: 'sent' | 'failed' | 'waiting' | 'duplicate'; logId: number | null }> {
  void x;
  void now;
  throw new Error('recitalMail: not implemented until Task 10');
}

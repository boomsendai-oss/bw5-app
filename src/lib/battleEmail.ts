// 月1回の校内プチバトルの確定メール。文面は battle.ts の純関数、送信はBF7と同じGmail SMTP基盤。
// 送信タイミング: Webhookで決済確定した瞬間(0円の申込は申込直後)。
import { sendEmail } from '@/lib/email';
import { PUBLIC_ORIGIN } from '@/lib/appOrigin';
import { buildBattleConfirmEmail, type BattleEvent } from '@/lib/battle';
import type { BattleEntryRow } from '@/lib/battleDb';

/** 確定メールを送る。失敗しても呼び出し元の処理(申込・Webhook)は止めない。 */
export async function sendBattleConfirmEmail(entry: BattleEntryRow, editToken: string, ev: BattleEvent): Promise<void> {
  try {
    const mail = buildBattleConfirmEmail(entry, ev, {
      completeUrl: `${PUBLIC_ORIGIN}/battle/complete?t=${editToken}`,
      entriesUrl: `${PUBLIC_ORIGIN}/battle/entries?e=${encodeURIComponent(ev.eventKey)}`,
    });
    await sendEmail({ to: entry.email, subject: mail.subject, text: mail.text });
  } catch (e) {
    console.error('[battle] confirm email failed', entry.entryId, e instanceof Error ? e.message : e);
  }
}

// 特設ワークショップの確定メール。文面は spWs.ts の純関数、送信は BOOM DOJO と同じGmail SMTP基盤。
// 送信タイミング: カード=Webhookで決済確定した瞬間 / 当日払い・0円=申込直後。
import { sendEmail } from '@/lib/email';
import { PUBLIC_ORIGIN } from '@/lib/appOrigin';
import { buildSpWsConfirmEmail, type SpWsEvent } from '@/lib/spWs';
import type { SpWsEntryRow } from '@/lib/spWsDb';

/** 確定メールを送る。失敗しても呼び出し元の処理(申込・Webhook)は止めない。 */
export async function sendSpWsConfirmEmail(entry: SpWsEntryRow, editToken: string, ev: SpWsEvent): Promise<void> {
  try {
    const mail = buildSpWsConfirmEmail(entry, ev, { completeUrl: `${PUBLIC_ORIGIN}/ws/complete?t=${editToken}` });
    await sendEmail({ to: entry.email, subject: mail.subject, text: mail.text, html: mail.html });
  } catch (e) {
    console.error('[spws] confirm email failed', entry.entryId, e instanceof Error ? e.message : e);
  }
}

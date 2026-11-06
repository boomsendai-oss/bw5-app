// HIRO ワークショップ: 入金を確認した申込に「申込が確定しました」メールを送る(テスト申込には送らない)。
// スタッフ画面の「入金確認」ボタンと、GMO明細の振込照合(/api/staff/bf7/ws-transfers)の両方から使う。
import { buildBf7WsEmail } from '@/lib/bf7Workshop';
import { getBf7WsOrderById } from '@/lib/bf7WorkshopDb';
import { sendEmail } from '@/lib/email';

/** 送れた(またはテスト申込で送らなくてよい)なら true */
export async function sendBf7WsPaidMail(id: number): Promise<boolean> {
  try {
    const o = await getBf7WsOrderById(id);
    if (!o) return false;
    if (o.isTest) return true;
    const mail = buildBf7WsEmail({ id: o.id, name: o.name, first: o.first, second: o.second, amountTotal: o.amountTotal, payMethod: o.payMethod, isMember: o.isMember, paid: true, appliedOn: o.appliedOn });
    await sendEmail({ to: o.email, subject: mail.subject, text: mail.text });
    return true;
  } catch (e) {
    console.error('[bf7ws] paid mail failed. order:', id, e instanceof Error ? e.message : e);
    return false;
  }
}

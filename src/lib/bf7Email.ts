// BOOMER'S FIGHT!!! vol.7 の完了メール。文面は純関数(vitest対象)、送信は既存のGmail SMTP基盤。
// 送信タイミング: 当日現金=申込直後 / カード=Webhookで決済確定した瞬間(vol.6と同じ)。
//
// ⚠️ 集合時刻・控室など当日の段取りは未定(2026-10-20時点)。決まっていないことは書かない。
//    当日のご案内は、決まった時点で一斉メール(スタッフ画面)で送る。
import { sendEmail } from '@/lib/email';
import { bf6DivisionLabel, bf6GradeLabel } from '@/lib/bf6';
import { formatBf7ReceiptNo } from '@/lib/bf7Entry';
import type { OwnBf7Order } from '@/lib/bf7EntryDb';

// 告知はすべて boomersfight.vercel.app で統一している(vol.6と同じ)
const BASE_URL = 'https://boomersfight.vercel.app';
const yen = (n: number) => `¥${n.toLocaleString()}`;
const TITLE = "BOOMER'S FIGHT!!! vol.7";

export function buildBf7OrderEmail(order: OwnBf7Order, editToken: string): { subject: string; text: string } {
  const receiptNo = formatBf7ReceiptNo(order.orderId);
  const entries = order.items.filter((i) => i.itemType === 'entry');
  const adult = order.items.find((i) => i.itemType === 'ticket_adult');
  const child = order.items.find((i) => i.itemType === 'ticket_child');
  const stream = order.items.find((i) => i.itemType === 'stream');
  const isEntry = entries.length > 0;
  const isStreamOnly = !isEntry && !adult && !child && Boolean(stream);
  const paid = order.paymentStatus === 'paid';

  const subject = isEntry
    ? `【${TITLE}】${paid ? 'エントリー確定' : 'エントリー受付'}(受付番号 ${receiptNo})`
    : isStreamOnly
      ? `【${TITLE}】オンライン配信チケット${paid ? '購入完了' : 'ご購入受付'}(受付番号 ${receiptNo})`
      : `【${TITLE}】観覧チケット${paid ? '購入完了' : 'ご予約受付'}(受付番号 ${receiptNo})`;

  const lines: string[] = [];
  lines.push(`${order.buyerName} 様`);
  lines.push('');
  lines.push(`${TITLE} への${isEntry ? 'エントリー' : 'お申し込み'}ありがとうございます。`);
  if (paid) lines.push(isEntry ? 'お支払いが完了し、エントリーが確定しました!' : 'お支払いが完了しました。');
  else lines.push(isEntry ? 'エントリーを受け付けました。' : 'ご予約を受け付けました。');
  lines.push('');
  lines.push(`■ 受付番号: ${receiptNo}`);
  lines.push('');
  for (const e of entries) {
    lines.push(`■ 出場者: ${e.dancerName}(${e.dancerKana})`);
    lines.push(`  本名: ${e.performerName} / ${bf6GradeLabel(e.grade)}`);
    lines.push(`  部門: ${e.divisions.map(bf6DivisionLabel).join('・')}`);
    lines.push(`  エントリー料: ${yen(e.unitAmount)}`);
  }
  if (adult) lines.push(`■ 観覧チケット(大人) × ${adult.qty} — ${yen(adult.qty * adult.unitAmount)}`);
  if (child) lines.push(`■ 観覧チケット(小学生) × ${child.qty} — ${yen(child.qty * child.unitAmount)}`);
  if (stream) lines.push(`■ オンライン配信視聴チケット × ${stream.qty} — ${yen(stream.qty * stream.unitAmount)}`);
  lines.push('');
  lines.push(`■ 合計: ${yen(order.amountTotal)}`);
  if (paid && order.amountTotal === 0) lines.push('  (無料枠でのご参加のため、お支払いは不要です)');
  else if (paid) lines.push('  (カード決済でお支払い済み)');
  else if (order.payMethod === 'onsite') lines.push('  当日会場受付にて現金でお支払いください。');
  lines.push('');
  lines.push('▼ お申し込み内容の確認はこちら');
  lines.push(`${BASE_URL}/bf7/complete?t=${editToken}`);
  if (isEntry) {
    lines.push('');
    lines.push('▼ エントリーリスト');
    lines.push(`${BASE_URL}/bf7/entries`);
  }
  lines.push('');
  lines.push('日時: 2027年1月30日(土)');
  lines.push('会場: SSM(仙台スクールオブミュージック&ダンス専門学校) 9階ホール');
  lines.push('');
  lines.push('集合時刻・タイムテーブルなど当日のご案内は、');
  lines.push('決まり次第あらためてメールでお送りします。');
  lines.push('');
  lines.push('内容の変更・キャンセルはBOOM公式LINEまでご連絡ください。');
  lines.push('');
  lines.push('BOOM DANCE SCHOOL');
  return { subject, text: lines.join('\n') };
}

/** 完了メールを送る。失敗しても呼び出し元の処理(申込・Webhook)は止めない。 */
export async function sendBf7OrderEmail(order: OwnBf7Order, editToken: string): Promise<void> {
  try {
    const mail = buildBf7OrderEmail(order, editToken);
    await sendEmail({ to: order.email, subject: mail.subject, text: mail.text });
  } catch (e) {
    console.error('[bf7] order email failed', order.orderId, e instanceof Error ? e.message : e);
  }
}

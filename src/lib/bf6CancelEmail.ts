// キャンセル完了のお知らせ。文面は純関数(vitest対象)、送信は既存のメール基盤を使う。
// 返金そのものはStripe管理画面で人が実行し、完了後にこのメールを送る。
import { sendEmail } from '@/lib/email';
import { formatReceiptNo } from '@/lib/bf6';

const BASE_URL = 'https://boomersfight.vercel.app';
const yen = (n: number) => `¥${n.toLocaleString()}`;

export interface Bf6CancelEmailInput {
  orderId: number;
  buyerName: string;
  dancerNames: string[];
  divisionLabels: string[];
  /** 返金済みの金額。0なら返金の記載をしない(当日現金・無料枠)。 */
  refundAmount: number;
}

export function buildBf6CancelEmail(input: Bf6CancelEmailInput): { subject: string; text: string } {
  const receiptNo = formatReceiptNo(input.orderId);
  const subject = `【BOOMER'S FIGHT!!! vol.6】エントリーキャンセルのお手続きが完了しました(受付番号 ${receiptNo})`;

  const lines: string[] = [];
  lines.push(`${input.buyerName} 様`);
  lines.push('');
  lines.push("BOOMER'S FIGHT!!! vol.6 事務局です。");
  lines.push('ご連絡いただいたエントリーのキャンセルを承りました。');
  lines.push('');
  lines.push(`■ 受付番号: ${receiptNo}`);
  for (const name of input.dancerNames) {
    lines.push(`■ 出場者: ${name}`);
  }
  if (input.divisionLabels.length > 0) {
    lines.push(`■ 部門: ${input.divisionLabels.join('・')}`);
  }
  lines.push('');
  lines.push('上記のエントリーは取り消され、エントリーリストからも削除されています。');
  lines.push('');

  if (input.refundAmount > 0) {
    lines.push('▼ 返金について');
    lines.push(`  ${yen(input.refundAmount)} の返金手続きが完了しています。`);
    lines.push('  ご利用のクレジットカードへ返金されます。');
    lines.push('  カード会社の締め日によって、明細に反映されるまで');
    lines.push('  数日〜1か月ほどかかる場合があります。');
    lines.push('  お手数ですが、ご利用明細をご確認ください。');
    lines.push('');
  }

  lines.push('またのご参加を心よりお待ちしております。');
  lines.push('締切前であれば、あらためてエントリーいただくことも可能です。');
  lines.push(`  ${BASE_URL}`);
  lines.push('');
  lines.push('ご不明な点がございましたら、このメールにご返信ください。');
  lines.push('');
  lines.push('---');
  lines.push("BOOMER'S FIGHT!!! vol.6 事務局");
  lines.push('BOOM DANCE SCHOOL');

  return { subject, text: lines.join('\n') };
}

/** キャンセル完了メールを1件送る。 */
export async function sendBf6CancelEmail(to: string, input: Bf6CancelEmailInput): Promise<void> {
  const { subject, text } = buildBf6CancelEmail(input);
  await sendEmail({ to, subject, text });
}

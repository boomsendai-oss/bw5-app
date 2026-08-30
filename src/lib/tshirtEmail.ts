// Tシャツ注文の確認メール(純ロジック・vitest対象)。送信は @/lib/email の sendEmail に任せる。
// ⚠️ メール本文以外(ログ等)に宛先や氏名を出さないこと。
import type { PaymentMethod, TshirtSize } from '@/lib/tshirtOrder';

export interface TshirtEmailOrder {
  name: string;
  size: TshirtSize;
  qty: number;
  wantsShipping: boolean;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  editUrl: string;
}

const yen = (n: number) => '¥' + n.toLocaleString('ja-JP');

// kind: 'ordered'=注文受付 / 'paid'=支払い完了(Webhook確定時)
export function buildTshirtOrderEmail(
  o: TshirtEmailOrder,
  kind: 'ordered' | 'paid'
): { subject: string; text: string } {
  const subject =
    kind === 'paid'
      ? '【BOOM】お支払いを確認しました｜オフィシャルTシャツ'
      : '【BOOM】ご注文ありがとうございます｜オフィシャルTシャツ';

  const lines: string[] = [];
  lines.push(`${o.name} 様`);
  lines.push('');
  if (kind === 'paid') {
    lines.push('お支払いを確認しました。ご注文が確定です。');
  } else {
    lines.push('BOOM オフィシャルTシャツ（黒×黒モデル）のご注文を受け付けました。');
  }
  lines.push('');
  lines.push('────────────────');
  lines.push(`サイズ　：Lサイズ × 2枚`.replace('Lサイズ × 2枚', `${o.size}サイズ × ${o.qty}枚`));
  lines.push(`受け取り：${o.wantsShipping ? '郵送（ご記入の住所へお送りします）' : 'レッスンで受け取り'}`);
  lines.push(`合計　　：${yen(o.totalAmount)}`);
  lines.push('────────────────');
  lines.push('');
  if (kind === 'ordered') {
    if (o.paymentMethod === 'cash') {
      lines.push('お支払いは、お渡しのときに現金と引き換えでお願いします。');
    } else {
      lines.push('お支払いがまだの場合は、下のリンクからカード決済にお進みください。');
    }
    lines.push('');
  }
  lines.push(o.wantsShipping ? '発送の準備ができ次第、順次お送りします。' : '9/15(火)以降、レッスン時に順次お渡しします。');
  lines.push('');
  lines.push('▼ ご注文の確認・変更');
  lines.push(o.editUrl);
  lines.push('');
  lines.push('※このメールに心当たりがない場合は、破棄してください。');
  lines.push('');
  lines.push('BOOM DANCE SCHOOL');
  return { subject, text: lines.join('\n') };
}

// 送信(失敗しても呼び出し元の処理は止めない・BF6と同方針)。宛先はログに出さない。
import { sendEmail } from '@/lib/email';
import type { StoredOrder } from '@/lib/tshirtOrderDb';

export async function sendTshirtOrderEmail(
  order: StoredOrder,
  editToken: string,
  kind: 'ordered' | 'paid',
  baseUrl = 'https://bw5-app.vercel.app'
): Promise<void> {
  if (!order.email) return;
  try {
    const mail = buildTshirtOrderEmail(
      {
        name: order.name,
        size: order.size,
        qty: order.qty,
        wantsShipping: order.wantsShipping,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        editUrl: `${baseUrl}/merch/tshirt?t=${editToken}`,
      },
      kind
    );
    await sendEmail({ to: order.email, subject: mail.subject, text: mail.text });
  } catch (e) {
    console.error('[tshirt] order email failed', order.id, e instanceof Error ? e.message : e);
  }
}

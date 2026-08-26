// キャンセル完了メールの送信。
//
// なぜ分けるか: sendEmail は認証情報が無いと警告だけ出して正常終了する。
// そのままだとスタッフ画面が「送信しました」と出すのに1通も届かない。
// 送る前に必ず canSendMail で弾き、送れないときは失敗として扱う。
import { bf6DivisionLabel } from '@/lib/bf6';
import { sendBf6CancelEmail, type Bf6CancelEmailInput } from '@/lib/bf6CancelEmail';

export function canSendMail(appPassword: string | undefined): boolean {
  return typeof appPassword === 'string' && appPassword.length > 0;
}

export interface CancelMailOrder {
  orderId: number;
  buyerName: string;
  email: string;
  payMethod: 'prepaid' | 'onsite';
  paymentStatus: string;
  amountTotal: number;
  items: { itemType: string; dancerName: string; divisions: string[] }[];
}

export function buildCancelMailTarget(order: CancelMailOrder): {
  to: string;
  input: Bf6CancelEmailInput;
} {
  const entries = order.items.filter((i) => i.itemType === 'entry');
  const divisions: string[] = [];
  for (const e of entries) {
    for (const d of e.divisions) {
      const label = bf6DivisionLabel(d);
      if (!divisions.includes(label)) divisions.push(label);
    }
  }
  return {
    to: order.email,
    input: {
      orderId: order.orderId,
      buyerName: order.buyerName,
      dancerNames: entries.map((e) => e.dancerName),
      divisionLabels: divisions,
      // 当日現金はお金を受け取っていないので返金の記載をしない
      refundAmount: order.payMethod === 'prepaid' ? order.amountTotal : 0,
    },
  };
}

/** 1件送る。認証情報が無ければ送らずにエラーを返す(黙って成功にしない)。 */
export async function sendCancelMailForOrder(
  order: CancelMailOrder
): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  if (!canSendMail(process.env.GMAIL_APP_PASSWORD)) {
    return { ok: false, error: 'メール送信の設定(GMAIL_APP_PASSWORD)が無いため送信できませんでした' };
  }
  const { to, input } = buildCancelMailTarget(order);
  if (!to) return { ok: false, error: 'メールアドレスが登録されていません' };
  try {
    await sendBf6CancelEmail(to, input);
    return { ok: true, to };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

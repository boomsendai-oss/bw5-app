import { Resend } from 'resend';

const resendKey = process.env.RESEND_API_KEY;
const resend = resendKey ? new Resend(resendKey) : null;

// Resend 側でドメイン認証していない場合は onboarding@resend.dev が送信元になる
// 認証後は noreply@<your-domain> に切替
const FROM = process.env.RESEND_FROM || 'BW5 <onboarding@resend.dev>';
const ADMIN_BCC = 'boom.sendai@gmail.com';

// 入金期限（固定）
export const PAYMENT_DEADLINE_LABEL = '2026年5月12日(火) 15:00 まで';

// 入金先（詳細は後日設定差し替え。現状はプレースホルダー）
export const BANK_INFO = {
  bank: 'GMOあおぞらネット銀行',
  branch: '（後日ご案内）',
  type: '普通',
  number: '（後日ご案内）',
  holder: '（後日ご案内）',
};

interface RestockOrderEmailParams {
  to: string;
  buyerName: string;
  merchName: string;
  color: string;
  size: string;
  quantity: number;
  unitPrice: number;
  shippingFee: number;
  totalAmount: number;
  postalCode: string;
  address: string;
  phone: string;
  orderId: number;
}

export async function sendRestockOrderEmail(p: RestockOrderEmailParams): Promise<void> {
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping email send');
    return;
  }

  const subject = `【BW5】追加注文を承りました（注文番号 #${p.orderId}）`;
  const colorLine = p.color ? `カラー：${p.color}` : '';
  const sizeLine = p.size ? `サイズ：${p.size}` : '';

  const html = `
<div style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; color: #222;">
  <div style="background: linear-gradient(135deg, #f27a1a, #dc4c04); color: #fff; padding: 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px;">BW5 追加注文 受付完了</h1>
    <p style="margin: 8px 0 0; font-size: 13px; opacity: 0.9;">注文番号 #${p.orderId}</p>
  </div>

  <div style="padding: 24px;">
    <p>${escapeHtml(p.buyerName)} 様</p>
    <p>このたびはご注文ありがとうございます。下記の内容で承りました。</p>

    <h2 style="margin-top: 28px; font-size: 15px; border-left: 4px solid #f27a1a; padding-left: 10px;">ご注文内容</h2>
    <table style="width:100%; border-collapse: collapse; font-size: 14px; margin-top: 8px;">
      <tr><td style="padding:6px 0; color:#666;">商品名</td><td style="padding:6px 0;"><strong>${escapeHtml(p.merchName)}</strong></td></tr>
      ${colorLine ? `<tr><td style="padding:6px 0; color:#666;">カラー</td><td style="padding:6px 0;">${escapeHtml(p.color)}</td></tr>` : ''}
      ${sizeLine ? `<tr><td style="padding:6px 0; color:#666;">サイズ</td><td style="padding:6px 0;">${escapeHtml(p.size)}</td></tr>` : ''}
      <tr><td style="padding:6px 0; color:#666;">数量</td><td style="padding:6px 0;">${p.quantity}</td></tr>
      <tr><td style="padding:6px 0; color:#666;">商品代金</td><td style="padding:6px 0;">¥${(p.unitPrice * p.quantity).toLocaleString()}</td></tr>
      <tr><td style="padding:6px 0; color:#666;">送料</td><td style="padding:6px 0;">¥${p.shippingFee.toLocaleString()}</td></tr>
      <tr><td style="padding:8px 0 0; color:#666; border-top: 1px solid #eee;"><strong>合計</strong></td><td style="padding:8px 0 0; border-top: 1px solid #eee;"><strong style="font-size: 16px; color:#dc4c04;">¥${p.totalAmount.toLocaleString()}</strong></td></tr>
    </table>

    <h2 style="margin-top: 28px; font-size: 15px; border-left: 4px solid #f27a1a; padding-left: 10px;">お届け先</h2>
    <table style="width:100%; border-collapse: collapse; font-size: 14px; margin-top: 8px;">
      <tr><td style="padding:6px 0; color:#666; width: 110px;">お名前</td><td style="padding:6px 0;">${escapeHtml(p.buyerName)} 様</td></tr>
      <tr><td style="padding:6px 0; color:#666;">郵便番号</td><td style="padding:6px 0;">〒${escapeHtml(p.postalCode)}</td></tr>
      <tr><td style="padding:6px 0; color:#666;">住所</td><td style="padding:6px 0;">${escapeHtml(p.address)}</td></tr>
      <tr><td style="padding:6px 0; color:#666;">電話番号</td><td style="padding:6px 0;">${escapeHtml(p.phone)}</td></tr>
    </table>

    <h2 style="margin-top: 28px; font-size: 15px; border-left: 4px solid #dc4c04; padding-left: 10px; color: #dc4c04;">お支払いのお願い</h2>
    <div style="background: #fff7ed; border: 1px solid rgba(242,122,26,0.3); border-radius: 12px; padding: 16px; margin-top: 8px;">
      <p style="margin: 0 0 12px; font-size: 14px;">
        下記口座へ <strong style="color:#dc4c04;">${PAYMENT_DEADLINE_LABEL}</strong> にお振り込みをお願いいたします。
      </p>
      <table style="width:100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding:4px 0; color:#666; width: 110px;">銀行名</td><td style="padding:4px 0;">${BANK_INFO.bank}</td></tr>
        <tr><td style="padding:4px 0; color:#666;">支店</td><td style="padding:4px 0;">${BANK_INFO.branch}</td></tr>
        <tr><td style="padding:4px 0; color:#666;">口座種別</td><td style="padding:4px 0;">${BANK_INFO.type}</td></tr>
        <tr><td style="padding:4px 0; color:#666;">口座番号</td><td style="padding:4px 0;">${BANK_INFO.number}</td></tr>
        <tr><td style="padding:4px 0; color:#666;">口座名義</td><td style="padding:4px 0;">${BANK_INFO.holder}</td></tr>
        <tr><td style="padding:4px 0; color:#666;">振込金額</td><td style="padding:4px 0;"><strong>¥${p.totalAmount.toLocaleString()}</strong></td></tr>
      </table>
      <p style="margin: 12px 0 0; font-size: 12px; color: #666;">
        ※振込手数料はお客様ご負担となります。<br />
        ※振込名義は <strong>${escapeHtml(p.buyerName)}</strong> 様のお名前でお願いいたします。
      </p>
    </div>

    <h2 style="margin-top: 28px; font-size: 15px; border-left: 4px solid #f27a1a; padding-left: 10px;">発送について</h2>
    <p style="font-size: 14px; line-height: 1.7;">
      ご入金確認後、<strong>約2週間</strong>を目安にご指定の住所へ発送いたします。<br />
      到着まで今しばらくお待ちください。
    </p>

    <hr style="margin: 28px 0; border: none; border-top: 1px solid #eee;" />
    <p style="font-size: 12px; color: #888; line-height: 1.7;">
      ご不明な点は本メールにご返信いただくか、<a href="mailto:boom.sendai@gmail.com" style="color:#f27a1a;">boom.sendai@gmail.com</a> までご連絡ください。<br />
      BOOM Dance School / BOOM WOP vol.5
    </p>
  </div>
</div>
`.trim();

  try {
    await resend.emails.send({
      from: FROM,
      to: p.to,
      bcc: [ADMIN_BCC],
      subject,
      html,
    });
  } catch (e) {
    console.error('[email] send failed', e);
    throw e;
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

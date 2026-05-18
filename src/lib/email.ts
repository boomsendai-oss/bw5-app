import * as nodemailer from 'nodemailer';

// ────────────────────────────────────────────────────────────
// Gmail SMTP (boom.sendai@gmail.com アプリパスワード経由)
// 旧 Resend は onboarding@resend.dev 制限でアカウント所有者にしか送れず
// 全顧客にメール届かない不具合 → 2026-05-18 nodemailer/Gmail SMTPに切替
// ────────────────────────────────────────────────────────────
const GMAIL_USER = process.env.GMAIL_USER || 'boom.sendai@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

const transporter = GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
      },
    })
  : null;

const FROM = `BOOM BW5 <${GMAIL_USER}>`;
const ADMIN_BCC = 'boom.sendai@gmail.com';

async function sendMail(opts: { to: string; subject: string; html: string }): Promise<void> {
  if (!transporter) {
    console.warn('[email] GMAIL_APP_PASSWORD not set — skipping email send');
    return;
  }
  await transporter.sendMail({
    from: FROM,
    to: opts.to,
    bcc: ADMIN_BCC === opts.to ? undefined : ADMIN_BCC,
    subject: opts.subject,
    html: opts.html,
  });
}

// 入金期限（固定）
export const PAYMENT_DEADLINE_LABEL = '2026年5月12日(火) 15:00 まで';

// 入金先
export const BANK_INFO = {
  bank: 'GMOあおぞらネット銀行',
  branch: 'めがみ支店',
  type: '普通',
  number: '4383329',
  holder: 'キムラ シンタロウ BW5 グッズ',
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
  if (!transporter) {
    console.warn('[email] GMAIL_APP_PASSWORD not set — skipping email send');
    return;
  }

  const subject = `【BW5】追加注文を承りました(注文番号 #${p.orderId})`;
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
        ※振込名義は <strong>${escapeHtml(p.buyerName)}</strong> 様のお名前でお願いいたします。<br />
        ※<strong>複数商品をご注文の場合、送料を1回分のみに調整できる場合がございます。</strong>その際は別途メールにて個別にご案内いたしますので、振込はそちらをご確認のうえお手続きください。
      </p>
    </div>

    <h2 style="margin-top: 28px; font-size: 15px; border-left: 4px solid #f27a1a; padding-left: 10px;">発送について</h2>
    <p style="font-size: 14px; line-height: 1.7;">
      <strong>発表会から約2週間後 (2026年5月19日(火) 頃)</strong> を目安に、ご指定の住所へ発送いたします。<br />
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
    await sendMail({ to: p.to, subject, html });
  } catch (e) {
    console.error('[email] send failed', e);
    throw e;
  }
}

// ════════════════════════════════════════
// 映像データ事前予約 確認メール
// ════════════════════════════════════════
interface VideoPreorderEmailParams {
  to: string;
  buyerName: string;
  phone?: string;
  preorderId: number;
  merchName: string;
  price: number;
}

export async function sendVideoPreorderEmail(p: VideoPreorderEmailParams): Promise<void> {
  if (!transporter) {
    console.warn('[email] GMAIL_APP_PASSWORD not set — skipping email send');
    return;
  }

  const subject = `【BW5】演目映像データのお申込を承りました`;
  const html = `
<div style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; color: #222;">
  <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; padding: 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px;">BW5 演目映像データ お申込完了</h1>
  </div>

  <div style="padding: 24px;">
    <p>${escapeHtml(p.buyerName)} 様</p>
    <p>このたびは BW5 演目映像データのお申込をいただき、誠にありがとうございます。</p>
    <div style="background:#ecfdf5;border:1px solid rgba(34,197,94,0.45);border-radius:12px;padding:14px;margin-top:14px;">
      <p style="margin:0 0 6px;font-size:14px;font-weight:bold;color:#047857;">🆓 現時点ではお支払いは発生しません</p>
      <p style="margin:0;font-size:13px;color:#065f46;line-height:1.7;">今回は「欲しい！」というご希望のお申込までで、料金のお支払いは<strong>編集完成後・販売サイトご案内時</strong>に承ります。</p>
    </div>

    <h2 style="margin-top: 28px; font-size: 15px; border-left: 4px solid #6366f1; padding-left: 10px;">お申込内容</h2>
    <table style="width:100%; border-collapse: collapse; font-size: 14px; margin-top: 8px;">
      <tr><td style="padding:6px 0; color:#666; width: 110px;">商品</td><td style="padding:6px 0;"><strong>${escapeHtml(p.merchName)}</strong></td></tr>
      <tr><td style="padding:6px 0; color:#666;">完成後のご購入金額</td><td style="padding:6px 0;"><strong style="color:#6366f1; font-size: 16px;">¥${p.price.toLocaleString()}</strong> <span style="font-size:11px; color:#888;">※今は申込のみ・お支払いは後日</span></td></tr>
    </table>

    <h2 style="margin-top: 28px; font-size: 15px; border-left: 4px solid #6366f1; padding-left: 10px;">今後の流れ</h2>
    <ol style="font-size: 14px; line-height: 1.8; padding-left: 20px;">
      <li><strong>今:</strong> ご希望の受付完了 (このメール) — お支払いは発生しません</li>
      <li><strong>編集完成後 (5月下旬予定):</strong> こちらのメールアドレスへ<strong>販売サイト（Vimeo オンデマンド予定）のご案内</strong>をお送りします</li>
      <li><strong>その時:</strong> ご案内メール内のリンクからお支払い (¥${p.price.toLocaleString()}) → 即時ダウンロード/視聴が可能になります</li>
    </ol>

    <h2 style="margin-top: 28px; font-size: 15px; border-left: 4px solid #dc4c04; padding-left: 10px; color: #dc4c04;">重要なお願い</h2>
    <div style="background: #fef2f2; border: 1px solid rgba(220,76,4,0.3); border-radius: 12px; padding: 16px; margin-top: 8px; font-size: 13px; line-height: 1.7;">
      <p style="margin: 0 0 8px;"><strong>購入後の映像データの第三者への共有・転載・SNS等への投稿は固くお断りいたします。</strong></p>
      <p style="margin: 0 0 8px;">
        ・データには<strong>コピーガード処理</strong>を施しています<br />
        ・<strong>ウォーターマーク（電子透かし）</strong>により、流出した場合は購入者を特定できる仕様となっています
      </p>
      <p style="margin: 0; color: #666; font-size: 12px;">出演者・関係者のプライバシー保護のため、ご理解とご協力をお願いいたします。</p>
    </div>

    <h2 style="margin-top: 28px; font-size: 15px; border-left: 4px solid #6366f1; padding-left: 10px;">ご登録内容</h2>
    <table style="width:100%; border-collapse: collapse; font-size: 14px; margin-top: 8px;">
      <tr><td style="padding:6px 0; color:#666; width: 110px;">お名前</td><td style="padding:6px 0;">${escapeHtml(p.buyerName)} 様</td></tr>
      ${p.phone ? `<tr><td style="padding:6px 0; color:#666;">電話番号</td><td style="padding:6px 0;">${escapeHtml(p.phone)}</td></tr>` : ''}
    </table>

    <hr style="margin: 28px 0; border: none; border-top: 1px solid #eee;" />
    <p style="font-size: 12px; color: #888; line-height: 1.7;">
      ご不明な点は本メールにご返信いただくか、<a href="mailto:boom.sendai@gmail.com" style="color:#6366f1;">boom.sendai@gmail.com</a> までご連絡ください。<br />
      BOOM Dance School / BOOM WOP vol.5
    </p>
  </div>
</div>
`.trim();

  try {
    await sendMail({ to: p.to, subject, html });
  } catch (e) {
    console.error('[email] video preorder send failed', e);
    throw e;
  }
}

// ════════════════════════════════════════
// 映像予約 補填確認メール (Resend不具合時の謝罪+再案内)
// 既存87件への一斉再送用 / GMAIL SMTP 切替後に運用
// ════════════════════════════════════════
interface VideoPreorderMakeupParams {
  to: string;
  buyerName: string;
  preorderId: number;
  merchName: string;
  price: number;
  phone?: string;
  createdAt: string;
}

export async function sendVideoPreorderMakeupEmail(p: VideoPreorderMakeupParams): Promise<void> {
  if (!transporter) {
    console.warn('[email] GMAIL_APP_PASSWORD not set — skipping email send');
    return;
  }

  const subject = `【BW5】映像データご予約 確認のご連絡`;
  const html = `
<div style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; color: #222;">
  <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; padding: 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px;">BW5 映像データご予約 確認のご連絡</h1>
  </div>

  <div style="padding: 24px;">
    <p>${escapeHtml(p.buyerName)} 様</p>
    <p>このたびは BW5 演目映像データのご予約をいただき、誠にありがとうございます。</p>

    <p>ご予約は正常に受付完了しております。<br />
    ご予約直後の確認メール送信に不具合があり、お届けできておりませんでしたため、
    改めてご予約内容のご連絡をさせていただきます。</p>

    <p>ご心配・ご不便をおかけし、申し訳ございません。</p>

    <div style="background:#ecfdf5;border:1px solid rgba(34,197,94,0.45);border-radius:12px;padding:14px;margin-top:14px;">
      <p style="margin:0 0 6px;font-size:14px;font-weight:bold;color:#047857;">🆓 現時点ではお支払いは発生しません</p>
      <p style="margin:0;font-size:13px;color:#065f46;line-height:1.7;">今回は「欲しい!」というご希望のお申込までで、料金のお支払いは<strong>別途お送りするお支払いリンク</strong>からお願いいたします。</p>
    </div>

    <h2 style="margin-top: 28px; font-size: 15px; border-left: 4px solid #6366f1; padding-left: 10px;">ご予約内容</h2>
    <table style="width:100%; border-collapse: collapse; font-size: 14px; margin-top: 8px;">
      <tr><td style="padding:6px 0; color:#666; width: 130px;">予約番号</td><td style="padding:6px 0;"><strong>#${p.preorderId}</strong></td></tr>
      <tr><td style="padding:6px 0; color:#666;">商品</td><td style="padding:6px 0;"><strong>${escapeHtml(p.merchName)}</strong></td></tr>
      <tr><td style="padding:6px 0; color:#666;">ご購入金額</td><td style="padding:6px 0;"><strong style="color:#6366f1; font-size: 16px;">¥${p.price.toLocaleString()}</strong> <span style="font-size:11px; color:#888;">※今は申込のみ・お支払いは後日</span></td></tr>
      <tr><td style="padding:6px 0; color:#666;">お名前</td><td style="padding:6px 0;">${escapeHtml(p.buyerName)} 様</td></tr>
      ${p.phone ? `<tr><td style="padding:6px 0; color:#666;">電話番号</td><td style="padding:6px 0;">${escapeHtml(p.phone)}</td></tr>` : ''}
      <tr><td style="padding:6px 0; color:#666;">ご予約日</td><td style="padding:6px 0;">${escapeHtml(p.createdAt)}</td></tr>
    </table>

    <h2 style="margin-top: 28px; font-size: 15px; border-left: 4px solid #6366f1; padding-left: 10px;">今後の流れ</h2>
    <ol style="font-size: 14px; line-height: 1.8; padding-left: 20px;">
      <li><strong>今:</strong> ご予約の受付完了 (このメール) — お支払いは発生しません</li>
      <li><strong>5月20日以降:</strong> このメールアドレス宛に <strong>お支払いリンク</strong> をお送りします。リンク内に <strong>お支払い期限</strong> もあわせてご案内いたします。</li>
      <li><strong>5月末〜6月頭 (編集完成タイミング):</strong> お支払い完了の方へ、<strong>ダウンロードリンク</strong> を一斉送信いたします。</li>
    </ol>

    <h2 style="margin-top: 28px; font-size: 15px; border-left: 4px solid #dc4c04; padding-left: 10px; color: #dc4c04;">重要なお願い</h2>
    <div style="background: #fef2f2; border: 1px solid rgba(220,76,4,0.3); border-radius: 12px; padding: 16px; margin-top: 8px; font-size: 13px; line-height: 1.7;">
      <p style="margin: 0 0 8px;"><strong>購入後の映像データの第三者への共有・転載・SNS等への投稿は固くお断りいたします。</strong></p>
      <p style="margin: 0 0 8px;">
        ・データには<strong>コピーガード処理</strong>を施しています<br />
        ・<strong>ウォーターマーク(電子透かし)</strong>により、流出した場合は購入者を特定できる仕様となっています
      </p>
      <p style="margin: 0; color: #666; font-size: 12px;">出演者・関係者のプライバシー保護のため、ご理解とご協力をお願いいたします。</p>
    </div>

    <hr style="margin: 28px 0; border: none; border-top: 1px solid #eee;" />
    <p style="font-size: 12px; color: #888; line-height: 1.7;">
      ご不明な点は本メールにご返信いただくか、<a href="mailto:boom.sendai@gmail.com" style="color:#6366f1;">boom.sendai@gmail.com</a> までご連絡ください。<br />
      BOOM Dance School / BOOM WOP vol.5
    </p>
  </div>
</div>
`.trim();

  await sendMail({ to: p.to, subject, html });
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

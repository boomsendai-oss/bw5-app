// src/lib/notify.ts — 運用障害の能動通知(TARO本人宛)の単一入口。
//
// 呼び出し側(watchdog / pre-flight 等)はチャネルを意識しない。
//   - 既定: 既存 nodemailer(Gmail SMTP) で boom.sendai@gmail.com へメール。
//   - 昇格: LINE_CHANNEL_ACCESS_TOKEN + TARO_LINE_USER_ID があればLINE push優先、失敗時はメールへフォールバック。
//
// 方針(MEMORY準拠): これは「自発的なLINE進捗報告」ではなく運用障害アラート専用。
// 顧客宛ではなくTARO本人宛なので誤爆リスクなし。全て正常なら呼ばれない(沈黙=正常)。

import { sendEmail } from './email';

const TARO_EMAIL = 'boom.sendai@gmail.com';

export async function notifyTaro(opts: { subject: string; body: string }): Promise<void> {
  const subject = `[BOOM Story] ${opts.subject}`;

  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const lineUser = process.env.TARO_LINE_USER_ID;
  if (lineToken && lineUser) {
    try {
      await pushLine(lineToken, lineUser, `${subject}\n\n${opts.body}`);
      return;
    } catch (e) {
      // LINE失敗時は通知を落とさずメールへ
      console.warn(`LINE通知失敗→メールへフォールバック: ${e instanceof Error ? e.message : e}`);
    }
  }

  await sendEmail({ to: TARO_EMAIL, subject, text: opts.body });
}

async function pushLine(token: string, to: string, text: string): Promise<void> {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  });
  if (!res.ok) {
    throw new Error(`LINE push ${res.status}: ${await res.text().catch(() => '')}`);
  }
}

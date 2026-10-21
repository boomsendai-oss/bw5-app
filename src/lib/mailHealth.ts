// メール送信(Gmail SMTP)の毎朝の健康診断。本体は /api/cron/mail-health。
// 2026-10-16、Googleのパスワード変更でアプリパスワードが無効になり、アプリのメールが全部
// 黙って失敗していた(障害通知もメール頼みだったので誰も気づけなかった)。その再発防止。
// ログインできるかだけ確かめ、お客さんにも誰にもメールは送らない。

export type MailHealthResult =
  | { ok: true }
  | { ok: false; error: string; notified: boolean; notifyError?: string };

export const MAIL_HEALTH_SUBJECT = 'メール送信が失敗しています(Googleのパスワード変更でアプリパスワードが無効になった可能性)';

export function mailHealthBody(error: string): string {
  return [
    'アプリからのメール(申込の控え・お知らせ等)が送れない状態です。',
    'Googleのパスワードを変えると、Gmailのアプリパスワードが自動で無効になります。',
    '',
    `エラー: ${error}`,
    '',
    '■ 対処',
    '事務所Macのターミナルで次を実行してください:',
    'bash scripts/after_google_password_change.sh',
    '',
    '直るまで、お客さん宛てのメールは届いていません。',
  ].join('\n');
}

export async function runMailHealth(deps: {
  verify: () => Promise<{ ok: true } | { ok: false; error: string }>;
  notify: (opts: { subjectPrefix: string; subject: string; body: string }) => Promise<void>;
}): Promise<MailHealthResult> {
  const r = await deps.verify();
  if (r.ok) return { ok: true };
  try {
    await deps.notify({ subjectPrefix: '[BOOM メール]', subject: MAIL_HEALTH_SUBJECT, body: mailHealthBody(r.error) });
    return { ok: false, error: r.error, notified: true };
  } catch (e) {
    return { ok: false, error: r.error, notified: false, notifyError: e instanceof Error ? e.message : String(e) };
  }
}

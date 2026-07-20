// 固定QR自動発行(WS U / 2026-07-20)の純ロジック。
// 宛先解決: 家族(子)アカウントはHACOMONOがダミーアドレスを自動発行するため、
// ML001「代表メールアドレス」(親の実アドレス)へ送る。解決不能なら送らずmanual扱い。

const DUMMY_EMAIL_RE = /@dummy\.hacomono\.mail$/i;

export function isDummyEmail(email: string | null | undefined): boolean {
  return !!email && DUMMY_EMAIL_RE.test(email.trim());
}

export type RecipientResult =
  | { ok: true; to: string }
  | { ok: false; reason: 'no_email' | 'rep_email_missing' | 'rep_email_dummy' };

export function resolveRecipient(email: string | null, repEmail: string | null): RecipientResult {
  const own = (email ?? '').trim();
  const rep = (repEmail ?? '').trim();
  if (own && !isDummyEmail(own)) return { ok: true, to: own };
  if (rep && !isDummyEmail(rep)) return { ok: true, to: rep };
  if (!own && !rep) return { ok: false, reason: 'no_email' };
  if (!rep) return { ok: false, reason: 'rep_email_missing' };
  return { ok: false, reason: 'rep_email_dummy' };
}

// 添付ファイル名に会員名を入れる (兄弟がいると同じファイル名でスマホ保存時に衝突するため)。
// 危険文字・制御文字を除去し、空白は '_' に、長すぎる場合は20文字で切る。
export function qrFileName(memberName: string): string {
  const safe = (memberName ?? '')
    .replace(/[/\\:*?"<>|\x00-\x1f\x7f]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 20);
  return `boom_checkin_qr_${safe || 'member'}.png`;
}

// トラブル調査用の伏せ字 (生アドレスはDBに保存しない)
export function maskEmail(email: string): string {
  const m = email.match(/^(.).*@(.+)$/);
  return m ? `${m[1]}***@${m[2]}` : '***';
}

// メール文面 (骨子TARO承認済み 2026-07-20。清書はゲートBでTARO最終確認)
// 兄弟がいると同じ見た目のQRメールが複数届き誰のQRか区別できないため、
// 件名・本文冒頭に会員名を明示する (2026-07-20 追加改修)
export function buildQrEmail(memberName: string): { subject: string; text: string } {
  const subject = `【BOOM】${memberName}さんのチェックイン用QRコード（印刷してご利用ください）`;
  const text = `${memberName} 様

BOOMダンススクールです。いつもご利用ありがとうございます。

【${memberName}さん】のチェックイン用「固定QRコード」を添付でお送りします。

■ これは何？
スタジオ入口のタブレットにかざす、チェックイン用のQRコードです。
マイページのQRコード（30分で切り替わります）と違い、このQRはずっと使えます。
印刷してお子さまに持たせていただければ、お子さまだけでもチェックインできます。

■ ⚠️ 他の人に共有しないでください
このQRで他の人がチェックインすると、あなたのチケットが消費されてしまいます。

■ なくしたときは
このメールを保存しておけば、いつでも印刷し直せます（QRは変わりません）。
QRを無効にして作り直したい場合は、このメールへの返信でご連絡ください。

BOOMダンススクール
boom.sendai@gmail.com`;
  return { subject, text };
}

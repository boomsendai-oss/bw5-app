// アンケート回答画面のクライアントエラー通報(白画面バグ調査・WS AO 2026-08-31)。
// 回答内容・氏名は一切送らない。エラーメッセージ/スタック/UA/URLのみ。
// 同一セッションからの多重送信はしない(1画面につき最大3件)。

let sent = 0;

export function reportSurveyClientError(message: string, stack?: string | null): void {
  if (typeof window === 'undefined' || sent >= 3) return;
  sent += 1;
  try {
    void fetch('/api/survey/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: String(message || '').slice(0, 500),
        stack: stack ? String(stack).slice(0, 2000) : undefined,
        ua: navigator.userAgent,
        url: window.location.pathname,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 通報自体の失敗は無視(回答体験を妨げない) */
  }
}

/** ページ全体のerror/unhandledrejectionを拾う。マウント時に1回だけ呼ぶ。 */
export function installSurveyErrorHandlers(): () => void {
  const onError = (e: ErrorEvent) => {
    reportSurveyClientError('window.onerror: ' + (e.message || 'unknown'), e.error?.stack);
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason;
    reportSurveyClientError(
      'unhandledrejection: ' + (r?.message || String(r)),
      typeof r === 'object' && r !== null ? (r as Error).stack : undefined
    );
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

// 受信箱アラート: 監視する3アカウントと各種設定を環境変数から組み立てる(純関数)。
// メールアドレスはコードに書かない(公開リポジトリに個人アドレスを載せないため)。
// 実際のアドレスは実行時にGmailのプロフィールAPIから取る。
export type AccountKey = 'boom' | 'nitroash' | 'taro';

export type AlertAccount = {
  key: AccountKey;
  /** 通知と朝のまとめに出す名前 */
  label: string;
  refreshToken: string;
  pushoverToken: string;
};

export type GmailClient = { clientId: string; clientSecret: string };

type Env = Record<string, string | undefined>;

const DEFS: { key: AccountKey; label: string; envSuffix: string }[] = [
  { key: 'boom', label: 'BOOM', envSuffix: 'BOOM' },
  { key: 'nitroash', label: 'NITRO ASH', envSuffix: 'NITROASH' },
  { key: 'taro', label: '個人', envSuffix: 'TARO' },
];

/** 鍵とPushoverトークンが両方そろったアカウントだけ返す(未設定のアカウントは静かに外す) */
export function loadAccounts(env: Env = process.env): AlertAccount[] {
  const out: AlertAccount[] = [];
  for (const d of DEFS) {
    const refreshToken = env[`GMAIL_ALERT_REFRESH_TOKEN_${d.envSuffix}`];
    const pushoverToken = env[`PUSHOVER_TOKEN_${d.envSuffix}`];
    if (refreshToken && pushoverToken) {
      out.push({ key: d.key, label: d.label, refreshToken, pushoverToken });
    }
  }
  return out;
}

export function loadGmailClient(env: Env = process.env): GmailClient | null {
  const clientId = env.GMAIL_ALERT_CLIENT_ID;
  const clientSecret = env.GMAIL_ALERT_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function loadPushoverUser(env: Env = process.env): string | null {
  return env.PUSHOVER_USER_KEY || null;
}

/** 通知を一切送らず、判定結果だけを記録するモード */
export function isDryRun(env: Env = process.env): boolean {
  return env.INBOX_ALERT_DRY_RUN === '1';
}

/** 初回だけ過去N日ぶんを判定する(事前テスト用)。0なら過去分は判定しない */
export function backfillDays(env: Env = process.env): number {
  const n = Number(env.INBOX_ALERT_BACKFILL_DAYS ?? '0');
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 30) : 0;
}

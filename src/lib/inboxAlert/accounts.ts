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
type AccountDef = { key: AccountKey; label: string; envSuffix: string };

const DEFS: AccountDef[] = [
  { key: 'boom', label: 'BOOM', envSuffix: 'BOOM' },
  { key: 'nitroash', label: 'NITRO ASH', envSuffix: 'NITROASH' },
  { key: 'taro', label: '個人', envSuffix: 'TARO' },
];

function credentialsOf(def: AccountDef, env: Env): { refreshToken: string; pushoverToken: string } | null {
  const refreshToken = env[`GMAIL_ALERT_REFRESH_TOKEN_${def.envSuffix}`];
  const pushoverToken = env[`PUSHOVER_TOKEN_${def.envSuffix}`];
  return refreshToken && pushoverToken ? { refreshToken, pushoverToken } : null;
}

/** 鍵とPushoverトークンが両方そろったアカウントだけ返す */
export function loadAccounts(env: Env = process.env): AlertAccount[] {
  return DEFS.flatMap((d) => {
    const credentials = credentialsOf(d, env);
    return credentials ? [{ key: d.key, label: d.label, ...credentials }] : [];
  });
}

/** 設定が欠けていて監視できないアカウントの表示名。黙って外さず、朝のまとめと入口のレスポンスで知らせる */
export function missingAccountLabels(env: Env = process.env): string[] {
  return DEFS.filter((d) => !credentialsOf(d, env)).map((d) => d.label);
}

/**
 * Pushoverの鍵を試す順番。BOOMの鍵を先頭に、残りは並び順のまま・重複なし
 * (自分の鍵で送れなかった通知の代わりの送り先と、朝のまとめの送り先に使う)
 */
export function pushoverTokensInFallbackOrder(accounts: AlertAccount[]): string[] {
  const ordered = [...accounts.filter((a) => a.key === 'boom'), ...accounts.filter((a) => a.key !== 'boom')];
  return [...new Set(ordered.map((a) => a.pushoverToken))];
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

/**
 * 初回だけ過去N日ぶんを判定する(事前テスト用)。0なら過去分は判定しない。
 * ドライラン中だけ有効(フラグの設定ミスで、通知ありのまま過去分を一斉に鳴らさないため)。
 */
export function backfillDays(env: Env = process.env): number {
  if (!isDryRun(env)) return 0;
  const n = Number(env.INBOX_ALERT_BACKFILL_DAYS ?? '0');
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 30) : 0;
}

// 受信箱アラート: cron入口の鍵チェック(純関数)。
// post-story と同じく CRON_SECRET(GitHub Actions) / CRON_SECRET_CF(Cloudflare Worker) のどちらでも通す。
type Env = Record<string, string | undefined>;

export function cronAuthorized(headers: Headers, env: Env = process.env): boolean {
  const secrets = [env.CRON_SECRET, env.CRON_SECRET_CF].filter((s): s is string => Boolean(s));
  if (secrets.length === 0) return false;
  const bearer = headers.get('authorization');
  const header = headers.get('x-cron-secret');
  return secrets.some((s) => bearer === `Bearer ${s}` || header === s);
}

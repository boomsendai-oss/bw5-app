// src/lib/threadsToken.ts — Threads長期トークンの「いつ延長するか」を決める純関数(DB・通信なし)。
//
// 2026-10-04 にThreadsのトークンが失効し、リールのThreads転載が止まった。
// 原因: threads.ts に更新関数はあったが**どこからも呼ばれていなかった**
// (Instagram側は post-reel / post-story / story-watchdog が毎日呼んでいる)。
// 失効してからでは refresh できず、TAROのMeta再ログインが要る。
// そうならないよう、毎日の cron (/api/cron/threads-token-refresh) でここの判定を回し、
// 期限の15日前を過ぎたら延長する。延長できないまま期限が近づいたら ok:false で赤くする。
//
// 公式(developers.facebook.com/docs/threads/get-started/long-lived-tokens, 2026-11-13確認):
//   - GET graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=…
//   - 条件: 失効前であること / 発行から24時間以上経っていること / threads_basic 許可
//   - 延長後は「延長した日から60日」有効。応答に expires_in(秒) が入る
//   - 60日以内に延長しなかったトークンは失効し、もう延長できない

export const DAY_MS = 86_400_000;
/** 長期トークンの寿命(expires_in が返らなかった時・古い保存データの推定に使う) */
export const TOKEN_LIFETIME_DAYS = 60;
/** 期限までこの日数を切ったら延長する */
export const REFRESH_WITHIN_DAYS = 15;
/** 発行からこの時間が経たないと延長できない(Metaの仕様) */
export const MIN_AGE_MS = DAY_MS;

export type TokenDecision =
  | { action: 'none'; expiresAt: string; daysLeft: number }
  | { action: 'refresh'; expiresAt: string; daysLeft: number }
  | { action: 'too_young'; expiresAt: string; daysLeft: number }
  | { action: 'expired'; expiresAt: string; daysLeft: number }
  | { action: 'unknown'; reason: string };

/**
 * 保存済みの期限を返す。expires_at が無い(2026-11以前の保存データ)なら発行日+60日で推定する。
 * どちらも読めなければ null。
 */
export function resolveExpiresAt(issuedAt?: string, expiresAt?: string): Date | null {
  if (expiresAt) {
    const d = new Date(expiresAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (issuedAt) {
    const d = new Date(issuedAt);
    if (!Number.isNaN(d.getTime())) return new Date(d.getTime() + TOKEN_LIFETIME_DAYS * DAY_MS);
  }
  return null;
}

/** 延長するかどうかを決める */
export function decideRefresh(input: { now: Date; issuedAt?: string; expiresAt?: string }): TokenDecision {
  const exp = resolveExpiresAt(input.issuedAt, input.expiresAt);
  if (!exp) return { action: 'unknown', reason: '発行日・期限のどちらも記録がありません' };
  const msLeft = exp.getTime() - input.now.getTime();
  const daysLeft = Math.floor(msLeft / DAY_MS);
  const expiresAt = exp.toISOString();
  if (msLeft <= 0) return { action: 'expired', expiresAt, daysLeft };
  if (daysLeft >= REFRESH_WITHIN_DAYS) return { action: 'none', expiresAt, daysLeft };
  const issued = input.issuedAt ? new Date(input.issuedAt) : null;
  if (issued && !Number.isNaN(issued.getTime()) && input.now.getTime() - issued.getTime() < MIN_AGE_MS) {
    return { action: 'too_young', expiresAt, daysLeft };
  }
  return { action: 'refresh', expiresAt, daysLeft };
}

/** Metaの expires_in(秒) から期限を作る。無ければ60日で推定する */
export function expiresAtFrom(now: Date, expiresInSec: unknown): string {
  const sec = Number(expiresInSec);
  const ms = Number.isFinite(sec) && sec > 0 ? sec * 1000 : TOKEN_LIFETIME_DAYS * DAY_MS;
  return new Date(now.getTime() + ms).toISOString();
}

/** Metaのエラーが「トークン失効・無効」(=再連携しか直し方が無い)か */
export function isTokenDeadError(err: unknown): boolean {
  const e = (err ?? {}) as { code?: unknown; type?: unknown; message?: unknown };
  if (Number(e.code) === 190) return true;
  return /expired|invalid.*token|Session has expired/i.test(String(e.message ?? ''));
}

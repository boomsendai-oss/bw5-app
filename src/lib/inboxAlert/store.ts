// 受信箱アラート: DBの読み書き(`@/lib/db` 経由)。件名・差出人・本文は扱わない。
import { execute, getAll, getOne } from '@/lib/db';
import type { AccountKey } from './accounts';
import type { Kind, Tier } from './classify';
import type { ReadMode } from './prefilter';

export type AlertState = {
  lastCheckedMs: number;
  lastSuccessAt: string;
  consecutiveErrors: number;
  tokenAlertDate: string;
  stallAlerted: boolean;
};

export type NewItem = {
  account: AccountKey;
  messageId: string;
  threadId: string;
  receivedMs: number;
  /** baseline = 初回に「既読扱い」で記録しただけのメール */
  readMode: ReadMode | 'baseline';
  tier: Tier;
  kind: Kind;
  aiFailed: boolean;
  inInbox: boolean;
  dryRun: boolean;
  inputTokens: number;
  outputTokens: number;
  notified: boolean;
};

export type OpenItem = {
  account: AccountKey;
  messageId: string;
  threadId: string;
  receivedMs: number;
  kind: Kind;
  aiFailed: boolean;
  inInbox: boolean;
};

/** run.ts が使う操作。テストではメモリ上の偽物を渡す */
export interface AlertStore {
  getState(account: AccountKey): Promise<AlertState>;
  saveSuccess(account: AccountKey, lastCheckedMs: number, nowIso: string): Promise<void>;
  saveError(account: AccountKey, message: string): Promise<number>;
  setTokenAlertDate(account: AccountKey, date: string): Promise<void>;
  setStallAlerted(account: AccountKey, on: boolean): Promise<void>;
  knownIds(account: AccountKey, ids: string[]): Promise<Set<string>>;
  insertItem(item: NewItem, nowIso: string): Promise<void>;
  listUnnotified(account: AccountKey, sinceIso: string, limit: number): Promise<OpenItem[]>;
  markNotified(account: AccountKey, messageId: string, nowIso: string): Promise<void>;
  listOpen(account: AccountKey, limit: number): Promise<OpenItem[]>;
  markResolved(account: AccountKey, messageId: string, reason: 'replied' | 'archived', nowIso: string): Promise<void>;
}

export const EMPTY_STATE: AlertState = {
  lastCheckedMs: 0,
  lastSuccessAt: '',
  consecutiveErrors: 0,
  tokenAlertDate: '',
  stallAlerted: false,
};

async function ensureState(account: AccountKey): Promise<void> {
  await execute('INSERT OR IGNORE INTO inbox_alert_state (account) VALUES (?)', [account]);
}

/* eslint-disable @typescript-eslint/no-explicit-any -- DBの行は動的キーアクセスのため */
function toOpen(r: any): OpenItem {
  return {
    account: r.account,
    messageId: String(r.message_id),
    threadId: String(r.thread_id),
    receivedMs: Number(r.received_ms),
    kind: r.kind,
    aiFailed: Number(r.ai_failed) === 1,
    inInbox: Number(r.in_inbox) === 1,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const dbStore: AlertStore = {
  async getState(account) {
    const r = await getOne('SELECT * FROM inbox_alert_state WHERE account = ?', [account]);
    if (!r) return { ...EMPTY_STATE };
    return {
      lastCheckedMs: Number(r.last_checked_ms),
      lastSuccessAt: String(r.last_success_at),
      consecutiveErrors: Number(r.consecutive_errors),
      tokenAlertDate: String(r.token_alert_date),
      stallAlerted: Number(r.stall_alerted) === 1,
    };
  },

  async saveSuccess(account, lastCheckedMs, nowIso) {
    await ensureState(account);
    await execute(
      "UPDATE inbox_alert_state SET last_checked_ms = ?, last_success_at = ?, last_error = '', consecutive_errors = 0 WHERE account = ?",
      [lastCheckedMs, nowIso, account],
    );
  },

  async saveError(account, message) {
    // 1文で「行が無ければ作る・回数を1増やす・増えた後の回数を返す」(往復を減らし、読み書きの間に割り込まれない)
    const r = await getOne(
      `INSERT INTO inbox_alert_state (account, last_error, consecutive_errors) VALUES (?, ?, 1)
       ON CONFLICT(account) DO UPDATE SET last_error = excluded.last_error, consecutive_errors = consecutive_errors + 1
       RETURNING consecutive_errors`,
      [account, message.slice(0, 500)],
    );
    return Number(r?.consecutive_errors ?? 0);
  },

  async setTokenAlertDate(account, date) {
    await ensureState(account);
    await execute('UPDATE inbox_alert_state SET token_alert_date = ? WHERE account = ?', [date, account]);
  },

  async setStallAlerted(account, on) {
    await ensureState(account);
    await execute('UPDATE inbox_alert_state SET stall_alerted = ? WHERE account = ?', [on ? 1 : 0, account]);
  },

  async knownIds(account, ids) {
    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const rows = await getAll(
        `SELECT message_id FROM inbox_alert_items WHERE account = ? AND message_id IN (${chunk.map(() => '?').join(',')})`,
        [account, ...chunk],
      );
      rows.forEach((r) => known.add(String(r.message_id)));
    }
    return known;
  },

  async insertItem(item, nowIso) {
    // OR IGNORE は NOT NULL 違反まで黙って捨てる(メールの取りこぼしに気づけない)ので、重複だけを無視する
    await execute(
      `INSERT INTO inbox_alert_items
        (account, message_id, thread_id, received_ms, read_mode, tier, kind, ai_failed, in_inbox, dry_run,
         input_tokens, output_tokens, notified_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account, message_id) DO NOTHING`,
      [
        item.account, item.messageId, item.threadId, item.receivedMs, item.readMode, item.tier, item.kind,
        item.aiFailed ? 1 : 0, item.inInbox ? 1 : 0, item.dryRun ? 1 : 0,
        item.inputTokens, item.outputTokens, item.notified ? nowIso : null, nowIso,
      ],
    );
  },

  async listUnnotified(account, sinceIso, limit) {
    const rows = await getAll(
      `SELECT * FROM inbox_alert_items
       WHERE account = ? AND tier = 'now' AND notified_at IS NULL AND resolved_at IS NULL AND dry_run = 0 AND created_at >= ?
       ORDER BY received_ms LIMIT ?`,
      [account, sinceIso, limit],
    );
    return rows.map(toOpen);
  },

  async markNotified(account, messageId, nowIso) {
    await execute('UPDATE inbox_alert_items SET notified_at = ? WHERE account = ? AND message_id = ?', [nowIso, account, messageId]);
  },

  async listOpen(account, limit) {
    // 古い順に取ると、未対応が上限を超えた時に後ろの分が永久に再確認されないので、毎回ばらばらに取る
    const rows = await getAll(
      `SELECT * FROM inbox_alert_items
       WHERE account = ? AND tier = 'now' AND resolved_at IS NULL AND dry_run = 0
       ORDER BY RANDOM() LIMIT ?`,
      [account, limit],
    );
    return rows.map(toOpen);
  },

  async markResolved(account, messageId, reason, nowIso) {
    await execute(
      'UPDATE inbox_alert_items SET resolved_at = ?, resolved_reason = ? WHERE account = ? AND message_id = ?',
      [nowIso, reason, account, messageId],
    );
  },
};

// ── 朝のまとめ用 ─────────────────────────────

const LAST_DIGEST_KEY = 'inbox_alert_last_digest_at';

export async function listOpenAll(limit: number): Promise<OpenItem[]> {
  const rows = await getAll(
    "SELECT * FROM inbox_alert_items WHERE tier = 'now' AND resolved_at IS NULL AND dry_run = 0 ORDER BY received_ms LIMIT ?",
    [limit],
  );
  return rows.map(toOpen);
}

/** 未対応の本当の件数(朝のまとめの見出し用。一覧は上限つきで取るため) */
export async function countOpenAll(): Promise<number> {
  const r = await getOne(
    "SELECT COUNT(*) AS n FROM inbox_alert_items WHERE tier = 'now' AND resolved_at IS NULL AND dry_run = 0",
  );
  return Number(r?.n ?? 0);
}

export async function listUndigested(limit: number): Promise<OpenItem[]> {
  const rows = await getAll(
    "SELECT * FROM inbox_alert_items WHERE tier = 'digest' AND digested_at IS NULL AND dry_run = 0 ORDER BY received_ms LIMIT ?",
    [limit],
  );
  return rows.map(toOpen);
}

export async function markDigested(items: OpenItem[], nowIso: string): Promise<void> {
  for (const it of items) {
    await execute('UPDATE inbox_alert_items SET digested_at = ? WHERE account = ? AND message_id = ?', [nowIso, it.account, it.messageId]);
  }
}

export async function countSince(sinceIso: string): Promise<{ countOnly: number; aiLight: number; aiFailed: number }> {
  const r = await getOne(
    `SELECT
       COALESCE(SUM(CASE WHEN read_mode = 'count_only' THEN 1 ELSE 0 END), 0) AS count_only,
       COALESCE(SUM(CASE WHEN read_mode = 'ai_light' THEN 1 ELSE 0 END), 0) AS ai_light,
       COALESCE(SUM(ai_failed), 0) AS ai_failed
     FROM inbox_alert_items WHERE created_at >= ? AND dry_run = 0`,
    [sinceIso],
  );
  return { countOnly: Number(r?.count_only ?? 0), aiLight: Number(r?.ai_light ?? 0), aiFailed: Number(r?.ai_failed ?? 0) };
}

/** 60日を過ぎた行を消す。本番の未対応(tier=now で未解決)だけは消さない(ドライランの行は消える) */
export async function purgeBefore(cutoffIso: string): Promise<void> {
  await execute(
    "DELETE FROM inbox_alert_items WHERE created_at < ? AND NOT (tier = 'now' AND resolved_at IS NULL AND dry_run = 0)",
    [cutoffIso],
  );
}

export async function getLastDigestAt(): Promise<string | null> {
  const r = await getOne('SELECT value FROM settings WHERE key = ?', [LAST_DIGEST_KEY]);
  return r?.value ? String(r.value) : null;
}

export async function setLastDigestAt(iso: string): Promise<void> {
  await execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [LAST_DIGEST_KEY, iso],
  );
}

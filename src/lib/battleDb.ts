// 月1回の校内プチバトル(/dojo)のDBアクセス層。src/lib/db.ts 経由のみ。
//
// BF7(src/lib/bf7EntryDb.ts)と同じ考え方:
//   - 枠を消費する = payment_status 'paid' + 決済待ち'pending'(30分の仮押さえ)
//   - 公開エントリー一覧 = 'paid' のみ
//   - 期限切れの 'pending' は読み取り前に sweep で 'expired' 化して枠を解放する
//   - 決済の確定はStripeのWebhookが正本(battle_payments に stripe_event_id UNIQUE で記録=冪等)
//   - 30分を過ぎて expired になった後に決済が完了した場合も paid に戻す(入金の事実を優先)
// 回は event_key で分ける。過去回の名簿は消さない。
import { getAll, execute, withWriteTx } from '@/lib/db';
import type { Transaction } from '@libsql/client';
import { generateEditToken } from '@/lib/eventSignup';
import {
  BATTLE_HOLD_MINUTES,
  calcBattleAmount,
  parseBattleCast,
  parseBattleDivisions,
  parseDivisionKeys,
  type BattleDivision,
  type BattleEvent,
  type ValidatedBattleEntry,
} from '@/lib/battle';

function nowIso(): string {
  return new Date().toISOString();
}

/* eslint-disable @typescript-eslint/no-explicit-any -- DB行 */
function rowToEvent(r: any): BattleEvent {
  return {
    eventKey: String(r.event_key),
    title: String(r.title ?? ''),
    subtitle: String(r.subtitle ?? ''),
    description: String(r.description ?? ''),
    eventDate: String(r.event_date ?? ''),
    openTime: String(r.open_time ?? ''),
    startTime: String(r.start_time ?? ''),
    endTime: String(r.end_time ?? ''),
    venue: String(r.venue ?? ''),
    venueAddress: String(r.venue_address ?? ''),
    moveSeconds: Number(r.move_seconds) || 0,
    divisions: parseBattleDivisions(r.divisions),
    entryFee: Number(r.entry_fee) || 0,
    entryFeeLate: Number(r.entry_fee_late) || 0,
    lateFeeFrom: String(r.late_fee_from ?? ''),
    spectatorFee: Number(r.spectator_fee) || 0,
    spectatorNote: String(r.spectator_note ?? ''),
    entryDeadline: String(r.entry_deadline ?? ''),
    entryOpen: Number(r.entry_open) === 1,
    rules: String(r.rules ?? ''),
    cancelPolicy: String(r.cancel_policy ?? ''),
    cast: parseBattleCast(r.cast_json),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getBattleEvent(eventKey: string): Promise<BattleEvent | null> {
  if (!eventKey) return null;
  const rows = await getAll('SELECT * FROM battle_events WHERE event_key = ? LIMIT 1', [eventKey]);
  return rows[0] ? rowToEvent(rows[0]) : null;
}

/** 全回(新しい順)。 */
export async function listBattleEvents(): Promise<BattleEvent[]> {
  const rows = await getAll('SELECT * FROM battle_events ORDER BY event_date DESC');
  return rows.map(rowToEvent);
}

/** 公開ページに出す回 = 今日以降でいちばん近い回。無ければ最後の回。 */
export async function getCurrentBattleEvent(today: string): Promise<BattleEvent | null> {
  const next = await getAll('SELECT * FROM battle_events WHERE event_date >= ? ORDER BY event_date ASC LIMIT 1', [today]);
  if (next[0]) return rowToEvent(next[0]);
  const last = await getAll('SELECT * FROM battle_events ORDER BY event_date DESC LIMIT 1');
  return last[0] ? rowToEvent(last[0]) : null;
}

/** スタッフ画面からの設定変更。受け取った項目だけ書き換える。 */
export async function updateBattleEvent(eventKey: string, ev: Omit<BattleEvent, 'eventKey'>): Promise<void> {
  await execute(
    `UPDATE battle_events SET title = ?, subtitle = ?, description = ?, event_date = ?, open_time = ?, start_time = ?, end_time = ?,
       venue = ?, venue_address = ?, move_seconds = ?, divisions = ?, entry_fee = ?, entry_fee_late = ?, late_fee_from = ?,
       spectator_fee = ?, spectator_note = ?, entry_deadline = ?, entry_open = ?, rules = ?, cancel_policy = ?, cast_json = ?, updated_at = ?
     WHERE event_key = ?`,
    [
      ev.title, ev.subtitle, ev.description, ev.eventDate, ev.openTime, ev.startTime, ev.endTime,
      ev.venue, ev.venueAddress, ev.moveSeconds, JSON.stringify(ev.divisions), ev.entryFee, ev.entryFeeLate, ev.lateFeeFrom,
      ev.spectatorFee, ev.spectatorNote, ev.entryDeadline, ev.entryOpen ? 1 : 0, ev.rules, ev.cancelPolicy, JSON.stringify(ev.cast), nowIso(), eventKey,
    ]
  );
}

/** 前の日の18:00(JST 'YYYY-MM-DDTHH:MM')。新しい回の締切の既定値。 */
export function previousDay1800(eventDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
  return `${d.toISOString().slice(0, 10)}T18:00`;
}

/**
 * 新しい回を作る。中身は元の回をコピーし、日付・締切だけ新しい開催日に合わせる。受付は「閉」で作る。
 * 同じ event_key が既にあれば何もしない(false)。
 */
export async function createBattleEventFrom(srcKey: string, newDate: string): Promise<boolean> {
  const src = await getBattleEvent(srcKey);
  if (!src) return false;
  const deadline = previousDay1800(newDate);
  const now = nowIso();
  const r = await execute(
    `INSERT OR IGNORE INTO battle_events (event_key, title, subtitle, description, event_date, open_time, start_time, end_time,
       venue, venue_address, move_seconds, divisions, entry_fee, entry_fee_late, late_fee_from, spectator_fee, spectator_note,
       entry_deadline, entry_open, rules, cancel_policy, cast_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      newDate, src.title, src.subtitle, src.description, newDate, src.openTime, src.startTime, src.endTime,
      src.venue, src.venueAddress, src.moveSeconds, JSON.stringify(src.divisions), src.entryFee, src.entryFeeLate, deadline,
      src.spectatorFee, src.spectatorNote, deadline, src.rules, src.cancelPolicy,
      // 出演者は毎回変わるので、役割だけ引き継いで名前は空・未発表にする
      JSON.stringify(src.cast.map((c) => ({ role: c.role, mark: c.mark, name: '', photo: '', note: '', instagram: '', announced: false }))),
      now, now,
    ]
  );
  return Number(r.rowsAffected ?? 0) > 0;
}

/** 30分過ぎた決済待ちを expired 化して枠を解放する。読み取り系の入口で必ず呼ぶ。 */
export async function sweepExpiredBattleEntries(): Promise<number> {
  const now = nowIso();
  const r = await execute(
    "UPDATE battle_entries SET payment_status = 'expired', updated_at = ? WHERE payment_status = 'pending' AND expires_at != '' AND expires_at < ?",
    [now, now]
  );
  return Number(r.rowsAffected ?? 0);
}

const USAGE_SQL = "SELECT divisions FROM battle_entries WHERE event_key = ? AND payment_status IN ('paid','pending')";

function countUsage(rows: { divisions: unknown }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) for (const k of parseDivisionKeys(r.divisions)) counts[k] = (counts[k] ?? 0) + 1;
  return counts;
}

/** 部門ごとの残り枠(確定+仮押さえを引いたもの)。 */
export function calcBattleRemaining(divisions: BattleDivision[], used: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of divisions) out[d.key] = Math.max(0, d.capacity - (used[d.key] ?? 0));
  return out;
}

export async function getBattleRemaining(ev: BattleEvent): Promise<Record<string, number>> {
  await sweepExpiredBattleEntries();
  const rows = await getAll(USAGE_SQL, [ev.eventKey]);
  return calcBattleRemaining(ev.divisions, countUsage(rows as { divisions: unknown }[]));
}

export type CreateBattleEntryResult =
  | { ok: true; entryId: number; editToken: string; amountTotal: number; status: 'pending' | 'paid' | 'test' }
  | { ok: false; error: string };

/**
 * 申込の保存。枠の再チェック→INSERTを1つの書き込みTxで行い、同時申込による定員超過を防ぐ。
 * カード決済は30分の仮押さえ(pending+expires_at)。金額0円なら決済なしで確定(paid)。
 * test=スタッフの確認用(枠を消費しない・公開一覧に出ない・決済しない)。
 */
export async function createBattleEntry(
  ev: BattleEvent,
  v: ValidatedBattleEntry,
  nowJst: string,
  opts: { test?: boolean } = {}
): Promise<CreateBattleEntryResult> {
  await sweepExpiredBattleEntries();
  const amount = calcBattleAmount(ev, v.divisions.length, v.spectators, nowJst);
  const editToken = generateEditToken();
  const now = nowIso();
  const status: 'pending' | 'paid' | 'test' = opts.test ? 'test' : amount.total === 0 ? 'paid' : 'pending';
  const expiresAt = status === 'pending' ? new Date(Date.now() + BATTLE_HOLD_MINUTES * 60 * 1000).toISOString() : '';

  try {
    const entryId = await withWriteTx(async (tx: Transaction) => {
      if (status !== 'test') {
        const usageRes = await tx.execute({ sql: USAGE_SQL, args: [ev.eventKey] });
        const remaining = calcBattleRemaining(ev.divisions, countUsage(usageRes.rows as unknown as { divisions: unknown }[]));
        for (const key of v.divisions) {
          if ((remaining[key] ?? 0) <= 0) {
            const name = ev.divisions.find((d) => d.key === key)?.name ?? key;
            throw new Error(`申し訳ありません。${name}は満員になりました`);
          }
        }
      }
      const r = await tx.execute({
        sql: `INSERT INTO battle_entries (event_key, email, dancer_name, dancer_kana, real_name, birthdate, rep, genre, phone, instagram,
                divisions, no_win_confirmed, spectators, spectators_preschool, guardian_name, guardian_consent,
                entry_unit, spectator_unit, amount_total, payment_status, edit_token, expires_at, note, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          ev.eventKey, v.email, v.dancerName, v.dancerKana, v.realName, v.birthdate, v.rep, v.genre, v.phone, v.instagram,
          JSON.stringify(v.divisions), v.noWinConfirmed ? 1 : 0, v.spectators, v.spectatorsPreschool, v.guardianName, v.guardianConsent ? 1 : 0,
          amount.entryUnit, amount.spectatorUnit, amount.total, status, editToken, expiresAt, opts.test ? 'スタッフ確認用テスト' : '', now, now,
        ],
      });
      return Number(r.lastInsertRowid);
    });
    return { ok: true, entryId, editToken, amountTotal: amount.total, status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '申込の保存に失敗しました' };
  }
}

export interface BattleEntryRow {
  entryId: number;
  eventKey: string;
  email: string;
  dancerName: string;
  dancerKana: string;
  realName: string;
  birthdate: string;
  rep: string;
  genre: string;
  phone: string;
  instagram: string;
  divisions: string[];
  noWinConfirmed: boolean;
  spectators: number;
  spectatorsPreschool: number;
  guardianName: string;
  guardianConsent: boolean;
  entryUnit: number;
  spectatorUnit: number;
  amountTotal: number;
  paymentStatus: string;
  stripeSessionId: string;
  expiresAt: string;
  note: string;
  createdAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- DB行 */
function rowToEntry(r: any): BattleEntryRow {
  return {
    entryId: Number(r.id),
    eventKey: String(r.event_key),
    email: String(r.email ?? ''),
    dancerName: String(r.dancer_name ?? ''),
    dancerKana: String(r.dancer_kana ?? ''),
    realName: String(r.real_name ?? ''),
    birthdate: String(r.birthdate ?? ''),
    rep: String(r.rep ?? ''),
    genre: String(r.genre ?? ''),
    phone: String(r.phone ?? ''),
    instagram: String(r.instagram ?? ''),
    divisions: parseDivisionKeys(r.divisions),
    noWinConfirmed: Number(r.no_win_confirmed) === 1,
    spectators: Number(r.spectators) || 0,
    spectatorsPreschool: Number(r.spectators_preschool) || 0,
    guardianName: String(r.guardian_name ?? ''),
    guardianConsent: Number(r.guardian_consent) === 1,
    entryUnit: Number(r.entry_unit) || 0,
    spectatorUnit: Number(r.spectator_unit) || 0,
    amountTotal: Number(r.amount_total) || 0,
    paymentStatus: String(r.payment_status),
    stripeSessionId: String(r.stripe_session_id ?? ''),
    expiresAt: String(r.expires_at ?? ''),
    note: String(r.note ?? ''),
    createdAt: String(r.created_at ?? ''),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 自分の申込1件をトークン完全一致で返す(列挙不可)。 */
export async function loadBattleEntryByToken(token: string): Promise<BattleEntryRow | null> {
  if (!token) return null;
  await sweepExpiredBattleEntries();
  const rows = await getAll('SELECT * FROM battle_entries WHERE edit_token = ? LIMIT 1', [token]);
  return rows[0] ? rowToEntry(rows[0]) : null;
}

export async function saveBattleStripeSession(entryId: number, sessionId: string): Promise<void> {
  await execute('UPDATE battle_entries SET stripe_session_id = ?, updated_at = ? WHERE id = ?', [sessionId, nowIso(), entryId]);
}

export interface PublicBattleEntry {
  dancerName: string;
  rep: string;
  genre: string;
  divisions: string[];
}

/**
 * 公開エントリー一覧。確定分(paid)のみ・公開列(ダンサー名/所属/ジャンル/部門)のみ。
 * 本名・連絡先・生年月日・IGなど他の列をこの関数から返してはならない。
 */
export async function getPublicBattleEntries(eventKey: string): Promise<PublicBattleEntry[]> {
  await sweepExpiredBattleEntries();
  const rows = await getAll(
    "SELECT dancer_name, rep, genre, divisions FROM battle_entries WHERE event_key = ? AND payment_status = 'paid' ORDER BY id ASC",
    [eventKey]
  );
  return rows.map((r) => ({
    dancerName: String(r.dancer_name ?? ''),
    rep: String(r.rep ?? ''),
    genre: String(r.genre ?? ''),
    divisions: parseDivisionKeys(r.divisions),
  }));
}

export type ApplyBattleWebhookResult =
  | { status: 'paid'; entry: BattleEntryRow; editToken: string; amountMismatch: boolean }
  | { status: 'duplicate' | 'ignored' | 'entry_not_found' | 'not_updated' };

/** 検証済みWebhookイベントを適用する(決済の正本)。規則はBF7と同じ。 */
export async function applyBattleWebhookEvent(
  ev: { eventId: string; type: string; sessionId: string; paymentIntentId: string; entryId: number; amountTotal: number | null; currency: string },
  rawPayload: string
): Promise<ApplyBattleWebhookResult> {
  const inserted = await execute(
    'INSERT OR IGNORE INTO battle_payments (stripe_event_id, event_type, stripe_session_id, payment_intent_id, entry_id, amount, currency, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [ev.eventId, ev.type, ev.sessionId, ev.paymentIntentId, ev.entryId, ev.amountTotal ?? 0, ev.currency || 'jpy', rawPayload.slice(0, 20000), nowIso()]
  );
  if (Number(inserted.rowsAffected ?? 0) === 0) return { status: 'duplicate' };
  if (ev.type !== 'checkout.session.completed') return { status: 'ignored' };

  const row = (await getAll('SELECT * FROM battle_entries WHERE id = ? LIMIT 1', [ev.entryId]))[0];
  if (!row) return { status: 'entry_not_found' };

  const updated = await execute(
    "UPDATE battle_entries SET payment_status = 'paid', stripe_session_id = ?, updated_at = ? WHERE id = ? AND payment_status IN ('pending', 'expired')",
    [ev.sessionId, nowIso(), Number(row.id)]
  );
  if (Number(updated.rowsAffected ?? 0) === 0) return { status: 'not_updated' };

  return {
    status: 'paid',
    entry: rowToEntry({ ...row, payment_status: 'paid', stripe_session_id: ev.sessionId }),
    editToken: String(row.edit_token),
    amountMismatch: ev.amountTotal != null && ev.amountTotal !== Number(row.amount_total),
  };
}

// ───────────────────────── スタッフ用(認証必須の画面からのみ呼ぶ) ─────────────────────────

export interface StaffBattleEntry extends BattleEntryRow {
  paymentIntentId: string;
}

/** 回の全申込(PII込み)。/staff 配下(サーバ側でセッション検証済み)からのみ使うこと。 */
export async function listBattleEntriesStaff(eventKey: string): Promise<StaffBattleEntry[]> {
  await sweepExpiredBattleEntries();
  const rows = await getAll('SELECT * FROM battle_entries WHERE event_key = ? ORDER BY id ASC', [eventKey]);
  const pays = await getAll(
    "SELECT p.entry_id, p.payment_intent_id FROM battle_payments p JOIN battle_entries e ON e.id = p.entry_id WHERE e.event_key = ? AND p.payment_intent_id != '' ORDER BY p.id",
    [eventKey]
  ).catch(() => []);
  const piByEntry = new Map<number, string>();
  for (const p of pays) if (p.entry_id != null) piByEntry.set(Number(p.entry_id), String(p.payment_intent_id));
  return rows.map((r) => ({ ...rowToEntry(r), paymentIntentId: piByEntry.get(Number(r.id)) ?? '' }));
}

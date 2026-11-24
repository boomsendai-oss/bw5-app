// 特設ワークショップ(/ws/[slug])のDBアクセス層。src/lib/db.ts 経由のみ。
//
// BOOM DOJO(battleDb.ts)と同じ考え方:
//   - 枠を消費する = 'paid' + 'onsite'(当日払いの確定) + 'pending'(カードの30分の仮押さえ)
//   - 期限切れの 'pending' は読み取り前に sweep で 'expired' にして枠を解放する
//   - カードの確定はStripeのWebhookが正本(sp_ws_payments に stripe_event_id UNIQUE で記録=冪等)
//   - 30分を過ぎて expired になった後に決済が完了した場合も paid に戻す(入金の事実を優先)
import { getAll, execute, withWriteTx } from '@/lib/db';
import type { Transaction } from '@libsql/client';
import { generateEditToken } from '@/lib/eventSignup';
import { SP_WS_HOLD_MINUTES, calcSpWsAmount, calcSpWsRemaining, type SpWsEvent, type ValidatedSpWsEntry } from '@/lib/spWs';

function nowIso(): string {
  return new Date().toISOString();
}

/* eslint-disable @typescript-eslint/no-explicit-any -- DB行 */
function rowToEvent(r: any): SpWsEvent {
  return {
    slug: String(r.slug),
    title: String(r.title ?? ''),
    subtitle: String(r.subtitle ?? ''),
    instructorName: String(r.instructor_name ?? ''),
    instructorKana: String(r.instructor_kana ?? ''),
    instructorFrom: String(r.instructor_from ?? ''),
    instructorBio: String(r.instructor_bio ?? ''),
    instructorGenre: String(r.instructor_genre ?? ''),
    instructorInstagram: String(r.instructor_instagram ?? '').replace(/^@/, ''),
    photoUrl: String(r.photo_url ?? ''),
    description: String(r.description ?? ''),
    eventDate: String(r.event_date ?? ''),
    startTime: String(r.start_time ?? ''),
    endTime: String(r.end_time ?? ''),
    venue: String(r.venue ?? ''),
    venueAddress: String(r.venue_address ?? ''),
    fee: Number(r.fee) || 0,
    capacity: Number(r.capacity) || 0,
    entryDeadline: String(r.entry_deadline ?? ''),
    entryOpen: Number(r.entry_open) === 1,
    belongings: String(r.belongings ?? ''),
    target: String(r.target ?? ''),
    cancelPolicy: String(r.cancel_policy ?? ''),
    contact: String(r.contact ?? ''),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export async function getSpWsEvent(slug: string): Promise<SpWsEvent | null> {
  if (!slug || !SLUG_RE.test(slug)) return null;
  const rows = await getAll('SELECT * FROM sp_ws_events WHERE slug = ? LIMIT 1', [slug]);
  return rows[0] ? rowToEvent(rows[0]) : null;
}

export async function listSpWsEvents(): Promise<SpWsEvent[]> {
  const rows = await getAll('SELECT * FROM sp_ws_events ORDER BY event_date DESC');
  return rows.map(rowToEvent);
}

/** スタッフ画面からの設定変更。 */
export async function updateSpWsEvent(slug: string, ev: Omit<SpWsEvent, 'slug'>): Promise<void> {
  await execute(
    `UPDATE sp_ws_events SET title = ?, subtitle = ?, instructor_name = ?, instructor_kana = ?, instructor_from = ?, instructor_bio = ?,
       instructor_genre = ?, instructor_instagram = ?, photo_url = ?, description = ?, event_date = ?, start_time = ?, end_time = ?,
       venue = ?, venue_address = ?, fee = ?, capacity = ?, entry_deadline = ?, entry_open = ?, belongings = ?, target = ?,
       cancel_policy = ?, contact = ?, updated_at = ?
     WHERE slug = ?`,
    [
      ev.title, ev.subtitle, ev.instructorName, ev.instructorKana, ev.instructorFrom, ev.instructorBio,
      ev.instructorGenre, ev.instructorInstagram, ev.photoUrl, ev.description, ev.eventDate, ev.startTime, ev.endTime,
      ev.venue, ev.venueAddress, ev.fee, ev.capacity, ev.entryDeadline, ev.entryOpen ? 1 : 0, ev.belongings, ev.target,
      ev.cancelPolicy, ev.contact, nowIso(), slug,
    ]
  );
}

/** その回の次の受付番号(確定した順)。1文で MAX+1 を取るので同時確定でも重ならない。 */
const NEXT_SEQ_SQL = '(SELECT COALESCE(MAX(receipt_seq), 0) + 1 FROM sp_ws_entries WHERE slug = ?)';
const USAGE_SQL = "SELECT COUNT(*) AS n FROM sp_ws_entries WHERE slug = ? AND payment_status IN ('paid','onsite','pending')";

/** 30分過ぎた決済待ちを expired にして枠を解放する。読み取り系の入口で必ず呼ぶ。 */
export async function sweepExpiredSpWsEntries(): Promise<number> {
  const now = nowIso();
  const r = await execute(
    "UPDATE sp_ws_entries SET payment_status = 'expired', updated_at = ? WHERE payment_status = 'pending' AND expires_at != '' AND expires_at < ?",
    [now, now]
  );
  return Number(r.rowsAffected ?? 0);
}

export async function getSpWsRemaining(ev: SpWsEvent): Promise<number> {
  await sweepExpiredSpWsEntries();
  const rows = await getAll(USAGE_SQL, [ev.slug]);
  return calcSpWsRemaining(ev.capacity, Number(rows[0]?.n) || 0);
}

export type CreateSpWsEntryResult =
  | { ok: true; entryId: number; editToken: string; amountTotal: number; status: 'pending' | 'paid' | 'onsite' | 'test' }
  | { ok: false; error: string };

/**
 * 申込の保存。枠の再チェック→INSERTを1つの書き込みTxで行い、同時申込による定員超過を防ぐ。
 * test=スタッフの確認用(枠を消費しない・決済しない)。
 */
export async function createSpWsEntry(ev: SpWsEvent, v: ValidatedSpWsEntry, opts: { test?: boolean } = {}): Promise<CreateSpWsEntryResult> {
  await sweepExpiredSpWsEntries();
  const amount = calcSpWsAmount(ev);
  const editToken = generateEditToken();
  const now = nowIso();
  const status: 'pending' | 'paid' | 'onsite' | 'test' = opts.test ? 'test' : amount === 0 ? 'paid' : v.payMethod === 'onsite' ? 'onsite' : 'pending';
  const expiresAt = status === 'pending' ? new Date(Date.now() + SP_WS_HOLD_MINUTES * 60 * 1000).toISOString() : '';
  const confirmed = status === 'paid' || status === 'onsite';

  try {
    const entryId = await withWriteTx(async (tx: Transaction) => {
      if (status !== 'test') {
        const usage = await tx.execute({ sql: USAGE_SQL, args: [ev.slug] });
        if (calcSpWsRemaining(ev.capacity, Number(usage.rows[0]?.n) || 0) <= 0) {
          throw new Error('申し訳ありません。定員に達したため、お申し込みを締め切りました');
        }
      }
      const r = await tx.execute({
        sql: `INSERT INTO sp_ws_entries (slug, name, kana, email, phone, age, is_member, guardian_name, guardian_consent,
                pay_method, payment_status, amount_total, edit_token, expires_at, note, created_at, updated_at, receipt_seq)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${confirmed ? NEXT_SEQ_SQL : 'NULL'})`,
        args: [
          ev.slug, v.name, v.kana, v.email, v.phone, v.age, v.isMember ? 1 : 0, v.guardianName, v.guardianConsent ? 1 : 0,
          v.payMethod, status, amount, editToken, expiresAt, opts.test ? 'スタッフ確認用テスト' : '', now, now,
          ...(confirmed ? [ev.slug] : []),
        ],
      });
      return Number(r.lastInsertRowid);
    });
    return { ok: true, entryId, editToken, amountTotal: amount, status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'お申し込みの保存に失敗しました' };
  }
}

export interface SpWsEntryRow {
  entryId: number;
  slug: string;
  name: string;
  kana: string;
  email: string;
  phone: string;
  age: number | null;
  isMember: boolean;
  guardianName: string;
  guardianConsent: boolean;
  payMethod: string;
  paymentStatus: string;
  amountTotal: number;
  stripeSessionId: string;
  receiptSeq: number | null;
  expiresAt: string;
  note: string;
  createdAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- DB行 */
function rowToEntry(r: any): SpWsEntryRow {
  return {
    entryId: Number(r.id),
    slug: String(r.slug),
    name: String(r.name ?? ''),
    kana: String(r.kana ?? ''),
    email: String(r.email ?? ''),
    phone: String(r.phone ?? ''),
    age: r.age == null || r.age === '' ? null : Number(r.age),
    isMember: Number(r.is_member) === 1,
    guardianName: String(r.guardian_name ?? ''),
    guardianConsent: Number(r.guardian_consent) === 1,
    payMethod: String(r.pay_method ?? ''),
    paymentStatus: String(r.payment_status),
    amountTotal: Number(r.amount_total) || 0,
    stripeSessionId: String(r.stripe_session_id ?? ''),
    receiptSeq: r.receipt_seq == null || r.receipt_seq === '' ? null : Number(r.receipt_seq),
    expiresAt: String(r.expires_at ?? ''),
    note: String(r.note ?? ''),
    createdAt: String(r.created_at ?? ''),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 自分の申込1件をトークン完全一致で返す(列挙不可)。 */
export async function loadSpWsEntryByToken(token: string): Promise<SpWsEntryRow | null> {
  if (!token || !/^[0-9a-f]{16,128}$/.test(token)) return null;
  await sweepExpiredSpWsEntries();
  const rows = await getAll('SELECT * FROM sp_ws_entries WHERE edit_token = ? LIMIT 1', [token]);
  return rows[0] ? rowToEntry(rows[0]) : null;
}

export async function saveSpWsStripeSession(entryId: number, sessionId: string): Promise<void> {
  await execute('UPDATE sp_ws_entries SET stripe_session_id = ?, updated_at = ? WHERE id = ?', [sessionId, nowIso(), entryId]);
}

export type ApplySpWsWebhookResult =
  | { status: 'paid'; entry: SpWsEntryRow; editToken: string; amountMismatch: boolean }
  | { status: 'duplicate' | 'ignored' | 'entry_not_found' | 'not_updated' };

/** 検証済みWebhookイベントを適用する(決済の正本)。規則は BOOM DOJO と同じ。 */
export async function applySpWsWebhookEvent(
  ev: { eventId: string; type: string; sessionId: string; paymentIntentId: string; entryId: number; amountTotal: number | null; currency: string },
  rawPayload: string
): Promise<ApplySpWsWebhookResult> {
  const inserted = await execute(
    'INSERT OR IGNORE INTO sp_ws_payments (stripe_event_id, event_type, stripe_session_id, payment_intent_id, entry_id, amount, currency, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [ev.eventId, ev.type, ev.sessionId, ev.paymentIntentId, ev.entryId, ev.amountTotal ?? 0, ev.currency || 'jpy', rawPayload.slice(0, 20000), nowIso()]
  );
  if (Number(inserted.rowsAffected ?? 0) === 0) return { status: 'duplicate' };
  if (ev.type !== 'checkout.session.completed') return { status: 'ignored' };

  const row = (await getAll('SELECT * FROM sp_ws_entries WHERE id = ? LIMIT 1', [ev.entryId]))[0];
  if (!row) return { status: 'entry_not_found' };

  const updated = await execute(
    `UPDATE sp_ws_entries SET payment_status = 'paid', stripe_session_id = ?, updated_at = ?,
       receipt_seq = COALESCE(receipt_seq, ${NEXT_SEQ_SQL})
     WHERE id = ? AND payment_status IN ('pending', 'expired')`,
    [ev.sessionId, nowIso(), String(row.slug), Number(row.id)]
  );
  if (Number(updated.rowsAffected ?? 0) === 0) return { status: 'not_updated' };
  const after = (await getAll('SELECT * FROM sp_ws_entries WHERE id = ? LIMIT 1', [Number(row.id)]))[0] ?? row;
  return {
    status: 'paid',
    entry: rowToEntry(after),
    editToken: String(row.edit_token),
    amountMismatch: ev.amountTotal != null && ev.amountTotal !== Number(row.amount_total),
  };
}

// ───────────────────────── スタッフ用(認証必須の画面からのみ呼ぶ) ─────────────────────────

export interface StaffSpWsEntry extends SpWsEntryRow {
  paymentIntentId: string;
}

/** 回の全申込(個人情報込み)。/staff 配下(サーバ側でセッション検証済み)からのみ使うこと。 */
export async function listSpWsEntriesStaff(slug: string): Promise<StaffSpWsEntry[]> {
  await sweepExpiredSpWsEntries();
  const rows = await getAll('SELECT * FROM sp_ws_entries WHERE slug = ? ORDER BY id ASC', [slug]);
  const pays = await getAll(
    "SELECT p.entry_id, p.payment_intent_id FROM sp_ws_payments p JOIN sp_ws_entries e ON e.id = p.entry_id WHERE e.slug = ? AND p.payment_intent_id != '' ORDER BY p.id",
    [slug]
  ).catch(() => []);
  const piByEntry = new Map<number, string>();
  for (const p of pays) if (p.entry_id != null) piByEntry.set(Number(p.entry_id), String(p.payment_intent_id));
  return rows.map((r) => ({ ...rowToEntry(r), paymentIntentId: piByEntry.get(Number(r.id)) ?? '' }));
}

/** 当日払いの受け取り(onsite → paid)。スタッフ画面(認証済み)からのみ呼ぶ。 */
export async function markSpWsOnsitePaid(entryId: number): Promise<boolean> {
  const r = await execute(
    "UPDATE sp_ws_entries SET payment_status = 'paid', note = CASE WHEN note = '' THEN '当日現金で受領' ELSE note || ' / 当日現金で受領' END, updated_at = ? WHERE id = ? AND payment_status = 'onsite'",
    [nowIso(), entryId]
  );
  return Number(r.rowsAffected ?? 0) > 0;
}

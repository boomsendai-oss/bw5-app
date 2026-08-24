// キャンセル待ちの保存。順番(position)の採番は同時申込で重複しないよう原子的に行う。
import { getAll, getOne, execute } from './db';
import { nowUtcIso, todayJst } from './dateJst';
import { WAITLIST_CAPACITY, canJoinWaitlist, offerDeadlineHours, type WaitlistInput, type WaitlistGate } from './bf6Waitlist';

export type WaitlistRow = {
  id: number; division: string; position: number; status: string;
  dancerName: string; performerName: string; grade: string; rep: string;
  email: string; phone: string; buyerName: string;
  offerExpiresAt: string | null; createdAt: string;
};

function toRow(r: Record<string, unknown>): WaitlistRow {
  return {
    id: Number(r.id), division: String(r.division), position: Number(r.position),
    status: String(r.status), dancerName: String(r.dancer_name),
    performerName: String(r.performer_name), grade: String(r.grade), rep: String(r.rep),
    email: String(r.email), phone: String(r.phone), buyerName: String(r.buyer_name),
    offerExpiresAt: r.offer_expires_at ? String(r.offer_expires_at) : null,
    createdAt: String(r.created_at ?? ''),
  };
}

/** まだ繰り上がっていない(待っている)人数。 */
export async function countWaiting(division: string): Promise<number> {
  const r = await getOne(
    "SELECT COUNT(*) AS n FROM bf_waitlist WHERE division = ? AND status IN ('waiting','offered')",
    [division]
  ).catch(() => null);
  return Number(r?.n ?? 0);
}

export async function listWaitlist(division?: string): Promise<WaitlistRow[]> {
  const rows = division
    ? await getAll('SELECT * FROM bf_waitlist WHERE division = ? ORDER BY position', [division])
    : await getAll('SELECT * FROM bf_waitlist ORDER BY division, position');
  return rows.map(toRow);
}

export type JoinResult = { ok: true; position: number } | { ok: false; reason: WaitlistGate };

/**
 * キャンセル待ちに登録する。
 * position は「その部門の最大+1」を1本のINSERT…SELECTで採番し、
 * UNIQUE(division, position) で衝突を弾いて再試行する(同時申込対策)。
 */
export async function joinWaitlist(
  division: string,
  remaining: number,
  v: WaitlistInput
): Promise<JoinResult> {
  const waiting = await countWaiting(division);
  const gate = canJoinWaitlist({ remaining, waiting });
  if (gate !== 'ok') return { ok: false, reason: gate };

  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await execute(
      `INSERT INTO bf_waitlist
         (division, position, status, buyer_name, email, phone, dancer_name, dancer_kana,
          performer_name, grade, genre, rep, instagram, created_at)
       SELECT ?, COALESCE(MAX(position), 0) + 1, 'waiting', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM bf_waitlist WHERE division = ?`,
      [division, v.buyerName, v.email, v.phone, v.dancerName, v.dancerKana,
       v.performerName, v.grade, v.genre, v.rep, v.instagram || null, nowUtcIso(), division]
    ).catch(() => null);
    if (r && (r.rowsAffected ?? 0) > 0) {
      const row = await getOne('SELECT position FROM bf_waitlist WHERE id = ?', [Number(r.lastInsertRowid)]);
      return { ok: true, position: Number(row?.position ?? 0) };
    }
  }
  return { ok: false, reason: 'waitlist_full' };
}

/** 繰り上げ通知を出す(次の1人)。期限は当日基準で48h/24h。 */
export async function offerNext(division: string): Promise<WaitlistRow | null> {
  const row = await getOne(
    "SELECT * FROM bf_waitlist WHERE division = ? AND status = 'waiting' ORDER BY position LIMIT 1",
    [division]
  );
  if (!row) return null;
  const hours = offerDeadlineHours(todayJst());
  const expires = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  await execute(
    "UPDATE bf_waitlist SET status = 'offered', offered_at = ?, offer_expires_at = ? WHERE id = ? AND status = 'waiting'",
    [nowUtcIso(), expires, Number(row.id)]
  );
  return toRow({ ...row, status: 'offered', offer_expires_at: expires });
}

export async function setWaitlistStatus(id: number, status: string): Promise<void> {
  await execute('UPDATE bf_waitlist SET status = ?, resolved_at = ? WHERE id = ?', [status, nowUtcIso(), id]);
}

export { WAITLIST_CAPACITY };

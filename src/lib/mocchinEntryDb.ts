// BW6スペシャルナンバー by MOCCHIN の申込のDB操作。純ロジックは mocchinEntry.ts。
// 公開フォーム: src/app/mocchin / スタッフ一覧: src/app/staff/mocchin
import { randomBytes } from 'node:crypto';
import { execute, getAll, getOne } from '@/lib/db';
import { nowUtcIso, todayJst } from '@/lib/dateJst';
import { MOCCHIN_DEFAULT_CAPACITY, MOCCHIN_TEST_CARD_AMOUNT, mocchinPaySteps, paidStepSet, parseSteps, type MocchinPayStep, type ValidatedMocchin } from '@/lib/mocchinEntry';
import type { MocchinWebhookEvent } from '@/lib/mocchinStripe';

/** 設定は party_settings に置く(クリパと同じ置き場・event_key で分ける) */
export const MOCCHIN_SETTINGS_KEY = 'bw6_mocchin';
/** 講師用リンクの鍵の種(鍵そのものは秘密値から作るのでリポジトリには出ない) */
export const MOCCHIN_INSTRUCTOR_KEY = 'bw6_mocchin_instructor';

export interface MocchinEntry {
  id: number;
  status: 'active' | 'cancelled';
  name: string;
  kana: string;
  age: string;
  guardianName: string;
  phone: string;
  email: string;
  isMember: boolean;
  memberNo: string;
  danceHistory: string;
  classNumber: string;
  note: string;
  paid: boolean;
  paidAt: string;
  staffNote: string;
  appliedOn: string;
  createdAt: string;
  paymentPlan: string;
  lessonPaid: string;
  reminded: string;
  payMethod: string;
  payToken: string;
  cardSteps: string;
  checkoutSessionId: string;
  checkoutStep: number;
}

function toEntry(r: Record<string, unknown>): MocchinEntry {
  return {
    id: Number(r.id),
    status: r.status === 'cancelled' ? 'cancelled' : 'active',
    name: String(r.name ?? ''),
    kana: String(r.kana ?? ''),
    age: String(r.age ?? ''),
    guardianName: String(r.guardian_name ?? ''),
    phone: String(r.phone ?? ''),
    email: String(r.email ?? ''),
    isMember: Number(r.is_member) === 1,
    memberNo: String(r.member_no ?? ''),
    danceHistory: String(r.dance_history ?? ''),
    classNumber: String(r.class_number ?? ''),
    note: String(r.note ?? ''),
    paid: Number(r.paid) === 1,
    paidAt: String(r.paid_at ?? ''),
    staffNote: String(r.staff_note ?? ''),
    appliedOn: String(r.applied_on ?? ''),
    createdAt: String(r.created_at ?? ''),
    paymentPlan: String(r.payment_plan ?? ''),
    lessonPaid: String(r.lesson_paid ?? ''),
    reminded: String(r.reminded ?? ''),
    payMethod: String(r.pay_method ?? 'transfer'),
    payToken: String(r.pay_token ?? ''),
    cardSteps: String(r.card_steps ?? ''),
    checkoutSessionId: String(r.checkout_session_id ?? ''),
    checkoutStep: Number(r.checkout_step ?? -1),
  };
}

export async function getMocchinCapacity(): Promise<number> {
  const r = await getOne('SELECT value FROM party_settings WHERE event_key = ? AND key = ?', [MOCCHIN_SETTINGS_KEY, 'capacity']);
  const n = Number(r?.value);
  return Number.isInteger(n) && n > 0 ? n : MOCCHIN_DEFAULT_CAPACITY;
}

export async function saveMocchinCapacity(n: number): Promise<void> {
  await execute(
    'INSERT INTO party_settings (event_key, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(event_key, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [MOCCHIN_SETTINGS_KEY, 'capacity', String(n), nowUtcIso()]
  );
}

export async function countActiveMocchin(): Promise<number> {
  const r = await getOne("SELECT COUNT(*) AS n FROM mocchin_entries WHERE status = 'active'");
  return Number(r?.n ?? 0);
}

/** 申込を1件保存して id を返す。定員を超えても受け付ける(オーディション/キャンセル待ちの案内は呼び出し側) */
export async function createMocchinEntry(v: ValidatedMocchin): Promise<{ id: number; appliedOn: string; payToken: string }> {
  const payToken = randomBytes(24).toString('hex');
  const now = nowUtcIso();
  const appliedOn = todayJst();
  const r = await execute(
    `INSERT INTO mocchin_entries
      (name, kana, age, guardian_name, phone, email, is_member, member_no, dance_history, class_number, payment_plan, pay_method, pay_token, note, applied_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.name, v.kana, v.age, v.guardianName, v.phone, v.email, v.isMember ? 1 : 0, v.memberNo, v.danceHistory, v.classNumber, v.paymentPlan, v.payMethod, payToken, v.note, appliedOn, now, now]
  );
  return { id: Number(r.lastInsertRowid), appliedOn, payToken };
}

export async function listMocchinEntries(): Promise<MocchinEntry[]> {
  const rows = await getAll('SELECT * FROM mocchin_entries ORDER BY id');
  return rows.map(toEntry);
}

export async function loadMocchinEntryByToken(token: string): Promise<MocchinEntry | null> {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const row = await getOne('SELECT * FROM mocchin_entries WHERE pay_token = ?', [token]);
  return row ? toEntry(row) : null;
}

/** 決済画面を作った記録(同じ回を二重に作らないため) */
export async function saveMocchinCheckout(id: number, sessionId: string, step: number): Promise<void> {
  await execute('UPDATE mocchin_entries SET checkout_session_id = ?, checkout_step = ?, updated_at = ? WHERE id = ?', [sessionId, step, nowUtcIso(), id]);
}

/** プレビューからのテスト申込か。カードは本物の請求になるので少額で試す */
export function isMocchinTestEntry(e: Pick<MocchinEntry, 'staffNote'>): boolean {
  return e.staffNote.includes('テスト');
}

/** その回のカード請求額。テスト申込だけ少額にする */
export function mocchinCardAmount(e: Pick<MocchinEntry, 'staffNote'>, step: MocchinPayStep): number {
  return isMocchinTestEntry(e) ? MOCCHIN_TEST_CARD_AMOUNT : step.amount;
}

export type ApplyMocchinWebhookResult =
  | { status: 'duplicate' | 'ignored' | 'entry_not_found' | 'step_not_found' | 'already_paid' }
  | { status: 'paid'; entry: MocchinEntry; step: MocchinPayStep; remaining: MocchinPayStep[]; amountMismatch: boolean };

/**
 * カード決済の確定通知を反映する。入金の記録 → 処理済みの記録の順にして、途中で失敗してもStripeの再送で取り戻せるようにする。
 * 同じ通知の再送は duplicate、すでに入金済みの回への決済は already_paid(二重払いなので返金の確認が要る)。
 */
export async function applyMocchinWebhookEvent(ev: MocchinWebhookEvent): Promise<ApplyMocchinWebhookResult> {
  const seen = await getOne('SELECT 1 AS x FROM mocchin_payments WHERE stripe_event_id = ?', [ev.eventId]);
  if (seen) return { status: 'duplicate' };
  const done = async () =>
    execute(
      'INSERT OR IGNORE INTO mocchin_payments (stripe_event_id, event_type, stripe_session_id, entry_id, step, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [ev.eventId, ev.type, ev.sessionId, ev.entryId, ev.step, ev.amountTotal ?? 0, nowUtcIso()]
    );
  if (ev.type !== 'checkout.session.completed') {
    await done();
    return { status: 'ignored' };
  }
  const row = await getOne('SELECT * FROM mocchin_entries WHERE id = ?', [ev.entryId]);
  if (!row) return { status: 'entry_not_found' };
  const entry = toEntry(row);
  const steps = mocchinPaySteps(entry.paymentPlan, entry.isMember, entry.appliedOn);
  const step = steps.find((s) => s.step === ev.step);
  if (!step) return { status: 'step_not_found' };
  const paid = paidStepSet(entry.paid, entry.lessonPaid);
  if (paid.has(ev.step)) {
    await done();
    return { status: 'already_paid' };
  }

  const card = [...new Set([...parseSteps(entry.cardSteps), ev.step])].sort((a, b) => a - b).join(',');
  const now = nowUtcIso();
  if (ev.step === 0) {
    await execute('UPDATE mocchin_entries SET paid = 1, paid_at = ?, card_steps = ?, updated_at = ? WHERE id = ?', [now, card, now, ev.entryId]);
  } else {
    const lesson = [...new Set([...parseSteps(entry.lessonPaid), ev.step])].sort((a, b) => a - b).join(',');
    await execute('UPDATE mocchin_entries SET lesson_paid = ?, card_steps = ?, updated_at = ? WHERE id = ?', [lesson, card, now, ev.entryId]);
  }
  await done();
  paid.add(ev.step);
  return {
    status: 'paid',
    entry,
    step,
    remaining: steps.filter((s) => !paid.has(s.step)),
    amountMismatch: ev.amountTotal != null && ev.amountTotal !== mocchinCardAmount(entry, step),
  };
}

export async function setMocchinPaid(id: number, paid: boolean): Promise<boolean> {
  const now = nowUtcIso();
  const r = await execute('UPDATE mocchin_entries SET paid = ?, paid_at = ?, updated_at = ? WHERE id = ?', [paid ? 1 : 0, paid ? now : '', now, id]);
  return Number(r.rowsAffected) > 0;
}

/** レッスン代の分割の入金(step=1〜)を付け外しする */
export async function setMocchinLessonPaid(id: number, step: number, paid: boolean): Promise<boolean> {
  const row = await getOne('SELECT lesson_paid FROM mocchin_entries WHERE id = ?', [id]);
  if (!row) return false;
  const set = new Set(parseSteps(String(row.lesson_paid ?? '')));
  if (paid) set.add(step);
  else set.delete(step);
  const value = [...set].sort((a, b) => a - b).join(',');
  const r = await execute('UPDATE mocchin_entries SET lesson_paid = ?, updated_at = ? WHERE id = ?', [value, nowUtcIso(), id]);
  return Number(r.rowsAffected) > 0;
}

/** お知らせメールを送った回を記録する(同じ回を二重に送らないため) */
export async function markMocchinReminded(id: number, reminded: string, steps: number[]): Promise<void> {
  const value = [...new Set([...parseSteps(reminded), ...steps])].sort((a, b) => a - b).join(',');
  await execute('UPDATE mocchin_entries SET reminded = ?, updated_at = ? WHERE id = ?', [value, nowUtcIso(), id]);
}

/** レッスン代の払い方を決める(参加費だけ=pending の申込のときだけ変わる)。変わったら true */
export async function setMocchinLessonPlan(id: number, plan: string): Promise<boolean> {
  const r = await execute("UPDATE mocchin_entries SET payment_plan = ?, updated_at = ? WHERE id = ? AND payment_plan = 'pending'", [plan, nowUtcIso(), id]);
  return Number(r.rowsAffected) > 0;
}

export async function setMocchinStatus(id: number, status: 'active' | 'cancelled'): Promise<boolean> {
  const r = await execute('UPDATE mocchin_entries SET status = ?, updated_at = ? WHERE id = ?', [status, nowUtcIso(), id]);
  return Number(r.rowsAffected) > 0;
}

export async function setMocchinStaffNote(id: number, note: string): Promise<boolean> {
  const r = await execute('UPDATE mocchin_entries SET staff_note = ?, updated_at = ? WHERE id = ?', [note.slice(0, 500), nowUtcIso(), id]);
  return Number(r.rowsAffected) > 0;
}

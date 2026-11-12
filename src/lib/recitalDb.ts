// BW6 発表会（段階1）の DB の読み書き：発表会・設定・料金の規則・作品・世帯の中身・お金と見え方・変えた記録。
// DB は src/lib/db.ts 経由だけ（createClient を呼ばない）。名前と型の正本は
// .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
// 記録の日時は UTC ISO（nowUtcIso）。設定の日時は JST 'YYYY-MM-DD HH:MM'。
import { batch, execute, getAll, getOne, withWriteTx } from '@/lib/db';
import type { Transaction } from '@libsql/client';
import { nowUtcIso } from '@/lib/dateJst';
import {
  RECITAL_SETTING_DEFAULTS,
  RECITAL_SETTING_KEYS_LOCKED,
  checkSettingValue,
  householdView,
  moneySummary,
  parseRecitalSettings,
  type HouseholdView,
  type MoneySummary,
  type RecitalSettings,
} from '@/lib/recital';
import { feeCheck, type FeeRule } from '@/lib/recitalFee';
import type { MemberLite } from '@/lib/recitalMatch';
import { recitalResetStatements } from '@/lib/recitalReset';

// ---------- 型（各表の列そのまま） ----------

export type RecitalEvent = { event_key: string; title: string; show_date: string; rehearsal_date: string; venue: string; is_test: number };

export type HouseholdRow = {
  id: number; event_key: string; seq: number; ref_code: string;
  contact_last_name: string | null; contact_first_name: string | null; contact_last_kana: string | null; contact_first_kana: string | null;
  email: string | null; phone: string | null; edit_token: string; submit_key: string | null; source: string; pay_method: string | null;
  bank_told_at: string | null; bank_told_date: string | null; bank_told_name: string | null; bank_told_amount: number | null; bank_told_by: string | null;
  extend_until: string | null; pay_due_override: string | null; status: string; merged_into: number | null;
  applied_at: string | null; opened_at: string | null; mail_opened_at: string | null; mail_bounced: number; staff_note: string | null; created_at: string;
};

export type PersonRow = {
  id: number; event_key: string; seq: number; household_id: number | null; category: string; member_id: number | null;
  match_status: string | null; instructor_link_id: number | null; last_name: string; first_name: string | null;
  last_kana: string | null; first_kana: string | null; birthday: string | null; display_name: string | null;
  name_ok: number; name_confirmed_at: string | null; photo_ok: number; sns_ok: number; insta_handle: string | null; insta_synced_at: string | null;
  tshirt_size: string | null; tshirt_color: string | null; tshirt_body: string | null; fee_class_override: string | null;
  staff_note: string | null; ext_ref: string | null; merged_into: number | null; ending_group: string | null; room_id: number | null;
  status: string; created_at: string;
};

export type CastRow = {
  id: number; event_key: string; person_id: number; work_id: number; status: string; source: string;
  applied_at: string | null; decided_at: string | null; withdrawn_at: string | null; withdraw_reason: string | null;
  absent_photo: number | null; sort_order: number | null; created_at: string;
};

export type ChargeRow = {
  id: number; event_key: string; household_id: number; person_id: number | null; item_code: string; ref: string; label: string;
  qty: number; unit_amount: number; amount: number; due_on: string | null; status: string; void_reason: string | null; voided_at: string | null; created_at: string;
};

export type PaymentRow = {
  id: number; event_key: string; household_id: number | null; ticket_order_id: number | null; method: string; amount: number; paid_on: string; source: string;
  bank_transaction_id: number | null; bank_date: string | null; bank_desc: string | null; stripe_event_id: string | null; stripe_session_id: string | null;
  stripe_pi_id: string | null; payer_name_raw: string | null; confirmed_by: string | null; memo: string | null; created_at: string;
};

export type RefundRow = {
  id: number; event_key: string; household_id: number; amount: number; reason_no: number; reason: string; waiting_reply: number;
  status: string; payment_id: number | null; source_payment_id: number | null; created_at: string; created_by: string; done_at: string | null;
};

export type MailRow = {
  id: number; event_key: string; household_id: number | null; instructor_link_id: number | null; ticket_order_id: number | null;
  mail_kind: string; dedupe_key: string | null; status: string; error: string | null; sent_at: string | null; created_at: string;
};

export type ChangeRow = {
  id: number; event_key: string; household_id: number | null; person_id: number | null; work_id: number | null; action: string;
  received_at: string | null; before_json: string | null; after_json: string | null; actor: string; reason: string | null; is_exception: number; created_at: string;
};

export type WorkRow = {
  id: number; event_key: string; work_code: string; kind: string; title: string; title_reading: string | null; title_final: number | null;
  class_label: string | null; class_short: string | null; slot_label: string | null; target_label: string | null; genre: string | null;
  entry_mode: string; fee_type: string; extra_fee: number | null; capacity: number | null; status: string; merged_into: number | null;
  public_note: string | null; staff_note: string | null; sort_order: number; duration_sec: number | null; start_style: string | null;
  exit_style: string | null; song: string | null; costume: string | null; color1: string | null; color2: string | null; intro_text: string | null;
  props: string | null; mic: number | null; smoke: number | null; attack: number | null; attack_sec: number | null; video_sale_ok: number | null;
  sns_post_ok: number | null; line_group_url: string | null; lighting_plan_json: string | null; created_at: string;
};

export type WorkInput = {
  id?: number; kind: string; title: string; class_label: string; slot_label: string; target_label: string; genre: string;
  entry_mode: 'form' | 'staff' | 'none'; fee_type: 'counted' | 'not_counted' | 'extra' | 'separate';
  extra_fee: number | null; capacity: number | null; status: 'draft' | 'open' | 'fixed' | 'dropped'; merged_into: number | null;
  public_note: string; staff_note: string; sort_order: number;
  classes: { lesson_master_id: number | null; label: string }[];
  instructors: { instructor_id: number | null; display_name: string; role: 'choreo' | 'perform' | 'assist'; sort_order: number }[];
};

export type HouseholdDetail = {
  household: HouseholdRow; people: PersonRow[]; casts: CastRow[]; charges: ChargeRow[]; payments: PaymentRow[];
  refunds: RefundRow[]; mails: MailRow[]; changes: ChangeRow[]; money: MoneySummary; view: HouseholdView; refundTodo: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- DB の行は動的キー */
/** libsql の行を素のオブジェクトにする（Server Component から渡せる形） */
function plain<T>(r: any): T {
  return { ...r } as T;
}

async function readRows(tx: Transaction | null, sql: string, args: any[]): Promise<any[]> {
  if (tx) return (await tx.execute({ sql, args })).rows as any[];
  return getAll(sql, args);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- 発表会と設定 ----------

export async function getRecitalEvent(eventKey: string): Promise<RecitalEvent | null> {
  const r = await getOne(
    'SELECT event_key, title, show_date, rehearsal_date, venue, is_test FROM recital_events WHERE event_key = ?',
    [eventKey],
  );
  if (!r) return null;
  return {
    event_key: String(r.event_key),
    title: String(r.title),
    show_date: String(r.show_date),
    rehearsal_date: r.rehearsal_date == null ? '' : String(r.rehearsal_date),
    venue: r.venue == null ? '' : String(r.venue),
    is_test: Number(r.is_test),
  };
}

export async function getRecitalSettings(eventKey: string): Promise<RecitalSettings> {
  const rows = await getAll('SELECT key, value FROM recital_settings WHERE event_key = ?', [eventKey]);
  return parseRecitalSettings(rows.map((r) => ({ key: String(r.key), value: String(r.value ?? '') })));
}

const UPSERT_SETTING_SQL = `INSERT INTO recital_settings (event_key, key, value, updated_at, updated_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(event_key, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`;

function upsertSettingArgs(eventKey: string, key: string, value: string, staffName: string): (string | null)[] {
  const now = nowUtcIso();
  return [eventKey, key, value, now, staffName, now];
}

/** 設定の画面の保存。LOCKED・知らない鍵・形ちがいは throw。変えた記録は書かない（行の updated_by が記録）。 */
export async function saveRecitalSetting(eventKey: string, key: string, value: string, staffName: string): Promise<void> {
  if ((RECITAL_SETTING_KEYS_LOCKED as readonly string[]).includes(key)) throw new Error('recital_setting:locked');
  if (!(key in RECITAL_SETTING_DEFAULTS)) throw new Error('recital_setting:unknown');
  if (checkSettingValue(key, value) !== null) throw new Error('recital_setting:bad_value');
  await execute(UPSERT_SETTING_SQL, upsertSettingArgs(eventKey, key, value, staffName));
}

/** JST の今 'YYYY-MM-DD HH:MM' */
function nowJstMinute(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** 支払いを開ける（pay_ok_at を入れる）。もう入っていれば何もしない。LOCKED を通らない内部の書き込みはここだけ。 */
export async function setPayOk(eventKey: string, staffName: string): Promise<void> {
  await withWriteTx(async (tx) => {
    const cur = await tx.execute({ sql: "SELECT value FROM recital_settings WHERE event_key = ? AND key = 'pay_ok_at'", args: [eventKey] });
    const v = cur.rows[0]?.value;
    if (v != null && String(v).trim() !== '') return;
    const at = nowJstMinute();
    await tx.execute({ sql: UPSERT_SETTING_SQL, args: upsertSettingArgs(eventKey, 'pay_ok_at', at, staffName) });
    await logChangeTx(tx, { eventKey, action: 'pay_opened', actor: staffName, after: { pay_ok_at: at } });
  });
}

/** 受付を開ける（on=false）／止める（on=true）。開けるときは検算・仮の金額・同意・使い道の知らせ・公式LINE をこの順で見る。 */
export async function setSuspended(
  eventKey: string,
  on: boolean,
  staffName: string,
): Promise<{ ok: boolean; reason?: 'fee_check' | 'tentative' | 'consent_empty' | 'privacy_empty' | 'line_empty' }> {
  if (!on) {
    const s = await getRecitalSettings(eventKey);
    const check = feeCheck(await listFeeRules(eventKey), s.fee_check_first, s.fee_check_family);
    if (check.tentative) return { ok: false, reason: 'tentative' };
    if (!check.ok) return { ok: false, reason: 'fee_check' };
    if (s.consent_items.trim() === '') return { ok: false, reason: 'consent_empty' };
    if (s.privacy_text.trim() === '') return { ok: false, reason: 'privacy_empty' };
    if (s.line_url.trim() === '') return { ok: false, reason: 'line_empty' };
  }
  const value = on ? '1' : '0';
  await withWriteTx(async (tx) => {
    await tx.execute({ sql: UPSERT_SETTING_SQL, args: upsertSettingArgs(eventKey, 'suspended', value, staffName) });
    await logChangeTx(tx, { eventKey, action: on ? 'entry_suspended' : 'entry_opened', actor: staffName, after: { suspended: value } });
  });
  return { ok: true };
}

/** 料金の規則（sort_order, id の順）。規則を読むのは全部ここ。 */
export async function listFeeRules(eventKey: string): Promise<(FeeRule & { id: number })[]> {
  const rows = await getAll(
    `SELECT id, payer_role, item_code, nth_from, nth_to, unit_amount, qty, label, is_tentative, sort_order
     FROM recital_fee_rules WHERE event_key = ? ORDER BY sort_order, id`,
    [eventKey],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    payer_role: String(r.payer_role) as FeeRule['payer_role'],
    item_code: String(r.item_code) as FeeRule['item_code'],
    nth_from: Number(r.nth_from),
    nth_to: r.nth_to == null ? null : Number(r.nth_to),
    unit_amount: Number(r.unit_amount),
    qty: Number(r.qty),
    label: String(r.label),
    is_tentative: Number(r.is_tentative),
    sort_order: Number(r.sort_order),
  }));
}

/** 会員を照合の形に詰める（全タスク共通）。退会は withdrew のまま、休会（member_type='休会'）は leave。 */
export async function loadMembersLite(): Promise<MemberLite[]> {
  const rows = await getAll('SELECT id, full_name, full_name_kana, birthday, status, member_type FROM boom_members');
  return rows.map((r) => {
    const status = r.status == null ? null : String(r.status);
    return {
      id: Number(r.id),
      fullName: r.full_name == null ? null : String(r.full_name),
      fullNameKana: r.full_name_kana == null ? null : String(r.full_name_kana),
      birthday: r.birthday == null ? null : String(r.birthday),
      status: status !== 'withdrew' && r.member_type === '休会' ? 'leave' : status,
    };
  });
}

// ---------- 作品 ----------

export async function listWorks(eventKey: string): Promise<WorkRow[]> {
  const rows = await getAll('SELECT * FROM recital_works WHERE event_key = ? ORDER BY sort_order, id', [eventKey]);
  return rows.map((r) => plain<WorkRow>(r));
}

function nextWorkCode(codes: string[]): string {
  let max = 0;
  for (const c of codes) {
    const m = /^W(\d+)$/.exec(c);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'W' + String(max + 1).padStart(2, '0');
}

/**
 * 作品を足す／直す。W番号は新しいときだけ（dropped も数えて最大＋1）。直すときは変えない。
 * クラスと講師のつなぎの2表だけ、その作品の行を消して入れ直す。
 * staffName は作品の表に直した人の列が無いので今は使わない（呼ぶ側の形をそろえるために受ける）。
 */
export async function saveWork(eventKey: string, w: WorkInput, staffName: string): Promise<{ id: number; workCode: string }> {
  void staffName;
  return withWriteTx(async (tx) => {
    const now = nowUtcIso();
    const fields = [
      w.kind, w.title, w.class_label, w.slot_label, w.target_label, w.genre, w.entry_mode, w.fee_type,
      w.extra_fee, w.capacity, w.status, w.merged_into, w.public_note, w.staff_note, w.sort_order,
    ];
    let id: number;
    let workCode: string;
    if (w.id != null) {
      const cur = await tx.execute({ sql: 'SELECT work_code FROM recital_works WHERE id = ? AND event_key = ?', args: [w.id, eventKey] });
      if (cur.rows.length === 0) throw new Error('recital_work:not_found');
      id = w.id;
      workCode = String(cur.rows[0].work_code);
      await tx.execute({
        sql: `UPDATE recital_works SET kind = ?, title = ?, class_label = ?, slot_label = ?, target_label = ?, genre = ?, entry_mode = ?,
              fee_type = ?, extra_fee = ?, capacity = ?, status = ?, merged_into = ?, public_note = ?, staff_note = ?, sort_order = ?
              WHERE id = ? AND event_key = ?`,
        args: [...fields, id, eventKey],
      });
    } else {
      const codes = await tx.execute({ sql: 'SELECT work_code FROM recital_works WHERE event_key = ?', args: [eventKey] });
      workCode = nextWorkCode(codes.rows.map((r) => String(r.work_code)));
      const r = await tx.execute({
        sql: `INSERT INTO recital_works (kind, title, class_label, slot_label, target_label, genre, entry_mode, fee_type, extra_fee, capacity,
              status, merged_into, public_note, staff_note, sort_order, event_key, work_code, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [...fields, eventKey, workCode, now],
      });
      id = Number(r.lastInsertRowid);
    }
    await tx.execute({ sql: 'DELETE FROM recital_work_classes WHERE work_id = ?', args: [id] });
    for (const c of w.classes) {
      await tx.execute({
        sql: 'INSERT INTO recital_work_classes (event_key, work_id, lesson_master_id, label, created_at) VALUES (?, ?, ?, ?, ?)',
        args: [eventKey, id, c.lesson_master_id, c.label, now],
      });
    }
    await tx.execute({ sql: 'DELETE FROM recital_work_instructors WHERE work_id = ?', args: [id] });
    for (const i of w.instructors) {
      await tx.execute({
        sql: 'INSERT INTO recital_work_instructors (event_key, work_id, instructor_id, display_name, role, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [eventKey, id, i.instructor_id, i.display_name, i.role, i.sort_order, now],
      });
    }
    return { id, workCode };
  });
}

/**
 * 作品ごとの数。in・maybe は「人 active・世帯 active」の出演。paid／unpaid は in のうち世帯の残りが 0／>0。
 * snsNg は in の人に sns_ok=0 がいるか。出演の無い作品も 0 で入れる。
 */
export async function listWorkCounts(eventKey: string): Promise<Map<number, { in: number; maybe: number; paid: number; unpaid: number; snsNg: boolean }>> {
  const out = new Map<number, { in: number; maybe: number; paid: number; unpaid: number; snsNg: boolean }>();
  for (const w of await getAll('SELECT id FROM recital_works WHERE event_key = ?', [eventKey])) {
    out.set(Number(w.id), { in: 0, maybe: 0, paid: 0, unpaid: 0, snsNg: false });
  }
  const casts = await getAll(
    `SELECT c.work_id, c.status, p.sns_ok, h.id AS household_id
     FROM recital_casts c
     JOIN recital_people p ON p.id = c.person_id
     JOIN recital_households h ON h.id = p.household_id
     WHERE c.event_key = ? AND c.status IN ('in', 'maybe') AND p.status = 'active' AND h.status = 'active'`,
    [eventKey],
  );
  const remaining = new Map<number, number>();
  for (const c of casts) {
    const hid = Number(c.household_id);
    if (c.status === 'in' && !remaining.has(hid)) remaining.set(hid, (await readMoneyViewTx(null, hid)).m.remaining);
  }
  for (const c of casts) {
    const wid = Number(c.work_id);
    const e = out.get(wid) ?? { in: 0, maybe: 0, paid: 0, unpaid: 0, snsNg: false };
    if (c.status === 'maybe') e.maybe++;
    else {
      e.in++;
      if ((remaining.get(Number(c.household_id)) ?? 0) > 0) e.unpaid++;
      else e.paid++;
      if (Number(c.sns_ok) === 0) e.snsNg = true;
    }
    out.set(wid, e);
  }
  return out;
}

// ---------- 世帯のお金と見え方 ----------

/**
 * 世帯のお金（式4行）と見え方の決め方の正本。tx が null なら getAll で読む。
 * m＝生きている請求・入金の全部・返す分 todo。hasIn／hasMaybe は「人 active・作品が dropped でない」出演。
 */
export async function readMoneyViewTx(
  tx: Transaction | null,
  householdId: number,
): Promise<{ m: MoneySummary; view: HouseholdView; refundTodo: number; hasIn: boolean; hasMaybe: boolean }> {
  const charges = await readRows(tx, "SELECT amount FROM recital_charges WHERE household_id = ? AND status = 'active'", [householdId]);
  const payments = await readRows(tx, 'SELECT amount FROM recital_payments WHERE household_id = ?', [householdId]);
  const refunds = await readRows(tx, "SELECT amount FROM recital_refunds WHERE household_id = ? AND status = 'todo'", [householdId]);
  const casts = await readRows(
    tx,
    `SELECT DISTINCT c.status FROM recital_casts c
     JOIN recital_people p ON p.id = c.person_id
     JOIN recital_works w ON w.id = c.work_id
     WHERE p.household_id = ? AND p.status = 'active' AND w.status <> 'dropped' AND c.status IN ('in', 'maybe')`,
    [householdId],
  );
  const refundTodoAmounts = refunds.map((r) => Number(r.amount));
  const m = moneySummary({
    chargeAmounts: charges.map((r) => Number(r.amount)),
    paymentAmounts: payments.map((r) => Number(r.amount)),
    refundTodoAmounts,
  });
  const hasIn = casts.some((r) => r.status === 'in');
  const hasMaybe = casts.some((r) => r.status === 'maybe');
  const view = householdView({ hasIn, hasMaybe, paid: m.paid, remaining: m.remaining });
  return { m, view, refundTodo: refundTodoAmounts.reduce((a, b) => a + b, 0), hasIn, hasMaybe };
}

export async function loadHouseholdDetail(householdId: number): Promise<HouseholdDetail | null> {
  const h = await getOne('SELECT * FROM recital_households WHERE id = ?', [householdId]);
  if (!h) return null;
  const people = await getAll('SELECT * FROM recital_people WHERE household_id = ? ORDER BY seq, id', [householdId]);
  const casts = await getAll(
    'SELECT c.* FROM recital_casts c JOIN recital_people p ON p.id = c.person_id WHERE p.household_id = ? ORDER BY c.id',
    [householdId],
  );
  const charges = await getAll('SELECT * FROM recital_charges WHERE household_id = ? ORDER BY id', [householdId]);
  const payments = await getAll('SELECT * FROM recital_payments WHERE household_id = ? ORDER BY id', [householdId]);
  const refunds = await getAll('SELECT * FROM recital_refunds WHERE household_id = ? ORDER BY id', [householdId]);
  const mails = await getAll('SELECT * FROM recital_mail_log WHERE household_id = ? ORDER BY id DESC', [householdId]);
  const changes = await getAll('SELECT * FROM recital_changes WHERE household_id = ? ORDER BY id DESC', [householdId]);
  const mv = await readMoneyViewTx(null, householdId);
  return {
    household: plain<HouseholdRow>(h),
    people: people.map((r) => plain<PersonRow>(r)),
    casts: casts.map((r) => plain<CastRow>(r)),
    charges: charges.map((r) => plain<ChargeRow>(r)),
    payments: payments.map((r) => plain<PaymentRow>(r)),
    refunds: refunds.map((r) => plain<RefundRow>(r)),
    mails: mails.map((r) => plain<MailRow>(r)),
    changes: changes.map((r) => plain<ChangeRow>(r)),
    money: mv.m,
    view: mv.view,
    refundTodo: mv.refundTodo,
  };
}

// ---------- 変えた記録 ----------

// R-18：この鍵の値は記録に残さない（入れ子までたどる）。名義は name か bank_told_name の鍵で渡す。
const REDACT_KEYS = new Set([
  'email', 'phone', 'birthday', 'insta_handle', 'instaHandle', 'bank_told_name', 'bankToldName',
  'payer_name_raw', 'payerNameRaw', 'desc_raw', 'desc_norm', 'bank_desc', 'name',
]);
const REDACTED = '(伏せた)';

function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (REDACT_KEYS.has(k)) out[k] = x == null || (typeof x === 'string' && x.trim() === '') ? null : REDACTED;
      else out[k] = redact(x);
    }
    return out;
  }
  return v;
}

export async function logChangeTx(
  tx: Transaction,
  c: {
    eventKey: string; householdId?: number | null; personId?: number | null; workId?: number | null; action: string;
    before?: unknown; after?: unknown; actor: string; reason?: string | null; receivedAt?: string | null; isException?: boolean;
  },
): Promise<void> {
  if (!c.actor || c.actor.trim() === '') throw new Error('recital_change:no_actor');
  const json = (x: unknown) => (x === undefined ? null : JSON.stringify(redact(x)));
  await tx.execute({
    sql: `INSERT INTO recital_changes (event_key, household_id, person_id, work_id, action, received_at, before_json, after_json, actor, reason, is_exception, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      c.eventKey, c.householdId ?? null, c.personId ?? null, c.workId ?? null, c.action, c.receivedAt ?? null,
      json(c.before), json(c.after), c.actor, c.reason ?? null, c.isException ? 1 : 0, nowUtcIso(),
    ],
  });
}

// ---------- テストデータを消す ----------

/**
 * 試しの発表会（is_test=1）のテストデータを消す。返り値は表の名前→消す前の数。
 * is_test=0・無い発表会は文の中の守りで全部0になり、何も消さない。dryRun は数えるだけ。
 * 設定・料金の規則・作品・事前登録は残す（消す表は recitalResetStatements が正本）。
 */
export async function resetTestEvent(eventKey: string, opts: { dryRun: boolean }): Promise<Record<string, number>> {
  const stmts = recitalResetStatements(eventKey);
  const counts: Record<string, number> = {};
  for (const s of stmts) {
    const row = await getOne(s.countSql, s.args);
    counts[s.table] = Number(row?.n ?? 0);
  }
  if (!opts.dryRun) {
    await batch(stmts.map((s) => ({ sql: s.deleteSql, args: s.args })), 'write');
  }
  return counts;
}

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
  RECITAL_STAFF_NAMES,
  checkSettingValue,
  countPeople,
  householdView,
  isCountedCast,
  moneySummary,
  normalizePhone,
  parseRecitalSettings,
  payGate,
  type CastStatus,
  type CountPerson,
  type FeeClass,
  type HouseholdView,
  type MoneySummary,
  type PeopleCounts,
  type RecitalSettings,
} from '@/lib/recital';
import { normalizeKana } from '@/lib/csvUtil';
import { feeCheck, type FeeRule } from '@/lib/recitalFee';
import { matchFeePreset, memberWarn, normalizeBirthday, type MemberLite } from '@/lib/recitalMatch';
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

// ---------- 設定の画面（Task 18）：料金の規則を直す・特別な料金の事前登録・会員を探す ----------

const FEE_ROLES: readonly string[] = ['first', 'family'];
const FEE_ITEMS: readonly string[] = ['base', 'tshirt', 'coop_ticket', 'add_work'];
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** 規則1行の形（03 3-4）。label は空にしない（請求の行の名前になるため） */
function isFeeRuleShape(r: FeeRule): boolean {
  if (!FEE_ROLES.includes(r.payer_role) || !FEE_ITEMS.includes(r.item_code)) return false;
  if (!isInt(r.nth_from) || r.nth_from < 1) return false;
  if (r.nth_to !== null && (!isInt(r.nth_to) || r.nth_to < r.nth_from)) return false;
  if (!isInt(r.unit_amount) || r.unit_amount < 0) return false;
  if (!isInt(r.qty) || r.qty < 1) return false;
  if (typeof r.label !== 'string' || r.label.trim() === '') return false;
  if (r.is_tentative !== 0 && r.is_tentative !== 1) return false;
  return isInt(r.sort_order);
}

/** 同じ役・同じ種類で、何作品目の範囲（nth_to が空＝上は無し）が重なるか */
function rangesOverlap(a: { nth_from: number; nth_to: number | null }, b: { nth_from: number; nth_to: number | null }): boolean {
  const aTo = a.nth_to ?? Number.POSITIVE_INFINITY;
  const bTo = b.nth_to ?? Number.POSITIVE_INFINITY;
  return a.nth_from <= bTo && b.nth_from <= aTo;
}

/**
 * 料金の規則を1行直す（id あり）／足す（id なし）。受付を開けたら変えない（03 3-4・決まり3）：
 * suspended=0、その発表会に entry_opened の記録が1つでもある（止め直しても戻らない）、本番の発表会（is_test=0）に世帯が1つでもある、のどれかなら opened。
 * 同じ役・同じ種類で範囲が重なる行は invalid（同じ人に2行が当たり、請求の行が入れかわり続けるのを防ぐ）。
 */
export async function saveFeeRule(
  eventKey: string,
  rule: FeeRule & { id?: number },
  staffName: string,
): Promise<{ ok: true; id: number } | { ok: false; code: 'opened' | 'invalid' }> {
  if (!RECITAL_STAFF_NAMES.includes(staffName)) throw new Error('recital_fee_rule:staff_name');
  return withWriteTx(async (tx) => {
    const one = async (sql: string) => (await tx.execute({ sql, args: [eventKey] })).rows[0];
    const sus = await one("SELECT value FROM recital_settings WHERE event_key = ? AND key = 'suspended'");
    // 行が無いときは parseRecitalSettings と同じく「止めている」と読む
    if (sus != null && String(sus.value) === '0') return { ok: false, code: 'opened' };
    if (await one("SELECT 1 AS x FROM recital_changes WHERE event_key = ? AND action = 'entry_opened' LIMIT 1")) return { ok: false, code: 'opened' };
    const ev = await one('SELECT is_test FROM recital_events WHERE event_key = ?');
    if (ev != null && Number(ev.is_test) === 0 && (await one('SELECT 1 AS x FROM recital_households WHERE event_key = ? LIMIT 1'))) {
      return { ok: false, code: 'opened' };
    }

    if (!isFeeRuleShape(rule)) return { ok: false, code: 'invalid' };
    if (rule.id != null && !isInt(rule.id)) return { ok: false, code: 'invalid' };
    const others = await tx.execute({
      sql: 'SELECT id, payer_role, item_code, nth_from, nth_to FROM recital_fee_rules WHERE event_key = ?',
      args: [eventKey],
    });
    if (rule.id != null && !others.rows.some((o) => Number(o.id) === rule.id)) return { ok: false, code: 'invalid' };
    const clash = others.rows.some((o) =>
      Number(o.id) !== rule.id && String(o.payer_role) === rule.payer_role && String(o.item_code) === rule.item_code
      && rangesOverlap({ nth_from: Number(o.nth_from), nth_to: o.nth_to == null ? null : Number(o.nth_to) }, rule));
    if (clash) return { ok: false, code: 'invalid' };

    const fields = [rule.payer_role, rule.item_code, rule.nth_from, rule.nth_to, rule.unit_amount, rule.qty, rule.label.trim(), rule.is_tentative, rule.sort_order];
    if (rule.id != null) {
      await tx.execute({
        sql: `UPDATE recital_fee_rules SET payer_role = ?, item_code = ?, nth_from = ?, nth_to = ?, unit_amount = ?, qty = ?, label = ?, is_tentative = ?, sort_order = ?
              WHERE id = ? AND event_key = ?`,
        args: [...fields, rule.id, eventKey],
      });
      return { ok: true, id: rule.id };
    }
    const r = await tx.execute({
      sql: `INSERT INTO recital_fee_rules (payer_role, item_code, nth_from, nth_to, unit_amount, qty, label, is_tentative, sort_order, event_key, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [...fields, eventKey, nowUtcIso()],
    });
    return { ok: true, id: Number(r.lastInsertRowid) };
  });
}

export type FeePresetRow = {
  id: number; memberId: number; feeClass: 'no_coop' | 'tshirt_only' | 'free'; memo: string | null; createdBy: string; createdAt: string; member: MemberLite | null;
};

const PRESET_CLASSES: readonly string[] = ['no_coop', 'tshirt_only', 'free'];

/** 事前登録の一覧（登録の順）。会員は loadMembersLite を1回だけ呼んで引き当てる（名前・カナ・生年月日はこの表に写さない。3-9） */
export async function listFeePresets(eventKey: string): Promise<FeePresetRow[]> {
  const [rows, members] = await Promise.all([
    getAll('SELECT id, member_id, fee_class, memo, created_by, created_at FROM recital_fee_presets WHERE event_key = ? ORDER BY id', [eventKey]),
    loadMembersLite(),
  ]);
  const byId = new Map(members.map((m) => [m.id, m]));
  return rows.map((r) => ({
    id: Number(r.id),
    memberId: Number(r.member_id),
    feeClass: String(r.fee_class) as FeePresetRow['feeClass'],
    memo: r.memo == null ? null : String(r.memo),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
    member: byId.get(Number(r.member_id)) ?? null,
  }));
}

/** 事前登録を入れる。同じ会員の行がもうあれば、種類とメモを直す（1人に1行）。もう申し込んだ人の印は変わらない（K226） */
export async function saveFeePreset(
  eventKey: string,
  x: { memberId: number; feeClass: 'no_coop' | 'tshirt_only' | 'free'; memo: string | null },
  staffName: string,
): Promise<{ ok: true; id: number } | { ok: false; code: 'no_member' }> {
  if (!RECITAL_STAFF_NAMES.includes(staffName)) throw new Error('recital_fee_preset:staff_name');
  if (!PRESET_CLASSES.includes(x.feeClass)) throw new Error('recital_fee_preset:bad_class');
  if (!isInt(x.memberId)) return { ok: false, code: 'no_member' };
  const memo = x.memo == null || x.memo.trim() === '' ? null : x.memo.trim();
  return withWriteTx(async (tx) => {
    const m = await tx.execute({ sql: 'SELECT id FROM boom_members WHERE id = ?', args: [x.memberId] });
    if (m.rows.length === 0) return { ok: false, code: 'no_member' };
    const cur = await tx.execute({ sql: 'SELECT id FROM recital_fee_presets WHERE event_key = ? AND member_id = ?', args: [eventKey, x.memberId] });
    if (cur.rows.length > 0) {
      const id = Number(cur.rows[0].id);
      await tx.execute({ sql: 'UPDATE recital_fee_presets SET fee_class = ?, memo = ? WHERE id = ? AND event_key = ?', args: [x.feeClass, memo, id, eventKey] });
      return { ok: true, id };
    }
    const r = await tx.execute({
      sql: 'INSERT INTO recital_fee_presets (event_key, member_id, fee_class, memo, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      args: [eventKey, x.memberId, x.feeClass, memo, nowUtcIso(), staffName],
    });
    return { ok: true, id: Number(r.lastInsertRowid) };
  });
}

/** 事前登録を消す（その発表会の行だけ）。もう申し込んだ人の印は変わらない（K226） */
export async function deleteFeePreset(eventKey: string, id: number, staffName: string): Promise<void> {
  if (!RECITAL_STAFF_NAMES.includes(staffName)) throw new Error('recital_fee_preset:staff_name');
  await execute('DELETE FROM recital_fee_presets WHERE id = ? AND event_key = ?', [id, eventKey]);
}

/** 会員を探す（20 も使う）。カナ（normalizeKana どうし）か、氏名（空白をとった物どうし）の部分一致。20件まで */
export async function searchMembers(q: string): Promise<MemberLite[]> {
  const t = q.normalize('NFKC').replace(/[\s　]/g, '');
  if (t === '') return [];
  const kq = normalizeKana(t);
  const hits: MemberLite[] = [];
  for (const m of await loadMembersLite()) {
    const kana = normalizeKana((m.fullNameKana ?? '').normalize('NFKC'));
    const name = (m.fullName ?? '').normalize('NFKC').replace(/[\s　]/g, '');
    if ((kq !== '' && kana.includes(kq)) || name.includes(t)) hits.push(m);
    if (hits.length >= 20) break;
  }
  return hits;
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

/** 作品ごとのクラスと担当（つなぎの2表）。担当は sort_order, id の順。行が1つも無い作品は入れない */
export async function listWorkLinks(eventKey: string): Promise<Map<number, { classes: WorkInput['classes']; instructors: WorkInput['instructors'] }>> {
  const out = new Map<number, { classes: WorkInput['classes']; instructors: WorkInput['instructors'] }>();
  const at = (wid: number) => {
    let e = out.get(wid);
    if (!e) { e = { classes: [], instructors: [] }; out.set(wid, e); }
    return e;
  };
  for (const r of await getAll('SELECT work_id, lesson_master_id, label FROM recital_work_classes WHERE event_key = ? ORDER BY id', [eventKey])) {
    at(Number(r.work_id)).classes.push({ lesson_master_id: r.lesson_master_id == null ? null : Number(r.lesson_master_id), label: r.label == null ? '' : String(r.label) });
  }
  for (const r of await getAll(
    'SELECT work_id, instructor_id, display_name, role, sort_order FROM recital_work_instructors WHERE event_key = ? ORDER BY sort_order, id',
    [eventKey],
  )) {
    const role = String(r.role);
    at(Number(r.work_id)).instructors.push({
      instructor_id: r.instructor_id == null ? null : Number(r.instructor_id),
      display_name: String(r.display_name),
      role: role === 'perform' || role === 'assist' ? role : 'choreo',
      sort_order: Number(r.sort_order),
    });
  }
  return out;
}

/** 作品の画面の選び肢：active のクラス（label＝class_name、target があれば「class_name（target）」）と active のイントラ。名前の順 */
export async function listWorkPickOptions(): Promise<{ classes: { id: number; label: string }[]; instructors: { id: number; name: string }[] }> {
  const classes = await getAll('SELECT id, class_name, target FROM lesson_master WHERE active = 1 ORDER BY class_name, target, id', []);
  const instructors = await getAll('SELECT id, name FROM instructors WHERE active = 1 ORDER BY name, id', []);
  return {
    classes: classes.map((r) => {
      const target = r.target == null ? '' : String(r.target).trim();
      return { id: Number(r.id), label: target ? `${String(r.class_name)}（${target}）` : String(r.class_name) };
    }),
    instructors: instructors.map((r) => ({ id: Number(r.id), name: String(r.name) })),
  };
}

/**
 * 作品ごとの数。in・maybe は「人 active・世帯 active」の出演。paid／unpaid は in のうち世帯の残りが 0／>0。
 * snsNg は in の人に sns_ok=0 がいるか。出演の無い作品も 0 で入れる。
 * 1回の SQL で読む（世帯ごとに引かない）。残りの式は readMoneyViewTx（moneySummary）と同じ：
 * total＝max(0, 生きている請求の和)、paid＝入金の全部の和 − 返す分 todo の和、remaining＝max(0, total − paid)。
 */
export async function listWorkCounts(eventKey: string): Promise<Map<number, { in: number; maybe: number; paid: number; unpaid: number; snsNg: boolean }>> {
  const rows = await getAll(
    `WITH x AS (
       SELECT c.work_id, c.status, p.sns_ok, p.household_id
       FROM recital_casts c
       JOIN recital_people p ON p.id = c.person_id
       JOIN recital_households h ON h.id = p.household_id
       WHERE c.event_key = ? AND c.status IN ('in', 'maybe') AND p.status = 'active' AND h.status = 'active'
     ),
     m AS (
       SELECT hid AS household_id, MAX(0, MAX(0, ch) - (pa - rf)) AS remaining FROM (
         SELECT hh.household_id AS hid,
           COALESCE((SELECT SUM(amount) FROM recital_charges WHERE household_id = hh.household_id AND status = 'active'), 0) AS ch,
           COALESCE((SELECT SUM(amount) FROM recital_payments WHERE household_id = hh.household_id), 0) AS pa,
           COALESCE((SELECT SUM(amount) FROM recital_refunds WHERE household_id = hh.household_id AND status = 'todo'), 0) AS rf
         FROM (SELECT DISTINCT household_id FROM x WHERE status = 'in') hh
       )
     )
     SELECT w.id AS work_id,
       COALESCE(SUM(x.status = 'in'), 0) AS n_in,
       COALESCE(SUM(x.status = 'maybe'), 0) AS n_maybe,
       COALESCE(SUM(x.status = 'in' AND m.remaining <= 0), 0) AS n_paid,
       COALESCE(SUM(x.status = 'in' AND m.remaining > 0), 0) AS n_unpaid,
       COALESCE(MAX(x.status = 'in' AND x.sns_ok = 0), 0) AS sns_ng
     FROM recital_works w
     LEFT JOIN x ON x.work_id = w.id
     LEFT JOIN m ON m.household_id = x.household_id
     WHERE w.event_key = ?
     GROUP BY w.id`,
    [eventKey, eventKey],
  );
  const out = new Map<number, { in: number; maybe: number; paid: number; unpaid: number; snsNg: boolean }>();
  for (const r of rows) {
    out.set(Number(r.work_id), {
      in: Number(r.n_in), maybe: Number(r.n_maybe), paid: Number(r.n_paid), unpaid: Number(r.n_unpaid), snsNg: Number(r.sns_ng) === 1,
    });
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

// ---------- スタッフの最初の画面（Task 16）：人数・見てほしいこと・探す ----------

/**
 * 発表会の世帯ごとのお金（式4行）。生きている請求・入金の全部・返す分 todo を、表ごとに1回だけ読む（世帯ごとに引かない）。
 * 29 の listToldWaiting（recitalBankDb）も、これで残りを読む。
 */
export async function readMoneyByHousehold(eventKey: string): Promise<Map<number, MoneySummary>> {
  const acc = new Map<number, { c: number[]; p: number[]; r: number[] }>();
  const at = (hid: number) => {
    let e = acc.get(hid);
    if (!e) { e = { c: [], p: [], r: [] }; acc.set(hid, e); }
    return e;
  };
  for (const r of await getAll("SELECT household_id, amount FROM recital_charges WHERE event_key = ? AND status = 'active'", [eventKey])) at(Number(r.household_id)).c.push(Number(r.amount));
  for (const r of await getAll('SELECT household_id, amount FROM recital_payments WHERE event_key = ? AND household_id IS NOT NULL', [eventKey])) at(Number(r.household_id)).p.push(Number(r.amount));
  for (const r of await getAll("SELECT household_id, amount FROM recital_refunds WHERE event_key = ? AND status = 'todo'", [eventKey])) at(Number(r.household_id)).r.push(Number(r.amount));
  const out = new Map<number, MoneySummary>();
  for (const [hid, e] of acc) out.set(hid, moneySummary({ chargeAmounts: e.c, paymentAmounts: e.p, refundTodoAmounts: e.r }));
  return out;
}

const ZERO_MONEY: MoneySummary = { total: 0, paid: 0, remaining: 0, overpaid: 0 };

function toFeeClass(v: unknown): FeeClass {
  return v === 'free' || v === 'no_coop' || v === 'tshirt_only' ? v : null;
}

/** 人数（05 5-9）。active の世帯の active の人ごとに CountPerson を作って countPeople に渡す */
export async function countRecitalPeople(eventKey: string, now?: Date): Promise<PeopleCounts> {
  const ev = await getRecitalEvent(eventKey);
  const isTestEvent = ev?.is_test === 1;
  const people = await getAll(
    `SELECT p.id, p.household_id, p.category, p.fee_class_override
     FROM recital_people p JOIN recital_households h ON h.id = p.household_id
     WHERE p.event_key = ? AND p.status = 'active' AND h.status = 'active'`,
    [eventKey],
  );
  const casts = await getAll(
    `SELECT c.person_id, c.status, w.fee_type, w.status AS work_status
     FROM recital_casts c JOIN recital_works w ON w.id = c.work_id WHERE c.event_key = ?`,
    [eventKey],
  );
  const money = await readMoneyByHousehold(eventKey);
  const castCount = new Map<number, { counted: number; maybe: number }>();
  for (const c of casts) {
    const pid = Number(c.person_id);
    const e = castCount.get(pid) ?? { counted: 0, maybe: 0 };
    const work = { fee_type: String(c.fee_type), status: String(c.work_status) };
    if (isCountedCast(work, { status: String(c.status) as CastStatus })) e.counted++;
    if (c.status === 'maybe' && work.status !== 'dropped') e.maybe++;
    castCount.set(pid, e);
  }
  const list: CountPerson[] = people.map((p) => {
    const cc = castCount.get(Number(p.id)) ?? { counted: 0, maybe: 0 };
    return {
      category: String(p.category),
      feeClass: toFeeClass(p.fee_class_override),
      countedIn: cc.counted,
      maybeCount: cc.maybe,
      householdRemaining: (money.get(Number(p.household_id)) ?? ZERO_MONEY).remaining,
      isTestEvent,
    };
  });
  return countPeople(list, now ?? new Date());
}

export type AttentionItem = { no: 1 | 2 | 3 | 4 | 5 | 8; label: string; href: string; householdId?: number; personId?: number };

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const entryHref = (householdId: number) => `/staff/bw6/entries/${householdId}`;
const BANK_HREF = '/staff/bw6/bank';
const str = (v: unknown) => (v == null ? '' : String(v));
const kanaKeyOf = (v: unknown) => normalizeKana(str(v).normalize('NFKC'));
const dismissKey = (no: number, householdId: number | null, personId: number | null) => `${no}:${householdId ?? 'null'}:${personId ?? 'null'}`;

/**
 * 見てほしいこと（1・2・3・4・5・8 の順）。何も無ければ []。
 * 1番と3番は、recital_changes の attention_dismissed（after_json の {no, householdId, personId} が同じ）があれば出さない。
 */
export async function listAttention(eventKey: string, now?: Date): Promise<AttentionItem[]> {
  const nowMs = (now ?? new Date()).getTime();
  const settings = await getRecitalSettings(eventKey);
  const households = (await getAll('SELECT * FROM recital_households WHERE event_key = ? ORDER BY seq, id', [eventKey])).map((r) => plain<HouseholdRow>(r));
  const byId = new Map(households.map((h) => [Number(h.id), h]));
  const active = households.filter((h) => h.status === 'active');
  const activeIds = new Set(active.map((h) => Number(h.id)));
  const people = (await getAll("SELECT * FROM recital_people WHERE event_key = ? AND status = 'active' ORDER BY seq, id", [eventKey]))
    .map((r) => plain<PersonRow>(r))
    .filter((p) => p.household_id != null && activeIds.has(Number(p.household_id)));
  const money = await readMoneyByHousehold(eventKey);
  const dismissed = new Set<string>();
  for (const r of await getAll("SELECT after_json FROM recital_changes WHERE event_key = ? AND action = 'attention_dismissed'", [eventKey])) {
    try {
      const a = JSON.parse(String(r.after_json)) as { no?: number; householdId?: number | null; personId?: number | null };
      dismissed.add(dismissKey(Number(a.no), a.householdId ?? null, a.personId ?? null));
    } catch { /* 読めない行は無視 */ }
  }
  const ref = (hid: number) => byId.get(hid)?.ref_code ?? '';
  const fullName = (p: PersonRow) => `${p.last_name}${p.first_name ?? ''}`;
  const out: AttentionItem[] = [];

  // 1番：同じ人・同じご家族かも（1組の世帯につき1件・後の世帯に付ける）
  const peopleOf = new Map<number, PersonRow[]>();
  for (const p of people) {
    const hid = Number(p.household_id);
    peopleOf.set(hid, [...(peopleOf.get(hid) ?? []), p]);
  }
  const personKey = (p: PersonRow): string | null => {
    const k = kanaKeyOf(str(p.last_kana) + str(p.first_kana));
    const b = normalizeBirthday(p.birthday);
    return k && b ? `${k}|${b}` : null;
  };
  for (let j = 0; j < active.length; j++) {
    const later = active[j];
    const laterPeople = peopleOf.get(Number(later.id)) ?? [];
    const laterPhone = normalizePhone(str(later.phone));
    const laterContact = str(later.contact_last_name).trim();
    const laterContactKana = kanaKeyOf(later.contact_last_kana);
    for (let i = 0; i < j; i++) {
      const earlier = active[i];
      const earlierKeys = new Set((peopleOf.get(Number(earlier.id)) ?? []).map(personKey).filter((k): k is string => k !== null));
      const samePerson = laterPeople.find((p) => {
        const k = personKey(p);
        return k !== null && earlierKeys.has(k);
      });
      const refs = `（${earlier.ref_code}・${later.ref_code}）`;
      let item: AttentionItem | null = null;
      if (samePerson) {
        item = { no: 1, label: `同じ人が2回申し込んでいるかもしれません${refs}`, href: entryHref(Number(later.id)), householdId: Number(later.id), personId: Number(samePerson.id) };
      } else {
        const samePhone = laterPhone !== '' && laterPhone === normalizePhone(str(earlier.phone));
        const sameFamily = laterContact !== '' && laterContact === str(earlier.contact_last_name).trim()
          && laterContactKana === kanaKeyOf(earlier.contact_last_kana);
        if (samePhone || sameFamily) {
          item = { no: 1, label: `同じご家族が2回申し込んでいるかもしれません${refs}`, href: entryHref(Number(later.id)), householdId: Number(later.id) };
        }
      }
      if (item && !dismissed.has(dismissKey(1, item.householdId ?? null, item.personId ?? null))) out.push(item);
    }
  }

  // 2番：会員との照合
  const members = await loadMembersLite();
  const memberById = new Map(members.map((m) => [m.id, m]));
  for (const p of people) {
    const hid = Number(p.household_id);
    const who = `${ref(hid)} ${fullName(p)}`;
    let label: string | null = null;
    if (p.match_status === 'pending') label = `会員との照合の確認待ち：${who}`;
    else if (p.match_status === 'unmatched') label = `会員と合わない申込：${who}`;
    else if (p.match_status === 'auto' && p.member_id != null) {
      const m = memberById.get(Number(p.member_id));
      const warn = m ? memberWarn(m) : null;
      if (warn === 'leave') label = `休会中の会員と合いました：${who}`;
      if (warn === 'withdrawn') label = `退会した会員と合いました：${who}`;
    }
    if (label) out.push({ no: 2, label, href: entryHref(hid), householdId: hid, personId: Number(p.id) });
  }

  // 3番：特別な料金の対象かも（事前登録の会員とだけ照らす）
  const presets = (await getAll('SELECT member_id, fee_class FROM recital_fee_presets WHERE event_key = ?', [eventKey]))
    .map((r) => ({ memberId: Number(r.member_id), feeClass: toFeeClass(r.fee_class) }))
    .filter((x): x is { memberId: number; feeClass: Exclude<FeeClass, null> } => x.feeClass !== null);
  if (presets.length > 0) {
    const presetIds = new Set(presets.map((x) => x.memberId));
    const presetMembers = members.filter((m) => presetIds.has(m.id));
    for (const p of people) {
      if (str(p.fee_class_override).trim() !== '') continue;
      const r = matchFeePreset(
        { lastKana: str(p.last_kana), firstKana: str(p.first_kana), lastName: p.last_name, firstName: str(p.first_name), birthday: p.birthday },
        presets,
        presetMembers,
      );
      if (!r || !('suspect' in r)) continue;
      const hid = Number(p.household_id);
      if (dismissed.has(dismissKey(3, hid, Number(p.id)))) continue;
      out.push({ no: 3, label: `特別な料金の対象かもしれません：${ref(hid)} ${fullName(p)}`, href: entryHref(hid), householdId: hid, personId: Number(p.id) });
    }
  }

  // 4番：入金（払うを開けた後だけ）。(a) は 28 の listReviewRows（closed でない行ごとに1件）。
  // (b) は 29 の listToldWaiting（世帯ごとに1件）。どちらも条件を2か所に持たない
  if (payGate(settings, nowMs) === 'open') {
    // recitalBankDb はこのファイルを読むので、関数の中で読む
    const { listReviewRows, listToldWaiting } = await import('./recitalBankDb');
    for (const r of (await listReviewRows(eventKey)).filter((x) => x.group !== 'closed')) {
      out.push({ no: 4, label: `見てほしい入金：${r.rowDate}`, href: BANK_HREF });
    }
    // 設定とお金は、この関数でもう読んだ物を渡す（同じ表を2回読まない）
    for (const h of await listToldWaiting(eventKey, new Date(nowMs), { settings, money })) {
      out.push({ no: 4, label: `『振り込みました』のまま3日：${h.ref_code}`, href: BANK_HREF, householdId: Number(h.id) });
    }
  }

  // 5番：返金の待ち（1行1件）と、残りもある世帯の「当てるか決めて」
  const refunds = await getAll("SELECT id, household_id, amount, waiting_reply FROM recital_refunds WHERE event_key = ? AND status = 'todo' ORDER BY id", [eventKey]);
  const refundsOf = new Map<number, typeof refunds>();
  for (const r of refunds) {
    const hid = Number(r.household_id);
    refundsOf.set(hid, [...(refundsOf.get(hid) ?? []), r]);
  }
  for (const h of households) {
    const hid = Number(h.id);
    const rs = refundsOf.get(hid);
    if (!rs) continue;
    for (const r of rs) {
      const tail = Number(r.waiting_reply) === 1 ? '（返事待ち）' : '';
      out.push({ no: 5, label: `返金の待ち：${h.ref_code} ${yen(Number(r.amount))}${tail}`, href: entryHref(hid), householdId: hid });
    }
    if ((money.get(hid) ?? ZERO_MONEY).remaining > 0) {
      out.push({ no: 5, label: `返す分を、足した作品に当てるか、決めてください：${h.ref_code}`, href: entryHref(hid), householdId: hid });
    }
  }

  // 8番：その世帯のいちばん新しい送った／送れなかったメールが failed
  const mails = await getAll(
    `SELECT m.household_id, m.status FROM recital_mail_log m
     JOIN (SELECT household_id, MAX(id) AS id FROM recital_mail_log
           WHERE event_key = ? AND household_id IS NOT NULL AND status IN ('sent', 'failed') GROUP BY household_id) last
       ON last.id = m.id`,
    [eventKey],
  );
  const failed = new Set(mails.filter((m) => m.status === 'failed').map((m) => Number(m.household_id)));
  for (const h of active) {
    const hid = Number(h.id);
    if (failed.has(hid)) out.push({ no: 8, label: `届かなかったメール：${h.ref_code}`, href: entryHref(hid), householdId: hid });
  }
  return out;
}

/** 1番・3番の「問題なし」。記録には番号だけを入れる（名前・カナを入れない） */
export async function dismissAttention(
  eventKey: string,
  item: { no: 1 | 3; householdId?: number; personId?: number },
  staffName: string,
): Promise<void> {
  if (!RECITAL_STAFF_NAMES.includes(staffName)) throw new Error('recital_attention:staff_name');
  if (item.no !== 1 && item.no !== 3) throw new Error('recital_attention:bad_no');
  await withWriteTx(async (tx) => {
    await logChangeTx(tx, {
      eventKey,
      householdId: item.householdId ?? null,
      personId: item.personId ?? null,
      action: 'attention_dismissed',
      after: { no: item.no, householdId: item.householdId ?? null, personId: item.personId ?? null },
      actor: staffName,
    });
  });
}

/** 探す欄の1行。鍵（edit_token）・メール・電話は返さない（client の部品でも使うため） */
export type HouseholdHit = { id: number; ref_code: string; contact_name: string; status: string; seq: number };

/**
 * 世帯を探す。4けたの数字なら整理番号、ほかは連絡する人の姓名（そのまま部分一致）と、連絡する人・世帯の人のカナ（normalizeKana して部分一致）。
 * merged の世帯も出す。新しい順に20件まで。
 */
export async function searchHouseholds(eventKey: string, q: string): Promise<HouseholdHit[]> {
  const t = q.normalize('NFKC').trim();
  if (t === '') return [];
  const rows = await getAll(
    `SELECT id, seq, ref_code, status, contact_last_name, contact_first_name, contact_last_kana, contact_first_kana
     FROM recital_households WHERE event_key = ? ORDER BY seq DESC, id DESC`,
    [eventKey],
  );
  const toHit = (r: (typeof rows)[number]): HouseholdHit => ({
    id: Number(r.id),
    ref_code: str(r.ref_code),
    contact_name: `${str(r.contact_last_name)} ${str(r.contact_first_name)}`.trim(),
    status: str(r.status),
    seq: Number(r.seq),
  });
  if (/^\d{4}$/.test(t)) return rows.filter((r) => str(r.ref_code) === t).slice(0, 20).map(toHit);

  const kq = normalizeKana(t);
  const personKana = new Map<number, string[]>();
  for (const p of await getAll('SELECT household_id, last_kana, first_kana FROM recital_people WHERE event_key = ? AND household_id IS NOT NULL', [eventKey])) {
    const hid = Number(p.household_id);
    personKana.set(hid, [...(personKana.get(hid) ?? []), kanaKeyOf(str(p.last_kana) + str(p.first_kana))]);
  }
  const hits = rows.filter((r) => {
    const last = str(r.contact_last_name);
    const first = str(r.contact_first_name);
    if ((last + first).includes(t) || `${last} ${first}`.includes(t)) return true;
    if (kq === '') return false;
    if (kanaKeyOf(str(r.contact_last_kana) + str(r.contact_first_kana)).includes(kq)) return true;
    return (personKana.get(Number(r.id)) ?? []).some((k) => k.includes(kq));
  });
  return hits.slice(0, 20).map(toHit);
}

// ---------- 申込の一覧（Task 19） ----------

/** 申込の一覧の1行。鍵（edit_token）・メール・電話は持たない */
export type EntryListRow = {
  id: number; refCode: string; contactName: string; peopleCount: number; worksCount: number;
  total: number; paid: number; remaining: number; overpaid: number; view: HouseholdView;
  mailOpened: boolean; bankTold: boolean; payMethod: string | null;
};

/**
 * 申込の一覧。active の世帯だけ・新しい順（seq の大きい順）。表ごとに1回ずつ読んで JS で世帯ごとにまとめる（世帯ごとに引かない）。
 * 人は active の人。worksCount は in・maybe で作品が dropped でない出演の数（active の人の分）。
 * お金は readMoneyByHousehold（moneySummary）、見え方は householdView に、readMoneyViewTx と同じ材料（hasIn／hasMaybe）を渡す。
 */
export async function listEntryRows(eventKey: string): Promise<EntryListRow[]> {
  const households = await getAll(
    `SELECT id, ref_code, contact_last_name, contact_first_name, pay_method, mail_opened_at, bank_told_at
     FROM recital_households WHERE event_key = ? AND status = 'active' ORDER BY seq DESC, id DESC`,
    [eventKey],
  );
  const peopleCount = new Map<number, number>();
  for (const p of await getAll("SELECT household_id FROM recital_people WHERE event_key = ? AND status = 'active' AND household_id IS NOT NULL", [eventKey])) {
    const hid = Number(p.household_id);
    peopleCount.set(hid, (peopleCount.get(hid) ?? 0) + 1);
  }
  const casts = new Map<number, { works: number; hasIn: boolean; hasMaybe: boolean }>();
  for (const c of await getAll(
    `SELECT p.household_id, c.status FROM recital_casts c
     JOIN recital_people p ON p.id = c.person_id
     JOIN recital_works w ON w.id = c.work_id
     WHERE c.event_key = ? AND p.status = 'active' AND p.household_id IS NOT NULL AND w.status <> 'dropped' AND c.status IN ('in', 'maybe')`,
    [eventKey],
  )) {
    const hid = Number(c.household_id);
    const e = casts.get(hid) ?? { works: 0, hasIn: false, hasMaybe: false };
    e.works++;
    if (c.status === 'in') e.hasIn = true;
    else e.hasMaybe = true;
    casts.set(hid, e);
  }
  const money = await readMoneyByHousehold(eventKey);
  return households.map((h) => {
    const id = Number(h.id);
    const m = money.get(id) ?? ZERO_MONEY;
    const cc = casts.get(id) ?? { works: 0, hasIn: false, hasMaybe: false };
    return {
      id,
      refCode: str(h.ref_code),
      contactName: `${str(h.contact_last_name)} ${str(h.contact_first_name)}`.trim(),
      peopleCount: peopleCount.get(id) ?? 0,
      worksCount: cc.works,
      total: m.total,
      paid: m.paid,
      remaining: m.remaining,
      overpaid: m.overpaid,
      view: householdView({ hasIn: cc.hasIn, hasMaybe: cc.hasMaybe, paid: m.paid, remaining: m.remaining }),
      mailOpened: h.mail_opened_at != null,
      bankTold: h.bank_told_at != null,
      payMethod: h.pay_method == null ? null : String(h.pay_method),
    };
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

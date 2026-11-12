// BW6 発表会（段階1）のメールを送る所（Task 10）：記録（recital_mail_log）・同じ知らせを2回出さない（dedupe_key）・
// 夜の「待ち」と待ちを出す・試しの発表会のすりかえ（test_mail_to）・写しの有無・お金のメールの選び方・お振込みのご案内の出し直し。
// 決まりの正本は設計書 04 4-2、07 7-6〜7-8、決まりの紙 2-24（K158・K160・K162・K186・K188・K202・K208・K218）。
// 文面は recitalEmail.ts（純）。DB は src/lib/db.ts 経由だけ。名前と型の正本は .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
// R-18：記録の error とログに、宛先・氏名・電話を書かない（送る口の例外の文は宛先を含むことがあるので、code だけを残す）。
// 送るのに失敗しても投げない（記録を failed にして返す）。スタッフがあとで送り直す（07 7-7）。
import type { Transaction } from '@libsql/client';
import { execute, getAll, getOne } from '@/lib/db';
import { isIsoDate, nowUtcIso, shiftDays, todayJst, weekdayJst } from '@/lib/dateJst';
import {
  MAIL_SEND_FROM,
  MAIL_SEND_UNTIL,
  deadlineMs,
  jstToMs,
  payGate,
  payableAmount,
  recitalMyUrl,
  type RecitalSettings,
} from '@/lib/recital';
import { getRecitalEvent, getRecitalSettings, loadHouseholdDetail, type HouseholdDetail } from '@/lib/recitalDb';
import { readHouseholdMoney } from '@/lib/recitalMoneyDb';
import { isMailConfigured, sendEmail, sendEmailNoBcc } from '@/lib/email';
import { RECITAL_MAIL_DAILY_WARN, buildRecitalMail, type MailKind, type MailVia, type RecitalMailData } from '@/lib/recitalEmail';

export type { MailKind, MailVia } from '@/lib/recitalEmail';

type SendStatus = 'sent' | 'failed' | 'waiting' | 'duplicate';

/** 控え（前の控えの時刻から後の変えた記録で、変更の控えの中身を作る） */
const CONTROL_KINDS: readonly string[] = ['receipt', 'change', 'complete', 'extra_complete'];
/** マイページに今出ている物（K221）。「作品を足す・やめる」は Task 15（出さないと決めたら、15 のコミットを revert して「お支払い、インスタ」に戻す） */
const MYPAGE_ITEMS_STAGE1 = 'お支払い、インスタ、作品を足す・やめる';
/** roster_fix_on が空のときの「次のご連絡」（計画で仮に決めた。12/8 に TARO が見る） */
const NEXT_CONTACT_DEFAULT = '2月ごろ';

// ---------- 日付の言葉 ----------

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 'YYYY-MM-DD' → '2月10日'（year で '2027年2月10日'、weekday で '（水）' を付ける）。形が合わなければそのまま */
function dateLabel(iso: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  if (!isIsoDate(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  return `${opts.year ? `${y}年` : ''}${m}月${d}日${opts.weekday ? `（${WEEKDAYS[weekdayJst(iso)]}）` : ''}`;
}

/** 'YYYY-MM-DD HH:MM' → '1月31日（日）23:59' */
function dateTimeLabel(jst: string): string {
  const [date, time] = jst.split(' ');
  return `${dateLabel(date, { weekday: true })}${time ?? ''}`;
}

function hhmmToMin(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/** JST の 8:00〜21:00（分でくらべる。21:00 ちょうどは中）。29 の「待ちのメールを、今出す」もこれで確かめる */
export function inSendWindow(now: Date): boolean {
  const j = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const min = j.getUTCHours() * 60 + j.getUTCMinutes();
  return min >= hhmmToMin(MAIL_SEND_FROM) && min <= hhmmToMin(MAIL_SEND_UNTIL);
}

// ---------- 記録 ----------

/* eslint-disable @typescript-eslint/no-explicit-any -- DB の行は動的キー */
async function findByDedupe(dedupeKey: string): Promise<number | null> {
  const r = await getOne('SELECT id FROM recital_mail_log WHERE dedupe_key = ?', [dedupeKey]);
  return r ? Number(r.id) : null;
}

/** 先に status=waiting・sent_at NULL で1行入れる。同じ鍵がもうあれば duplicate */
async function insertLog(
  eventKey: string, householdId: number, kind: MailKind, dedupeKey: string | null, now: Date,
): Promise<{ logId: number; duplicate: boolean }> {
  if (dedupeKey) {
    const id = await findByDedupe(dedupeKey);
    if (id !== null) return { logId: id, duplicate: true };
  }
  try {
    const r = await execute(
      `INSERT INTO recital_mail_log (event_key, household_id, mail_kind, dedupe_key, status, created_at) VALUES (?, ?, ?, ?, 'waiting', ?)`,
      [eventKey, householdId, kind, dedupeKey, nowUtcIso(now)],
    );
    return { logId: Number(r.lastInsertRowid), duplicate: false };
  } catch (e) {
    // 同時に同じ鍵を入れた方が先に入った（一意の索引）
    if (dedupeKey && /UNIQUE constraint failed/.test(e instanceof Error ? e.message : String(e))) {
      const id = await findByDedupe(dedupeKey);
      if (id !== null) return { logId: id, duplicate: true };
    }
    throw e;
  }
}

/** 失敗にする。取った印（sent_at）も空に戻す */
async function markFailed(logId: number, error: string): Promise<void> {
  await execute("UPDATE recital_mail_log SET status = 'failed', error = ?, sent_at = NULL WHERE id = ? AND status = 'waiting'", [error, logId]);
}

/**
 * 送る直前に行を取る（status は増やさず、sent_at を「取った」印に使う）。取れた1人だけが送る。
 * 同時に2つの待ちを出す（2回押し・見回りとボタン）や、すぐ送る途中の行を待ちを出す側が拾うのを防ぐ。
 */
async function claimLog(logId: number, now: Date): Promise<boolean> {
  const r = await execute(
    "UPDATE recital_mail_log SET sent_at = ? WHERE id = ? AND status = 'waiting' AND sent_at IS NULL",
    [nowUtcIso(now), logId],
  );
  return r.rowsAffected === 1;
}

/** 例外から残してよいのは code だけ（英数の短い物）。文は宛先を含むことがあるので残さない（R-18） */
function sendErrorText(e: unknown): string {
  const code = e !== null && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(code) ? `送信に失敗（${code}）` : '送信に失敗';
}

// ---------- メールの data を作る ----------

function parseJson(s: string | null): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function personName(p: { last_name: string; first_name: string | null }): string {
  return [p.last_name, p.first_name].filter((x) => x != null && String(x).trim() !== '').join(' ');
}

function contactNameOf(h: HouseholdDetail['household']): string {
  const kanji = [h.contact_last_name, h.contact_first_name].filter((x) => x && x.trim() !== '').join(' ');
  if (kanji) return kanji;
  const kana = [h.contact_last_kana, h.contact_first_kana].filter((x) => x && x.trim() !== '').join(' ');
  return kana || 'お申し込みの方';
}

type WorkLite = { id: number; code: string; title: string; status: string; sort: number };

async function loadWorks(eventKey: string): Promise<Map<number, WorkLite>> {
  const rows = await getAll('SELECT id, work_code, title, status, sort_order FROM recital_works WHERE event_key = ?', [eventKey]);
  return new Map(rows.map((r) => [Number(r.id), { id: Number(r.id), code: String(r.work_code), title: String(r.title), status: String(r.status), sort: Number(r.sort_order) }]));
}

const workLabel = (w: WorkLite) => `${w.title}（${w.code}）`;

function peopleOf(detail: HouseholdDetail, works: Map<number, WorkLite>): RecitalMailData['people'] {
  const out: RecitalMailData['people'] = [];
  for (const p of detail.people) {
    if (p.status !== 'active') continue;
    const casts = detail.casts
      .filter((c) => Number(c.person_id) === Number(p.id) && (c.status === 'in' || c.status === 'maybe'))
      .map((c) => ({ c, w: works.get(Number(c.work_id)) }))
      .filter((x): x is { c: typeof x.c; w: WorkLite } => !!x.w && x.w.status !== 'dropped')
      .sort((a, b) => a.w.sort - b.w.sort || a.w.id - b.w.id);
    out.push({
      name: personName(p),
      inWorks: casts.filter((x) => x.c.status === 'in').map((x) => workLabel(x.w)),
      maybeWorks: casts.filter((x) => x.c.status === 'maybe').map((x) => workLabel(x.w)),
    });
  }
  return out;
}

/** 控え（前に出した物）の時刻。今の行は除く。無ければ ''（全部の記録が後ろ） */
function lastMailAt(detail: HouseholdDetail, kinds: readonly string[], exceptLogId: number): string {
  const m = detail.mails.find((x) => Number(x.id) !== exceptLogId && kinds.includes(x.mail_kind) && x.status !== 'cancelled');
  return m ? String(m.created_at) : '';
}

function buildChange(
  detail: HouseholdDetail, works: Map<number, WorkLite>, s: RecitalSettings, logId: number, now: Date, mergedInto: string | null,
): NonNullable<RecitalMailData['change']> {
  const since = lastMailAt(detail, CONTROL_KINDS, logId);
  const changes = detail.changes.filter((c) => String(c.created_at) > since).reverse(); // 古い順
  const people = new Map(detail.people.map((p) => [Number(p.id), p]));
  const nameOf = (id: number | null) => (id != null && people.has(Number(id)) ? personName(people.get(Number(id))!) : '');
  const workOf = (id: number | null) => (id != null && works.has(Number(id)) ? workLabel(works.get(Number(id))!) : '');
  const lines: string[] = [];
  const push = (l: string) => { if (l && !lines.includes(l)) lines.push(l); };
  const totals: { before: number; after: number }[] = [];
  for (const c of changes) {
    if (c.action === 'cast_add') push(`${nameOf(c.person_id)}『${workOf(c.work_id)}』を足しました`);
    else if (c.action === 'cast_out') push(`${nameOf(c.person_id)}『${workOf(c.work_id)}』をやめました`);
    else if (c.action === 'cast_decide') push(`${nameOf(c.person_id)}『${workOf(c.work_id)}』を『出る』にしました`);
    else if (c.action === 'person_edit') push('お名前を直しました');
    else if (c.action === 'insta_edit') push('インスタの欄を直しました');
    else if (c.action === 'contact_edit') push('連絡先を直しました');
    else if (c.action === 'total_changed') {
      const b = parseJson(c.before_json);
      const a = parseJson(c.after_json);
      if (b && a && Number.isFinite(Number(b.total)) && Number.isFinite(Number(a.total))) totals.push({ before: Number(b.total), after: Number(a.total) });
    }
  }
  const m = detail.money;
  const totalBefore = totals.length > 0 ? totals[0].before : m.total;
  const totalAfter = totals.length > 0 ? totals[totals.length - 1].after : m.total;
  const newRefund = detail.refunds
    .filter((r) => r.status === 'todo' && String(r.created_at) > since)
    .reduce((a, r) => a + Number(r.amount), 0);
  let kind: NonNullable<RecitalMailData['change']>['kind'];
  if (totalBefore === totalAfter) kind = 'no_money';
  else if (m.paid <= 0) kind = 'unpaid';
  else if (m.remaining > 0) kind = 'paid_add';
  else if (totalAfter < totalBefore && newRefund > 0) kind = 'fee_refund';
  else kind = 'paid_drop';
  return {
    lines, totalBefore, totalAfter, kind,
    afterFeb1: now.getTime() > deadlineMs(s.change_close_at),
    refundAmount: kind === 'fee_refund' ? newRefund : 0,
    ...(mergedInto ? { merged: { intoRefCode: mergedInto } } : {}),
  };
}

function buildAddedWorks(detail: HouseholdDetail, works: Map<number, WorkLite>, logId: number): RecitalMailData['addedWorks'] {
  const since = lastMailAt(detail, ['complete', 'extra_complete'], logId);
  const inNow = new Set(detail.casts.filter((c) => c.status === 'in').map((c) => `${Number(c.person_id)}:${Number(c.work_id)}`));
  const byPerson = new Map<number, string[]>();
  for (const c of [...detail.changes].reverse()) {
    if (c.action !== 'cast_add' || String(c.created_at) <= since || c.person_id == null || c.work_id == null) continue;
    if (!inNow.has(`${Number(c.person_id)}:${Number(c.work_id)}`)) continue;
    const w = works.get(Number(c.work_id));
    if (!w || w.status === 'dropped') continue;
    const list = byPerson.get(Number(c.person_id)) ?? [];
    if (!list.includes(workLabel(w))) list.push(workLabel(w));
    byPerson.set(Number(c.person_id), list);
  }
  const people = new Map(detail.people.map((p) => [Number(p.id), p]));
  return [...byPerson.entries()].map(([pid, ws]) => ({ name: people.has(pid) ? personName(people.get(pid)!) : '', works: ws }));
}

function restLineOf(s: RecitalSettings, now: Date): string | null {
  if (!isIsoDate(s.bank_rest_from) || !isIsoDate(s.bank_rest_to)) return null;
  if (todayJst(now) > s.bank_rest_to) return null;
  const w = (iso: string) => dateLabel(iso, { weekday: true });
  return `${w(s.bank_rest_from)}〜${w(s.bank_rest_to)}のお振込みは、${w(shiftDays(s.bank_rest_to, 1))}からじゅんに確認します。`;
}

async function buildMailData(
  kind: MailKind, householdId: number, s: RecitalSettings, logId: number, dedupeKey: string | null, via: MailVia | undefined, now: Date,
): Promise<RecitalMailData> {
  const detail = await loadHouseholdDetail(householdId);
  if (!detail) throw new Error('recital_mail:no_household');
  const h = detail.household;
  const event = await getRecitalEvent(h.event_key);
  const works = await loadWorks(h.event_key);
  const m = detail.money;
  const people = peopleOf(detail, works);
  const zeroComplete = kind === 'complete' && m.total === 0;

  // その入金：bank_paid の鍵ならその入金、ほかは調整でないプラスのいちばん新しい入金
  const bankPaidId = dedupeKey?.startsWith('bank_paid:') ? Number(dedupeKey.slice('bank_paid:'.length)) : null;
  const payment = bankPaidId != null
    ? detail.payments.find((p) => Number(p.id) === bankPaidId)
    : [...detail.payments].reverse().find((p) => p.method !== 'adjust' && Number(p.amount) > 0);
  const mailVia: MailVia | undefined = via ?? (bankPaidId != null && payment ? (payment.method as MailVia) : undefined);
  const paid = payment
    ? { amount: Number(payment.amount), dateLabel: dateLabel(payment.method === 'bank' && payment.bank_date ? String(payment.bank_date) : String(payment.paid_on)) }
    : undefined;
  const paidTotal = detail.payments.filter((p) => p.method !== 'adjust').reduce((a, p) => a + Number(p.amount), 0);

  const payDueIso = h.pay_due_override && h.pay_due_override.trim() !== '' ? h.pay_due_override : s.pay_due;
  const changeClose = h.extend_until && deadlineMs(h.extend_until) > deadlineMs(s.change_close_at) ? h.extend_until : s.change_close_at;
  const showDate = event ? dateLabel(event.show_date, { year: true, weekday: true }) : '';
  const venue = event?.venue ? `・${event.venue}` : '';

  let mergedInto: string | null = null;
  if (kind === 'change' && h.status === 'merged' && h.merged_into != null) {
    const t = await getOne('SELECT ref_code FROM recital_households WHERE id = ?', [h.merged_into]);
    mergedInto = t ? String(t.ref_code) : null;
  }

  let guide: RecitalMailData['guide'];
  if (kind === 'bank_guide') {
    const money = await readHouseholdMoney(householdId);
    const kana = [h.contact_last_kana, h.contact_first_kana].filter((x) => x && x.trim() !== '').join(' ');
    guide = {
      amount: payableAmount(money.m, money.told),
      bankText: s.bank_text,
      nameLine: `${h.ref_code} ${kana}`.trim(),
      restLine: restLineOf(s, now),
    };
  }

  return {
    contactName: contactNameOf(h),
    refCode: h.ref_code,
    myUrl: recitalMyUrl(h.edit_token, { fromMail: kind === 'receipt' || zeroComplete }),
    eventLine: `BW6（${showDate}${venue}）`,
    people,
    chargeLines: detail.charges.filter((c) => c.status === 'active').map((c) => ({ label: c.label, amount: Number(c.amount) })),
    m,
    hasMaybe: people.some((p) => p.maybeWorks.length > 0),
    zeroComplete,
    payDue: dateLabel(payDueIso, { weekday: true }),
    payDueLong: dateLabel(payDueIso, { year: true, weekday: true }),
    payNotice: payGate(s, now.getTime()),
    payOpenLabel: dateLabel(s.pay_open_at.slice(0, 10), { weekday: true }),
    changeCloseLabel: dateTimeLabel(changeClose),
    mypageItems: MYPAGE_ITEMS_STAGE1,
    nextContact: s.roster_fix_on && isIsoDate(s.roster_fix_on) ? `${Number(s.roster_fix_on.slice(5, 7))}月ごろ` : NEXT_CONTACT_DEFAULT,
    via: mailVia,
    paid,
    paidTotal,
    ...(kind === 'extra_complete' ? { addedWorks: buildAddedWorks(detail, works, logId) } : {}),
    ...(kind === 'change' ? { change: buildChange(detail, works, s, logId, now, mergedInto) } : {}),
    ...(guide ? { guide } : {}),
  };
}

// ---------- 送る（宛先の確かめから先。待ちを出す時もここを通る。呼ぶ前に claimLog で行を取っておく） ----------

async function deliver(
  row: { logId: number; kind: MailKind; householdId: number; dedupeKey: string | null },
  via: MailVia | undefined,
  now: Date,
): Promise<'sent' | 'failed'> {
  let to: string;
  let subject: string;
  let text: string;
  let bcc: boolean;
  try {
    const h = await getOne('SELECT event_key, email FROM recital_households WHERE id = ?', [row.householdId]);
    if (!h) { await markFailed(row.logId, '世帯が無い'); return 'failed'; }
    const event = await getRecitalEvent(String(h.event_key));
    if (!event) { await markFailed(row.logId, '発表会が無い'); return 'failed'; }
    const s = await getRecitalSettings(event.event_key);
    if (event.is_test === 1) {
      to = s.test_mail_to.trim();
      if (to === '') { await markFailed(row.logId, 'test_mail_to が空'); return 'failed'; }
    } else {
      to = h.email == null ? '' : String(h.email).trim();
      if (to === '') { await markFailed(row.logId, '宛先が無い'); return 'failed'; }
    }
    if (!isMailConfigured()) { await markFailed(row.logId, 'メールの鍵が無い'); return 'failed'; }
    const data = await buildMailData(row.kind, row.householdId, s, row.logId, row.dedupeKey, via, now);
    ({ subject, text } = buildRecitalMail(row.kind, data));
    bcc = s.mail_bcc_staff;
    if (bcc) await sendEmail({ to, subject, text });
    else await sendEmailNoBcc({ to, subject, text });
  } catch (e) {
    const err = sendErrorText(e);
    console.error(`[recital] メールを送れませんでした log=${row.logId} kind=${row.kind}`, err);
    await markFailed(row.logId, err);
    return 'failed';
  }
  await execute("UPDATE recital_mail_log SET status = 'sent', sent_at = ?, error = NULL WHERE id = ? AND status = 'waiting'", [nowUtcIso(now), row.logId]);
  return 'sent';
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- 外から呼ぶ物 ----------

/**
 * 1通を記録して送る。順：記録の1行（鍵がもうあれば duplicate）→ forceWait／夜の待ち（宛先の確かめより先）→ 宛先 → 鍵 → 文 → 送る。
 * 失敗は記録を failed にして返す（投げない）。世帯が無い時と DB の失敗だけ投げる。
 */
export async function sendRecitalMail(
  x: { kind: MailKind; householdId: number; dedupeKey?: string | null; via?: MailVia; deferAtNight?: boolean; forceWait?: boolean },
  now: Date = new Date(),
): Promise<{ status: SendStatus; logId: number | null }> {
  const h = await getOne('SELECT event_key FROM recital_households WHERE id = ?', [x.householdId]);
  if (!h) throw new Error('recital_mail:no_household');
  const dedupeKey = x.dedupeKey ?? null;
  const { logId, duplicate } = await insertLog(String(h.event_key), x.householdId, x.kind, dedupeKey, now);
  if (duplicate) return { status: 'duplicate', logId };
  if (x.forceWait) return { status: 'waiting', logId };
  if (x.deferAtNight && !inSendWindow(now)) return { status: 'waiting', logId };
  // 待ちにしないと決まったら、すぐ取る（送るまでの間に、待ちを出す側が同じ行を拾わないように）
  if (!(await claimLog(logId, now))) return { status: 'waiting', logId };
  const r = await deliver({ logId, kind: x.kind, householdId: x.householdId, dedupeKey }, x.via, now);
  return { status: r, logId };
}

/**
 * お金が入ったあとのメールを選んで送る（07 7-8・決まりの紙 2-24）。
 * 出演なし → なし。残り0 → その入金の返す分が入金と同じ額（もう払い済みだった K188）ならなし、complete の記録があれば extra_complete、無ければ complete。
 * 残り>0 → sendRemaining のときだけ remaining。振込は鍵 bank_paid:<入金id> と夜の待ち、ほかは complete だけ鍵 complete:<世帯id>。
 */
export async function sendPaidMail(
  householdId: number,
  paymentId: number,
  via: MailVia,
  opts: { sendRemaining?: boolean; now?: Date; forceWait?: boolean } = {},
): Promise<{ status: 'none' } | { kind: MailKind; status: SendStatus; logId: number | null }> {
  const money = await readHouseholdMoney(householdId);
  if (money.view === 'none') return { status: 'none' };
  let kind: MailKind;
  if (money.m.remaining === 0) {
    const pay = await getOne('SELECT amount FROM recital_payments WHERE id = ? AND household_id = ?', [paymentId, householdId]);
    if (!pay) throw new Error('recital_mail:no_payment');
    const recs = await getAll("SELECT after_json FROM recital_changes WHERE household_id = ? AND action = 'payment_recorded' ORDER BY id DESC", [householdId]);
    const rec = recs.map((r) => parseJson(r.after_json == null ? null : String(r.after_json))).find((a) => a && Number(a.paymentId) === paymentId);
    const refundId = rec && rec.refundId != null ? Number(rec.refundId) : null;
    if (refundId != null) {
      const rf = await getOne("SELECT amount FROM recital_refunds WHERE id = ? AND status <> 'cancelled'", [refundId]);
      if (rf && Number(rf.amount) === Number(pay.amount)) return { status: 'none' };
    }
    const done = await getOne("SELECT id FROM recital_mail_log WHERE household_id = ? AND mail_kind = 'complete' AND status <> 'cancelled' LIMIT 1", [householdId]);
    kind = done ? 'extra_complete' : 'complete';
  } else {
    if (!opts.sendRemaining) return { status: 'none' };
    kind = 'remaining';
  }
  const bank = via === 'bank';
  const dedupeKey = bank ? `bank_paid:${paymentId}` : kind === 'complete' ? `complete:${householdId}` : null;
  const r = await sendRecitalMail({ kind, householdId, dedupeKey, via, deferAtNight: bank, forceWait: opts.forceWait }, opts.now);
  return { kind, ...r };
}

/** その発表会の待ちを古い順に limit 通まで出す（JST 8:00〜21:00 だけ。関数は60秒まで、残りは次の回） */
export async function flushWaitingMails(eventKey: string, now: Date = new Date(), limit = 20): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };
  if (!inSendWindow(now)) return out;
  const rows = await getAll(
    "SELECT id, household_id, mail_kind, dedupe_key FROM recital_mail_log WHERE event_key = ? AND status = 'waiting' AND sent_at IS NULL ORDER BY id LIMIT ?",
    [eventKey, limit],
  );
  for (const r of rows) {
    const logId = Number(r.id);
    if (!(await claimLog(logId, now))) continue; // ほかの出し手が先に取った・取りやめになった
    if (r.household_id == null) {
      await markFailed(logId, '世帯が無い');
      out.failed++;
      continue;
    }
    const res = await deliver(
      { logId, kind: String(r.mail_kind) as MailKind, householdId: Number(r.household_id), dedupeKey: r.dedupe_key == null ? null : String(r.dedupe_key) },
      undefined,
      now,
    );
    if (res === 'sent') out.sent++;
    else out.failed++;
  }
  return out;
}

/** 入金を取り消したとき、その入金の待ちのメールを出さずに閉じる（取りやめ。K202） */
export async function cancelWaitingMailsTx(tx: Transaction, paymentId: number): Promise<void> {
  await tx.execute({
    sql: "UPDATE recital_mail_log SET status = 'cancelled' WHERE dedupe_key = ? AND status = 'waiting' AND sent_at IS NULL",
    args: ['bank_paid:' + paymentId],
  });
}

/** 今日（JST）の発表会のメールの数（sent＋failed。待ち・取りやめは数えない）。送った日で数える（sent_at、無ければ created_at）。warn＝上限に近い（07 7-7） */
export async function countRecitalMailsToday(now: Date = new Date()): Promise<{ count: number; warn: boolean }> {
  const start = jstToMs(todayJst(now));
  const r = await getOne(
    "SELECT COUNT(*) AS n FROM recital_mail_log WHERE status IN ('sent', 'failed') AND COALESCE(sent_at, created_at) >= ? AND COALESCE(sent_at, created_at) < ?",
    [new Date(start).toISOString(), new Date(start + 86_400_000).toISOString()],
  );
  const count = Number(r?.n ?? 0);
  return { count, warn: count >= RECITAL_MAIL_DAILY_WARN };
}

/**
 * お振込みのご案内を（出し直しも）出す。振込の世帯・bank_text あり・返す分 todo＜残り・ご案内の金額＞0 のときだけ。
 * いちばん新しいご案内（取りやめ以外）と同じ金額なら出さない。鍵は bank_guide:<世帯id>:<金額>:<その世帯のご案内の記録の数＋1>（K208）。
 */
export async function maybeResendBankGuide(householdId: number): Promise<void> {
  const money = await readHouseholdMoney(householdId);
  if (money.payMethod !== 'bank') return;
  const h = await getOne('SELECT event_key FROM recital_households WHERE id = ?', [householdId]);
  if (!h) return;
  const s = await getRecitalSettings(String(h.event_key));
  if (s.bank_text.trim() === '') return;
  if (!(money.refundTodo < money.m.remaining)) return;
  const amount = payableAmount(money.m, money.told);
  if (amount <= 0) return;
  const rows = await getAll("SELECT dedupe_key, status FROM recital_mail_log WHERE household_id = ? AND mail_kind = 'bank_guide' ORDER BY id DESC", [householdId]);
  const latest = rows.find((r) => r.status !== 'cancelled');
  if (latest && Number(String(latest.dedupe_key ?? '').split(':')[2]) === amount) return;
  await sendRecitalMail({ kind: 'bank_guide', householdId, dedupeKey: `bank_guide:${householdId}:${amount}:${rows.length + 1}` });
}

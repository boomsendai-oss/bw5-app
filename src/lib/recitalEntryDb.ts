// BW6 発表会（段階1）の申込の「送る」と「送る前の確かめ」（Task 7）、代わりに直す・マイページの変更・請求の作り直し（Task 8）。
// 1回の書き込み（withWriteTx）で 世帯・人・出演・請求・変えた記録 を入れる。照合とメールは書き込みのあと。
// 請求の行はスタッフが打たない。直したあとは必ず料金の規則から作り直す（recomputeChargesTx・K223・K226〜K228）。
// DB は src/lib/db.ts 経由だけ。名前と型の正本は .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
// 決まりの正本は設計書 03 3-4・05 5-2・04 4-2「送る」。記録の日時は UTC ISO（nowUtcIso）。
import { randomBytes } from 'node:crypto';
import type { Transaction } from '@libsql/client';
import { batch, getAll, getOne, withWriteTx } from '@/lib/db';
import { normalizeKana } from '@/lib/csvUtil';
import { isIsoDate, nowUtcIso, todayJst, weekdayJst } from '@/lib/dateJst';
import {
  ageOn,
  canFamilyEdit,
  entryPhase,
  householdView,
  isCountedCast,
  normalizeEmail,
  normalizePhone,
  parseRecitalSettings,
  RECITAL_STAFF_NAMES,
  type CastStatus,
  type FeeClass,
  type HouseholdView,
  type RecitalSettings,
} from '@/lib/recital';
import { getRecitalEvent, getRecitalSettings, listFeeRules, listWorks, loadMembersLite, logChangeTx, readMoneyViewTx, type WorkRow } from '@/lib/recitalDb';
import { diffCharges, expectedCharges, type ChargeLine, type FeePerson, type FeeRule } from '@/lib/recitalFee';
import { matchFeePreset, matchMember } from '@/lib/recitalMatch';
import { pickRef } from '@/lib/recitalRef';
import { requireHouseholdByToken } from '@/lib/recitalGuard';
import { sendRecitalMail } from '@/lib/recitalMail';
import { afterMoneyChanged, readHouseholdMoneyTx } from '@/lib/recitalMoneyDb';

// ---------- 型（split.md ③） ----------

export type EntryPersonInput = {
  tempId: string; lastName: string; firstName: string; lastKana: string; firstKana: string; birthday: string; isContact: boolean;
  category: 'student' | 'non_member'; tshirtSize: string | null; instaHandle: string | null; works: { workId: number; status: 'in' | 'maybe' }[];
};
export type EntrySubmission = {
  eventKey: string; submitKey: string;
  contact: { lastName: string; firstName: string; lastKana: string; firstKana: string; email: string; phone: string };
  people: EntryPersonInput[]; confirmNotFamily: boolean; confirmSamePerson: boolean; consentAccepted: boolean;
};
type FailCode = 'suspended' | 'before' | 'closed' | 'same_email' | 'same_phone' | 'same_person' | 'invalid' | 'busy';
export type SubmitResult =
  | { ok: true; householdId: number; token: string; refCode: string; view: HouseholdView; total: number; replay: boolean }
  | { ok: false; code: FailCode; message: string; fieldErrors?: Record<string, string> };

type FeeInputPerson = {
  lastName: string; firstName: string; lastKana: string; firstKana: string; birthday: string | null;
  works: { workId: number; status: 'in' | 'maybe' }[];
};

// ---------- 失敗の文 ----------

const MESSAGES: Record<Exclude<FailCode, 'before'>, string> = {
  suspended: 'ただいま受付を止めています。再開までお待ちください',
  closed: '受付は終わりました。ご相談は公式LINEへ',
  same_email: 'このメールアドレスに、ご案内を送りました。メールをご確認ください。',
  same_phone: 'ご家族のお申し込みが、すでにあります。マイページをご確認ください。',
  same_person: '同じお名前・同じ生年月日のお申し込みが、もうあります。ご家族が申し込んでいないか、確かめてください。',
  busy: 'ただいま混み合っています。もう一度『送る』を押してください。二重にはなりません。',
  invalid: '入力を確かめてください。',
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** entry_open_at（JST 'YYYY-MM-DD HH:MM'）→「12月15日（火）12時から受け付けます」。分が 0 でなければ「12時30分」 */
function beforeMessage(openAt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(openAt);
  if (!m) return MESSAGES.suspended;
  const [, , mo, d, h, mi] = m;
  const wd = WEEKDAYS[weekdayJst(`${m[1]}-${mo}-${d}`)];
  const time = `${Number(h)}時${Number(mi) === 0 ? '' : `${Number(mi)}分`}`;
  return `${Number(mo)}月${Number(d)}日（${wd}）${time}から受け付けます`;
}

const fail = (code: Exclude<FailCode, 'before'>, fieldErrors?: Record<string, string>): SubmitResult =>
  fieldErrors ? { ok: false, code, message: MESSAGES[code], fieldErrors } : { ok: false, code, message: MESSAGES[code] };

// ---------- 中身の確かめ ----------

const SUBMIT_KEY_RE = /^[0-9a-f]{32}$/;
const KANA_RE = /^[ァ-ヺー\s]+$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PEOPLE = 10;
const CATEGORIES: readonly string[] = ['student', 'non_member'];

function checkName(errors: Record<string, string>, key: string, v: string): void {
  if (typeof v !== 'string' || v.trim() === '') errors[key] = '入力してください';
}

function checkKana(errors: Record<string, string>, key: string, v: string): void {
  if (typeof v !== 'string' || v.trim() === '') errors[key] = '入力してください';
  else if (!KANA_RE.test(v.trim())) errors[key] = 'カタカナで入力してください';
}

function validate(s: EntrySubmission, settings: RecitalSettings, works: Map<number, WorkRow>, today: string): Record<string, string> {
  const e: Record<string, string> = {};
  const c = s.contact;
  checkName(e, 'contact.lastName', c.lastName);
  checkName(e, 'contact.firstName', c.firstName);
  checkKana(e, 'contact.lastKana', c.lastKana);
  checkKana(e, 'contact.firstKana', c.firstKana);
  if (!EMAIL_RE.test(normalizeEmail(c.email ?? ''))) e['contact.email'] = 'メールアドレスの形で入力してください';
  const phone = normalizePhone(c.phone ?? '');
  if (phone.length < 10 || phone.length > 11) e['contact.phone'] = '電話番号は10〜11けたで入力してください';
  if (!s.consentAccepted) e.consentAccepted = '同意が必要です';

  const people = Array.isArray(s.people) ? s.people : [];
  if (people.length < 1 || people.length > MAX_PEOPLE) e.people = `出る人は1〜${MAX_PEOPLE}人で入力してください`;
  people.slice(0, MAX_PEOPLE).forEach((p, i) => {
    const k = (f: string) => `people.${i}.${f}`;
    checkName(e, k('lastName'), p.lastName);
    checkName(e, k('firstName'), p.firstName);
    checkKana(e, k('lastKana'), p.lastKana);
    checkKana(e, k('firstKana'), p.firstKana);
    const bdOk = isIsoDate(p.birthday) && p.birthday <= today;
    if (!bdOk) e[k('birthday')] = '生年月日を確かめてください';
    if (!CATEGORIES.includes(p.category)) e[k('category')] = '区分を選んでください';
    if (p.isContact && (!bdOk || !(ageOn(p.birthday, today) >= settings.min_self_apply_age))) {
      e[k('isContact')] = `${settings.min_self_apply_age}歳未満の方は「連絡する人と同じ」を選べません`;
    }
    if (p.tshirtSize !== null && !settings.tshirt_sizes.includes(p.tshirtSize)) e[k('tshirtSize')] = 'サイズを選び直してください';
    const ws = Array.isArray(p.works) ? p.works : [];
    if (ws.length < 1) e[k('works')] = '作品を1つ以上選んでください';
    else if (ws.length > settings.max_works_per_person) e[k('works')] = `作品は1人${settings.max_works_per_person}つまでです（迷っている作品も数えます）`;
    else if (new Set(ws.map((w) => w.workId)).size !== ws.length) e[k('works')] = '同じ作品が2回選ばれています';
    else if (ws.some((w) => (w.status !== 'in' && w.status !== 'maybe') || !isSelectable(works.get(w.workId)))) e[k('works')] = '選べない作品があります';
  });
  return e;
}

function isSelectable(w: WorkRow | undefined): boolean {
  return !!w && w.entry_mode === 'form' && w.status === 'open';
}

// ---------- 同じ電話・同じメール・同じ人 ----------

async function samePhoneExists(eventKey: string, phoneRaw: string): Promise<boolean> {
  const phone = normalizePhone(phoneRaw ?? '');
  if (phone === '') return false;
  const r = await getOne("SELECT id FROM recital_households WHERE event_key = ? AND phone = ? AND status = 'active' LIMIT 1", [eventKey, phone]);
  return !!r;
}

async function sameEmailExists(eventKey: string, emailRaw: string): Promise<boolean> {
  const email = normalizeEmail(emailRaw ?? '');
  if (email === '') return false;
  const r = await getOne("SELECT id FROM recital_households WHERE event_key = ? AND email = ? AND status = 'active' LIMIT 1", [eventKey, email]);
  return !!r;
}

const personKey = (lastKana: string | null, firstKana: string | null) => normalizeKana(`${lastKana ?? ''}${firstKana ?? ''}`);

/** 「normalizeKana(セイ＋メイ)＋生年月日」が同じ active の人がいる入力の番号 */
async function samePersonIdx(eventKey: string, people: { lastKana: string; firstKana: string; birthday: string }[]): Promise<number[]> {
  const bds = [...new Set(people.map((p) => p.birthday).filter((b) => isIsoDate(b)))];
  if (bds.length === 0) return [];
  const rows = await getAll(
    `SELECT last_kana, first_kana, birthday FROM recital_people
     WHERE event_key = ? AND status = 'active' AND birthday IN (${bds.map(() => '?').join(',')})`,
    [eventKey, ...bds],
  );
  const have = new Set(rows.map((r) => `${personKey(r.last_kana, r.first_kana)}|${r.birthday}`));
  const out: number[] = [];
  people.forEach((p, i) => {
    const k = personKey(p.lastKana, p.firstKana);
    if (k !== '' && isIsoDate(p.birthday) && have.has(`${k}|${p.birthday}`)) out.push(i);
  });
  return out;
}

/** 送る前の確かめ。書かない・送らない（同じ電話・同じメールの URL のメールは 13 の precheckEntryAction だけが送る） */
export async function precheckEntry(
  eventKey: string,
  x: { email: string; phone: string; people: { lastKana: string; firstKana: string; birthday: string }[] },
): Promise<{ sameEmail: boolean; samePhone: boolean; samePersonIdx: number[] }> {
  return {
    sameEmail: await sameEmailExists(eventKey, x.email),
    samePhone: await samePhoneExists(eventKey, x.phone),
    samePersonIdx: await samePersonIdx(eventKey, x.people ?? []),
  };
}

// ---------- 金額の材料（submitEntry と 13 の quoteEntry の両方が呼ぶ） ----------

/**
 * 料金の材料。規則・作品・事前登録・会員は1回だけ読み、照合（presetClasses）も1回だけ。
 * opts は 13 の quoteEntry 用（submitEntry は付けない）：
 *   formOpenOnly … フォームで選べない作品（form かつ open でない）を数えない
 *   withAllIn    … 迷っている作品を全部「出る」にした形の feePeopleAllIn も返す（同じ照合の結果を使う）
 */
export async function buildEntryFeePeople(
  eventKey: string,
  people: FeeInputPerson[],
  opts?: { formOpenOnly?: boolean; withAllIn?: boolean },
): Promise<{ rules: FeeRule[]; feePeople: FeePerson[]; presetClasses: FeeClass[]; feePeopleAllIn?: FeePerson[] }> {
  const rules = await listFeeRules(eventKey);
  const works = new Map((await listWorks(eventKey)).map((w) => [Number(w.id), w]));
  const presetRows = await getAll('SELECT member_id, fee_class FROM recital_fee_presets WHERE event_key = ?', [eventKey]);
  const presets = presetRows.map((r) => ({ memberId: Number(r.member_id), feeClass: String(r.fee_class) as Exclude<FeeClass, null> }));
  const members = presets.length > 0 ? await loadMembersLite() : [];

  const presetClasses: FeeClass[] = people.map((p) => {
    if (presets.length === 0) return null;
    const hit = matchFeePreset(p, presets, members);
    return hit && 'feeClass' in hit ? hit.feeClass : null;
  });
  const toFeePeople = (allIn: boolean): FeePerson[] => people.map((p, i) => {
    const cs: FeeCast[] = [];
    for (const c of p.works) {
      const w = works.get(c.workId);
      if (!w || (opts?.formOpenOnly && !isSelectable(w))) continue;
      cs.push({ status: allIn ? 'in' : c.status, fee_type: w.fee_type, work_status: w.status, work_code: w.work_code, title: w.title, extra_fee: w.extra_fee });
    }
    return { personId: i + 1, seq: i + 1, feeClass: presetClasses[i], ...feeCounts(cs) };
  });
  const feePeople = toFeePeople(false);
  return opts?.withAllIn
    ? { rules, feePeople, presetClasses, feePeopleAllIn: toFeePeople(true) }
    : { rules, feePeople, presetClasses };
}

/** 料金に使う出演1つ（出演の状態＋作品の料金の種類・状態） */
type FeeCast = { status: string; fee_type: string; work_status: string; work_code: string; title: string; extra_fee: number | null };

/** 1人の「お金に数える出演の数」と「別料金の作品」（申込と作り直しの両方がここを通る） */
function feeCounts(casts: FeeCast[]): { counted: number; extraWorks: FeePerson['extraWorks'] } {
  let counted = 0;
  const extraWorks: FeePerson['extraWorks'] = [];
  for (const c of casts) {
    if (isCountedCast({ fee_type: c.fee_type, status: c.work_status }, { status: c.status as CastStatus })) counted++;
    if (c.fee_type === 'extra' && c.work_status !== 'dropped' && c.status === 'in') {
      extraWorks.push({ workCode: c.work_code, label: c.title, fee: Number(c.extra_fee ?? 0) });
    }
  }
  return { counted, extraWorks };
}

// ---------- 送る ----------

class EntryBusyError extends Error {}

function errText(e: unknown): string {
  return e instanceof Error ? `${(e as { code?: string }).code ?? ''} ${e.message}` : String(e);
}

function isBusyError(e: unknown): boolean {
  if (e instanceof EntryBusyError) return true;
  const t = errText(e);
  return /SQLITE_BUSY|database is locked/i.test(t) || (/UNIQUE constraint failed/.test(t) && /\.seq\b/.test(t));
}

const isRefConflict = (e: unknown) => /UNIQUE constraint failed/.test(errText(e)) && /\.ref_code\b/.test(errText(e));

async function replayResult(householdId: number): Promise<SubmitResult> {
  const h = await getOne('SELECT edit_token, ref_code FROM recital_households WHERE id = ?', [householdId]);
  const mv = await readMoneyViewTx(null, householdId);
  return { ok: true, householdId, token: String(h.edit_token), refCode: String(h.ref_code), view: mv.view, total: mv.m.total, replay: true };
}

type TxOutcome =
  | { kind: 'replay'; householdId: number }
  | { kind: 'same_email'; householdId: number }
  | { kind: 'created'; householdId: number; token: string; refCode: string; total: number; view: HouseholdView; personIds: number[] };

export async function submitEntry(s: EntrySubmission, now: Date = new Date()): Promise<SubmitResult> {
  if (typeof s.submitKey !== 'string' || !SUBMIT_KEY_RE.test(s.submitKey)) return fail('invalid');
  // 同じ submit_key の2回目は、受付の状態・中身・同じ電話の確かめより先に1回目の結果を返す
  // （締切のあとや作品の状態が変わったあとの押し直し、1回目の世帯に当たる same_phone で止めないため）
  const prior = await getOne('SELECT id FROM recital_households WHERE submit_key = ?', [s.submitKey]);
  if (prior) return replayResult(Number(prior.id));

  // 1. 受付の状態
  const event = await getRecitalEvent(s.eventKey);
  if (!event) return fail('invalid');
  const settings = await getRecitalSettings(s.eventKey);
  const phase = entryPhase(settings, now.getTime());
  if (phase === 'before') return { ok: false, code: 'before', message: beforeMessage(settings.entry_open_at) };
  if (phase !== 'open') return fail(phase);

  // 2. 中身
  const today = todayJst(now);
  const works = new Map((await listWorks(s.eventKey)).map((w) => [Number(w.id), w]));
  const errors = validate(s, settings, works, today);
  if (Object.keys(errors).length > 0) return fail('invalid', errors);

  // 3. 同じ電話・同じ人
  if (!s.confirmNotFamily && (await samePhoneExists(s.eventKey, s.contact.phone))) return fail('same_phone');
  if (!s.confirmSamePerson && (await samePersonIdx(s.eventKey, s.people)).length > 0) return fail('same_person');

  // 4. 金額の材料
  const { rules, feePeople, presetClasses } = await buildEntryFeePeople(s.eventKey, s.people);
  const charges = expectedCharges(rules, feePeople, null);

  const email = normalizeEmail(s.contact.email);
  const phone = normalizePhone(s.contact.phone);
  const at = nowUtcIso(now);
  const hasIn = s.people.some((p) => p.works.some((w) => w.status === 'in'));
  const hasMaybe = s.people.some((p) => p.works.some((w) => w.status === 'maybe'));
  const view = householdView({ hasIn, hasMaybe, paid: 0, remaining: charges.total });
  const castCount = s.people.reduce((a, p) => a + p.works.length, 0);

  // 5. 1回の書き込み
  let out: TxOutcome;
  try {
    out = await withWriteTx(async (tx): Promise<TxOutcome> => {
      // (あ)(い) 読む1回目：同じ submit_key／同じメールの active 世帯
      const r1 = await tx.execute({
        sql: `SELECT id, submit_key FROM recital_households
              WHERE submit_key = ? OR (event_key = ? AND email = ? AND status = 'active') ORDER BY id`,
        args: [s.submitKey, s.eventKey, email],
      });
      const again = r1.rows.find((r) => r.submit_key === s.submitKey);
      if (again) return { kind: 'replay', householdId: Number(again.id) };
      if (r1.rows.length > 0) return { kind: 'same_email', householdId: Number(r1.rows[0].id) };

      // (う) 読む2回目：世帯の seq・使用ずみの番号・人の seq
      const [hs, refs, ps] = await tx.batch([
        { sql: 'SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM recital_households WHERE event_key = ?', args: [s.eventKey] },
        { sql: 'SELECT ref_code FROM recital_households WHERE event_key = ?', args: [s.eventKey] },
        { sql: 'SELECT COALESCE(MAX(seq), 0) AS n FROM recital_people WHERE event_key = ?', args: [s.eventKey] },
      ]);
      const seq = Number(hs.rows[0].n);
      const used = new Set(refs.rows.map((r) => String(r.ref_code)));
      const personSeq0 = Number(ps.rows[0].n);

      // (え) 世帯
      const token = randomBytes(24).toString('hex');
      let householdId = 0;
      let refCode = '';
      for (let retry = 0; ; retry++) {
        const pick = pickRef(used, settings.ref_skip, Math.random);
        if (pick === null) {
          console.error(`[recital] 整理番号が尽きました event=${s.eventKey}`);
          throw new EntryBusyError('recital_entry:ref_exhausted');
        }
        try {
          const r = await tx.execute({
            sql: `INSERT INTO recital_households (event_key, seq, ref_code, contact_last_name, contact_first_name, contact_last_kana, contact_first_kana,
                  email, phone, edit_token, submit_key, source, status, applied_at, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'form', 'active', ?, ?)`,
            args: [
              s.eventKey, seq, pick, s.contact.lastName.trim(), s.contact.firstName.trim(), s.contact.lastKana.trim(), s.contact.firstKana.trim(),
              email, phone, token, s.submitKey, at, at,
            ],
          });
          householdId = Number(r.lastInsertRowid);
          refCode = pick;
          break;
        } catch (e) {
          if (isRefConflict(e) && retry < 3) {
            used.add(pick);
            continue;
          }
          if (isRefConflict(e)) {
            console.error(`[recital] 整理番号が4回続けてぶつかりました event=${s.eventKey}`);
            throw new EntryBusyError('recital_entry:ref_conflict');
          }
          throw e;
        }
      }

      // 人
      const peopleRes = await tx.batch(s.people.map((p, i) => {
        const last = p.lastName.trim();
        const first = p.firstName.trim();
        const insta = p.instaHandle == null || p.instaHandle.trim() === '' ? null : p.instaHandle.trim();
        return {
          sql: `INSERT INTO recital_people (event_key, seq, household_id, category, match_status, last_name, first_name, last_kana, first_kana, birthday,
                display_name, name_ok, photo_ok, sns_ok, insta_handle, tshirt_size, fee_class_override, status, created_at)
                VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?, ?, 'active', ?)`,
          args: [
            s.eventKey, personSeq0 + i + 1, householdId, p.category, last, first, p.lastKana.trim(), p.firstKana.trim(), p.birthday,
            `${last} ${first}`, insta, p.tshirtSize, presetClasses[i], at,
          ],
        };
      }));
      const personIds = peopleRes.map((r) => Number(r.lastInsertRowid));

      // 出演・請求（FeePerson.personId〔並びの番号 1〜〕を INSERT した人の id に付けかえる）
      const castStmts = s.people.flatMap((p, i) => p.works.map((w) => ({
        sql: `INSERT INTO recital_casts (event_key, person_id, work_id, status, source, applied_at, decided_at, created_at)
              VALUES (?, ?, ?, ?, 'form', ?, ?, ?)`,
        args: [s.eventKey, personIds[i], w.workId, w.status, at, w.status === 'in' ? at : null, at],
      })));
      const chargeStmts = charges.lines.map((l) => ({
        sql: `INSERT INTO recital_charges (event_key, household_id, person_id, item_code, ref, label, qty, unit_amount, amount, due_on, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        args: [
          s.eventKey, householdId, l.personId == null ? null : personIds[l.personId - 1], l.itemCode, l.ref, l.label,
          l.qty, l.unitAmount, l.amount, settings.pay_due, at,
        ],
      }));
      await tx.batch([...castStmts, ...chargeStmts]);
      await logChangeTx(tx, {
        eventKey: s.eventKey, householdId, action: 'apply', actor: 'family',
        after: { people: s.people.length, casts: castCount, total: charges.total },
      });
      return { kind: 'created', householdId, token, refCode, total: charges.total, view, personIds };
    });
  } catch (e) {
    if (isBusyError(e)) return fail('busy');
    throw e;
  }

  if (out.kind === 'replay') return replayResult(out.householdId);

  if (out.kind === 'same_email') {
    try {
      await sendRecitalMail({ kind: 'resend_url', householdId: out.householdId });
    } catch (e) {
      console.error(`[recital] URLのメールを送れませんでした household=${out.householdId}`, errText(e));
    }
    return fail('same_email');
  }

  // 6. 照合（書き込みのあと。失敗しても申込は成り立つ＝pending のまま）
  try {
    const members = await loadMembersLite();
    await batch(s.people.map((p, i) => {
      const m = matchMember(p, members);
      return { sql: 'UPDATE recital_people SET member_id = ?, match_status = ? WHERE id = ?', args: [m.status === 'auto' ? m.memberId : null, m.status, out.personIds[i]] };
    }));
  } catch (e) {
    console.error(`[recital] 照合に失敗しました household=${out.householdId}`, errText(e));
  }

  // 7. メール（失敗しても ok: true）
  try {
    if (out.view === 'complete') await sendRecitalMail({ kind: 'complete', householdId: out.householdId, dedupeKey: `complete:${out.householdId}` });
    else await sendRecitalMail({ kind: 'receipt', householdId: out.householdId });
  } catch (e) {
    console.error(`[recital] 控えのメールを送れませんでした household=${out.householdId}`, errText(e));
  }

  return { ok: true, householdId: out.householdId, token: out.token, refCode: out.refCode, view: out.view, total: out.total, replay: false };
}

// =====================================================================
// Task 8：代わりに直す・マイページの変更・請求の作り直し（05 5-3・5-5、決まり20・穴10、K222、R-60）
// =====================================================================

// ---------- 型（split.md ③。dryRun は計画で足した名前） ----------

export type HouseholdEdit =
  | { type: 'cast_set'; personId: number; workId: number; status: 'in' | 'maybe' | 'out' }
  | { type: 'person'; personId: number; fields: Partial<{ last_name: string; first_name: string; last_kana: string; first_kana: string; birthday: string; display_name: string; tshirt_size: string | null; insta_handle: string | null; name_ok: number; photo_ok: number; sns_ok: number; staff_note: string }> }
  | { type: 'contact'; fields: Partial<{ contact_last_name: string; contact_first_name: string; contact_last_kana: string; contact_first_kana: string; phone: string; staff_note: string; pay_due_override: string | null }> };
export type EditCtx = { actor: string; by: 'family' | 'staff'; reason?: string | null; receivedAt?: string | null; now?: Date; dryRun?: boolean };
type EditFailCode = 'closed' | 'max_works' | 'paid_no_maybe' | 'last_work' | 'invalid';
export type EditResult =
  | { ok: true; totalBefore: number; totalAfter: number }
  | { ok: true; totalBefore: number; totalAfter: number; remainingBefore: number; remainingAfter: number }
  | { ok: false; code: EditFailCode; message: string };

// ---------- 失敗の文 ----------

function editFailMessage(code: EditFailCode, maxWorks: number): string {
  switch (code) {
    case 'closed': return 'お申し込みと変更の受付は、1月31日（日）で終わりました。中身を変えたいときは、公式LINEでお知らせください。';
    case 'max_works': return `1人${maxWorks}作品までです。`;
    case 'paid_no_maybe': return 'お支払いのあとは、『まだ迷っている』に戻せません。';
    case 'last_work': return '出演を全部やめるときは、公式LINEでお知らせください。';
    case 'invalid': return MESSAGES.invalid;
  }
}

/** 書き込みの中で見つけた失敗。投げて巻き戻し、外で失敗の返り値にする */
class EditFail extends Error {
  constructor(readonly code: EditFailCode) { super(`recital_entry:${code}`); }
}
/** dryRun の印。計算が終わったら投げて巻き戻し、外で返り値にする */
class DryRunDone extends Error {
  constructor(readonly result: EditResult) { super('recital_entry:dry_run'); }
}

// これだけを直したときは変更の控えのメールを送らない
const QUIET_FIELDS: ReadonlySet<string> = new Set(['staff_note', 'name_ok', 'photo_ok', 'sns_ok', 'pay_due_override']);
const PERSON_FIELDS: readonly string[] = ['last_name', 'first_name', 'last_kana', 'first_kana', 'birthday', 'display_name', 'tshirt_size', 'insta_handle', 'name_ok', 'photo_ok', 'sns_ok', 'staff_note'];
const CONTACT_FIELDS: readonly string[] = ['contact_last_name', 'contact_first_name', 'contact_last_kana', 'contact_first_kana', 'phone', 'staff_note', 'pay_due_override'];
const FLAG_FIELDS: readonly string[] = ['name_ok', 'photo_ok', 'sns_ok'];
const FEE_CLASSES: readonly string[] = ['free', 'no_coop', 'tshirt_only'];

/* eslint-disable @typescript-eslint/no-explicit-any -- DB の行は動的キー */
const rowsOf = async (tx: Transaction, sql: string, args: any[]): Promise<any[]> => (await tx.execute({ sql, args })).rows as any[];
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 欄1つを確かめて入れる形にする。だめなら EditFail('invalid') */
function cleanField(key: string, v: unknown, settings: RecitalSettings, today: string): string | number | null {
  const bad = () => { throw new EditFail('invalid'); };
  switch (key) {
    case 'last_name': case 'first_name': case 'display_name': case 'contact_last_name': case 'contact_first_name':
      if (typeof v !== 'string' || v.trim() === '') bad();
      return (v as string).trim();
    case 'last_kana': case 'first_kana': case 'contact_last_kana': case 'contact_first_kana':
      if (typeof v !== 'string' || !KANA_RE.test(v.trim())) bad();
      return (v as string).trim();
    case 'birthday':
      if (!isIsoDate(v) || v > today) bad();
      return v as string;
    case 'tshirt_size':
      if (v === null) return null;
      if (typeof v !== 'string' || !settings.tshirt_sizes.includes(v)) bad();
      return v as string;
    case 'insta_handle':
      if (v === null) return null;
      if (typeof v !== 'string') bad();
      return (v as string).trim() === '' ? null : (v as string).trim();
    case 'name_ok': case 'photo_ok': case 'sns_ok':
      if (v !== 0 && v !== 1) bad();
      return v as number;
    case 'staff_note':
      if (typeof v !== 'string') bad();
      return (v as string).trim() === '' ? null : (v as string).trim();
    case 'phone': {
      if (typeof v !== 'string') bad();
      const p = normalizePhone(v as string);
      if (p.length < 10 || p.length > 11) bad();
      return p;
    }
    case 'pay_due_override':
      if (v === null) return null;
      if (!isIsoDate(v)) bad();
      return v as string;
  }
  return bad();
}

const sameValue = (a: unknown, b: unknown) => (a == null ? null : String(a)) === (b == null ? null : String(b));

/**
 * 家庭のマイページの変更と、スタッフの代わりに直す。全部を1回の withWriteTx で書き、最後に請求の行を作り直す。
 * 書き込みのあと：合計が変わったら afterMoneyChanged(id, 'total')、変更の控えのメール1通（静かな欄だけのときは送らない）。
 * dryRun は同じ確かめと作り直しを通して巻き戻し、合計と残りだけを返す（メールも afterMoneyChanged も呼ばない）。
 */
export async function applyHouseholdEdits(householdId: number, edits: HouseholdEdit[], ctx: EditCtx): Promise<EditResult> {
  const now = ctx.now ?? new Date();
  const h0 = await getOne('SELECT event_key FROM recital_households WHERE id = ?', [householdId]);
  const settings = h0 ? await getRecitalSettings(String(h0.event_key)) : null;
  const fail = (code: EditFailCode): EditResult => ({ ok: false, code, message: editFailMessage(code, settings?.max_works_per_person ?? 5) });

  if (!h0 || !settings) return fail('invalid');
  if (!Array.isArray(edits) || edits.length === 0) return fail('invalid');
  if (ctx.by !== 'family' && ctx.by !== 'staff') return fail('invalid');
  if (typeof ctx.actor !== 'string' || ctx.actor.trim() === '') return fail('invalid');
  if (ctx.by === 'staff' && (ctx.reason ?? '').trim() === '') return fail('invalid');
  if (ctx.by === 'family' && edits.some((e) => e?.type !== 'cast_set')) return fail('invalid');

  const eventKey = String(h0.event_key);
  const at = nowUtcIso(now);
  const today = todayJst(now);
  const reason = ctx.by === 'staff' ? (ctx.reason ?? '').trim() : null;
  let out: { totalBefore: number; totalAfter: number; changed: Set<string> };
  try {
    out = await withWriteTx(async (tx) => {
      const [h] = await rowsOf(tx, 'SELECT status, extend_until FROM recital_households WHERE id = ?', [householdId]);
      if (!h || h.status !== 'active') throw new EditFail('invalid');
      const familyOpen = canFamilyEdit(settings, now.getTime(), h.extend_until == null ? null : String(h.extend_until));
      if (ctx.by === 'family' && !familyOpen) throw new EditFail('closed');
      // 家庭が直せない時（締切のあと）のスタッフの直しは、決まりの外の扱い（03 3-4 changes.is_exception）
      const isException = ctx.by === 'staff' && !familyOpen;
      const paid = (await readMoneyViewTx(tx, householdId)).m.paid;

      const people = new Map((await rowsOf(tx, "SELECT * FROM recital_people WHERE household_id = ? AND status = 'active'", [householdId])).map((r) => [Number(r.id), r]));
      const works = new Map((await rowsOf(tx, 'SELECT id, entry_mode, status FROM recital_works WHERE event_key = ?', [eventKey])).map((r) => [Number(r.id), r]));
      const castRows = await rowsOf(
        tx,
        "SELECT c.id, c.person_id, c.work_id, c.status FROM recital_casts c JOIN recital_people p ON p.id = c.person_id WHERE p.household_id = ? AND p.status = 'active' ORDER BY c.id",
        [householdId],
      );
      const casts = new Map<string, { id: number; personId: number; workId: number; status: string }>();
      for (const c of castRows) {
        const k = `${Number(c.person_id)}:${Number(c.work_id)}`;
        if (!casts.has(k)) casts.set(k, { id: Number(c.id), personId: Number(c.person_id), workId: Number(c.work_id), status: String(c.status) });
      }
      /** その人の、取りやめでない作品の出演で status が sts のどれかの数（except の作品は除く） */
      const countOf = (personId: number, sts: string[], exceptWorkId: number) => {
        let n = 0;
        for (const c of casts.values()) {
          if (c.personId !== personId || c.workId === exceptWorkId || !sts.includes(c.status)) continue;
          if (works.get(c.workId)?.status !== 'dropped') n++;
        }
        return n;
      };
      const log = (x: { action: string; personId?: number | null; workId?: number | null; before?: unknown; after?: unknown }) =>
        logChangeTx(tx, { eventKey, householdId, ...x, actor: ctx.actor, reason, receivedAt: ctx.receivedAt ?? null, isException });

      const changed = new Set<string>();
      for (const e of edits) {
        if (e?.type === 'cast_set') {
          const personId = Number(e.personId);
          const workId = Number(e.workId);
          const next = e.status;
          if (!people.has(personId)) throw new EditFail('invalid');
          const w = works.get(workId);
          if (!w || w.status === 'dropped') throw new EditFail('invalid');
          if (next !== 'in' && next !== 'maybe' && next !== 'out') throw new EditFail('invalid');
          const k = `${personId}:${workId}`;
          const cur = casts.get(k) ?? null;
          const before = cur?.status ?? null;
          if (before === next || (before === null && next === 'out')) continue;
          const isAdd = before === null || before === 'out' || before === 'passed';
          if (ctx.by === 'family' && isAdd) {
            if (!(w.entry_mode === 'form' && w.status === 'open')) throw new EditFail('invalid');
            if (countOf(personId, ['in', 'maybe'], workId) + 1 > settings.max_works_per_person) throw new EditFail('max_works');
          }
          if (paid > 0 && before === 'in' && next === 'maybe') throw new EditFail('paid_no_maybe');
          if (ctx.by === 'family' && paid > 0 && before === 'in' && next === 'out' && countOf(personId, ['in'], workId) === 0) throw new EditFail('last_work');
          const action = isAdd ? 'cast_add' : next === 'out' ? 'cast_out' : 'cast_decide';

          if (!cur) {
            const r = await tx.execute({
              sql: `INSERT INTO recital_casts (event_key, person_id, work_id, status, source, applied_at, decided_at, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [eventKey, personId, workId, next, ctx.by === 'family' ? 'mypage' : 'staff', at, next === 'in' ? at : null, at],
            });
            casts.set(k, { id: Number(r.lastInsertRowid), personId, workId, status: next });
          } else {
            const extra = next === 'out' ? ', withdrawn_at = ?' : next === 'in' ? ', decided_at = ?' : '';
            await tx.execute({
              sql: `UPDATE recital_casts SET status = ?${extra} WHERE id = ?`,
              args: extra ? [next, at, cur.id] : [next, cur.id],
            });
            cur.status = next;
          }
          await log({ action, personId, workId, ...(before === null ? {} : { before: { status: before } }), after: { status: next } });
          changed.add('cast');
        } else if (e?.type === 'person') {
          const personId = Number(e.personId);
          const p = people.get(personId);
          if (!p) throw new EditFail('invalid');
          const fields = e.fields ?? {};
          const keys = Object.keys(fields);
          if (keys.length === 0 || keys.some((x) => !PERSON_FIELDS.includes(x))) throw new EditFail('invalid');
          const groups: Record<string, { before: Record<string, unknown>; after: Record<string, unknown> }> = {};
          const sets: string[] = [];
          const args: unknown[] = [];
          for (const key of keys) {
            const v = cleanField(key, (fields as Record<string, unknown>)[key], settings, today);
            if (sameValue(p[key], v)) continue;
            const action = FLAG_FIELDS.includes(key) ? 'flags_edit' : key === 'insta_handle' ? 'insta_edit' : 'person_edit';
            const g = (groups[action] ??= { before: {}, after: {} });
            g.before[key] = p[key] ?? null;
            g.after[key] = v;
            sets.push(`${key} = ?`);
            args.push(v);
            p[key] = v;
            changed.add(key);
          }
          if (sets.length > 0) {
            await tx.execute({ sql: `UPDATE recital_people SET ${sets.join(', ')} WHERE id = ?`, args: [...args, personId] as (string | number | null)[] });
            for (const [action, g] of Object.entries(groups)) await log({ action, personId, before: g.before, after: g.after });
          }
        } else if (e?.type === 'contact') {
          const fields = e.fields ?? {};
          const keys = Object.keys(fields);
          if (keys.length === 0 || keys.some((x) => !CONTACT_FIELDS.includes(x))) throw new EditFail('invalid');
          const [cur] = await rowsOf(tx, `SELECT ${CONTACT_FIELDS.join(', ')} FROM recital_households WHERE id = ?`, [householdId]);
          const before: Record<string, unknown> = {};
          const after: Record<string, unknown> = {};
          const sets: string[] = [];
          const args: (string | number | null)[] = [];
          for (const key of keys) {
            const v = cleanField(key, (fields as Record<string, unknown>)[key], settings, today);
            if (sameValue(cur[key], v)) continue;
            before[key] = cur[key] ?? null;
            after[key] = v;
            sets.push(`${key} = ?`);
            args.push(v);
            changed.add(key);
          }
          if (sets.length > 0) {
            await tx.execute({ sql: `UPDATE recital_households SET ${sets.join(', ')} WHERE id = ?`, args: [...args, householdId] });
            await log({ action: 'contact_edit', before, after });
          }
        } else {
          throw new EditFail('invalid');
        }
      }

      const r = await recomputeChargesTx(tx, householdId, ctx.actor);
      if (ctx.dryRun) {
        throw new DryRunDone({
          ok: true, totalBefore: r.totalBefore, totalAfter: r.totalAfter,
          remainingBefore: Math.max(0, r.totalBefore - paid), remainingAfter: Math.max(0, r.totalAfter - paid),
        });
      }
      return { totalBefore: r.totalBefore, totalAfter: r.totalAfter, changed };
    });
  } catch (e) {
    if (e instanceof EditFail) return fail(e.code);
    if (e instanceof DryRunDone) return e.result;
    throw e;
  }

  // 書き込みのあと（失敗しても直しは成り立っている）
  if (out.totalAfter !== out.totalBefore) {
    try {
      await afterMoneyChanged(householdId, 'total');
    } catch (e) {
      console.error(`[recital] afterMoneyChanged に失敗しました household=${householdId}`, errText(e));
    }
  }
  if ([...out.changed].some((f) => !QUIET_FIELDS.has(f))) {
    try {
      await sendRecitalMail({ kind: 'change', householdId });
    } catch (e) {
      console.error(`[recital] 変更の控えのメールを送れませんでした household=${householdId}`, errText(e));
    }
  }
  return { ok: true, totalBefore: out.totalBefore, totalAfter: out.totalAfter };
}

/**
 * 請求の行の作り直し（05 5-3）。料金の規則・人（active）・出演＋作品・生きている請求の行を読み、
 * 行ごとに足す／void だけをする（全部を取り消して入れ直さない。adjust の行にはさわらない）。
 * 合計が変わったら、この中で total_changed を記録する。afterMoneyChanged は呼ぶ側が書き込みのあとに呼ぶ。
 */
export async function recomputeChargesTx(
  tx: Transaction,
  householdId: number,
  actor: string,
): Promise<{ totalBefore: number; totalAfter: number; firstPersonId: number | null }> {
  const [h] = await rowsOf(tx, 'SELECT event_key FROM recital_households WHERE id = ?', [householdId]);
  if (!h) throw new Error('recital_entry:no_household');
  const eventKey = String(h.event_key);
  const settings = parseRecitalSettings(
    (await rowsOf(tx, 'SELECT key, value FROM recital_settings WHERE event_key = ?', [eventKey])).map((r) => ({ key: String(r.key), value: String(r.value ?? '') })),
  );
  const rules: FeeRule[] = (await rowsOf(
    tx,
    `SELECT payer_role, item_code, nth_from, nth_to, unit_amount, qty, label, is_tentative, sort_order
     FROM recital_fee_rules WHERE event_key = ? ORDER BY sort_order, id`,
    [eventKey],
  )).map((r) => ({
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
  const people = await rowsOf(tx, "SELECT id, seq, fee_class_override FROM recital_people WHERE household_id = ? AND status = 'active' ORDER BY seq, id", [householdId]);
  const castRows = await rowsOf(
    tx,
    `SELECT c.person_id, c.status, w.fee_type, w.status AS work_status, w.work_code, w.title, w.extra_fee
     FROM recital_casts c JOIN recital_people p ON p.id = c.person_id JOIN recital_works w ON w.id = c.work_id
     WHERE p.household_id = ? AND p.status = 'active' ORDER BY c.id`,
    [householdId],
  );
  const activeRows = await rowsOf(
    tx,
    "SELECT id, person_id, item_code, ref, label, qty, unit_amount, amount FROM recital_charges WHERE household_id = ? AND status = 'active' ORDER BY id",
    [householdId],
  );

  const feePeople: FeePerson[] = people.map((p) => {
    const pid = Number(p.id);
    const cs: FeeCast[] = castRows.filter((c) => Number(c.person_id) === pid).map((c) => ({
      status: String(c.status), fee_type: String(c.fee_type), work_status: String(c.work_status), work_code: String(c.work_code),
      title: String(c.title), extra_fee: c.extra_fee == null ? null : Number(c.extra_fee),
    }));
    const fc = p.fee_class_override == null ? null : String(p.fee_class_override);
    return { personId: pid, seq: Number(p.seq), feeClass: (fc !== null && FEE_CLASSES.includes(fc) ? fc : null) as FeeClass, ...feeCounts(cs) };
  });
  const active: (ChargeLine & { id: number })[] = activeRows.map((r) => ({
    id: Number(r.id), personId: r.person_id == null ? null : Number(r.person_id), itemCode: String(r.item_code), ref: String(r.ref ?? ''),
    label: String(r.label), qty: Number(r.qty), unitAmount: Number(r.unit_amount), amount: Number(r.amount),
  }));

  // 今の1人目＝base の行で、単価が first の base の規則の額と同じ行の人
  const firstBase = rules.find((r) => r.payer_role === 'first' && r.item_code === 'base');
  const firstLine = firstBase ? active.find((a) => a.itemCode === 'base' && a.unitAmount === firstBase.unit_amount && a.personId != null) : undefined;
  const currentFirst = firstLine?.personId ?? null;

  const expected = expectedCharges(rules, feePeople, currentFirst);
  const { add, voidIds } = diffCharges(active, expected.lines);
  const at = nowUtcIso();
  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  if (voidIds.length > 0) {
    stmts.push({
      sql: `UPDATE recital_charges SET status = 'void', void_reason = 'recompute', voided_at = ? WHERE id IN (${voidIds.map(() => '?').join(',')})`,
      args: [at, ...voidIds],
    });
  }
  for (const l of add) {
    stmts.push({
      sql: `INSERT INTO recital_charges (event_key, household_id, person_id, item_code, ref, label, qty, unit_amount, amount, due_on, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      args: [eventKey, householdId, l.personId, l.itemCode, l.ref, l.label, l.qty, l.unitAmount, l.amount, settings.pay_due, at],
    });
  }
  if (stmts.length > 0) await tx.batch(stmts);

  const sumOf = (xs: number[]) => Math.max(0, xs.reduce((a, b) => a + b, 0));
  const voided = new Set(voidIds);
  const totalBefore = sumOf(active.map((a) => a.amount));
  const totalAfter = sumOf([...active.filter((a) => !voided.has(a.id)).map((a) => a.amount), ...add.map((l) => l.amount)]);
  if (totalAfter !== totalBefore) {
    await logChangeTx(tx, { eventKey, householdId, action: 'total_changed', actor, before: { total: totalBefore }, after: { total: totalAfter } });
  }
  return { totalBefore, totalAfter, firstPersonId: expected.firstPersonId };
}

/** スタッフがメールアドレスを直す。鍵も作り直し（古い URL は使えない）、新しいアドレスへ URL のメールを送る */
export async function changeHouseholdEmail(householdId: number, email: string, staffName: string): Promise<{ token: string }> {
  const e = normalizeEmail(typeof email === 'string' ? email : '');
  if (!EMAIL_RE.test(e)) throw new Error('recital_entry:bad_email');
  const token = randomBytes(24).toString('hex');
  await withWriteTx(async (tx) => {
    const [h] = await rowsOf(tx, 'SELECT event_key FROM recital_households WHERE id = ?', [householdId]);
    if (!h) throw new Error('recital_entry:no_household');
    const eventKey = String(h.event_key);
    const dup = await rowsOf(
      tx,
      "SELECT id FROM recital_households WHERE event_key = ? AND email = ? AND status = 'active' AND id <> ? LIMIT 1",
      [eventKey, e, householdId],
    );
    if (dup.length > 0) throw new Error('recital_entry:same_email');
    await tx.execute({ sql: 'UPDATE recital_households SET email = ?, edit_token = ? WHERE id = ?', args: [e, token, householdId] });
    await logChangeTx(tx, { eventKey, householdId, action: 'email_edit', actor: staffName, after: { field: 'email' } });
    await logChangeTx(tx, { eventKey, householdId, action: 'token_regenerated', actor: staffName });
  });
  try {
    await sendRecitalMail({ kind: 'resend_url', householdId });
  } catch (err) {
    console.error(`[recital] URLのメールを送れませんでした household=${householdId}`, errText(err));
  }
  return { token };
}

/** 鍵（マイページの URL）を作り直す。メールは送らない（スタッフが URL を写す） */
export async function regenerateToken(householdId: number, staffName: string): Promise<{ token: string }> {
  const token = randomBytes(24).toString('hex');
  await withWriteTx(async (tx) => {
    const [h] = await rowsOf(tx, 'SELECT event_key FROM recital_households WHERE id = ?', [householdId]);
    if (!h) throw new Error('recital_entry:no_household');
    await tx.execute({ sql: 'UPDATE recital_households SET edit_token = ? WHERE id = ?', args: [token, householdId] });
    await logChangeTx(tx, { eventKey: String(h.event_key), householdId, action: 'token_regenerated', actor: staffName });
  });
  return { token };
}

// =====================================================================
// Task 14：マイページのインスタの欄（04 4-2「載せる名前・インスタ」・5-13、R-18）
// =====================================================================

const INSTA_MAX = 100;

/**
 * 家庭がマイページでインスタの欄を変える。鍵（edit_token）の完全一致の世帯の、生きている人だけ。
 * 前後の空白だけ取って生のまま入れる（空は null）。100字まで。受付を止めている間は ok:false（見るだけ）。
 * 締切のあとも変えられる。変更の控えのメールは送らない。変えた記録は insta_edit（前後の値は渡さない）。
 */
export async function updateInstaHandle(token: string, personId: number, handle: string | null): Promise<{ ok: boolean }> {
  if (handle !== null && typeof handle !== 'string') return { ok: false };
  const value = handle === null ? null : handle.trim() === '' ? null : handle.trim();
  if (value !== null && [...value].length > INSTA_MAX) return { ok: false };
  const d = await requireHouseholdByToken(token);
  if (!d || d.household.status !== 'active') return { ok: false };
  const pid = Number(personId);
  if (!d.people.some((p) => Number(p.id) === pid && p.status === 'active')) return { ok: false };
  const eventKey = d.household.event_key;
  const settings = await getRecitalSettings(eventKey);
  if (entryPhase(settings, Date.now(), d.household.extend_until) === 'suspended') return { ok: false };
  const householdId = Number(d.household.id);
  await withWriteTx(async (tx) => {
    await tx.execute({
      sql: "UPDATE recital_people SET insta_handle = ? WHERE id = ? AND household_id = ? AND status = 'active'",
      args: [value, pid, householdId],
    });
    await logChangeTx(tx, { eventKey, householdId, personId: pid, action: 'insta_edit', actor: 'family' });
  });
  return { ok: true };
}

// =====================================================================
// Task 17：作品の取りやめ（04 4-4「取りやめは、消さずに状態を変える」）
// =====================================================================

export type DropWorkResult =
  | { ok: true; households: number }
  | { ok: false; code: 'not_found' | 'count_changed' | 'paid_household'; count: number; households?: number };

/**
 * 作品を取りやめる（status を dropped にする）。段階1は、その作品に in で出る世帯に払った世帯（paid > 0）が
 * 1つでもあれば取りやめない（返す分4番が要り、それは後の計画）。confirmCount は画面に出した「申込の人数」
 * （in＋maybe・人 active・世帯 active）。今の数とちがえば count_changed（古い画面から押した）。
 * 取りやめたら、その作品に in／maybe で出る世帯の請求を作り直し、書き込みのあとで afterMoneyChanged を呼ぶ。
 * 家庭へのメールは出さない（作品がなくなる時の一言 7-9 は後の計画）。
 */
export async function dropWork(workId: number, confirmCount: number, staffName: string): Promise<DropWorkResult> {
  if (typeof staffName !== 'string' || !RECITAL_STAFF_NAMES.includes(staffName)) throw new Error('recital_works:staff_name');
  const out = await withWriteTx(async (tx): Promise<DropWorkResult & { householdIds?: number[] }> => {
    const [w] = await rowsOf(tx, 'SELECT id FROM recital_works WHERE id = ?', [workId]);
    if (!w) return { ok: false, code: 'not_found', count: 0 };
    const casts = await rowsOf(
      tx,
      `SELECT c.status, p.household_id FROM recital_casts c
       JOIN recital_people p ON p.id = c.person_id
       JOIN recital_households h ON h.id = p.household_id
       WHERE c.work_id = ? AND c.status IN ('in', 'maybe') AND p.status = 'active' AND h.status = 'active'`,
      [workId],
    );
    const count = casts.length;
    if (count !== confirmCount) return { ok: false, code: 'count_changed', count };
    const inHouseholds = [...new Set(casts.filter((c) => c.status === 'in').map((c) => Number(c.household_id)))];
    let paidHouseholds = 0;
    for (const hid of inHouseholds) {
      if ((await readHouseholdMoneyTx(tx, hid)).m.paid > 0) paidHouseholds++;
    }
    if (paidHouseholds > 0) return { ok: false, code: 'paid_household', count, households: paidHouseholds };
    await tx.execute({ sql: "UPDATE recital_works SET status = 'dropped' WHERE id = ?", args: [workId] });
    const householdIds = [...new Set(casts.map((c) => Number(c.household_id)))];
    for (const hid of householdIds) await recomputeChargesTx(tx, hid, staffName);
    return { ok: true, households: householdIds.length, householdIds };
  });
  if (!out.ok) return out;
  for (const hid of out.householdIds ?? []) {
    try {
      await afterMoneyChanged(hid, 'total');
    } catch (e) {
      console.error(`[recital] afterMoneyChanged に失敗しました household=${hid}`, errText(e));
    }
  }
  return { ok: true, households: out.households };
}

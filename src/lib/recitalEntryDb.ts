// BW6 発表会（段階1）の申込の「送る」と「送る前の確かめ」。
// 1回の書き込み（withWriteTx）で 世帯・人・出演・請求・変えた記録 を入れる。照合とメールは書き込みのあと。
// DB は src/lib/db.ts 経由だけ。名前と型の正本は .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
// 決まりの正本は設計書 03 3-4・05 5-2・04 4-2「送る」。記録の日時は UTC ISO（nowUtcIso）。
import { randomBytes } from 'node:crypto';
import { batch, getAll, getOne, withWriteTx } from '@/lib/db';
import { normalizeKana } from '@/lib/csvUtil';
import { isIsoDate, nowUtcIso, todayJst, weekdayJst } from '@/lib/dateJst';
import {
  ageOn,
  entryPhase,
  householdView,
  isCountedCast,
  normalizeEmail,
  normalizePhone,
  type FeeClass,
  type HouseholdView,
  type RecitalSettings,
} from '@/lib/recital';
import { getRecitalEvent, getRecitalSettings, listFeeRules, listWorks, loadMembersLite, logChangeTx, readMoneyViewTx, type WorkRow } from '@/lib/recitalDb';
import { expectedCharges, type FeePerson, type FeeRule } from '@/lib/recitalFee';
import { matchFeePreset, matchMember } from '@/lib/recitalMatch';
import { pickRef } from '@/lib/recitalRef';
import { sendRecitalMail } from '@/lib/recitalMail';

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

export async function buildEntryFeePeople(
  eventKey: string,
  people: FeeInputPerson[],
): Promise<{ rules: FeeRule[]; feePeople: FeePerson[]; presetClasses: FeeClass[] }> {
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
  const feePeople: FeePerson[] = people.map((p, i) => {
    let counted = 0;
    const extraWorks: FeePerson['extraWorks'] = [];
    for (const c of p.works) {
      const w = works.get(c.workId);
      if (!w) continue;
      if (isCountedCast({ fee_type: w.fee_type, status: w.status }, { status: c.status })) counted++;
      if (w.fee_type === 'extra' && w.status !== 'dropped' && c.status === 'in') {
        extraWorks.push({ workCode: w.work_code, label: w.title, fee: Number(w.extra_fee ?? 0) });
      }
    }
    return { personId: i + 1, seq: i + 1, feeClass: presetClasses[i], counted, extraWorks };
  });
  return { rules, feePeople, presetClasses };
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
  // 1. 受付の状態
  const event = await getRecitalEvent(s.eventKey);
  if (!event) return fail('invalid');
  const settings = await getRecitalSettings(s.eventKey);
  const phase = entryPhase(settings, now.getTime());
  if (phase === 'before') return { ok: false, code: 'before', message: beforeMessage(settings.entry_open_at) };
  if (phase !== 'open') return fail(phase);

  // 2. 中身
  if (typeof s.submitKey !== 'string' || !SUBMIT_KEY_RE.test(s.submitKey)) return fail('invalid');
  const today = todayJst(now);
  const works = new Map((await listWorks(s.eventKey)).map((w) => [Number(w.id), w]));
  const errors = validate(s, settings, works, today);
  if (Object.keys(errors).length > 0) return fail('invalid', errors);

  // 同じ submit_key の2回目は、同じ電話・同じ人の確かめより先に1回目の結果を返す（1回目の世帯に当たって止まらないため）
  const prior = await getOne('SELECT id FROM recital_households WHERE submit_key = ?', [s.submitKey]);
  if (prior) return replayResult(Number(prior.id));

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

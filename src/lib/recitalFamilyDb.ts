// BW6 発表会（段階1）の家庭の画面（/bw6/entry など）が読む物（Task 13）。サーバ専用（DB を読む）。
// client の部品からは型だけ（import type）を読む。
// 金額は「送る」（recitalEntryDb.ts の submitEntry）と同じ材料・同じ関数で出す（計算を2か所に書かない）。
// URL の送り直しは、申込があるかを返り値の数でしか返さない（宛先も世帯の番号も返さない。画面には出さない）。
import { execute, getAll } from '@/lib/db';
import { nowUtcIso } from '@/lib/dateJst';
import { normalizeEmail, normalizePhone } from '@/lib/recital';
import { applyHouseholdEdits, buildEntryFeePeople, type HouseholdEdit } from '@/lib/recitalEntryDb';
import { requireHouseholdByToken } from '@/lib/recitalGuard';
import { expectedCharges, type ChargeLine } from '@/lib/recitalFee';
import { sendRecitalMail } from '@/lib/recitalMail';

export type PublicWork = {
  id: number; workCode: string; title: string; classLabel: string; slotLabel: string; targetLabel: string; publicNote: string;
  feeType: string; extraFee: number | null; status: 'open' | 'draft'; instructors: string[];
};

/** フォームに出す作品（entry_mode='form' かつ open／draft）。並びは sort_order, id。担当イントラは sort_order の順 */
export async function listPublicWorks(eventKey: string): Promise<PublicWork[]> {
  const rows = await getAll(
    `SELECT id, work_code, title, class_label, slot_label, target_label, public_note, fee_type, extra_fee, status
     FROM recital_works WHERE event_key = ? AND entry_mode = 'form' AND status IN ('open', 'draft') ORDER BY sort_order, id`,
    [eventKey],
  );
  const ins = await getAll(
    'SELECT work_id, display_name FROM recital_work_instructors WHERE event_key = ? ORDER BY sort_order, id',
    [eventKey],
  );
  const byWork = new Map<number, string[]>();
  for (const r of ins) {
    const id = Number(r.work_id);
    const list = byWork.get(id) ?? [];
    list.push(String(r.display_name));
    byWork.set(id, list);
  }
  const s = (v: unknown) => (v == null ? '' : String(v));
  return rows.map((r) => ({
    id: Number(r.id),
    workCode: String(r.work_code),
    title: String(r.title),
    classLabel: s(r.class_label),
    slotLabel: s(r.slot_label),
    targetLabel: s(r.target_label),
    publicNote: s(r.public_note),
    feeType: String(r.fee_type),
    extraFee: r.extra_fee == null ? null : Number(r.extra_fee),
    status: String(r.status) === 'open' ? 'open' : 'draft',
    instructors: byWork.get(Number(r.id)) ?? [],
  }));
}

// 漢字の名前も渡す（matchFeePreset が漢字だけ合う人を suspect にするため）
export type QuotePerson = {
  lastName: string; firstName: string; lastKana: string; firstKana: string; birthday: string | null;
  works: { workId: number; status: 'in' | 'maybe' }[];
};

/**
 * 画面3・5 の金額。書かない。材料は submitEntry と同じ buildEntryFeePeople、計算は同じ expectedCharges。
 * 材料（規則・作品・事前登録・会員）は1回だけ読み、照合の結果を両方の計算に使う。
 * personId は people の並びの番号（1から）。フォームで選べない作品（form かつ open でない）は数えない。
 * totalIfAllIn は、迷っている作品を全部「出る」にしたときの合計。
 */
export async function quoteEntry(eventKey: string, people: QuotePerson[]): Promise<{ lines: ChargeLine[]; total: number; totalIfAllIn: number }> {
  const { rules, feePeople, feePeopleAllIn } = await buildEntryFeePeople(eventKey, people, { formOpenOnly: true, withAllIn: true });
  const charges = expectedCharges(rules, feePeople, null);
  const totalIfAllIn = feePeopleAllIn ? expectedCharges(rules, feePeopleAllIn, null).total : charges.total;
  return { lines: charges.lines, total: charges.total, totalIfAllIn };
}

/**
 * マイページの URL を、生きている世帯の登録のメールへ送り直す（resend_url）。
 * メール・電話は normalizeEmail／normalizePhone でそろえてから、世帯の値（7 が同じ形で入れている）と一致でくらべる。
 * 返す sent は sendRecitalMail を呼んだ世帯の数（記録が failed でも数える）。宛先・世帯の番号は返さない。
 */
export async function resendMyPageUrl(eventKey: string, by: { email: string } | { phone: string }): Promise<{ sent: number }> {
  let rows;
  if ('email' in by) {
    const email = normalizeEmail(by.email ?? '');
    if (email === '') return { sent: 0 };
    rows = await getAll("SELECT id FROM recital_households WHERE event_key = ? AND email = ? AND status = 'active' ORDER BY id", [eventKey, email]);
  } else {
    const phone = normalizePhone(by.phone ?? '');
    if (phone === '') return { sent: 0 };
    rows = await getAll("SELECT id FROM recital_households WHERE event_key = ? AND phone = ? AND status = 'active' ORDER BY id", [eventKey, phone]);
  }
  let sent = 0;
  for (const r of rows) {
    const householdId = Number(r.id);
    sent++;
    try {
      await sendRecitalMail({ kind: 'resend_url', householdId });
    } catch (e) {
      console.error(`[recital] URLのメールを送れませんでした household=${householdId}`, e instanceof Error ? e.message : String(e));
    }
  }
  return { sent };
}

/**
 * マイページを開いた印（Task 14）。opened_at は初めの1回だけ。控えのメールのリンク（&from=mail）から開いた時は
 * mail_opened_at も初めの1回だけ入れる。値は nowUtcIso。変えた記録は書かない。
 */
export async function markMyPageOpened(householdId: number, fromMail: boolean, now: Date = new Date()): Promise<void> {
  const at = nowUtcIso(now);
  if (fromMail) {
    await execute(
      'UPDATE recital_households SET opened_at = COALESCE(opened_at, ?), mail_opened_at = COALESCE(mail_opened_at, ?) WHERE id = ?',
      [at, at, householdId],
    );
  } else {
    await execute('UPDATE recital_households SET opened_at = COALESCE(opened_at, ?) WHERE id = ?', [at, householdId]);
  }
}

// ---------- マイページの「作品を足す・やめる」（Task 15。12/8 に出すか決める。出さない時はこの欄ごと git revert で抜く） ----------

export type FamilyEdit = { personId: number; workId: number; status: 'in' | 'out' };

type FamilyEditFail = 'closed' | 'max_works' | 'paid_no_maybe' | 'last_work' | 'invalid';

/** 家庭の変更を 8 の形（cast_set）にする。家庭から来た物の type などは持ち込まない（3つの欄だけを写す） */
const toCastSets = (edits: FamilyEdit[]): HouseholdEdit[] =>
  edits.map((e) => ({ type: 'cast_set' as const, personId: e.personId, workId: e.workId, status: e.status }));

/**
 * 「金額を見る」。書かない。8 の applyHouseholdEdits を dryRun で呼んで返すだけ（確かめも計算も決定と同じ関数。写さない）。
 * 呼ぶ側が鍵で世帯を引いてから householdId を渡す。
 */
export async function previewHouseholdEdits(
  householdId: number,
  edits: FamilyEdit[],
  now: Date = new Date(),
): Promise<{ ok: true; totalBefore: number; totalAfter: number; remainingBefore: number; remainingAfter: number } | { ok: false; code: FamilyEditFail; message: string }> {
  const r = await applyHouseholdEdits(householdId, toCastSets(edits), { actor: 'family', by: 'family', now, dryRun: true });
  if (!r.ok) return r;
  if (!('remainingBefore' in r)) throw new Error('recital_family:dry_run_shape');
  return { ok: true, totalBefore: r.totalBefore, totalAfter: r.totalAfter, remainingBefore: r.remainingBefore, remainingAfter: r.remainingAfter };
}

/**
 * 「決定する」。鍵（edit_token）で世帯を引き（見つからなければ not_found）、8 の applyHouseholdEdits を家庭として呼んで返すだけ。
 * その世帯の人か・足す作品が form かつ open か・変えてよい時か（canFamilyEdit）・まとめた世帯でないかは 8 が確かめる（ここで重ねて書かない）。
 * 変更の控えのメール1通と afterMoneyChanged も 8 が中でする（ここでは送らない・呼ばない）。
 */
export async function applyFamilyWorkEdits(
  token: string,
  edits: FamilyEdit[],
  now: Date = new Date(),
): Promise<{ ok: true; totalBefore: number; totalAfter: number } | { ok: false; code: 'not_found' | FamilyEditFail; message: string }> {
  const d = await requireHouseholdByToken(token);
  if (!d) return { ok: false, code: 'not_found', message: 'お申し込みが見つかりません' };
  const r = await applyHouseholdEdits(Number(d.household.id), toCastSets(edits), { actor: 'family', by: 'family', now });
  if (!r.ok) return r;
  return { ok: true, totalBefore: r.totalBefore, totalAfter: r.totalAfter };
}

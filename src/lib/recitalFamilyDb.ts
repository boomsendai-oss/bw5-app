// BW6 発表会（段階1）の家庭の画面（/bw6/entry など）が読む物（Task 13）。サーバ専用（DB を読む）。
// client の部品からは型だけ（import type）を読む。
// 金額は「送る」（recitalEntryDb.ts の submitEntry）と同じ材料・同じ関数で出す（計算を2か所に書かない）。
// URL の送り直しは、申込があるかを返り値の数でしか返さない（宛先も世帯の番号も返さない。画面には出さない）。
import { getAll } from '@/lib/db';
import { normalizeEmail, normalizePhone } from '@/lib/recital';
import { buildEntryFeePeople } from '@/lib/recitalEntryDb';
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

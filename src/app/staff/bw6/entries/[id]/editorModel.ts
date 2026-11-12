// BW6 発表会のスタッフの「代わりに直す」の中身の決め方（純関数。client の部品と Server Action と試験が使う）。
// 欄の差分は「開いた時に写した値（base）」と「今の欄（cur）」でとる。開くたびに、その時の画面の値から写し直す
// （前の直しのあとで古い値と比べると、前の直しを黙って戻す差分ができるため）。
import { moneySummary } from '@/lib/recital';
import type { HouseholdEdit } from '@/lib/recitalEntryDb';

export type EditorPerson = {
  id: number; last_name: string; first_name: string; last_kana: string; first_kana: string; birthday: string; display_name: string;
  tshirt_size: string; insta_handle: string; name_ok: number; photo_ok: number; sns_ok: number; staff_note: string;
};
export type EditorContact = {
  contact_last_name: string; contact_first_name: string; contact_last_kana: string; contact_first_kana: string; phone: string; staff_note: string;
};
/** 出演の今の状態（'' は出演の行なし。'' と passed〔見送り〕は今の値を出すだけで、送るのは出る／迷っている／やめた） */
export type CastValue = '' | 'in' | 'maybe' | 'out' | 'passed';

export type EditorState = { people: EditorPerson[]; casts: Record<string, CastValue>; contact: EditorContact };

export const castKey = (personId: number, workId: number) => `${personId}:${workId}`;

/** 画面の値から、欄の値の写しを作る（開いた時に毎回呼ぶ。中の物を共有しない） */
export function editorStateFrom(x: EditorState): EditorState {
  return { people: x.people.map((p) => ({ ...p })), casts: { ...x.casts }, contact: { ...x.contact } };
}

/** 変わった欄だけを HouseholdEdit[] にする（空の Tシャツ・インスタは null） */
export function buildEdits(base: EditorState, cur: EditorState): HouseholdEdit[] {
  const edits: HouseholdEdit[] = [];
  for (const p of cur.people) {
    const p0 = base.people.find((x) => x.id === p.id);
    if (!p0) continue;
    const fields: Record<string, string | number | null> = {};
    for (const k of Object.keys(p) as (keyof EditorPerson)[]) {
      if (k === 'id' || p[k] === p0[k]) continue;
      const v = p[k];
      fields[k] = (k === 'tshirt_size' || k === 'insta_handle') && v === '' ? null : v;
    }
    if (Object.keys(fields).length > 0) edits.push({ type: 'person', personId: p.id, fields } as HouseholdEdit);
  }
  for (const [k, v] of Object.entries(cur.casts)) {
    if (v === (base.casts[k] ?? '') || v === '' || v === 'passed') continue;
    const [personId, workId] = k.split(':').map(Number);
    edits.push({ type: 'cast_set', personId, workId, status: v });
  }
  const cf: Record<string, string> = {};
  for (const k of Object.keys(cur.contact) as (keyof EditorContact)[]) if (cur.contact[k] !== base.contact[k]) cf[k] = cur.contact[k];
  if (Object.keys(cf).length > 0) edits.push({ type: 'contact', fields: cf } as HouseholdEdit);
  return edits;
}

/** 書く前の確かめに出す、お金の前→あと（K227）。paid は今の払った額（返す分 todo を引いた額）。式は moneySummary */
export type EditPreview = {
  totalBefore: number; totalAfter: number; remainingBefore: number; remainingAfter: number;
  overpaidBefore: number; overpaidAfter: number; extra: number;
};

export function editPreview(totalBefore: number, totalAfter: number, paid: number): EditPreview {
  const at = (total: number) => moneySummary({ chargeAmounts: [total], paymentAmounts: [paid], refundTodoAmounts: [] });
  const b = at(totalBefore);
  const a = at(totalAfter);
  return {
    totalBefore: b.total, totalAfter: a.total, remainingBefore: b.remaining, remainingAfter: a.remaining,
    overpaidBefore: b.overpaid, overpaidAfter: a.overpaid, extra: Math.max(0, a.remaining - b.remaining),
  };
}

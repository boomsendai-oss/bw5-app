'use server';

// BW6 発表会のスタッフの「設定」の画面の Server Actions。/staff/* は proxy（cookie の有無）で覆われているが、
// proxy は DB を見られないので requireRecitalStaff() でセッションを必ず本検証する（規約4.5）。
// pay_ok_at を入れるのは openPayAction（setPayOk）だけ。saveSettingAction は checkSettingValue が LOCKED・suspended・stripe_mode を拒む（K224）。
// 料金の規則は、この画面からは金額・数・名前・仮だけを直す（何作品目の範囲・役・種類は今の行のまま）。
import { revalidatePath } from 'next/cache';
import { RECITAL_EVENT, RECITAL_STAFF_NAMES, checkSettingValue, pickStaffEventKey } from '@/lib/recital';
import {
  deleteFeePreset,
  getRecitalEvent,
  getRecitalSettings,
  listFeeRules,
  resetTestEvent,
  saveFeePreset,
  saveFeeRule,
  saveRecitalSetting,
  searchMembers,
  setPayOk,
  setSuspended,
} from '@/lib/recitalDb';
import type { FeeRule } from '@/lib/recitalFee';
import { requireRecitalStaff } from '@/lib/recitalGuard';
import type { MemberLite } from '@/lib/recitalMatch';
import { recitalPreviewKey } from '@/lib/recitalPreview';

type Result = { ok: true } | { ok: false; error: string };

const NAME_ERROR = '名前を選んでください';
const PRESET_CLASSES: readonly string[] = ['no_coop', 'tshirt_only', 'free'];
const MEMO_MAX = 200;

function isStaffName(v: unknown): v is string {
  return typeof v === 'string' && RECITAL_STAFF_NAMES.includes(v);
}

function done(): void {
  revalidatePath('/staff/bw6/settings');
  revalidatePath('/staff/bw6');
}

const OPEN_REASON_TEXT: Record<string, string> = {
  fee_check: '検算が合いません。料金の規則を直してください',
  tentative: '仮の金額の行があります',
  consent_empty: '同意の文が空です',
  privacy_empty: '使い道の知らせ（privacy_text）が空です',
  line_empty: '公式LINEのURL（line_url）が空です',
};

/** 設定を1つの鍵ずつ保存する。pay_ok_at・bank_audit_done_at・suspended・stripe_mode は checkSettingValue が拒む */
export async function saveSettingAction(ev: string, key: string, value: string, staffName: string): Promise<Result> {
  await requireRecitalStaff();
  if (!isStaffName(staffName)) return { ok: false, error: NAME_ERROR };
  const eventKey = pickStaffEventKey(ev);
  if (typeof key !== 'string' || typeof value !== 'string') return { ok: false, error: '入力を確かめてください' };
  const v = value.trim();
  const msg = checkSettingValue(key, v);
  if (msg !== null) return { ok: false, error: msg };
  try {
    await saveRecitalSetting(eventKey, key, v, staffName);
  } catch {
    return { ok: false, error: '保存できませんでした' };
  }
  done();
  return { ok: true };
}

/** 受付を開ける（suspended を 0 に）。setSuspended が検算・仮の金額・同意・使い道の知らせ・公式LINE を見る */
export async function openEntryAction(ev: string, staffName: string): Promise<Result> {
  await requireRecitalStaff();
  if (!isStaffName(staffName)) return { ok: false, error: NAME_ERROR };
  const r = await setSuspended(pickStaffEventKey(ev), false, staffName);
  if (!r.ok) return { ok: false, error: OPEN_REASON_TEXT[r.reason ?? ''] ?? '開けられませんでした' };
  done();
  return { ok: true };
}

/** 受付を止める（suspended を 1 に） */
export async function suspendEntryAction(ev: string, staffName: string): Promise<Result> {
  await requireRecitalStaff();
  if (!isStaffName(staffName)) return { ok: false, error: NAME_ERROR };
  await setSuspended(pickStaffEventKey(ev), true, staffName);
  done();
  return { ok: true };
}

/**
 * 支払いを開ける（pay_ok_at を入れる。K224）。TARO の返事と本番の少額の試しの2つに印が要る。
 * 本番の発表会（is_test=0）は stripe_mode が live でなければ拒む（試しのカードで払えたことにしない）。
 * 振込先（bank_text）が空の時は「カードだけで開けてよい」も要る（4-9・K210）。戻すボタンは作らない。
 */
export async function openPayAction(
  ev: string,
  answers: { replied: boolean; smokeOk: boolean; cardOnlyOk?: boolean },
  staffName: string,
): Promise<{ ok: true; payOkAt: string } | { ok: false; error: string }> {
  await requireRecitalStaff();
  if (!isStaffName(staffName)) return { ok: false, error: NAME_ERROR };
  const eventKey = pickStaffEventKey(ev);
  if (answers?.replied !== true || answers?.smokeOk !== true) return { ok: false, error: '2つの確かめに印を付けてください' };
  const s = await getRecitalSettings(eventKey);
  // 本番の発表会（is_test=0。行が無い時も本番あつかい）で、カードが試しのモードのまま開けると、家庭が試しのカードで「払えた」になる
  const event = await getRecitalEvent(eventKey);
  if (event?.is_test !== 1 && s.stripe_mode !== 'live') {
    return { ok: false, error: '本番の発表会なのに、カードが試しのモードです。開けられません。' };
  }
  if (s.bank_text.trim() === '' && answers.cardOnlyOk !== true) {
    return { ok: false, error: '振込先（bank_text）が空です。「カードだけで開けてよい」にも印を付けてください' };
  }
  await setPayOk(eventKey, staffName);
  const after = await getRecitalSettings(eventKey);
  done();
  return { ok: true, payOkAt: after.pay_ok_at ?? '' };
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** 料金の規則の1行を直す。画面から受けるのは金額・数・名前・仮だけ（範囲・役・種類・並びは今の行のまま） */
export async function saveFeeRuleAction(
  ev: string,
  rule: Pick<FeeRule, 'unit_amount' | 'qty' | 'label' | 'is_tentative'> & { id: number },
  staffName: string,
): Promise<Result> {
  await requireRecitalStaff();
  if (!isStaffName(staffName)) return { ok: false, error: NAME_ERROR };
  const eventKey = pickStaffEventKey(ev);
  if (!rule || !isInt(rule.id)) return { ok: false, error: '画面を開き直してください' };
  const cur = (await listFeeRules(eventKey)).find((r) => r.id === rule.id);
  if (!cur) return { ok: false, error: '規則の行が見つかりません。画面を開き直してください' };
  const r = await saveFeeRule(
    eventKey,
    {
      ...cur,
      unit_amount: rule.unit_amount,
      qty: rule.qty,
      label: typeof rule.label === 'string' ? rule.label : '',
      is_tentative: rule.is_tentative === 1 ? 1 : 0,
    },
    staffName,
  );
  if (!r.ok) {
    return {
      ok: false,
      error: r.code === 'opened'
        ? '受付を開けたあとは、料金の規則は変えられません'
        : '入力を確かめてください（金額は0以上の整数、数は1以上の整数、名前は空にしない）',
    };
  }
  done();
  return { ok: true };
}

/** 会員を探す（名前・カナ）。20件まで */
export async function searchMembersAction(q: string): Promise<MemberLite[]> {
  await requireRecitalStaff();
  if (typeof q !== 'string') return [];
  return searchMembers(q.slice(0, 50));
}

/** 特別な料金の事前登録を入れる（同じ会員なら種類とメモを直す） */
export async function saveFeePresetAction(
  ev: string,
  x: { memberId: number; feeClass: 'no_coop' | 'tshirt_only' | 'free'; memo: string | null },
  staffName: string,
): Promise<Result> {
  await requireRecitalStaff();
  if (!isStaffName(staffName)) return { ok: false, error: NAME_ERROR };
  const eventKey = pickStaffEventKey(ev);
  if (!x || !isInt(x.memberId)) return { ok: false, error: '会員を選んでください' };
  if (!PRESET_CLASSES.includes(x.feeClass)) return { ok: false, error: '種類を選んでください' };
  const memo = typeof x.memo === 'string' ? x.memo.trim() : '';
  if ([...memo].length > MEMO_MAX) return { ok: false, error: `メモは${MEMO_MAX}字までにしてください` };
  const r = await saveFeePreset(eventKey, { memberId: x.memberId, feeClass: x.feeClass, memo: memo === '' ? null : memo }, staffName);
  if (!r.ok) return { ok: false, error: '会員が見つかりません。探し直してください' };
  done();
  return { ok: true };
}

/** 特別な料金の事前登録を消す（その発表会の行だけ） */
export async function deleteFeePresetAction(ev: string, id: number, staffName: string): Promise<Result> {
  await requireRecitalStaff();
  if (!isStaffName(staffName)) return { ok: false, error: NAME_ERROR };
  if (!isInt(id)) return { ok: false, error: '画面を開き直してください' };
  await deleteFeePreset(pickStaffEventKey(ev), id, staffName);
  done();
  return { ok: true };
}

/**
 * 試し用のURLのパス（画面で location.origin を前に付ける）。形は 12（src/app/bw6/context.ts）の受け方に合わせる：
 * is_test=1 の発表会は ?ev=&pv=、本番（bw6）は ?pv= だけ。ほかは作らない（空を返す）。
 */
export async function previewPathAction(ev: string): Promise<{ path: string }> {
  await requireRecitalStaff();
  const eventKey = pickStaffEventKey(ev);
  const event = await getRecitalEvent(eventKey);
  if (event?.is_test === 1) {
    return { path: `/bw6/entry?ev=${encodeURIComponent(eventKey)}&pv=${recitalPreviewKey(eventKey)}` };
  }
  if (eventKey === RECITAL_EVENT.live) return { path: `/bw6/entry?pv=${recitalPreviewKey(eventKey)}` };
  return { path: '' };
}

/** テストデータを消す。試しの発表会（bw6-test・is_test=1）だけ。dryRun は数えるだけ。resetTestEvent の文の中にも is_test の守りがある */
export async function resetTestDataAction(
  ev: string,
  dryRun: boolean,
  staffName: string,
): Promise<{ ok: true; counts: Record<string, number> } | { ok: false; error: string }> {
  await requireRecitalStaff();
  if (!isStaffName(staffName)) return { ok: false, error: NAME_ERROR };
  const eventKey = pickStaffEventKey(ev);
  if (eventKey !== RECITAL_EVENT.test) return { ok: false, error: '試しの発表会でだけ使えます' };
  const event = await getRecitalEvent(eventKey);
  if (event?.is_test !== 1) return { ok: false, error: '試しの発表会でだけ使えます' };
  const counts = await resetTestEvent(eventKey, { dryRun: dryRun !== false });
  if (dryRun === false) done();
  return { ok: true, counts };
}

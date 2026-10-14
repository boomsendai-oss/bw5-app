'use server';

// クリスマスパーティー2026 スタッフ専用 Server Actions。/staff/* はproxy(cookie存在チェック)で
// 覆われているが、proxyはDBを見られないため isAuthorizedServer() による本検証をここで必ず行う(規約4.5)。
import { revalidatePath } from 'next/cache';
import { isAuthorizedServer } from '@/lib/eventAuth';
import {
  PARTY_EVENT_KEY,
  isValidJstLocal,
  type PartySettings,
} from '@/lib/party';
import {
  getPartySettings,
  restorePartyOrderStaff,
  savePartySettings,
  setPartyOrderStatusStaff,
  setPartyStaffNote,
} from '@/lib/partyDb';
import { addLedgerEntry, deleteLedgerEntry, listLedger } from '@/lib/eventLedgerDb';

const EV = PARTY_EVENT_KEY;

async function requireStaff(): Promise<void> {
  if (!(await isAuthorizedServer())) throw new Error('Unauthorized');
}

type Result = { ok: true } | { ok: false; error: string };

export interface XmasSettingsInput {
  openAt: string;
  ticketCardDeadline: string;
  ticketCashDeadline: string;
  entryDeadline: string;
  audioDeadline: string;
  presalePrice: number;
  doorPrice: number;
  performerFee: number;
  teamCap: number;
  venueFee: number;
  suspended: boolean;
}

export async function saveXmasSettings(input: XmasSettingsInput): Promise<Result> {
  await requireStaff();
  if (input.openAt && !isValidJstLocal(input.openAt)) return { ok: false, error: '公開日時の形式が正しくありません' };
  for (const [label, v] of [
    ['カード前売の締切', input.ticketCardDeadline],
    ['当日現金予約の締切', input.ticketCashDeadline],
    ['エントリー締切', input.entryDeadline],
    ['音源の締切', input.audioDeadline],
  ] as const) {
    if (!isValidJstLocal(v)) return { ok: false, error: `${label}の形式が正しくありません` };
  }
  for (const [label, v, min] of [
    ['前売料金', input.presalePrice, 0],
    ['当日料金', input.doorPrice, 0],
    ['出演料', input.performerFee, 0],
    ['チーム上限', input.teamCap, 1],
    ['会場費', input.venueFee, 0],
  ] as const) {
    if (!Number.isInteger(v) || v < min) return { ok: false, error: `${label}は${min}以上の整数で入力してください` };
  }
  const s: PartySettings = { ...input, suspended: Boolean(input.suspended) };
  await savePartySettings(EV, s);
  revalidatePath('/staff/xmas');
  revalidatePath('/xmas');
  return { ok: true };
}

export async function setXmasOrderStatus(id: number, action: 'canceled' | 'refunded' | 'restore'): Promise<Result> {
  await requireStaff();
  const ok = action === 'restore' ? await restorePartyOrderStaff(id) : await setPartyOrderStatusStaff(id, action);
  revalidatePath('/staff/xmas');
  return ok ? { ok: true } : { ok: false, error: 'この状態からは変更できません' };
}

export async function setXmasNote(id: number, note: string): Promise<Result> {
  await requireStaff();
  await setPartyStaffNote(id, note);
  revalidatePath('/staff/xmas');
  return { ok: true };
}

// ---- 精算・収支(event_ledger に event_key='xmas2026' で記録) ----

const CAT_CASH = 'キャッシャー回収';
const CAT_VENUE = '会場費';

export async function saveXmasSettlement(input: { walkinCount: number; actualCash: number; staffName: string }): Promise<Result> {
  await requireStaff();
  const staffName = input.staffName.trim();
  // 担当者名は必須(BF6で担当欄が空の「集金済み」が¥2,500合わなかった事故の対策)
  if (!staffName) return { ok: false, error: '入力した人の名前を入れてください' };
  if (!Number.isInteger(input.walkinCount) || input.walkinCount < 0) return { ok: false, error: '当日券の人数を0以上で入力してください' };
  if (!Number.isInteger(input.actualCash) || input.actualCash < 0) return { ok: false, error: '現金の実額を0以上で入力してください' };
  const s = await getPartySettings(EV);
  // 精算はやり直せるように、前回の精算行を消してから入れ直す
  for (const e of await listLedger(EV)) {
    if (e.category === CAT_CASH || e.category === CAT_VENUE) await deleteLedgerEntry(e.id);
  }
  const stamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  await addLedgerEntry({
    eventKey: EV, kind: 'income', category: CAT_CASH, label: '当日現金(キャッシャー回収・当日券含む)',
    qty: 1, unitAmount: input.actualCash, amount: input.actualCash, collected: true,
    note: `当日券${input.walkinCount}人 / 入力: ${staffName} / ${stamp}`, sortOrder: 0,
  });
  await addLedgerEntry({
    eventKey: EV, kind: 'cost', category: CAT_VENUE, label: 'SPACE ZERO 会場費(キャッシャー回収と相殺)',
    qty: 1, unitAmount: s.venueFee, amount: s.venueFee, collected: true,
    note: `入力: ${staffName} / ${stamp}`, sortOrder: 0,
  });
  revalidatePath('/staff/xmas/settlement');
  return { ok: true };
}

export async function addXmasCost(input: { label: string; amount: number; staffName: string }): Promise<Result> {
  await requireStaff();
  const label = input.label.trim();
  if (!label) return { ok: false, error: '内容を入れてください' };
  if (!input.staffName.trim()) return { ok: false, error: '入力した人の名前を入れてください' };
  if (!Number.isInteger(input.amount) || input.amount <= 0) return { ok: false, error: '金額を1以上で入力してください' };
  await addLedgerEntry({
    eventKey: EV, kind: 'cost', category: 'その他', label, qty: 1, unitAmount: input.amount, amount: input.amount,
    collected: false, note: `入力: ${input.staffName.trim()}`, sortOrder: 10,
  });
  revalidatePath('/staff/xmas/settlement');
  return { ok: true };
}

export async function deleteXmasLedger(id: number): Promise<Result> {
  await requireStaff();
  const mine = (await listLedger(EV)).some((e) => e.id === id);
  if (!mine) return { ok: false, error: '見つかりません' };
  await deleteLedgerEntry(id);
  revalidatePath('/staff/xmas/settlement');
  return { ok: true };
}

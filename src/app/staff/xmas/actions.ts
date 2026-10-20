'use server';

// クリスマスパーティー2026 スタッフ専用 Server Actions。/staff/* はproxy(cookie存在チェック)で
// 覆われているが、proxyはDBを見られないため isAuthorizedServer() による本検証をここで必ず行う(規約4.5)。
import { revalidatePath } from 'next/cache';
import { isAuthorizedServer } from '@/lib/eventAuth';
import {
  PARTY_EVENT_KEY,
  audioOpen,
  isValidJstLocal,
  type PartySettings,
} from '@/lib/party';
import {
  getPartySettings,
  restorePartyOrderStaff,
  savePartySettings,
  setPartyOrderStatusStaff,
  setPartyStaffNote,
  listEntriesMissingAudio,
  listPartyOrdersStaff,
  markAudioReminded,
  markEntryTicketNoticed,
  ENTRY_TICKET_NOTICE_MARK,
} from '@/lib/partyDb';
import { buildAudioReminderEmail, buildEntryTicketNoticeEmail, sendPartyMail } from '@/lib/partyEmail';
import { addLedgerEntry, deleteLedgerEntry, listLedger } from '@/lib/eventLedgerDb';

const EV = PARTY_EVENT_KEY;

async function requireStaff(): Promise<void> {
  if (!(await isAuthorizedServer())) throw new Error('Unauthorized');
}

type Result = { ok: true } | { ok: false; error: string };

export interface XmasSettingsInput {
  openAt: string;
  ticketOpenAt: string;
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
  if (input.openAt && !isValidJstLocal(input.openAt)) return { ok: false, error: 'エントリー受付開始の形式が正しくありません' };
  if (input.ticketOpenAt && !isValidJstLocal(input.ticketOpenAt)) return { ok: false, error: 'チケット予約の受付開始の形式が正しくありません' };
  for (const [label, v] of [
    ['カード前売の締切', input.ticketCardDeadline],
    ['当日現金予約の締切', input.ticketCashDeadline],
    ['エントリー締切', input.entryDeadline],
    ['音源の締切', input.audioDeadline],
  ] as const) {
    if (!isValidJstLocal(v)) return { ok: false, error: `${label}の形式が正しくありません` };
  }
  for (const [label, v, min] of [
    ['前売料金', input.presalePrice, 1],
    ['当日料金', input.doorPrice, 1],
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
  if (action === 'restore') {
    const r = await restorePartyOrderStaff(id, (await getPartySettings(EV)).teamCap);
    revalidatePath('/staff/xmas');
    return r;
  }
  const ok = await setPartyOrderStatusStaff(id, action);
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

/** 音源が未提出の確定エントリーへ、提出ページのURLつきリマインドを送る。押した人の名前は必須。 */
export async function sendXmasAudioReminders(staffName: string): Promise<{ ok: true; sent: number; failed: number } | { ok: false; error: string }> {
  await requireStaff();
  if (!staffName.trim()) return { ok: false, error: '送る人の名前を入れてください' };
  const s = await getPartySettings(EV);
  if (!audioOpen(s, new Date())) return { ok: false, error: '音源の提出締切を過ぎているため送れません' };
  let sent = 0;
  let failed = 0;
  for (const { order, token } of await listEntriesMissingAudio(EV)) {
    const ok = await sendPartyMail(order.email, buildAudioReminderEmail(order, token, s), 'audio-reminder');
    if (ok) {
      await markAudioReminded(order.id);
      sent += 1;
    } else {
      failed += 1;
    }
    // Gmailの連続送信制限(421)を避ける(BF6の一斉送信と同じ間隔)
    await new Promise((r) => setTimeout(r, 900));
  }
  console.log(`[party] audio reminders by staff: sent=${sent} failed=${failed}`);
  revalidatePath('/staff/xmas');
  return { ok: true, sent, failed };
}

/** 入場チケットのお願いを送る対象: 確定済みの出演エントリーで、まとめ買いの入場チケットがメンバー数より少なく、まだ送っていないチーム。 */
function needsEntryTicketNotice(o: { kind: string; status: string; peopleCount: number; memberCount: number; staffNote: string }): boolean {
  return (
    o.kind === 'entry' &&
    (o.status === 'paid' || o.status === 'cash_due') &&
    o.peopleCount < o.memberCount &&
    !(o.staffNote ?? '').includes(ENTRY_TICKET_NOTICE_MARK)
  );
}

export async function sendXmasEntryTicketNotices(staffName: string): Promise<{ ok: true; sent: number; failed: number } | { ok: false; error: string }> {
  await requireStaff();
  if (!staffName.trim()) return { ok: false, error: '送る人の名前を入れてください' };
  const s = await getPartySettings(EV);
  let sent = 0;
  let failed = 0;
  for (const o of (await listPartyOrdersStaff(EV)).filter(needsEntryTicketNotice)) {
    const ok = await sendPartyMail(o.email, buildEntryTicketNoticeEmail(o, s), 'entry-ticket-notice');
    if (ok) {
      await markEntryTicketNoticed(o.id, staffName.trim());
      sent += 1;
    } else {
      failed += 1;
    }
    await new Promise((r) => setTimeout(r, 900));
  }
  console.log(`[party] entry ticket notices by staff: sent=${sent} failed=${failed}`);
  revalidatePath('/staff/xmas');
  return { ok: true, sent, failed };
}

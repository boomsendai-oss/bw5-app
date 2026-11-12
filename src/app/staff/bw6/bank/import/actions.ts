'use server';

// BW6 発表会のスタッフの「入金の取り込み」（/staff/bw6/bank/import）の Server Actions（Task 29。決まりの紙 2-17・2-18・2-21）。
// どれも1行目で requireRecitalStaff() を呼ぶ（規約4.5）。束の形の確かめは 25 の validateBatchShape、入れるのは 27 の ingestBankBatch（commit）。
// 明細のファイルは 25 の parseGmoStatementCsv（GMOあおぞらの入出金明細の CSV）。待ちのメールは 10 の flushWaitingMails。
// 返す文に、名義・摘要・残高・金額を入れない（数と日付だけ）。ログも短い語だけ。
import { revalidatePath } from 'next/cache';
import { isIsoDate, todayJst } from '@/lib/dateJst';
import { RECITAL_STAFF_NAMES, pickStaffEventKey } from '@/lib/recital';
import { BANK_BATCH_MAX_ROWS, parseGmoStatementCsv, validateBatchShape, type BankBatchIn } from '@/lib/recitalBankBatch';
import { ingestBankBatch, type IngestResult } from '@/lib/recitalBankDb';
import { requireRecitalStaff } from '@/lib/recitalGuard';
import { flushWaitingMails, inSendWindow } from '@/lib/recitalMail';
import { parseYenInput } from '@/lib/recitalMyPage';

type Result = { ok: true; message: string } | { ok: false; error: string };

const NAME_ERROR = '名前を選んでください';
const DESC_MAX = 100;
/** 1か月の明細の CSV は数十KB。Server Action の本文の上限（1MB）より前で止める */
const FILE_MAX_BYTES = 900_000;
const MANUAL_NOTE = '手で打った行は、自動では当たりません。見てほしい入金で当ててください';

const okName = (s: unknown): s is string => typeof s === 'string' && RECITAL_STAFF_NAMES.includes(s);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 残高（0円もあり）。数字だけ（カンマ・円・空白は読み飛ばす） */
function parseBalance(x: unknown): number | null {
  if (typeof x !== 'string') return null;
  const t = x.normalize('NFKC').replace(/[,円\s]/g, '');
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * 検算が合わなかった時の文。27 の near（わけ＋場所）から金額の所（「の ◯円の行のあたり」）だけを「のあたり」に変え、わけは残す。
 * 例：「12月16日の 26,500円の行のあたり」→「12月16日のあたりが合いません」／
 * 「残高が読めない行があります（入出金明細の一覧の画面で撮ってください）：12月16日の 26,500円の行のあたり」→ わけ＋「12月16日のあたり」／
 * 「12月14日（期間の開始日）」→ そのまま
 */
function nearMessageOf(near: string): string {
  const s = near.replace(/の\s*[\d,]+円の行のあたり/, 'のあたり');
  if (!s.includes('：') && s.endsWith('のあたり')) return `${s}が合いません`;
  return `検算が合いません（${s}）`;
}

/** 入れた結果の文（数だけ） */
function resultText(r: IngestResult): { ok: boolean; text: string } {
  if (!r.check.ok) return { ok: false, text: `${nearMessageOf(r.check.near)}。何も入れていません` };
  const auto = r.auto_matched > 0 ? `・自動で当たった ${r.auto_matched}行` : '';
  return { ok: true, text: `読んだ ${r.read_rows}行・新しく入った ${r.inserted}行・もうあった ${r.existing}行・はじいた ${r.rejected}行${auto}` };
}

/** ingestBankBatch が投げた語 → 画面の文 */
function ingestError(e: unknown, where: string): string {
  const m = errMsg(e);
  if (m === 'no_event') return 'この発表会は、まだ作られていません';
  if (m === 'recital_bank:match_failed') return '行は入りましたが、当てられなかった行があります。見てほしい入金の画面で見てください';
  if (/SQLITE_BUSY|database is locked/i.test(m) || m === 'busy') return 'ほかの人が、いま入金を入れています。少し待ってから、もう一度押してください';
  console.error(`[recital] 入金の取り込みができませんでした action=${where}`, m.startsWith('recital_') ? m : 'error');
  return '入れられませんでした。画面を開き直して、もう一度押してください';
}

function done(): void {
  revalidatePath('/staff/bw6/bank/import');
  revalidatePath('/staff/bw6/bank');
  revalidatePath('/staff/bw6');
}

/**
 * 手で打つ欄（日付・金額・残高・摘要の4つ）→ 1行の manual の束 → validateBatchShape → ingestBankBatch(commit)。
 * 摘要は「振込 」を頭に付ける（4 の readRefFromDesc は頭が「振込」の時だけ番号を読むため）。手で打った行は自動では当たらない。
 */
export async function manualEntryAction(x: { ev: string; date: string; amount: string; balance: string; desc: string; staffName: string }): Promise<Result> {
  await requireRecitalStaff();
  if (!okName(x?.staffName)) return { ok: false, error: NAME_ERROR };
  const date = typeof x.date === 'string' ? x.date.trim() : '';
  if (!isIsoDate(date)) return { ok: false, error: '日付を選んでください' };
  const amount = parseYenInput(typeof x.amount === 'string' ? x.amount : '');
  if (amount === null) return { ok: false, error: '金額は 1円以上の数で入れてください' };
  const balance = parseBalance(x.balance);
  if (balance === null) return { ok: false, error: '残高は数で入れてください' };
  const desc = typeof x.desc === 'string' ? x.desc.trim() : '';
  if (desc === '') return { ok: false, error: '摘要を入れてください' };
  const raw: BankBatchIn = {
    event_key: pickStaffEventKey(x.ev), source: 'manual', shot_on: todayJst(), range_from: date, range_to: date, images: 0, account: '円普通預金',
    rows: [{ pos: 'm-1', date, dir: 'in', amount, balance, kind: 'transfer', desc: '振込 ' + desc.slice(0, DESC_MAX), cut: false, unread: '' }],
  };
  const v = validateBatchShape(raw);
  if (!v.ok) return { ok: false, error: '入れた形が読めません。4つの欄を確かめてください' };
  let r: IngestResult;
  try {
    r = await ingestBankBatch(v.batch, 'commit', x.staffName);
  } catch (e) {
    return { ok: false, error: ingestError(e, 'manual') };
  }
  done();
  const t = resultText(r);
  return t.ok ? { ok: true, message: `${t.text}。${MANUAL_NOTE}` } : { ok: false, error: t.text };
}

/**
 * 明細のファイル（GMOあおぞらの入出金明細の CSV）→ parseGmoStatementCsv → file の束 → validateBatchShape → ingestBankBatch(commit)。
 * 期間はいちばん古い行の日付〜いちばん新しい行の日付。行が BANK_BATCH_MAX_ROWS をこえたら、月ごとに分けてもらう。
 */
export async function fileImportAction(formData: FormData): Promise<Result> {
  await requireRecitalStaff();
  const staffName = String(formData.get('staffName') ?? '');
  if (!okName(staffName)) return { ok: false, error: NAME_ERROR };
  const ev = pickStaffEventKey(String(formData.get('ev') ?? ''));
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'ファイルを選んでください' };
  if (file.size > FILE_MAX_BYTES) return { ok: false, error: 'ファイルが大きすぎます。月ごとに分けて入れてください' };
  let rows: BankBatchIn['rows'];
  try {
    rows = parseGmoStatementCsv(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { ok: false, error: 'ファイルの形がちがいます。GMOあおぞらの入出金明細の CSV を選んでください' };
  }
  if (rows.length === 0) return { ok: false, error: 'ファイルに明細の行がありません' };
  if (rows.length > BANK_BATCH_MAX_ROWS) return { ok: false, error: `行が ${BANK_BATCH_MAX_ROWS}行をこえています。月ごとに分けて入れてください` };
  const dates = rows.map((r) => r.date).filter((d) => isIsoDate(d)).sort();
  if (dates.length === 0) return { ok: false, error: 'ファイルの日付が読めません。GMOあおぞらの入出金明細の CSV を選んでください' };
  const raw: BankBatchIn = {
    event_key: ev, source: 'file', shot_on: todayJst(), range_from: dates[0], range_to: dates[dates.length - 1], images: 0, account: '円普通預金', rows,
  };
  const v = validateBatchShape(raw);
  if (!v.ok) return { ok: false, error: 'ファイルの中に読めない行があります。GMOあおぞらの入出金明細の CSV か、確かめてください' };
  let r: IngestResult;
  try {
    r = await ingestBankBatch(v.batch, 'commit', staffName);
  } catch (e) {
    return { ok: false, error: ingestError(e, 'file') };
  }
  done();
  const t = resultText(r);
  return t.ok ? { ok: true, message: t.text } : { ok: false, error: t.text };
}

/** 「待ちのメールを、今出す」。JST の 8:00〜21:00 だけ（画面でも押せないようにしているが、ここでもう一度確かめる） */
export async function flushWaitingAction(x: { ev: string; staffName: string }): Promise<Result> {
  await requireRecitalStaff();
  if (!okName(x?.staffName)) return { ok: false, error: NAME_ERROR };
  if (!inSendWindow(new Date())) return { ok: false, error: '今は出せません（メールを出せるのは朝8時〜夜9時です）' };
  let r: { sent: number; failed: number };
  try {
    r = await flushWaitingMails(pickStaffEventKey(x.ev));
  } catch (e) {
    console.error('[recital] 待ちのメールを出せませんでした', errMsg(e).startsWith('recital_') ? errMsg(e) : 'error');
    return { ok: false, error: '出せませんでした。少し待ってから、もう一度押してください' };
  }
  done();
  return { ok: true, message: `${r.sent}通出しました（失敗 ${r.failed}通）` };
}

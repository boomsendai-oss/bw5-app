// BW6 発表会（段階1）の入金の束を入れる所（Task 27）：検算 → 台帳（recital_bank_rows）と束の記録（recital_imports）→
// 古い順に1行ずつ自動で当てる → 「ご入金を確認しました」のメール。
// 決まりの正本は設計書 05 5-6、決まりの紙 2-17・2-18・2-19・2-23（K144・K146・K147・K151・K191・K201・K209）。
// 純な計算は recitalBankBatch（束・検算・印）と recitalBankMatch（当てる）。ここに同じ計算を書かない。
// DB は src/lib/db.ts 経由だけ。名前と型の正本は .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
// 守り：合わない束では台帳にも入金にも1行も書かない。dry は（合わなかった時の束の記録の1行のほか）何も書かない。
// 1つの台帳の行の入金は1回だけ（書き込みの中で state='new' を読み直し、当てたら同じ書き込みで matched にする）。
// 返す物とログに、名義・摘要・世帯の名前・残高を入れない（K146・R-18）。
import type { Transaction } from '@libsql/client';
import { batch, getAll, getOne, withWriteTx } from '@/lib/db';
import { nowUtcIso, shiftDays, todayJst } from '@/lib/dateJst';
import { FIRST5_LIMIT, bankToldWaitDue, householdView, jstToMs, moneySummary, type MoneySummary, type RecitalSettings } from '@/lib/recital';
import { checkBatch, flagRows, normalizeBatch, type BankBatchIn, type LedgerRowLite, type NormRow } from '@/lib/recitalBankBatch';
import { candidatesFor, decideRow, surnameMatches, type Candidate, type MatchHousehold, type MatchRow, type ReviewKind } from '@/lib/recitalBankMatch';
import { getRecitalEvent, getRecitalSettings, logChangeTx, readMoneyByHousehold, type HouseholdRow } from '@/lib/recitalDb';
import { cancelWaitingMailsTx, sendPaidMail } from '@/lib/recitalMail';
import { afterMoneyChanged, insertPaymentTx, readHouseholdMoneyTx } from '@/lib/recitalMoneyDb';
import { reversedBankPaymentIds } from '@/lib/recitalMyPage';
import { readRefFromDesc } from '@/lib/recitalRef';

// ---------- 型（split.md ③。flagged は計画で足した名前） ----------

export type IngestResult = {
  mode: 'dry' | 'commit';
  check: { ok: true } | { ok: false; near: string; lastOkDate: string | null };
  read_rows: number; inserted: number; existing: number; rejected: number; auto_matched: number;
  /** 5つがそろっても印（twin・last・manual_twin）だけで止まった行の数 */
  flagged: number;
  review: Partial<Record<ReviewKind, number>>;
  needs_first_ok: boolean;
  first5_rows?: { pos: string; ref: string | null; amount: number; conditions: [boolean, boolean, boolean, boolean, boolean] }[];
  join_mismatch?: { date: string; amount: number }[];
};

/** 1つの束で、その場で送るメールの数（Gmail は1通1〜3秒・関数は60秒まで。残りは「待ち」で朝8時か「待ちのメールを、今出す」） */
const MAIL_NOW_MAX = 10;
const MEMO_REPLACED = '入れかえ';

/* eslint-disable @typescript-eslint/no-explicit-any -- DB の行は動的キー */
type Reader = (sql: string, args: (string | number | null)[]) => Promise<any[]>;
const readOf = (tx: Transaction | null): Reader =>
  tx ? async (sql, args) => (await tx.execute({ sql, args })).rows as any[] : (sql, args) => getAll(sql, args);

const isTransferIn = (r: { dir: string; kind: string }) => r.dir === 'in' && r.kind === 'transfer';

/**
 * このファイルの書き込みは、同じプロセスの中では1本ずつ通す（前の書き込みが終わってから次を開く）。
 * libsql の手元のファイルの DB では、同じプロセスから2本目の transaction('write') が SQLITE_BUSY で落ちると、
 * その接続に終わっていない BEGIN が残り、あとの書き込みが全部 database is locked になる（Task 28 で確かめた）。
 * 別のプロセス（別のサーバ）どうしがぶつかった時は、今までどおり SQLITE_BUSY が出る（呼ぶ側が busy に直す）。待って入れ直す輪ではない。
 */
let writeChain: Promise<unknown> = Promise.resolve();
/**
 * 1本ずつ通すのは手元のファイルの DB（TURSO_DATABASE_URL が空か file: で始まる）の時だけ。
 * 本番の Turso（HTTP）では、今までどおりそのまま書く（止まった書き込み1本で、このファイルの書き込みが全部待たないように）
 */
function serialFor(url: string | undefined): boolean {
  const u = (url ?? '').trim();
  return u === '' || u.startsWith('file:');
}
function serialWrite<T>(run: () => Promise<T>): Promise<T> {
  if (!serialFor(process.env.TURSO_DATABASE_URL)) return run();
  const p = writeChain.then(run);
  writeChain = p.catch(() => undefined);
  return p;
}
const serialWriteTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => serialWrite(() => withWriteTx(fn));

// ---------- 開始日・数える物 ----------

/**
 * 声かけの「開始日」と検算5の日（この関数が正本。24 の声かけもこれを呼ぶ）。
 * 台帳の入金の振込（void 以外・source が chat か file）のいちばん新しい row_date。manual の行は数えない。
 * 無ければ「pay_open_at と pay_ok_at の遅い方の日付」の前の日（決まりの紙 7-5）。
 */
export async function bankStartDate(eventKey: string, s: RecitalSettings): Promise<string> {
  const r = await getOne(
    `SELECT MAX(row_date) AS d FROM recital_bank_rows
     WHERE event_key = ? AND dir = 'in' AND kind = 'transfer' AND state <> 'void' AND source IN ('chat', 'file')`,
    [eventKey],
  );
  if (r?.d) return String(r.d);
  const open = s.pay_open_at.slice(0, 10);
  const ok = s.pay_ok_at ? s.pay_ok_at.slice(0, 10) : '';
  return shiftDays(ok > open ? ok : open, -1);
}

/** はじめの5件の数：bank_auto のプラスの入金の台帳の行の数（取り消しても減らさない。④C-12） */
async function countFirst5Done(read: Reader, eventKey: string): Promise<number> {
  const rows = await read(
    `SELECT COUNT(DISTINCT bank_transaction_id) AS n FROM recital_payments
     WHERE event_key = ? AND source = 'bank_auto' AND amount > 0 AND bank_transaction_id IS NOT NULL`,
    [eventKey],
  );
  return Number(rows[0]?.n ?? 0);
}

/** 合った束（chat|file）のいちばん新しい imported_at の JST の日付 */
async function lastOkDate(eventKey: string): Promise<string | null> {
  const r = await getOne(
    `SELECT MAX(imported_at) AS t FROM recital_imports
     WHERE event_key = ? AND kind = 'statement' AND source IN ('chat', 'file') AND check_result = 'ok'`,
    [eventKey],
  );
  return r?.t ? todayJst(new Date(String(r.t))) : null;
}

/**
 * TARO への声かけ（24）が使う事実。夜の声かけと朝の入口の両方が呼ぶ。名前・金額は返さない。
 * startDate＝bankStartDate（正本。ここで計算し直さない）。
 * lastShotOn・okBatchToday＝合った束（kind='statement'・check_result='ok'・source が chat か file）のいちばん新しい1行から。
 * 手で打った束（manual）と合わなかった束は数えない（K211）。今日＝JST の今日の 0:00 以後（imported_at は UTC ISO の文字のまま比べる）。
 * reviewCount＝見てほしい入金の件数（listReviewRows のうち、片づいた closed を数えない）。
 */
export async function getBankAskFacts(
  eventKey: string,
  now: Date,
): Promise<{ startDate: string; lastShotOn: string | null; reviewCount: number; okBatchToday: boolean }> {
  const s = await getRecitalSettings(eventKey);
  const startDate = await bankStartDate(eventKey, s);
  const last = await getOne(
    `SELECT shot_on, imported_at FROM recital_imports
     WHERE event_key = ? AND kind = 'statement' AND check_result = 'ok' AND source IN ('chat', 'file')
     ORDER BY imported_at DESC, id DESC LIMIT 1`,
    [eventKey],
  );
  const todayStart = nowUtcIso(new Date(jstToMs(todayJst(now))));
  const reviewCount = (await listReviewRows(eventKey)).filter((r) => r.group !== 'closed').length;
  return {
    startDate,
    lastShotOn: last?.shot_on ? String(last.shot_on) : null,
    reviewCount,
    okBatchToday: last?.imported_at != null && String(last.imported_at) >= todayStart,
  };
}

// ---------- 当てる材料 ----------

/** 全世帯（merged・出演なしも）の当てる材料。表ごとに1本の SQL で読んでから計算する（世帯ごとに引かない） */
export async function loadMatchHouseholds(eventKey: string): Promise<MatchHousehold[]> {
  return loadMatchHouseholdsCore(readOf(null), eventKey);
}

/**
 * onlyRef を渡すと、その番号の世帯だけ（状態は問わない＝merged・出演なしも入る）。
 * decideRow は byRef.get(行の番号) しか見ないので、1行を当てる時はこれで足りる。
 */
async function loadMatchHouseholdsCore(read: Reader, eventKey: string, onlyRef?: string): Promise<MatchHousehold[]> {
  const refCond = onlyRef === undefined ? '' : ' AND ref_code = ?';
  const hArgs: (string | number)[] = onlyRef === undefined ? [eventKey] : [eventKey, onlyRef];
  const sub = `SELECT id FROM recital_households WHERE event_key = ?${refCond}`;
  const hs = await read(
    `SELECT id, ref_code, status, merged_into, contact_last_kana, bank_told_date, bank_told_name, bank_told_amount
     FROM recital_households WHERE event_key = ?${refCond} ORDER BY id`,
    hArgs,
  );
  if (hs.length === 0) return [];
  const group = <T>(rows: any[], val: (r: any) => T): Map<number, T[]> => {
    const m = new Map<number, T[]>();
    for (const r of rows) {
      const k = Number(r.household_id);
      const list = m.get(k) ?? [];
      list.push(val(r));
      m.set(k, list);
    }
    return m;
  };
  const charges = group(await read(`SELECT household_id, amount FROM recital_charges WHERE status = 'active' AND household_id IN (${sub})`, hArgs), (r) => Number(r.amount));
  const payments = group(await read(`SELECT household_id, amount FROM recital_payments WHERE household_id IN (${sub})`, hArgs), (r) => Number(r.amount));
  const refunds = group(await read(`SELECT household_id, amount FROM recital_refunds WHERE status = 'todo' AND household_id IN (${sub})`, hArgs), (r) => Number(r.amount));
  // 出演の数え方は readMoneyViewTx と同じ（人 active・作品が dropped でない・in か maybe）
  const casts = group(
    await read(
      `SELECT DISTINCT p.household_id, c.status FROM recital_casts c
       JOIN recital_people p ON p.id = c.person_id
       JOIN recital_works w ON w.id = c.work_id
       WHERE p.status = 'active' AND w.status <> 'dropped' AND c.status IN ('in', 'maybe') AND p.household_id IN (${sub})`,
      hArgs,
    ),
    (r) => String(r.status),
  );
  const kanas = group(await read(`SELECT household_id, last_kana FROM recital_people WHERE last_kana IS NOT NULL AND household_id IN (${sub})`, hArgs), (r) => String(r.last_kana));
  // total_changed の形は 8 の recomputeChargesTx（と 20 の調整）が書く { total } の前後。新しい順に見て、下がった最初の行の前の合計
  const changes = group(
    await read(`SELECT household_id, before_json, after_json FROM recital_changes WHERE action = 'total_changed' AND household_id IN (${sub}) ORDER BY id DESC`, hArgs),
    (r) => ({ before: totalOf(r.before_json), after: totalOf(r.after_json) }),
  );

  return hs.map((h) => {
    const id = Number(h.id);
    const m = moneySummary({ chargeAmounts: charges.get(id) ?? [], paymentAmounts: payments.get(id) ?? [], refundTodoAmounts: refunds.get(id) ?? [] });
    const cs = casts.get(id) ?? [];
    const view = householdView({ hasIn: cs.includes('in'), hasMaybe: cs.includes('maybe'), paid: m.paid, remaining: m.remaining });
    const drop = (changes.get(id) ?? []).find((c) => c.before !== null && c.after !== null && c.after < c.before);
    const surnames = new Set((kanas.get(id) ?? []).filter((k) => k.trim() !== ''));
    if (h.contact_last_kana != null && String(h.contact_last_kana).trim() !== '') surnames.add(String(h.contact_last_kana));
    return {
      id,
      refCode: String(h.ref_code),
      status: String(h.status) === 'active' ? 'active' : 'merged',
      mergedInto: h.merged_into == null ? null : Number(h.merged_into),
      view,
      remaining: m.remaining,
      totalBeforeLastDrop: drop ? drop.before : null,
      surnamesKana: [...surnames],
      told: h.bank_told_amount == null ? null : { date: String(h.bank_told_date ?? ''), name: h.bank_told_name == null ? null : String(h.bank_told_name), amount: Number(h.bank_told_amount) },
    } satisfies MatchHousehold;
  });
}

/** { "total": n } の n。読めなければ null（その行は「前の合計」に使わない） */
function totalOf(json: unknown): number | null {
  if (json == null) return null;
  try {
    const t = (JSON.parse(String(json)) as { total?: unknown })?.total;
    return typeof t === 'number' && Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

/** 台帳の行（DB）→ MatchRow */
function matchRowOfDb(r: any, remainingOfRow: number): MatchRow {
  return {
    id: Number(r.id), source: String(r.source), dir: String(r.dir), kind: String(r.kind), amount: Number(r.amount), remainingOfRow,
    refRead: r.ref_read == null ? null : String(r.ref_read), refOk: Number(r.ref_ok ?? 0),
    nameRaw: r.desc_raw == null ? '' : readRefFromDesc(String(r.desc_raw)).nameRaw,
    unread: r.unread == null ? null : String(r.unread), cut: Number(r.cut ?? 0), checkFlag: r.check_flag == null ? null : String(r.check_flag),
    rowDate: String(r.row_date),
  };
}

/** 束の新しい行 → MatchRow（まだ id が無いので 0） */
function matchRowOfNorm(r: NormRow, source: string): MatchRow {
  return {
    id: 0, source, dir: r.dir, kind: r.kind, amount: r.amount, remainingOfRow: r.amount, refRead: r.refRead, refOk: r.refOk,
    nameRaw: r.descRaw == null ? '' : readRefFromDesc(r.descRaw).nameRaw, unread: r.unread, cut: r.cut, checkFlag: r.checkFlag, rowDate: r.rowDate,
  };
}

/** 2-19 の5つの条件（decideRow と同じ見方。①は unread・manual の行を外す） */
function conditionsOf(row: MatchRow, byRef: Map<string, MatchHousehold>): [boolean, boolean, boolean, boolean, boolean] {
  const h = row.refRead ? byRef.get(row.refRead) : undefined;
  return [
    isTransferIn(row) && (row.source === 'chat' || row.source === 'file') && !row.unread,
    row.refRead !== null && row.refOk === 1,
    !!h && h.status === 'active' && h.view !== 'none',
    !!h && row.remainingOfRow === h.remaining,
    !!h && surnameMatches(row.nameRaw, h.surnamesKana, h.told?.name ?? null),
  ];
}

// ---------- 文と鍵 ----------

const yen = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const mdParts = (iso: string): [number, number] | null => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? [Number(iso.slice(5, 7)), Number(iso.slice(8, 10))] : null);

type FailReason = 'balance_unread' | 'chain' | null;

/**
 * 検算が落ちたわけ（文に出す分だけ）。checkBatch の⓪と1 と同じ順に見て、最初に落ちる所を返す
 * （checkBatch は最初に落ちた所で返すので、同じ順で見れば同じ所になる）：⓪・1 で残高が読めない／1 の残高のつながり。
 * ⓪の日付・金額・入出が読めない時と、2 から先（日付の順・枚のつなぎ目・開始日・前の日とのつなぎ目）は null（場所だけを出す）。
 */
function failReason(b: BankBatchIn, rows: NormRow[]): FailReason {
  for (const r of rows) {
    const w = r.unread ? r.unread.split(',') : [];
    const blocking = ['date', 'amount', 'balance', 'dir'].filter((x) => w.includes(x));
    if (blocking.length > 0) return blocking.includes('balance') ? 'balance_unread' : null;
  }
  if (b.source === 'manual') return rows.some((r) => r.balance === null) ? 'balance_unread' : null;
  for (let i = 0; i + 1 < rows.length; i++) {
    const up = rows[i];
    const dn = rows[i + 1];
    if (up.balance === null || dn.balance === null) return 'balance_unread';
    if (up.balance !== dn.balance + (up.dir === 'in' ? up.amount : -up.amount)) return 'chain';
  }
  return rows.some((r) => r.balance === null) ? 'balance_unread' : null;
}

function nearText(near: { date: string; amount: number }, isStart: boolean, reason: FailReason): string {
  const md = mdParts(near.date);
  const day = md ? `${md[0]}月${md[1]}日` : '日付の読めない';
  if (isStart) return `${day}（期間の開始日）`;
  const at = `${day}の ${yen(near.amount)}円の行のあたり`;
  if (reason === 'balance_unread') return `残高が読めない行があります（入出金明細の一覧の画面で撮ってください）：${at}`;
  if (reason === 'chain') return `残高がつながりません：${at}`;
  return at;
}

function ngResult(near: { date: string; amount: number }): string {
  const md = mdParts(near.date);
  return `ng:${md ? `${md[0]}/${md[1]}` : '?'}:${near.amount}`;
}

// ---------- 入れる前の印（Task 27 の見直しの裁定） ----------

type LedgerDeposit = { refRead: string; rowDate: string; amount: number; balance: number | null };

/** 台帳の chat・file の入金の振込（void 以外・番号あり） */
async function readLedgerDeposits(eventKey: string): Promise<LedgerDeposit[]> {
  return (await getAll(
    `SELECT ref_read, row_date, amount, balance FROM recital_bank_rows
     WHERE event_key = ? AND state <> 'void' AND dir = 'in' AND kind = 'transfer' AND source IN ('chat', 'file') AND ref_read IS NOT NULL`,
    [eventKey],
  )).map((r) => ({ refRead: String(r.ref_read), rowDate: String(r.row_date), amount: Number(r.amount), balance: r.balance == null ? null : Number(r.balance) }));
}

/**
 * 重なる日を撮り直した時、前の日の出金などで残高が変わると、同じ振込が別の鍵でもう1行入ることがある。
 * 新しく入る入金の振込の行で、まだ印が無く、台帳に「同じ番号・同じ日・同じ金額で、残高だけがちがう」chat・file の行がある物に
 * twin の印を付ける（自動で当てず、見てほしい入金へ。同じ束の中の行どうしは見ない＝同じ日の2件の入金は場面3のとおり）。
 */
function markSameRefTwins(rows: NormRow[], deposits: LedgerDeposit[], liveKeys: Set<string>): NormRow[] {
  return rows.map((r) => {
    if (r.checkFlag !== null || liveKeys.has(r.rowKey) || !isTransferIn(r) || r.refRead === null) return r;
    const twin = deposits.some((l) => l.refRead === r.refRead && l.rowDate === r.rowDate && l.amount === r.amount && l.balance !== r.balance);
    return twin ? { ...r, checkFlag: 'twin' } : r;
  });
}

// ---------- 入れる ----------

/**
 * 束を入れる（dry＝試し／commit＝本番）。流れは決まりの紙 2-17・2-18・2-19・2-23 の順：
 * 発表会 → 台帳 → 開始日 → 正規化 → 検算 →（合わない）束の記録だけ／（合う）分ける → dry はまねるだけ／commit は書いて古い順に当てる。
 */
export async function ingestBankBatch(b: BankBatchIn, mode: 'dry' | 'commit', importedBy: string, now?: Date): Promise<IngestResult> {
  const event = await getRecitalEvent(b.event_key);
  if (!event) throw new Error('no_event');
  const at = now ?? new Date();
  const handed = todayJst(at);
  const stamp = nowUtcIso(at);
  const actor = importedBy.trim() === '' ? 'chat' : importedBy;
  const s = await getRecitalSettings(b.event_key);

  const ledger: LedgerRowLite[] = (await getAll(
    `SELECT id, row_key, row_date, dir, amount, balance, kind, source, state FROM recital_bank_rows WHERE event_key = ? AND state <> 'void' ORDER BY id`,
    [b.event_key],
  )).map((l) => ({
    id: Number(l.id), row_key: String(l.row_key), row_date: String(l.row_date), dir: String(l.dir), amount: Number(l.amount),
    balance: l.balance == null ? null : Number(l.balance), kind: String(l.kind), source: String(l.source), state: String(l.state),
  }));
  const startDate = await bankStartDate(b.event_key, s);
  const rows = normalizeBatch(b, handed);
  const check = checkBatch(b, rows, ledger, { startDate });

  const empty = { read_rows: rows.length, inserted: 0, existing: 0, rejected: 0, auto_matched: 0, flagged: 0, review: {}, needs_first_ok: false };

  // ---- 合わない束：台帳・入金には何も書かない。束の記録だけ ----
  if (!check.ok) {
    // 開始日で落ちた時（checkBatch の5。円は 0・日は開始日）。範囲の開始日は checkBatch と同じく / を - にそろえてくらべる
    const isStart = check.near.amount === 0 && check.near.date === startDate && b.range_from.replace(/\//g, '-') > startDate;
    const checkResult = ngResult(check.near);
    const full = mode === 'commit';
    await serialWriteTx(async (tx) => {
      await tx.execute({
        sql: `INSERT INTO recital_imports (event_key, created_at, kind, read_rows, inserted, existing, rejected, imported_by, imported_at, shot_on, range_from, range_to, images, source, check_result)
              VALUES (?, ?, 'statement', ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          b.event_key, stamp, full ? rows.length : 0, full ? rows.length : 0, actor, stamp,
          full ? b.shot_on : null, full ? b.range_from : null, full ? b.range_to : null, full ? b.images : null, b.source, checkResult,
        ],
      });
    });
    const byId = new Map(ledger.map((l) => [l.id, l]));
    const seen = new Set<number>();
    const joinMismatch: { date: string; amount: number }[] = [];
    for (const j of check.joinMismatch ?? []) {
      const l = byId.get(j.ledgerRowId);
      if (!l || seen.has(l.id)) continue;
      seen.add(l.id);
      joinMismatch.push({ date: l.row_date, amount: l.amount });
    }
    return {
      mode, check: { ok: false, near: nearText(check.near, isStart, isStart ? null : failReason(b, rows)), lastOkDate: await lastOkDate(b.event_key) }, ...empty,
      ...(joinMismatch.length > 0 ? { join_mismatch: joinMismatch } : {}),
    };
  }

  // ---- 合う束：分ける ----
  const liveKeys = new Set(ledger.map((l) => l.row_key));
  const marked = markSameRefTwins(flagRows(rows, ledger), await readLedgerDeposits(b.event_key), liveKeys);
  const newRows: { row: NormRow; index: number }[] = [];
  let existing = 0;
  marked.forEach((row, index) => {
    if (liveKeys.has(row.rowKey)) existing++;
    else newRows.push({ row, index });
  });
  // 入れかえ：chat・file の束だけ。台帳の、入金の振込でない行で、いちばん下の行の日より後〜新しい行の最大の日まで、鍵が束に無い物。
  // いちばん下の日は入れかえない（その日の行が全部写っていないことがある）。manual の束は日付の並びが無いので入れかえない
  const batchKeys = new Set(rows.map((r) => r.rowKey));
  const bottomDate = rows[rows.length - 1].rowDate;
  const maxNewDate = newRows.reduce((m, x) => (x.row.rowDate > m ? x.row.rowDate : m), '');
  const replace = b.source === 'manual' || maxNewDate === ''
    ? []
    : ledger.filter((l) => !isTransferIn(l) && l.row_date > bottomDate && l.row_date <= maxNewDate && !batchKeys.has(l.row_key));

  if (mode === 'dry') return dryRun(b, marked, newRows, existing);

  // ---- commit：1回の書き込みで束の記録・入れかえ・新しい行（下＝古い順） ----
  const insertedIds = await serialWriteTx(async (tx) => {
    const imp = await tx.execute({
      sql: `INSERT INTO recital_imports (event_key, created_at, kind, read_rows, inserted, existing, rejected, imported_by, imported_at, shot_on, range_from, range_to, images, source, check_result)
            VALUES (?, ?, 'statement', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'ok')`,
      args: [b.event_key, stamp, rows.length, newRows.length, existing, actor, stamp, b.shot_on, b.range_from, b.range_to, b.images, b.source],
    });
    const importId = Number(imp.lastInsertRowid);
    // 合った束の rejected は 0。read_rows ≠ inserted＋existing＋rejected なら書かない（3-7）
    const rejected = 0;
    if (rows.length !== newRows.length + existing + rejected) throw new Error('recital_bank:count_mismatch');
    for (const l of replace) {
      await tx.execute({
        sql: `UPDATE recital_bank_rows SET state = 'void', memo = ?, decided_by = 'system', decided_at = ? WHERE id = ? AND state <> 'void'`,
        args: [MEMO_REPLACED, stamp, l.id],
      });
    }
    const ids: { id: number; transferIn: boolean }[] = [];
    for (const { row } of [...newRows].reverse()) {
      const ins = await tx.execute({
        sql: `INSERT INTO recital_bank_rows (event_key, created_at, row_date, dir, amount, balance, kind, desc_raw, desc_norm, cut, unread, ref_read, ref_ok, row_key, source, import_id, state, check_flag)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
        args: [
          b.event_key, stamp, row.rowDate, row.dir, row.amount, row.balance, row.kind, row.descRaw, row.descNorm, row.cut, row.unread,
          row.refRead, row.refOk, row.rowKey, b.source, importId, row.checkFlag,
        ],
      });
      ids.push({ id: Number(ins.lastInsertRowid), transferIn: isTransferIn(row) });
      if (row.checkFlag === 'manual_twin') {
        await tx.execute({
          sql: `UPDATE recital_bank_rows SET check_flag = 'manual_twin'
                WHERE event_key = ? AND source = 'manual' AND state <> 'void' AND row_date = ? AND dir = ? AND amount = ?`,
          args: [b.event_key, row.rowDate, row.dir, row.amount],
        });
      }
    }
    await logChangeTx(tx, {
      eventKey: b.event_key, action: 'bank_imported', actor,
      after: { importId, source: b.source, read_rows: rows.length, inserted: newRows.length, existing, rejected: 0, voided: replace.length },
    });
    return ids;
  });

  // ---- 当てる行：新しい入金の振込の行＋（first_ok の時だけ）台帳の first5 で待っている行の全部。古い順・同じ日は id の小さい順 ----
  const targetIds = new Set(insertedIds.filter((x) => x.transferIn).map((x) => x.id));
  // 前の回が入れたあと当てる前に止まった行（60秒・メール・失敗）：new のまま種類も印も無い chat・file の入金の振込。
  // 同じ束を渡し直せば、ここで当て直す（書き込みの中で state='new' を読み直すので、2回は記録しない）
  // 人が決めた行（decided_by あり：取り消し・もとにもどす・当てられずに回した行）は、どちらの道でも当てない（K147）
  const retryIds = new Set<number>();
  for (const r of await getAll(
    `SELECT id FROM recital_bank_rows
     WHERE event_key = ? AND state = 'new' AND review_kind IS NULL AND check_flag IS NULL AND decided_by IS NULL
       AND dir = 'in' AND kind = 'transfer' AND source IN ('chat', 'file')`,
    [b.event_key],
  )) {
    if (!targetIds.has(Number(r.id))) retryIds.add(Number(r.id));
    targetIds.add(Number(r.id));
  }
  if (b.first_ok === true) {
    for (const r of await getAll(`SELECT id FROM recital_bank_rows WHERE event_key = ? AND state = 'new' AND review_kind = 'first5' AND decided_by IS NULL`, [b.event_key])) {
      if (!targetIds.has(Number(r.id))) retryIds.add(Number(r.id));
      targetIds.add(Number(r.id));
    }
  }
  const ordered = targetIds.size === 0
    ? []
    : (await getAll(`SELECT id FROM recital_bank_rows WHERE id IN (${[...targetIds].map(() => '?').join(',')}) ORDER BY row_date, id`, [...targetIds])).map((r) => Number(r.id));

  const out: IngestResult = { mode, check: { ok: true }, read_rows: rows.length, inserted: newRows.length, existing, rejected: 0, auto_matched: 0, flagged: 0, review: {}, needs_first_ok: false };
  let mailedNow = 0;
  let failedRows = 0;
  for (const rowId of ordered) {
    let d: Awaited<ReturnType<typeof matchOneRow>>;
    try {
      d = await __internal.matchOneRow(b.event_key, rowId, b.first_ok === true);
    } catch (e) {
      failedRows++;
      const code = e instanceof Error && e.message.startsWith('recital_') ? e.message : 'db_error';
      console.error(`[recital] 入金の行を当てられませんでした row=${rowId}`, code);
      // 前の束から残っていた行がまた当てられなければ、見てほしい入金へ回す（いつも落ちる行1つで、あとの束が全部 match_failed にならないように。
      // 新しく入った行は1回だけ渡し直しを待つ＝60秒切れ・一時の失敗なら、同じ束を渡し直せば当たる）
      if (retryIds.has(rowId)) await sendRowToReview(rowId, stamp);
      continue;
    }
    if (d.kind === 'skip') continue;
    if (d.kind === 'review') {
      if (d.reviewKind === null) out.flagged++;
      else out.review[d.reviewKind] = (out.review[d.reviewKind] ?? 0) + 1;
      if (d.reviewKind === 'first5') out.needs_first_ok = true;
      continue;
    }
    out.auto_matched++;
    // 書き込みの外で：メール（先頭の10通だけその場で。残りは待ち）→ お金が変わったあとの仕事。失敗しても続ける（入金は記録ずみ）
    try {
      const m = await sendPaidMail(d.householdId, d.paymentId, 'bank', { now: at, forceWait: mailedNow >= MAIL_NOW_MAX });
      if (m.status === 'sent' || m.status === 'failed') mailedNow++;
    } catch (e) {
      console.error(`[recital] ご入金を確認しましたのメールを記録できませんでした payment=${d.paymentId}`, e instanceof Error && e.message.startsWith('recital_') ? e.message : 'error');
    }
    await afterMoneyChanged(d.householdId, 'payment');
  }
  // 当てられなかった行（守りに当たった・DB の失敗）があれば、当たった分のメールを出しおえてから知らせる（行は new のまま見てほしい入金に出る）
  if (failedRows > 0) throw new Error('recital_bank:match_failed');
  return out;
}

/**
 * 1行を当てる（1回の書き込み）。行を読み直し（new の入金の振込だけ）→ 行ののこり → はじめの5件の数 → 番号の世帯の材料
 * （残りは readHouseholdMoneyTx で読み直す）→ 同じ番号のほかの待っている行ののこり → decideRow。
 * 自動なら入金（insertPaymentTx が守りを全部やる）と行の matched を同じ書き込みで。自動でなければ review_kind を書く。
 */
async function matchOneRow(
  eventKey: string,
  rowId: number,
  firstOk: boolean,
): Promise<{ kind: 'skip' } | { kind: 'review'; reviewKind: ReviewKind | null } | { kind: 'auto'; householdId: number; paymentId: number }> {
  return serialWriteTx(async (tx) => {
    const read = readOf(tx);
    const row = (await read('SELECT * FROM recital_bank_rows WHERE id = ? AND event_key = ?', [rowId, eventKey]))[0];
    // void・出金・振込でない行には入金を作らない（当てるのは、まだ決まっていない入金の振込の行だけ）
    if (!row || String(row.state) !== 'new' || !isTransferIn({ dir: String(row.dir), kind: String(row.kind) })) return { kind: 'skip' };
    // 人が決めた行は、自動では当てない（K147。取り消し・もとにもどす・当てられずに回した行）
    if (row.decided_by != null) return { kind: 'skip' };
    const paidOnRow = Number((await read('SELECT COALESCE(SUM(amount), 0) AS n FROM recital_payments WHERE bank_transaction_id = ?', [rowId]))[0]?.n ?? 0);
    const rest = Number(row.amount) - paidOnRow;
    if (rest <= 0) return { kind: 'skip' };
    const first5Done = await countFirst5Done(read, eventKey);
    const ref = row.ref_read == null ? null : String(row.ref_read);
    const hs = ref === null ? [] : await loadMatchHouseholdsCore(read, eventKey, ref);
    for (const h of hs) {
      const money = await readHouseholdMoneyTx(tx, h.id);
      h.remaining = money.m.remaining;
      h.view = money.view;
    }
    const byRef = new Map(hs.map((h) => [h.refCode, h]));
    // 同じ番号の、ほかの（この行を入れない）入金の振込で new／hold の行ののこり
    const sameRefOpenAmounts = ref === null
      ? []
      : (await read(
          `SELECT r.amount - COALESCE((SELECT SUM(p.amount) FROM recital_payments p WHERE p.bank_transaction_id = r.id), 0) AS rest
           FROM recital_bank_rows r
           WHERE r.event_key = ? AND r.ref_read = ? AND r.dir = 'in' AND r.kind = 'transfer' AND r.state IN ('new', 'hold') AND r.id <> ?`,
          [eventKey, ref, rowId],
        )).map((x) => Number(x.rest)).filter((n) => n > 0);
    const mr = matchRowOfDb(row, rest);
    const d = decideRow(mr, byRef, { first5Done, firstOk, sameRefOpenAmounts });
    if (!d.auto) {
      await tx.execute({ sql: "UPDATE recital_bank_rows SET review_kind = ? WHERE id = ? AND state = 'new'", args: [d.reviewKind, rowId] });
      return { kind: 'review', reviewKind: d.reviewKind };
    }
    const h = byRef.get(ref ?? '');
    // まとめた世帯・出演なしの世帯には入金を作らない（decideRow が gone にするが、書き込みの中でもう一度拒む）
    if (!h || h.id !== d.householdId || h.status !== 'active' || h.view === 'none') throw new Error('recital_bank:not_active');
    const desc = row.desc_raw == null ? null : String(row.desc_raw);
    const res = await insertPaymentTx(
      tx,
      {
        householdId: h.id, method: 'bank', amount: rest, paidOn: String(row.row_date), source: 'bank_auto', confirmedBy: firstOk ? 'TARO' : null,
        bankRowId: rowId, bankDate: String(row.row_date), bankDesc: desc, payerNameRaw: desc === null ? null : readRefFromDesc(desc).nameRaw,
      },
      'system',
    );
    const upd = await tx.execute({
      sql: "UPDATE recital_bank_rows SET state = 'matched', match_by = 'auto', review_kind = NULL WHERE id = ? AND state = 'new'",
      args: [rowId],
    });
    if (upd.rowsAffected !== 1) throw new Error('recital_bank:row_changed');
    return { kind: 'auto', householdId: h.id, paymentId: res.paymentId };
  });
}

/** 同じファイルの中から matchOneRow を呼ぶ時の通り道（試験の spy 用。ほかのファイルからは使わない） */
export const __internal = {
  matchOneRow: (eventKey: string, rowId: number, firstOk: boolean) => matchOneRow(eventKey, rowId, firstOk),
  /** 書き込みを1本ずつ通すか（試験用。手元のファイルの DB だけ true） */
  serialFor,
};

/**
 * dry：書かない。新しい入金の振込の行と、前の回が当てる前に止まった台帳の行と、（はじめの5件の間は）台帳で first5 で待っている行の全部について、
 * commit の当て方を記憶の中だけでまねる（自動で当たった世帯の残りはその場で減らす＝同じ番号・同じ金額の2行目は当たらない）。
 * first_ok は付けずに見る。
 */
async function dryRun(b: BankBatchIn, allRows: NormRow[], newRows: { row: NormRow; index: number }[], existing: number): Promise<IngestResult> {
  const households = await loadMatchHouseholds(b.event_key);
  const byRef = new Map(households.map((h) => [h.refCode, { ...h }]));
  const first5Done = await countFirst5Done(readOf(null), b.event_key);
  const inFirst5 = first5Done < FIRST5_LIMIT;

  type Entry = { key: string; date: string; group: number; seq: number; row: MatchRow; pos: string };
  const entries: Entry[] = [];
  const total = newRows.length;
  for (const { row, index } of newRows) {
    if (!isTransferIn(row)) continue;
    // 同じ日は下（古い）から＝commit で id が小さい順
    entries.push({ key: `n${index}`, date: row.rowDate, group: 1, seq: total - index, row: matchRowOfNorm(row, b.source), pos: row.pos });
  }
  const restSql = `r.amount - COALESCE((SELECT SUM(p.amount) FROM recital_payments p WHERE p.bank_transaction_id = r.id), 0) AS rest`;
  const ledgerFirst5 = inFirst5
    ? await getAll(`SELECT r.*, ${restSql} FROM recital_bank_rows r WHERE r.event_key = ? AND r.state = 'new' AND r.review_kind = 'first5' AND r.decided_by IS NULL ORDER BY r.row_date, r.id`, [b.event_key])
    : [];
  // 束に写っている台帳の行（もうある行）には束の pos、写っていない行は ledger-<id>
  const posByKey = new Map(allRows.map((r) => [r.rowKey, r.pos]));
  // 前の回が入れたあと当てる前に止まった行（commit がここで当て直す行。first5 の数に関係なく）
  const resumeRows = await getAll(
    `SELECT r.*, ${restSql} FROM recital_bank_rows r
     WHERE r.event_key = ? AND r.state = 'new' AND r.review_kind IS NULL AND r.check_flag IS NULL AND r.decided_by IS NULL
       AND r.dir = 'in' AND r.kind = 'transfer' AND r.source IN ('chat', 'file')
     ORDER BY r.row_date, r.id`,
    [b.event_key],
  );
  for (const l of [...ledgerFirst5, ...resumeRows]) {
    const rest = Number(l.rest);
    if (rest <= 0) continue;
    entries.push({ key: `l${l.id}`, date: String(l.row_date), group: 0, seq: Number(l.id), row: matchRowOfDb(l, rest), pos: posByKey.get(String(l.row_key)) ?? `ledger-${l.id}` });
  }
  entries.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.group - y.group || x.seq - y.seq));

  // 足すとぴったりの材料：台帳の new／hold の入金の振込（のこり）＋束の新しい入金の振込。自分の行と、当たった行は入れない
  const pool = new Map<string, { ref: string; rest: number; matched: boolean }>();
  for (const r of await getAll(
    `SELECT r.id, r.ref_read, ${restSql} FROM recital_bank_rows r
     WHERE r.event_key = ? AND r.dir = 'in' AND r.kind = 'transfer' AND r.state IN ('new', 'hold') AND r.ref_read IS NOT NULL`,
    [b.event_key],
  )) pool.set(`l${r.id}`, { ref: String(r.ref_read), rest: Number(r.rest), matched: false });
  for (const { row, index } of newRows) {
    if (isTransferIn(row) && row.refRead !== null) pool.set(`n${index}`, { ref: row.refRead, rest: row.amount, matched: false });
  }

  const out: IngestResult = { mode: 'dry', check: { ok: true }, read_rows: allRows.length, inserted: newRows.length, existing, rejected: 0, auto_matched: 0, flagged: 0, review: {}, needs_first_ok: false };
  const conds = new Map<string, [boolean, boolean, boolean, boolean, boolean]>();
  for (const e of entries) {
    const ref = e.row.refRead;
    const sameRefOpenAmounts = ref === null
      ? []
      : [...pool.entries()].filter(([k, p]) => k !== e.key && p.ref === ref && !p.matched && p.rest > 0).map(([, p]) => p.rest);
    conds.set(e.key, conditionsOf(e.row, byRef));
    const d = decideRow(e.row, byRef, { first5Done, firstOk: false, sameRefOpenAmounts });
    if (d.auto) {
      out.auto_matched++;
      const h = byRef.get(ref ?? '');
      if (h) h.remaining = Math.max(0, h.remaining - e.row.remainingOfRow);
      const p = pool.get(e.key);
      if (p) p.matched = true;
      continue;
    }
    if (d.reviewKind === null) out.flagged++;
    else out.review[d.reviewKind] = (out.review[d.reviewKind] ?? 0) + 1;
    if (d.reviewKind === 'first5') out.needs_first_ok = true;
  }

  if (inFirst5) {
    // 並び：束の新しい入金の振込（束の順）→ 台帳の first5 の行（古い順）。名義は入れない（番号・金額・pos・条件だけ）
    const list: NonNullable<IngestResult['first5_rows']> = [];
    for (const { row, index } of newRows) {
      if (!isTransferIn(row)) continue;
      list.push({ pos: row.pos, ref: row.refRead, amount: row.amount, conditions: conds.get(`n${index}`) ?? conditionsOf(matchRowOfNorm(row, b.source), byRef) });
    }
    for (const l of ledgerFirst5) {
      const e = entries.find((x) => x.key === `l${l.id}`);
      if (!e) continue;
      list.push({ pos: e.pos, ref: e.row.refRead, amount: Number(l.amount), conditions: conds.get(e.key)! });
    }
    out.first5_rows = list;
  }
  return out;
}

/**
 * 当てられなかった行を「見てほしい入金」へ回す（Task 27 の持ち越し。Task 28 で足した）。種類は manual（人が決める）、decided_by は system。
 * decided_by がある行は、渡し直しでも「はい」の束でも自動では当てない。失敗してもログだけ（名義は出さない）。
 */
async function sendRowToReview(rowId: number, stamp: string): Promise<void> {
  try {
    await serialWriteTx(async (tx) => {
      await tx.execute({
        sql: "UPDATE recital_bank_rows SET review_kind = 'manual', decided_by = 'system', decided_at = ? WHERE id = ? AND state = 'new' AND decided_by IS NULL",
        args: [stamp, rowId],
      });
    });
  } catch (e) {
    console.error(`[recital] 当てられなかった行を見てほしい入金へ回せませんでした row=${rowId}`, isBusyError(e) ? 'busy' : 'db_error');
  }
}

// =====================================================================
// Task 28：見てほしい入金のボタンと、入金の取り消し（決まりの紙 2-19・2-20・2-24、K200・K202・K205・K214・K216）。
// 1つの台帳の行から作った入金の合計は、行の額をこえない（書き込みの中で行の state とのこりを読み直してから、insertPaymentTx が守る）。
// 2人が同時に押した時：あとの方は、ここか insertPaymentTx の守りで止まるか、SQLITE_BUSY を busy に直して返す（待って入れ直す輪は作らない）。
// 人が決めた行（decided_by あり）は、自動の種類（first5）にせず manual と同じ扱いにする（K147：あとから自動では当てない）。
// =====================================================================

export type ReviewRowView = {
  group: 'review' | 'no_candidate' | 'closed';
  rowId: number; rowDate: string; amount: number; leftover: number; isLeftover: boolean;
  nameRaw: string | null; state: 'new' | 'hold' | 'matched' | 'not_recital' | 'void';
  reviewKind: ReviewKind | null; checkFlag: 'twin' | 'last' | 'manual_twin' | null;
  flagPair: { rowId: number; rowDate: string; amount: number; source: string } | null;
  refRead: string | null; refHouseholdId: number | null; nameMismatch: boolean;
  candidates: (Candidate & { refCode: string; contactName: string; remaining: number })[];
  notice: string | null; memo: string | null;
  overInfo: { paidOn: string; totalChangedAt: string | null; sameDay: boolean } | null;
};

const BUSY_RE = /SQLITE_BUSY|database is locked/i;
function isBusyError(e: unknown): boolean {
  if (!(e instanceof Error)) return BUSY_RE.test(String(e));
  return BUSY_RE.test(`${(e as { code?: string }).code ?? ''} ${e.message}`);
}

/** 書き込み1回。SQLITE_BUSY・database is locked は busy に直す（7 の submitEntry と同じ扱い） */
async function writeOrBusy<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  try {
    return await serialWriteTx(fn);
  } catch (e) {
    if (isBusyError(e)) throw new Error('busy');
    throw e;
  }
}

const fail28 = (code: string): never => {
  throw new Error(code);
};

/** 人が決めた行は、自動の種類（first5。自動で当たる条件がそろった物も first5 として扱う）を manual にする */
function kindOf(d: ReturnType<typeof decideRow>, humanTouched: boolean): ReviewKind | null {
  const k: ReviewKind | null = d.auto ? 'first5' : d.reviewKind;
  return humanTouched && k === 'first5' ? 'manual' : k;
}

const restOfRowSql = `r.amount - COALESCE((SELECT SUM(p.amount) FROM recital_payments p WHERE p.bank_transaction_id = r.id), 0)`;
const asState = (v: unknown) => String(v) as ReviewRowView['state'];
const asFlag = (v: unknown) => (v == null ? null : (String(v) as 'twin' | 'last' | 'manual_twin'));

/**
 * 見てほしい入金の一覧（2-19。K216）。開くたびに種類を計算し直して、前とちがえば review_kind を書く（入金は作らない。K147）。
 * 出す行：入金の振込で new／hold、または matched でのこりがある行（候補があれば review、無ければ no_candidate）。not_recital／void は closed（日付と金額だけ）。
 * 残高は返さない。並びは group の順、その中は row_date の古い順。
 */
export async function listReviewRows(eventKey: string): Promise<ReviewRowView[]> {
  const rows = await getAll(
    `SELECT r.*, ${restOfRowSql} AS rest FROM recital_bank_rows r
     WHERE r.event_key = ? AND r.dir = 'in' AND r.kind = 'transfer' ORDER BY r.row_date, r.id`,
    [eventKey],
  );
  const isOpen = (r: any) => {
    const st = String(r.state);
    return st === 'new' || st === 'hold' || (st === 'matched' && Number(r.rest) > 0);
  };
  const open = rows.filter(isOpen);
  const closedRows = rows.filter((r) => String(r.state) === 'not_recital' || String(r.state) === 'void');
  const out: ReviewRowView[] = [];
  if (open.length > 0) {
    const households = await loadMatchHouseholds(eventKey);
    const byRef = new Map(households.map((h) => [h.refCode, h]));
    const byId = new Map(households.map((h) => [h.id, h]));
    const contactOf = new Map(
      (await getAll('SELECT id, contact_last_name, contact_first_name FROM recital_households WHERE event_key = ?', [eventKey]))
        .map((h) => [Number(h.id), `${h.contact_last_name ?? ''} ${h.contact_first_name ?? ''}`.trim()]),
    );
    const first5Done = await countFirst5Done(readOf(null), eventKey);
    // しくみが作った返す分（1番。source_payment_id あり）が todo の世帯
    const sysRefund = new Set((await getAll(
      "SELECT DISTINCT household_id FROM recital_refunds WHERE event_key = ? AND status = 'todo' AND source_payment_id IS NOT NULL",
      [eventKey],
    )).map((r) => Number(r.household_id)));
    // 合計が下がった、いちばん新しい記録の日時（世帯ごと）
    const dropAt = new Map<number, string>();
    for (const c of await getAll(
      "SELECT household_id, before_json, after_json, created_at FROM recital_changes WHERE event_key = ? AND action = 'total_changed' AND household_id IS NOT NULL ORDER BY id DESC",
      [eventKey],
    )) {
      const hid = Number(c.household_id);
      if (dropAt.has(hid)) continue;
      const bf = totalOf(c.before_json);
      const af = totalOf(c.after_json);
      if (bf !== null && af !== null && af < bf) dropAt.set(hid, String(c.created_at));
    }
    const live = rows.filter((r) => String(r.state) !== 'void');
    const updates: { sql: string; args: (string | number | null)[] }[] = [];
    for (const r of open) {
      const rowId = Number(r.id);
      const rest = Number(r.rest);
      const ref = r.ref_read == null ? null : String(r.ref_read);
      const sameRefOpenAmounts = ref === null
        ? []
        : open.filter((x) => Number(x.id) !== rowId && String(x.ref_read ?? '') === ref && (String(x.state) === 'new' || String(x.state) === 'hold') && Number(x.rest) > 0).map((x) => Number(x.rest));
      const mr = matchRowOfDb(r, rest);
      const kind = kindOf(decideRow(mr, byRef, { first5Done, firstOk: false, sameRefOpenAmounts }), r.decided_by != null);
      const stored = r.review_kind == null ? null : String(r.review_kind);
      if (kind !== stored) {
        updates.push({ sql: 'UPDATE recital_bank_rows SET review_kind = ? WHERE id = ? AND state = ? AND review_kind IS ?', args: [kind, rowId, String(r.state), stored] });
      }
      const cand = candidatesFor(mr, households);
      const h = ref === null ? undefined : byRef.get(ref);
      const checkFlag = asFlag(r.check_flag);
      let overInfo: ReviewRowView['overInfo'] = null;
      if (kind === 'over' || (h && sysRefund.has(h.id))) {
        const at = h ? dropAt.get(h.id) ?? null : null;
        overInfo = { paidOn: String(r.row_date), totalChangedAt: at, sameDay: at !== null && todayJst(new Date(at)) === String(r.row_date) };
      }
      out.push({
        group: cand.list.length > 0 ? 'review' : 'no_candidate',
        rowId, rowDate: String(r.row_date), amount: Number(r.amount), leftover: rest, isLeftover: String(r.state) === 'matched' && rest > 0,
        nameRaw: r.desc_raw == null ? null : readRefFromDesc(String(r.desc_raw)).nameRaw,
        state: asState(r.state), reviewKind: kind, checkFlag, flagPair: flagPairOf(r, checkFlag, live),
        refRead: ref, refHouseholdId: h ? h.id : null,
        nameMismatch: !!h && !surnameMatches(mr.nameRaw, h.surnamesKana, h.told?.name ?? null),
        candidates: cand.list.map((c) => ({ ...c, refCode: byId.get(c.householdId)?.refCode ?? '', contactName: contactOf.get(c.householdId) ?? '', remaining: byId.get(c.householdId)?.remaining ?? 0 })),
        notice: cand.notice, memo: r.memo == null ? null : String(r.memo), overInfo,
      });
    }
    if (updates.length > 0) {
      // 種類の書きもどしが落ちても、一覧は出す（次に開いた時に書き直す）。ログには行の数と短い語だけ
      try {
        await serialWrite(() => batch(updates, 'write'));
      } catch (e) {
        console.error(`[recital] 見てほしい入金の種類を書きもどせませんでした rows=${updates.length}`, isBusyError(e) ? 'busy' : 'db_error');
      }
    }
  }
  for (const r of closedRows) {
    out.push({
      group: 'closed', rowId: Number(r.id), rowDate: String(r.row_date), amount: Number(r.amount), leftover: 0, isLeftover: false,
      nameRaw: null, state: asState(r.state), reviewKind: null, checkFlag: null, flagPair: null, refRead: null, refHouseholdId: null,
      nameMismatch: false, candidates: [], notice: null, memo: null, overInfo: null,
    });
  }
  const order = { review: 0, no_candidate: 1, closed: 2 } as const;
  const pos = new Map(rows.map((r, i) => [Number(r.id), i]));
  return out.sort((a, b) => order[a.group] - order[b.group] || (pos.get(a.rowId) ?? 0) - (pos.get(b.rowId) ?? 0));
}

/**
 * 印の相手の行。twin は 25 の flagRows（残高が同じで、金額か日付だけがちがう）と、27 の撮り直し（同じ番号・日・金額で残高だけがちがう）の見方。
 * manual_twin は、日付・金額が同じで、手で打った行とそうでない行の組（どちらの行にも相手を出す）。
 */
function flagPairOf(r: any, flag: ReviewRowView['checkFlag'], live: any[]): ReviewRowView['flagPair'] {
  if (flag !== 'twin' && flag !== 'manual_twin') return null;
  const id = Number(r.id);
  const bal = r.balance == null ? null : Number(r.balance);
  const others = live.filter((l) => Number(l.id) !== id);
  const hit = flag === 'twin'
    ? others.find((l) => {
        const lb = l.balance == null ? null : Number(l.balance);
        const sameBal = lb !== null && bal !== null && lb === bal;
        const sameAmt = Number(l.amount) === Number(r.amount);
        const sameDate = String(l.row_date) === String(r.row_date);
        const refTwin = r.ref_read != null && String(l.ref_read ?? '') === String(r.ref_read) && sameDate && sameAmt && lb !== bal;
        return (sameBal && ((sameAmt && !sameDate) || (sameDate && !sameAmt))) || refTwin;
      })
    : others.find((l) => String(l.row_date) === String(r.row_date) && Number(l.amount) === Number(r.amount)
        && (String(r.source) === 'manual') !== (String(l.source) === 'manual'));
  return hit ? { rowId: Number(hit.id), rowDate: String(hit.row_date), amount: Number(hit.amount), source: String(hit.source) } : null;
}

/** 足すとぴったりの組：pool（古い順）の部分の和が need になる、いちばん小さい組み合わせの番号の物。10行をこえたら探さない */
function pickSumRows<T extends { rest: number }>(pool: T[], need: number): T[] {
  if (need <= 0 || pool.length === 0 || pool.length > 10) return [];
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    let s = 0;
    for (let i = 0; i < pool.length; i++) if (mask & (1 << i)) s += pool[i].rest;
    if (s === need) return pool.filter((_, i) => mask & (1 << i));
  }
  return [];
}

/**
 * 「この世帯に当てる」「2つの世帯に分ける」（2-19・2-24）。1つの書き込みで、行の state とのこりを読み直してから当てる。
 * 足すとぴったり（sum）で、選んだ世帯が番号の世帯なら、同じ番号の決まっていない行のうち、足して残りになる組も同じ書き込みで当てる（古い順）。
 * メールは書き込みの外で、世帯ごとに1通（その世帯で新しい方の入金の鍵）。読みまちがいで取り消した入金と同じ額で、同じ世帯に当て直した時は出さない（K202）。
 */
export async function assignBankRow(
  rowId: number,
  alloc: { householdId: number; amount: number }[],
  opts: { sendRemaining: boolean; confirmFlag: boolean },
  staffName: string,
): Promise<{ paymentIds: number[] }> {
  if (!Number.isInteger(rowId)) fail28('not_found');
  if (!Array.isArray(alloc) || alloc.length < 1 || alloc.length > 2
    || alloc.some((a) => !a || !Number.isInteger(a.householdId) || !Number.isInteger(a.amount) || a.amount <= 0)
    || (alloc.length === 2 && alloc[0].householdId === alloc[1].householdId)) fail28('bad_alloc');
  const stamp = nowUtcIso();
  const r = await writeOrBusy(async (tx) => {
    const read = readOf(tx);
    const row = (await read('SELECT * FROM recital_bank_rows WHERE id = ?', [rowId]))[0];
    if (!row) fail28('not_found');
    if (!isTransferIn({ dir: String(row.dir), kind: String(row.kind) })) fail28('bad_state');
    const eventKey = String(row.event_key);
    const st = String(row.state);
    const paidOnRow = Number((await read('SELECT COALESCE(SUM(amount), 0) AS n FROM recital_payments WHERE bank_transaction_id = ?', [rowId]))[0]?.n ?? 0);
    const rest = Number(row.amount) - paidOnRow;
    if (!((st === 'new' || st === 'hold' || st === 'matched') && rest > 0)) fail28('bad_state');
    // のこりの行は1世帯だけ（2つに分けるのは、のこりが行の額と同じ時だけ）。合計はのこりと同じ
    if (alloc.reduce((a, x) => a + x.amount, 0) !== rest) fail28('bad_alloc');
    if (alloc.length === 2 && rest !== Number(row.amount)) fail28('bad_alloc');
    if (row.check_flag != null && !opts.confirmFlag) fail28('confirm_flag');
    for (const a of alloc) {
      const h = (await read('SELECT event_key, status FROM recital_households WHERE id = ?', [a.householdId]))[0];
      if (!h) fail28('not_found');
      if (String(h.event_key) !== eventKey) fail28('bad_alloc');
      if (String(h.status) !== 'active') fail28('merged');
    }

    // 今の種類を出し直す（番号の世帯の残りは書き込みの中で読み直す）
    const ref = row.ref_read == null ? null : String(row.ref_read);
    const hs = ref === null ? [] : await loadMatchHouseholdsCore(read, eventKey, ref);
    for (const h of hs) {
      const money = await readHouseholdMoneyTx(tx, h.id);
      h.remaining = money.m.remaining;
      h.view = money.view;
    }
    const byRef = new Map(hs.map((h) => [h.refCode, h]));
    const openOthers = ref === null
      ? []
      : (await read(
          `SELECT r.id, r.row_date, r.state, r.check_flag, r.desc_raw, ${restOfRowSql} AS rest FROM recital_bank_rows r
           WHERE r.event_key = ? AND r.ref_read = ? AND r.dir = 'in' AND r.kind = 'transfer' AND r.state IN ('new', 'hold') AND r.id <> ?
           ORDER BY r.row_date, r.id`,
          [eventKey, ref, rowId],
        )).map((x) => ({ ...x, rest: Number(x.rest) })).filter((x) => x.rest > 0);
    const first5Done = await countFirst5Done(read, eventKey);
    const d = decideRow(matchRowOfDb(row, rest), byRef, { first5Done, firstOk: false, sameRefOpenAmounts: openOthers.map((x) => x.rest) });
    const kind = kindOf(d, row.decided_by != null);
    const refH = byRef.get(ref ?? '');
    const toRefHousehold = !!refH && alloc.length === 1 && alloc[0].householdId === refH.id;
    // はじめの5件に数えるのは、条件がそろった行（first5）を、1世帯に全額、番号の世帯へ当てた時だけ（2-23）
    const source: 'bank_auto' | 'bank_staff' = kind === 'first5' && toRefHousehold ? 'bank_auto' : 'bank_staff';
    // 足すとぴったりの組に入れるのは new の行だけ（保留はスタッフが決めた物なので、ここで当てない）
    const extras = kind === 'sum' && toRefHousehold ? pickSumRows(openOthers.filter((x) => String(x.state) === 'new'), refH.remaining - rest) : [];
    if (extras.some((x) => x.check_flag != null) && !opts.confirmFlag) fail28('confirm_flag');

    // 読みまちがいで取り消した入金と同じ額で、同じ世帯に当て直す時は、確認のメールを出さない（K202）
    const amountOf = new Map<number, number>();
    for (const a of alloc) amountOf.set(a.householdId, (amountOf.get(a.householdId) ?? 0) + a.amount);
    for (const x of extras) amountOf.set(refH!.id, (amountOf.get(refH!.id) ?? 0) + x.rest);
    const quiet = new Set<number>();
    for (const [hid, amt] of amountOf) {
      const c = (await read("SELECT reason, after_json FROM recital_changes WHERE household_id = ? AND action = 'payment_cancelled' ORDER BY id DESC LIMIT 1", [hid]))[0];
      if (!c || String(c.reason) !== 'misread') continue;
      let a: { paymentId?: unknown; amount?: unknown; reversalId?: unknown } | null = null;
      try { a = JSON.parse(String(c.after_json)); } catch { a = null; }
      if (!a || Number(a.amount) !== amt) continue;
      const since = Number(a.reversalId ?? a.paymentId);
      const later = Number((await read("SELECT COUNT(*) AS n FROM recital_payments WHERE household_id = ? AND method = 'bank' AND amount > 0 AND id > ?", [hid, since]))[0]?.n ?? 0);
      if (later === 0) quiet.add(hid);
    }

    const paymentIds: number[] = [];
    const newestOf = new Map<number, number>();
    const logs: { hid: number; rowId: number; amount: number; paymentId: number }[] = [];
    const pay = async (hid: number, amount: number, r2: any) => {
      const desc = r2.desc_raw == null ? null : String(r2.desc_raw);
      const res = await insertPaymentTx(
        tx,
        {
          householdId: hid, method: 'bank', amount, paidOn: String(r2.row_date), source: r2 === row ? source : 'bank_staff', confirmedBy: staffName,
          bankRowId: Number(r2.id), bankDate: String(r2.row_date), bankDesc: desc, payerNameRaw: desc === null ? null : readRefFromDesc(desc).nameRaw,
        },
        staffName,
      );
      paymentIds.push(res.paymentId);
      newestOf.set(hid, Math.max(newestOf.get(hid) ?? 0, res.paymentId));
      logs.push({ hid, rowId: Number(r2.id), amount, paymentId: res.paymentId });
    };
    const decide = async (id: number, state: string, matchBy: 'auto' | 'staff') => {
      const u = await tx.execute({
        sql: "UPDATE recital_bank_rows SET state = 'matched', match_by = ?, review_kind = NULL, decided_by = ?, decided_at = ? WHERE id = ? AND state = ?",
        args: [matchBy, staffName, stamp, id, state],
      });
      if (u.rowsAffected !== 1) fail28('bad_state');
    };
    for (const a of alloc) await pay(a.householdId, a.amount, row);
    await decide(rowId, st, source === 'bank_auto' ? 'auto' : 'staff');
    for (const x of extras) {
      await pay(refH!.id, x.rest, x);
      await decide(Number(x.id), String(x.state), 'staff');
    }
    // 記録は入金ごとに1行。paymentIds＝この1回の操作でその世帯に作った入金の全部（取り消す時に、組の待ちのメールもいっしょに取りやめるため）
    for (const l of logs) {
      const group = logs.filter((x) => x.hid === l.hid).map((x) => x.paymentId);
      await logChangeTx(tx, { eventKey, householdId: l.hid, action: 'bank_row_decided', actor: staffName, after: { rowId: l.rowId, householdId: l.hid, amount: l.amount, paymentId: l.paymentId, paymentIds: group } });
    }
    return { paymentIds, households: [...amountOf.keys()], newestOf, quiet };
  });

  // 書き込みの外で：メール（世帯ごとに1通）→ お金が変わったあとの仕事。失敗しても当てた入金はそのまま
  for (const hid of r.households) {
    if (!r.quiet.has(hid)) {
      try {
        await sendPaidMail(hid, r.newestOf.get(hid)!, 'bank', { sendRemaining: opts.sendRemaining });
      } catch (e) {
        console.error(`[recital] ご入金を確認しましたのメールを記録できませんでした household=${hid}`, e instanceof Error && e.message.startsWith('recital_') ? e.message : 'error');
      }
    }
    await afterMoneyChanged(hid, 'payment');
  }
  return { paymentIds: r.paymentIds };
}

/** 入金の振込の行の、生きている入金の合計 */
async function paidOnRowTx(tx: Transaction, rowId: number): Promise<number> {
  return Number((await tx.execute({ sql: 'SELECT COALESCE(SUM(amount), 0) AS n FROM recital_payments WHERE bank_transaction_id = ?', args: [rowId] })).rows[0]?.n ?? 0);
}

/**
 * 「発表会ではない」「保留」「読みまちがいにする」（2-19）。どの行も、生きている入金の無い（new／hold の）入金の振込の行。
 * not_recital は名義（desc_raw・desc_norm）を消す（日付・金額・残高・鍵は残す）。hold はメモを入れる。void は鍵から外れる。1回の書き込み。
 */
export async function setBankRowState(rowIds: number[], state: 'not_recital' | 'hold' | 'void', memo: string | null, staffName: string): Promise<void> {
  if (!Array.isArray(rowIds) || rowIds.length === 0 || rowIds.some((id) => !Number.isInteger(id))) fail28('not_found');
  if (state !== 'not_recital' && state !== 'hold' && state !== 'void') fail28('bad_state');
  const memoText = memo == null || memo.trim() === '' ? null : memo.trim();
  const stamp = nowUtcIso();
  await writeOrBusy(async (tx) => {
    for (const id of [...new Set(rowIds)]) {
      const row = (await tx.execute({ sql: 'SELECT id, event_key, dir, kind, state FROM recital_bank_rows WHERE id = ?', args: [id] })).rows[0];
      if (!row) fail28('not_found');
      if (!isTransferIn({ dir: String(row.dir), kind: String(row.kind) })) fail28('bad_state');
      if ((await paidOnRowTx(tx, id)) > 0) fail28('has_payment');
      const from = String(row.state);
      if (from !== 'new' && from !== 'hold') fail28('bad_state');
      const nameSql = state === 'not_recital' ? ', desc_raw = NULL, desc_norm = NULL' : '';
      await tx.execute({
        sql: `UPDATE recital_bank_rows SET state = ?, memo = COALESCE(?, memo), decided_by = ?, decided_at = ?${nameSql} WHERE id = ? AND state = ?`,
        args: [state, memoText, staffName, stamp, id, from],
      });
      await logChangeTx(tx, { eventKey: String(row.event_key), action: 'bank_row_decided', actor: staffName, before: { rowId: id, state: from }, after: { rowId: id, state } });
    }
  });
}

/**
 * 「もとにもどす」（K214）。not_recital／hold／void の入金の振込の行を new にもどす。理由が要る。
 * もどした行は自動では当てない（種類は manual・decided_by あり）。not_recital からもどした行の名義は空のまま。
 */
export async function restoreBankRow(rowId: number, reason: string, staffName: string): Promise<void> {
  if (typeof reason !== 'string' || reason.trim() === '') fail28('reason_required');
  if (!Number.isInteger(rowId)) fail28('not_found');
  const stamp = nowUtcIso();
  await writeOrBusy(async (tx) => {
    const row = (await tx.execute({ sql: 'SELECT id, event_key, dir, kind, state, row_key FROM recital_bank_rows WHERE id = ?', args: [rowId] })).rows[0];
    if (!row) fail28('not_found');
    if (!isTransferIn({ dir: String(row.dir), kind: String(row.kind) })) fail28('bad_state');
    const from = String(row.state);
    if (from !== 'not_recital' && from !== 'hold' && from !== 'void') fail28('bad_state');
    if (from === 'void') {
      const taken = (await tx.execute({
        sql: "SELECT id FROM recital_bank_rows WHERE event_key = ? AND row_key = ? AND state <> 'void' AND id <> ? LIMIT 1",
        args: [String(row.event_key), String(row.row_key), rowId],
      })).rows[0];
      if (taken) fail28('key_taken');
    }
    await tx.execute({
      sql: "UPDATE recital_bank_rows SET state = 'new', match_by = NULL, review_kind = 'manual', decided_by = ?, decided_at = ? WHERE id = ? AND state = ?",
      args: [staffName, stamp, rowId, from],
    });
    await logChangeTx(tx, {
      eventKey: String(row.event_key), action: 'bank_row_decided', actor: staffName, reason: reason.trim(),
      before: { rowId, state: from }, after: { rowId, state: 'new' },
    });
  });
}

/**
 * 「同じ入金にする」（K205）。手で打った行（manual・void でない）と、あとから入った行（chat／file・日付・入出・金額が同じ・生きている入金なし）。
 * manual の行の入金（マイナスもふくむ）を新しい行に付けかえ → 新しい行に manual の行の state・match_by を写す → manual の行は void → 両方の印を外す。メールは出さない。
 */
export async function mergeManualRow(manualRowId: number, newRowId: number, staffName: string): Promise<void> {
  if (!Number.isInteger(manualRowId) || !Number.isInteger(newRowId) || manualRowId === newRowId) fail28('bad_state');
  const stamp = nowUtcIso();
  await writeOrBusy(async (tx) => {
    const get = async (id: number) => (await tx.execute({ sql: 'SELECT * FROM recital_bank_rows WHERE id = ?', args: [id] })).rows[0] as any;
    const man = await get(manualRowId);
    const neu = await get(newRowId);
    if (!man || !neu) fail28('not_found');
    if (String(man.source) !== 'manual' || String(man.state) === 'void') fail28('bad_state');
    if (!['chat', 'file'].includes(String(neu.source)) || String(neu.state) === 'void' || String(neu.event_key) !== String(man.event_key)) fail28('bad_state');
    // 入金が付くのは入金の振込の行だけ（核の insertPaymentTx と同じ守り）
    if (!isTransferIn({ dir: String(neu.dir), kind: String(neu.kind) })) fail28('bad_state');
    if (String(neu.row_date) !== String(man.row_date) || String(neu.dir) !== String(man.dir) || Number(neu.amount) !== Number(man.amount)) fail28('bad_state');
    if ((await paidOnRowTx(tx, newRowId)) > 0) fail28('bad_state');
    const desc = neu.desc_raw == null ? null : String(neu.desc_raw);
    await tx.execute({
      sql: 'UPDATE recital_payments SET bank_transaction_id = ?, bank_date = ?, bank_desc = ?, payer_name_raw = ? WHERE bank_transaction_id = ?',
      args: [newRowId, String(neu.row_date), desc, desc === null ? null : readRefFromDesc(desc).nameRaw, manualRowId],
    });
    const st = String(man.state);
    // 写した行は人が決めた行（自動では当てない）。まだ当てていない行なら種類は manual。発表会ではない行なら名義も消す
    await tx.execute({
      sql: `UPDATE recital_bank_rows SET state = ?, match_by = ?, check_flag = NULL, review_kind = ?, decided_by = ?, decided_at = ?, memo = COALESCE(memo, ?)
            ${st === 'not_recital' ? ', desc_raw = NULL, desc_norm = NULL' : ''} WHERE id = ?`,
      args: [st, man.match_by ?? null, st === 'new' || st === 'hold' ? 'manual' : null, staffName, stamp, man.memo ?? null, newRowId],
    });
    await tx.execute({
      sql: "UPDATE recital_bank_rows SET state = 'void', check_flag = NULL, decided_by = ?, decided_at = ? WHERE id = ?",
      args: [staffName, stamp, manualRowId],
    });
    await logChangeTx(tx, {
      eventKey: String(man.event_key), action: 'bank_row_decided', actor: staffName,
      before: { rowId: manualRowId, state: st }, after: { rowId: newRowId, state: st, mergedFrom: manualRowId },
    });
  });
}

const CANCEL_MEMO: Record<'wrong_household' | 'misread', string> = {
  wrong_household: '取り消し（ちがう世帯に当てた）',
  misread: '取り消し（読みまちがいを直すため）',
};
const NEGATIVE_ROLLBACK = 'recital_bank:negative_rollback';

/**
 * 「この入金を取り消す」（2-24。K200・K202）。1つの書き込みで：しくみの返す分（todo→cancelled。done があれば何も書かずに refund_done）→
 * マイナスの行（払った額が0未満になるなら negative で、書き込みはまき戻る）→ 台帳の行（入金の合計が0なら new・自動では当てない印）→
 * 「振り込みました」の印をもどす（名義は空）→ 待ちのメールは取りやめ → 記録。メールは出さない。
 */
export async function cancelBankPayment(
  paymentId: number,
  reason: 'wrong_household' | 'misread',
  staffName: string,
): Promise<{ ok: boolean; code?: 'refund_done' | 'negative' }> {
  if (reason !== 'wrong_household' && reason !== 'misread') fail28('reason_required');
  if (!Number.isInteger(paymentId)) fail28('not_found');
  const stamp = nowUtcIso();
  let r: { kind: 'refund_done' } | { kind: 'ok'; householdId: number };
  try {
    r = await writeOrBusy(async (tx) => {
      const read = readOf(tx);
      const p = (await read('SELECT id, event_key, household_id, method, amount, bank_transaction_id FROM recital_payments WHERE id = ?', [paymentId]))[0];
      if (!p) fail28('not_found');
      if (String(p.method) !== 'bank' || Number(p.amount) <= 0 || p.bank_transaction_id == null || p.household_id == null) fail28('bad_state');
      const hid = Number(p.household_id);
      const rowId = Number(p.bank_transaction_id);
      const amount = Number(p.amount);
      const eventKey = String(p.event_key);
      const h = (await read('SELECT status, bank_told_at FROM recital_households WHERE id = ?', [hid]))[0];
      if (!h) fail28('not_found');
      if (String(h.status) !== 'active') fail28('merged');
      const pays = (await read('SELECT id, method, amount, bank_transaction_id FROM recital_payments WHERE household_id = ?', [hid])).map((x) => ({
        id: Number(x.id), method: String(x.method), amount: Number(x.amount), bank_transaction_id: x.bank_transaction_id == null ? null : Number(x.bank_transaction_id),
      }));
      const sameRow = pays.filter((x) => x.bank_transaction_id === rowId).reduce((a, x) => a + x.amount, 0);
      if (sameRow <= 0 || reversedBankPaymentIds(pays).has(paymentId)) fail28('already_cancelled');

      // しくみが作った返す分（K200）
      const refunds = await read('SELECT id, amount, reason_no, status FROM recital_refunds WHERE source_payment_id = ?', [paymentId]);
      if (refunds.some((x) => String(x.status) === 'done')) return { kind: 'refund_done' as const };
      for (const rf of refunds.filter((x) => String(x.status) === 'todo')) {
        await tx.execute({ sql: "UPDATE recital_refunds SET status = 'cancelled' WHERE id = ? AND status = 'todo'", args: [Number(rf.id)] });
        await logChangeTx(tx, {
          eventKey, householdId: hid, action: 'refund_cancelled', actor: staffName, reason: CANCEL_MEMO[reason],
          before: { refundId: Number(rf.id), status: 'todo', amount: Number(rf.amount), reasonNo: Number(rf.reason_no) },
          after: { refundId: Number(rf.id), status: 'cancelled' },
        });
      }

      // マイナスの行（9 の守りが、払った額の0未満・行の合計をこえる物を拒む）
      let neg: Awaited<ReturnType<typeof insertPaymentTx>>;
      try {
        neg = await insertPaymentTx(
          tx,
          { householdId: hid, method: 'bank', amount: -amount, paidOn: todayJst(), source: 'bank_staff', confirmedBy: staffName, bankRowId: rowId, memo: CANCEL_MEMO[reason] },
          staffName,
        );
      } catch (e) {
        if (e instanceof Error && e.message === 'recital_money:negative') throw new Error(NEGATIVE_ROLLBACK);
        throw e;
      }

      // 台帳の行：入金の合計が0なら new（自動では当てない＝人が決めた行の印）。のこっていれば matched のまま（K216）
      if ((await paidOnRowTx(tx, rowId)) === 0) {
        await tx.execute({
          sql: "UPDATE recital_bank_rows SET state = 'new', match_by = NULL, review_kind = 'manual', decided_by = ?, decided_at = ? WHERE id = ?",
          args: [staffName, stamp, rowId],
        });
      }

      // その入金が閉じた「振り込みました」の印をもどす（記録の before.told。名義は記録に無いので空。新しい印が開いていればもどさない）
      if (h.bank_told_at == null) {
        const recs = await read("SELECT before_json, after_json FROM recital_changes WHERE household_id = ? AND action = 'payment_recorded' ORDER BY id DESC", [hid]);
        type Told = { at?: unknown; date?: unknown; amount?: unknown; by?: unknown };
        const toldOf = (): Told | null => {
          for (const rec of recs) {
            try {
              const a = JSON.parse(String(rec.after_json ?? 'null')) as { paymentId?: unknown } | null;
              if (!a || Number(a.paymentId) !== paymentId) continue;
              return (JSON.parse(String(rec.before_json ?? 'null')) as { told?: Told | null } | null)?.told ?? null;
            } catch { /* 読めない記録は飛ばす */ }
          }
          return null;
        };
        const told = toldOf();
        if (told && told.at != null) {
          await tx.execute({
            sql: `UPDATE recital_households SET bank_told_at = ?, bank_told_date = ?, bank_told_name = NULL, bank_told_amount = ?, bank_told_by = ?
                  WHERE id = ? AND bank_told_at IS NULL`,
            args: [String(told.at), told.date == null ? null : String(told.date), told.amount == null ? null : Number(told.amount), told.by == null ? null : String(told.by), hid],
          });
        }
      }

      // 待ちのメールの取りやめ：この入金と、同じ1回の操作（足すとぴったり）で作った入金の鍵の分も（鍵は新しい方の入金に付いているため）
      const together = new Set<number>([paymentId]);
      for (const c of await read("SELECT after_json FROM recital_changes WHERE household_id = ? AND action = 'bank_row_decided' ORDER BY id DESC", [hid])) {
        try {
          const a = JSON.parse(String(c.after_json ?? 'null')) as { paymentIds?: unknown } | null;
          const ids = Array.isArray(a?.paymentIds) ? a.paymentIds.map(Number) : [];
          if (ids.includes(paymentId)) ids.forEach((x) => together.add(x));
        } catch { /* 読めない記録は飛ばす */ }
      }
      for (const id of together) await cancelWaitingMailsTx(tx, id);
      await logChangeTx(tx, {
        eventKey, householdId: hid, action: 'payment_cancelled', actor: staffName, reason,
        after: { paymentId, amount, reversalId: neg.paymentId, bankRowId: rowId },
      });
      return { kind: 'ok' as const, householdId: hid };
    });
  } catch (e) {
    if (e instanceof Error && e.message === NEGATIVE_ROLLBACK) return { ok: false, code: 'negative' };
    throw e;
  }
  if (r.kind === 'refund_done') return { ok: false, code: 'refund_done' };
  await afterMoneyChanged(r.householdId, 'payment');
  return { ok: true };
}

// =====================================================================
// Task 29：見てほしい入金と、入金の取り込みの画面が読む物。
// =====================================================================

/**
 * 「振り込みました」のまま3日の世帯（2-20）。active で、印（bank_told_at・bank_told_amount）があり、残りが 0 より大きく、
 * bankToldWaitDue（3日の数え方の正本。休みの日は数えない）が true の世帯。並びは bank_told_at の古い順。
 * 最初の画面の見てほしいことの4番 (b) も、これを呼ぶ（条件を2か所に持たない）。
 * pre：呼ぶ側がもう読んだ設定・世帯ごとのお金（readMoneyByHousehold の返り）があれば渡す（同じ表を2回読まない）。
 */
export async function listToldWaiting(
  eventKey: string,
  now?: Date,
  pre?: { settings?: RecitalSettings; money?: Map<number, MoneySummary> },
): Promise<HouseholdRow[]> {
  const nowMs = (now ?? new Date()).getTime();
  const hs = await getAll(
    `SELECT * FROM recital_households
     WHERE event_key = ? AND status = 'active' AND bank_told_at IS NOT NULL AND bank_told_amount IS NOT NULL
     ORDER BY bank_told_at, id`,
    [eventKey],
  );
  if (hs.length === 0) return [];
  const s = pre?.settings ?? (await getRecitalSettings(eventKey));
  const money = pre?.money ?? (await readMoneyByHousehold(eventKey));
  return hs
    .filter((h) => (money.get(Number(h.id))?.remaining ?? 0) > 0 && bankToldWaitDue(String(h.bank_told_at), nowMs, s.bank_rest_from, s.bank_rest_to))
    .map((h) => ({ ...h }) as HouseholdRow);
}

/** recital_imports の列そのまま */
export type ImportRow = {
  id: number; event_key: string; created_at: string; kind: string; read_rows: number; inserted: number; existing: number; rejected: number;
  imported_by: string | null; imported_at: string | null; shot_on: string | null; range_from: string | null; range_to: string | null;
  images: number | null; source: string | null; check_result: string | null;
};

/** その発表会の束の記録の全部（imported_at の新しい順。合わなかった束・dry の記録もふくむ） */
export async function listImports(eventKey: string): Promise<ImportRow[]> {
  return (await getAll('SELECT * FROM recital_imports WHERE event_key = ? ORDER BY imported_at DESC, id DESC', [eventKey])).map((r) => ({ ...r }) as ImportRow);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

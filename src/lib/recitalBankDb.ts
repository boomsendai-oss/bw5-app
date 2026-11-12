// BW6 発表会（段階1）の入金の束を入れる所（Task 27）：検算 → 台帳（recital_bank_rows）と束の記録（recital_imports）→
// 古い順に1行ずつ自動で当てる → 「ご入金を確認しました」のメール。
// 決まりの正本は設計書 05 5-6、決まりの紙 2-17・2-18・2-19・2-23（K144・K146・K147・K151・K191・K201・K209）。
// 純な計算は recitalBankBatch（束・検算・印）と recitalBankMatch（当てる）。ここに同じ計算を書かない。
// DB は src/lib/db.ts 経由だけ。名前と型の正本は .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
// 守り：合わない束では台帳にも入金にも1行も書かない。dry は（合わなかった時の束の記録の1行のほか）何も書かない。
// 1つの台帳の行の入金は1回だけ（書き込みの中で state='new' を読み直し、当てたら同じ書き込みで matched にする）。
// 返す物とログに、名義・摘要・世帯の名前・残高を入れない（K146・R-18）。
import type { Transaction } from '@libsql/client';
import { getAll, getOne, withWriteTx } from '@/lib/db';
import { nowUtcIso, shiftDays, todayJst } from '@/lib/dateJst';
import { FIRST5_LIMIT, householdView, moneySummary, type RecitalSettings } from '@/lib/recital';
import { checkBatch, flagRows, normalizeBatch, type BankBatchIn, type LedgerRowLite, type NormRow } from '@/lib/recitalBankBatch';
import { decideRow, surnameMatches, type MatchHousehold, type MatchRow, type ReviewKind } from '@/lib/recitalBankMatch';
import { getRecitalEvent, getRecitalSettings, logChangeTx } from '@/lib/recitalDb';
import { sendPaidMail } from '@/lib/recitalMail';
import { afterMoneyChanged, insertPaymentTx, readHouseholdMoneyTx } from '@/lib/recitalMoneyDb';
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

function nearText(near: { date: string; amount: number }, isStart: boolean): string {
  const md = mdParts(near.date);
  const day = md ? `${md[0]}月${md[1]}日` : '日付の読めない';
  if (isStart) return `${day}（期間の開始日）`;
  return `${day}の ${yen(near.amount)}円の行のあたり`;
}

function ngResult(near: { date: string; amount: number }): string {
  const md = mdParts(near.date);
  return `ng:${md ? `${md[0]}/${md[1]}` : '?'}:${near.amount}`;
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
    const isStart = check.near.amount === 0 && b.range_from > startDate && check.near.date === startDate;
    const checkResult = ngResult(check.near);
    const full = mode === 'commit';
    await withWriteTx(async (tx) => {
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
      mode, check: { ok: false, near: nearText(check.near, isStart), lastOkDate: await lastOkDate(b.event_key) }, ...empty,
      ...(joinMismatch.length > 0 ? { join_mismatch: joinMismatch } : {}),
    };
  }

  // ---- 合う束：分ける ----
  const liveKeys = new Set(ledger.map((l) => l.row_key));
  const marked = flagRows(rows, ledger);
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
  const insertedIds = await withWriteTx(async (tx) => {
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
  if (b.first_ok === true) {
    for (const r of await getAll(`SELECT id FROM recital_bank_rows WHERE event_key = ? AND state = 'new' AND review_kind = 'first5'`, [b.event_key])) targetIds.add(Number(r.id));
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
      d = await matchOneRow(b.event_key, rowId, b.first_ok === true);
    } catch (e) {
      failedRows++;
      const code = e instanceof Error && e.message.startsWith('recital_') ? e.message : 'db_error';
      console.error(`[recital] 入金の行を当てられませんでした row=${rowId}`, code);
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
  return withWriteTx(async (tx) => {
    const read = readOf(tx);
    const row = (await read('SELECT * FROM recital_bank_rows WHERE id = ? AND event_key = ?', [rowId, eventKey]))[0];
    // void・出金・振込でない行には入金を作らない（当てるのは、まだ決まっていない入金の振込の行だけ）
    if (!row || String(row.state) !== 'new' || !isTransferIn({ dir: String(row.dir), kind: String(row.kind) })) return { kind: 'skip' };
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

/**
 * dry：書かない。新しい入金の振込の行と、（はじめの5件の間は）台帳で first5 で待っている行の全部について、
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
    ? await getAll(`SELECT r.*, ${restSql} FROM recital_bank_rows r WHERE r.event_key = ? AND r.state = 'new' AND r.review_kind = 'first5' ORDER BY r.row_date, r.id`, [b.event_key])
    : [];
  // 束に写っている台帳の行（もうある行）には束の pos、写っていない行は ledger-<id>
  const posByKey = new Map(allRows.map((r) => [r.rowKey, r.pos]));
  for (const l of ledgerFirst5) {
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
/* eslint-enable @typescript-eslint/no-explicit-any */

// BW6 発表会（段階1）の入金の「束」（TARO の毎日のスクショ、または明細の CSV から読んだ行のまとまり）。
// 純関数。DB にさわらない。名前と型の正本は .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
// 決まりの正本は設計書 05 5-6「台帳と検算」（D5 2-17・2-18、K142〜K145・K189・K190・K201・K205）。
// 行は、どの source でも「上が新しい順」（スマホの画面の順）。file の行は並べ直さない（preflight H13）。
import { readRefFromDesc } from '@/lib/recitalRef';

export type BankBatchRowIn = { pos: string; date: string; dir: 'in' | 'out'; amount: number | null; balance: number | null; kind: 'transfer' | 'debit' | 'other'; desc: string; cut: boolean; unread: string };
export type BankBatchIn = { event_key: string; source: 'chat' | 'manual' | 'file'; shot_on: string; range_from: string; range_to: string; images: number; account: string; rows: BankBatchRowIn[]; first_ok?: boolean };
export type LedgerRowLite = { id: number; row_key: string; row_date: string; dir: string; amount: number; balance: number | null; kind: string; source: string; state: string };
export type NormRow = { rowDate: string; dir: 'in' | 'out'; amount: number; balance: number | null; kind: string; descRaw: string | null; descNorm: string | null; cut: number; unread: string | null; refRead: string | null; refOk: number; rowKey: string; pos: string; checkFlag: 'twin' | 'last' | 'manual_twin' | null };

/** 1つの束の行の上限。こえたら月ごとに分けて渡す */
export const BANK_BATCH_MAX_ROWS = 400;

const SOURCES = ['chat', 'manual', 'file'] as const;
const DIRS = ['in', 'out'] as const;
const KINDS = ['transfer', 'debit', 'other'] as const;
const UNREAD_WORDS = ['date', 'amount', 'balance', 'desc', 'dir'] as const;
/** この語が unread にある行がある束は入れない（K143） */
const UNREAD_BLOCKING = ['date', 'amount', 'balance', 'dir'] as const;
const DESC_MAX = 200;
const POS_RE: Record<BankBatchIn['source'], RegExp> = { chat: /^\d+-\d+$/, manual: /^m-\d+$/, file: /^f-\d+$/ };
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MD_RE = /^(\d{1,2})\/(\d{1,2})$/;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNonNegInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const unreadWords = (u: string | null | undefined): string[] => (u ? u.split(',') : []);
const isTransferIn = (r: { dir: string; kind: string }) => r.dir === 'in' && r.kind === 'transfer';

/** 渡された束の JSON の形を確かめる。range の `/` は `-` に、desc は 200字に切って返す */
export function validateBatchShape(x: unknown): { ok: true; batch: BankBatchIn } | { ok: false; error: string } {
  const ng = (error: string) => ({ ok: false as const, error });
  if (!isObj(x)) return ng('束がオブジェクトではない');
  const { event_key, source, shot_on, range_from, range_to, images, account, rows, first_ok } = x;
  if (typeof event_key !== 'string' || event_key.length < 1 || event_key.length > 40) return ng('event_key は 1〜40字');
  if (typeof source !== 'string' || !(SOURCES as readonly string[]).includes(source)) return ng('source は chat|manual|file');
  const src = source as BankBatchIn['source'];
  if (typeof shot_on !== 'string' || !YMD_RE.test(shot_on)) return ng('shot_on は YYYY-MM-DD');
  const range = (v: unknown) => (typeof v === 'string' && /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(v) ? v.replace(/\//g, '-') : null);
  const from = range(range_from);
  const to = range(range_to);
  if (from === null || to === null) return ng('range_from・range_to は YYYY-MM-DD か YYYY/MM/DD');
  if (!isNonNegInt(images)) return ng('images は 0 以上の整数');
  if (typeof account !== 'string') return ng('account は文字');
  if (first_ok !== undefined && typeof first_ok !== 'boolean') return ng('first_ok は boolean か無し');
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > BANK_BATCH_MAX_ROWS) return ng(`rows は 1〜${BANK_BATCH_MAX_ROWS} 行`);

  const out: BankBatchRowIn[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row: unknown = rows[i];
    const at = `rows[${i}]`;
    if (!isObj(row)) return ng(`${at} がオブジェクトではない`);
    const { pos, date, dir, amount, balance, kind, desc, cut, unread } = row;
    if (typeof pos !== 'string' || !POS_RE[src].test(pos)) return ng(`${at}.pos の形がちがう`);
    if (typeof dir !== 'string' || !(DIRS as readonly string[]).includes(dir)) return ng(`${at}.dir は in|out`);
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return ng(`${at}.kind は transfer|debit|other`);
    if (typeof unread !== 'string') return ng(`${at}.unread は文字`);
    const words = unreadWords(unread);
    if (unread !== '' && !words.every((w) => (UNREAD_WORDS as readonly string[]).includes(w))) return ng(`${at}.unread は date,amount,balance,desc,dir の語`);
    if (amount === null ? !words.includes('amount') : !isNonNegInt(amount)) return ng(`${at}.amount は 0 以上の整数（null は unread に amount がある時だけ）`);
    if (balance === null ? src === 'manual' || !words.includes('balance') : !isNonNegInt(balance)) return ng(`${at}.balance は 0 以上の整数（null は unread に balance がある時だけ・manual は不可）`);
    if (typeof date !== 'string' || !(src === 'chat' ? MD_RE.test(date) : YMD_RE.test(date))) return ng(`${at}.date は ${src === 'chat' ? 'M/D' : 'YYYY-MM-DD'}`);
    if (typeof desc !== 'string') return ng(`${at}.desc は文字`);
    if (typeof cut !== 'boolean') return ng(`${at}.cut は boolean`);
    if (src === 'manual' && !(dir === 'in' && kind === 'transfer')) return ng(`${at} manual の行は dir=in・kind=transfer だけ`);
    out.push({ pos, date, dir: dir as BankBatchRowIn['dir'], amount: amount as number | null, balance: balance as number | null, kind: kind as BankBatchRowIn['kind'], desc: desc.slice(0, DESC_MAX), cut, unread });
  }
  const batch: BankBatchIn = { event_key, source: src, shot_on, range_from: from, range_to: to, images, account, rows: out };
  if (first_ok !== undefined) batch.first_ok = first_ok;
  return { ok: true, batch };
}

/** 本当にある日なら YYYY-MM-DD、ない日なら null */
function ymd(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** M/D に年を付ける：渡した日（JST）より先にならない、いちばん新しい年。作れない日付は '' */
export function inferRowYear(mmdd: string, handedJstDate: string): string {
  const m = MD_RE.exec(mmdd.trim());
  if (!m || !YMD_RE.test(handedJstDate)) return '';
  const y = Number(handedJstDate.slice(0, 4));
  const thisYear = ymd(y, Number(m[1]), Number(m[2]));
  if (thisYear !== null && thisYear <= handedJstDate) return thisYear;
  return ymd(y - 1, Number(m[1]), Number(m[2])) ?? '';
}

export function buildRowKey(r: { rowDate: string; dir: string; amount: number; balance: number | null }): string {
  return `${r.rowDate}|${r.dir}|${r.amount}|${r.balance ?? ''}`;
}

const posNums = (pos: string): [number, number] => {
  const [s, r] = pos.split('-');
  return [Number(s), Number(r)];
};

/** chat の行を枚ごとに（枚・行の数の順で）分ける */
function chatSheets(rows: BankBatchRowIn[]): BankBatchRowIn[][] {
  const sorted = [...rows].sort((a, b) => {
    const [as, ar] = posNums(a.pos);
    const [bs, br] = posNums(b.pos);
    return as - bs || ar - br;
  });
  const sheets: BankBatchRowIn[][] = [];
  let cur: number | null = null;
  for (const row of sorted) {
    const s = posNums(row.pos)[0];
    if (s !== cur) {
      sheets.push([]);
      cur = s;
    }
    sheets[sheets.length - 1].push(row);
  }
  return sheets;
}

/** 重ね撮りの同じ行かを見る鍵（日付・入出・金額・残高）。日付は月日の数でくらべる（12/05 と 12/5 は同じ） */
const sameRowKey = (r: BankBatchRowIn) => {
  const m = MD_RE.exec(r.date.trim());
  const md = m ? `${Number(m[1])}/${Number(m[2])}` : r.date;
  return `${md}|${r.dir}|${r.amount ?? ''}|${r.balance ?? ''}`;
};

/** 束を1本の「上が新しい順」の行にする（重ね撮りの1本化・年・番号・row_key と #n） */
export function normalizeBatch(b: BankBatchIn, handedJstDate: string): NormRow[] {
  let ordered: BankBatchRowIn[];
  if (b.source === 'chat') {
    // ①枚・行の順に並べる ②枚のつなぎ目だけ、いちばん長く一致する並びを後の枚の側から消す（1枚の中は消さない）
    const sheets = chatSheets(b.rows);
    ordered = [...(sheets[0] ?? [])];
    for (let k = 1; k < sheets.length; k++) {
      const prev = sheets[k - 1];
      const next = sheets[k];
      let overlap = 0;
      for (let n = Math.min(prev.length, next.length); n >= 1; n--) {
        let same = true;
        for (let i = 0; i < n; i++) {
          if (sameRowKey(prev[prev.length - n + i]) !== sameRowKey(next[i])) {
            same = false;
            break;
          }
        }
        if (same) {
          overlap = n;
          break;
        }
      }
      ordered.push(...next.slice(overlap));
    }
  } else {
    ordered = [...b.rows];
  }

  const rows: NormRow[] = ordered.map((x) => {
    const words = unreadWords(x.unread);
    let rowDate = x.date;
    if (b.source === 'chat') {
      rowDate = inferRowYear(x.date, handedJstDate);
      if (rowDate === '' && !words.includes('date')) words.push('date');
    }
    const read = isTransferIn(x) && x.desc !== '' ? readRefFromDesc(x.desc) : null;
    return {
      rowDate,
      dir: x.dir,
      amount: x.amount ?? 0,
      balance: x.balance,
      kind: x.kind,
      descRaw: read ? x.desc : null,
      descNorm: read ? read.descNorm : null,
      cut: x.cut ? 1 : 0,
      unread: words.length > 0 ? words.join(',') : null,
      refRead: read ? read.ref : null,
      refOk: read?.refOk ? 1 : 0,
      rowKey: '',
      pos: x.pos,
      checkFlag: null,
    };
  });

  // ⑥同じ鍵は古い方（下）から数えて2つ目以降に #n
  const seen = new Map<string, number>();
  for (let i = rows.length - 1; i >= 0; i--) {
    const base = buildRowKey(rows[i]);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows[i].rowKey = n === 1 ? base : `${base}#${n}`;
  }
  return rows;
}

type CheckResult = { ok: true } | { ok: false; near: { date: string; amount: number }; joinMismatch?: { ledgerRowId: number; pos: string }[] };

/** 束の検算。合わなければ「◯月◯日の ◯円の行のあたり」を near に返す */
export function checkBatch(b: BankBatchIn, rows: NormRow[], ledger: LedgerRowLite[], ctx: { startDate: string }): CheckResult {
  const near = (r: NormRow) => ({ ok: false as const, near: { date: r.rowDate, amount: r.amount } });

  // ⓪読めない数字のある行
  for (const r of rows) {
    const words = unreadWords(r.unread);
    if (UNREAD_BLOCKING.some((w) => words.includes(w))) return near(r);
  }
  if (b.source === 'manual') {
    for (const r of rows) if (r.balance === null) return near(r);
    return { ok: true };
  }

  // 1 残高のつながり（となりの2行の上の行を near に）
  for (let i = 0; i + 1 < rows.length; i++) {
    const up = rows[i];
    const dn = rows[i + 1];
    if (up.balance === null || dn.balance === null || up.balance !== dn.balance + (up.dir === 'in' ? up.amount : -up.amount)) return near(up);
  }
  for (const r of rows) if (r.balance === null) return near(r);

  // 2 日付が下へ新しくならない
  for (let i = 0; i + 1 < rows.length; i++) {
    if (rows[i].rowDate < rows[i + 1].rowDate) return near(rows[i]);
  }
  if (b.source === 'file') return { ok: true };

  // 3 枚のつなぎ目（rows の pos に出てくる枚どうしで見る。images は数えるのに使わない）
  const sheets = chatSheets(b.rows);
  for (let k = 0; k + 1 < sheets.length; k++) {
    const bottom = sheets[k][sheets[k].length - 1];
    const top = sheets[k + 1][0];
    if (sameRowKey(bottom) !== sameRowKey(top)) {
      // 枚 k のいちばん下は1本化で消えない（消すのは後の枚の側）ので、年の付いた行が rows にある
      const r = rows.find((x) => x.pos === bottom.pos);
      return { ok: false, near: { date: r?.rowDate ?? '', amount: r?.amount ?? bottom.amount ?? 0 } };
    }
  }

  // 5 期間の開始日が声かけの日より後
  if (b.range_from.replace(/\//g, '-') > ctx.startDate) return { ok: false, near: { date: ctx.startDate, amount: 0 } };

  // 4 前の日までのつなぎ目（振込の入金の行で見る。デビットの行・manual の行では見ない）
  const prevIns = ledger.filter((l) => isTransferIn(l) && (l.source === 'chat' || l.source === 'file') && l.state !== 'void');
  if (prevIns.length === 0) return { ok: true };
  const batchIns = rows.filter(isTransferIn);
  const prevKeys = new Set(prevIns.map((l) => l.row_key));
  if (batchIns.some((r) => prevKeys.has(r.rowKey))) return { ok: true };
  const joinMismatch: { ledgerRowId: number; pos: string }[] = [];
  for (const l of prevIns) {
    for (const r of batchIns) {
      if (l.row_date === r.rowDate && l.dir === r.dir && l.amount === r.amount && l.balance !== r.balance) joinMismatch.push({ ledgerRowId: l.id, pos: r.pos });
    }
  }
  const last = rows[rows.length - 1];
  return { ok: false, near: { date: last.rowDate, amount: last.amount }, ...(joinMismatch.length > 0 ? { joinMismatch } : {}) };
}

/** 入金の振込の行に、自動で当てない印（manual_twin → twin → last の順で最初の1つ）を付ける */
export function flagRows(rows: NormRow[], ledger: LedgerRowLite[]): NormRow[] {
  const live = ledger.filter((l) => l.state !== 'void');
  const keys = new Set(live.map((l) => l.row_key));
  return rows.map((r, i) => {
    let checkFlag: NormRow['checkFlag'] = null;
    if (!keys.has(r.rowKey) && isTransferIn(r)) {
      const sameBal = (l: LedgerRowLite) => l.balance !== null && r.balance !== null && l.balance === r.balance;
      if (live.some((l) => l.source === 'manual' && l.row_date === r.rowDate && l.dir === r.dir && l.amount === r.amount)) checkFlag = 'manual_twin';
      else if (
        live.some(
          (l) =>
            l.dir === r.dir &&
            sameBal(l) &&
            ((l.amount === r.amount && l.row_date !== r.rowDate) || (l.row_date === r.rowDate && l.amount !== r.amount)),
        )
      )
        checkFlag = 'twin';
      else if (i === rows.length - 1) checkFlag = 'last';
    }
    return { ...r, checkFlag };
  });
}

/** 引用符つきの欄も読める CSV の1行の分け方（scripts/bf7_ws_match_transfers.mjs の parseCsvLine と同じ考え） */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** 金額の欄を整数にする。空・数でない時は null */
function parseYen(s: string | undefined): number | null {
  const t = String(s ?? '').replace(/[,円¥\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * GMO の明細 CSV（Shift_JIS・見出し `日付,摘要,入金金額,出金金額,残高,メモ`。④C-16）を、上が新しい順の行にする。
 * pos は `f-<CSVの行番号>`（見出しが1行目）。列の形がちがうと分かったら（U55）、この関数だけを直す。
 */
export function parseGmoStatementCsv(buf: Uint8Array): BankBatchIn['rows'] {
  const text = new TextDecoder('shift_jis').decode(buf);
  const lines = text.split(/\r?\n/);
  const head = parseCsvLine(lines[0] ?? '').map((h) => h.trim());
  const col = (name: string) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`明細の CSV に「${name}」の列がない`);
    return i;
  };
  const iDate = col('日付');
  const iDesc = col('摘要');
  const iIn = col('入金金額');
  const iOut = col('出金金額');
  const iBal = col('残高');

  const rows: BankBatchRowIn[] = [];
  for (let li = 1; li < lines.length; li++) {
    if (lines[li].trim() === '') continue;
    const f = parseCsvLine(lines[li]);
    const rawDate = (f[iDate] ?? '').trim();
    const dm = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(rawDate);
    const date = dm ? `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}` : rawDate.replace(/\//g, '-');
    const descAll = f[iDesc] ?? '';
    const deposit = parseYen(f[iIn]);
    const withdrawal = parseYen(f[iOut]);
    const balance = parseYen(f[iBal]);
    const unread: string[] = [];
    let dir: BankBatchRowIn['dir'] = 'out';
    let amount: number | null;
    if (deposit !== null && deposit > 0) {
      dir = 'in';
      amount = deposit;
    } else {
      amount = withdrawal;
      if (amount === null) unread.push('amount');
    }
    if (balance === null) unread.push('balance');
    const descNfkc = descAll.normalize('NFKC');
    const kind: BankBatchRowIn['kind'] = dir === 'in' && descNfkc.trimStart().startsWith('振込') ? 'transfer' : descNfkc.includes('デビット') ? 'debit' : 'other';
    rows.push({ pos: `f-${li + 1}`, date, dir, amount, balance, kind, desc: dir === 'in' && kind === 'transfer' ? descAll : '', cut: false, unread: unread.join(',') });
  }
  // 古い順の CSV なら逆にする（はじめと終わりの日付でくらべる）
  if (rows.length > 1 && rows[0].date < rows[rows.length - 1].date) rows.reverse();
  return rows;
}

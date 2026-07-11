// 経費取込の純関数（パース＋分類）— WS P: 経費見える化「配線」
// 仕様: ~/BOOM/boom-events-hub/docs/decisions/2026-07-11_expenses-visibility-design.md (v2)
// 計画: docs/superpowers/plans/2026-07-11-expenses-wiring.md
//
// 設計メモ:
// - I/O・DBアクセスを持たない純関数のみ (vitest対象)。書込は scripts/import_expense_sources.mjs 側。
// - 依存ゼロ: scripts/*.mjs から Node ネイティブの type stripping (Node 23.6+) で
//   `import ... from '../src/lib/expenseImport.ts'` できるよう、erasable syntax のみを使い、
//   CSVパーサも csvUtil.parseCSV と同等品を内包する (拡張子なし相対importはNodeで解決できないため)。
//   ※ house前例: scripts/sync_lstep_blocked.mjs も同パーサを内包している。

export type ParsedRow = {
  date: string; // ISO YYYY-MM-DD
  description: string; // 生の摘要 (正規化しない。DBにもこのまま保存)
  deposit: number; // 入金 (正の整数, 0=なし)
  withdraw: number; // 出金 (正の整数, 0=なし)
  memo?: string; // GMO/SBIのメモ列。counterpartyとして保存し照合対象にも含める
  balance?: number | null; // 残高 (同一(日付,金額,摘要)の実重複判定に使う)
  skip?: boolean; // SBI入出金: デビット行・楽天カードサービス行 (無条件スキップ)
};

export type Master = {
  id: number;
  category: string;
  subcategory: string | null;
  match_pattern: string | null;
};

export type ImportSource = 'gmo' | 'sbi-bank' | 'sbi-debit' | 'rakuten';

export type ClassifyResult = {
  action: 'expense' | 'ignore' | 'queue' | 'drop';
  category?: string;
  subcategory?: string | null;
  masterId?: number;
  label?: string; // ignore時に bank_transactions.expense_category へ入れるラベル
};

/** NFKC正規化 + 小文字化 + 連続空白(全角含む)圧縮 + trim。照合はすべてこの形で行う。 */
export function normalizeDesc(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 金額文字列 → 整数。カンマ・円記号・空白を除去。'3300.00' は 3300。不正は 0。 */
function parseAmount(s: string | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/[,円¥\s"]/g, '').trim();
  if (!cleaned || cleaned === '-') return 0;
  const n = parseInt(cleaned, 10);
  return Number.isNaN(n) ? 0 : n;
}

/** '20260630' | '2026/06/30' | '2026-06-30' → '2026-06-30'。不正は null。 */
function toIsoDate(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  const m = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/** 引用符対応CSVパーサ (src/lib/csvUtil.ts の parseCSV と同等・依存ゼロ化のため内包)。 */
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      cur.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

/** ヘッダー行を探す (先頭5行から対象列名を含む行)。見つからなければ 0。 */
function findHeaderIndex(rows: string[][], needle: RegExp): number {
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if (needle.test(rows[i].join('|'))) return i;
  }
  return 0;
}

// ============================================
// GMOあおぞらネット銀行 入出金CSV
// ヘッダー: "日付","摘要","入金金額","出金金額","残高","メモ" / 日付=YYYYMMDD / 全列引用符付き
// ============================================
export function parseGmoCsv(text: string): ParsedRow[] {
  const rows = parseCsvText(text);
  const hi = findHeaderIndex(rows, /日付/);
  const header = rows[hi];
  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const cDate = col('日付');
  const cDesc = col('摘要');
  const cIn = col('入金');
  const cOut = col('出金');
  const cBal = col('残高');
  const cMemo = col('メモ');
  const out: ParsedRow[] = [];
  for (const r of rows.slice(hi + 1)) {
    const date = toIsoDate(r[cDate]);
    if (!date) continue;
    const description = (r[cDesc] ?? '').trim();
    const deposit = parseAmount(r[cIn]);
    const withdraw = parseAmount(r[cOut]);
    if (deposit === 0 && withdraw === 0) continue;
    const memoRaw = cMemo >= 0 ? (r[cMemo] ?? '').trim() : '';
    out.push({
      date,
      description,
      deposit,
      withdraw,
      balance: cBal >= 0 ? parseAmount(r[cBal]) : null,
      memo: memoRaw && memoRaw !== '-' ? memoRaw : undefined,
    });
  }
  return out;
}

// ============================================
// 住信SBIネット銀行 入出金CSV
// ヘッダー: "日付","内容","出金金額(円)","入金金額(円)","残高(円)","メモ" / 日付=YYYY/MM/DD
// ⚠️空フィールドは引用符なし ("4,434",,"7,987") のため引用符対応パーサ必須
// 「デビット　nnnnnn」行(デビット明細と重複)・「楽天カードサービス」行(カード明細側で計上)は skip:true
// ============================================
export function parseSbiBankCsv(text: string): ParsedRow[] {
  const rows = parseCsvText(text);
  const hi = findHeaderIndex(rows, /日付/);
  const header = rows[hi];
  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const cDate = col('日付');
  const cDesc = col('内容');
  const cOut = col('出金');
  const cIn = col('入金');
  const cBal = col('残高');
  const cMemo = col('メモ');
  const out: ParsedRow[] = [];
  for (const r of rows.slice(hi + 1)) {
    const date = toIsoDate(r[cDate]);
    if (!date) continue;
    const description = (r[cDesc] ?? '').trim();
    const deposit = parseAmount(r[cIn]);
    const withdraw = parseAmount(r[cOut]);
    if (deposit === 0 && withdraw === 0) continue;
    const memoRaw = cMemo >= 0 ? (r[cMemo] ?? '').trim() : '';
    const skip = description.startsWith('デビット') || description.includes('楽天カードサービス');
    out.push({
      date,
      description,
      deposit,
      withdraw,
      balance: cBal >= 0 ? parseAmount(r[cBal]) : null,
      memo: memoRaw && memoRaw !== '-' ? memoRaw : undefined,
      ...(skip ? { skip: true } : {}),
    });
  }
  return out;
}

// ============================================
// 住信SBIネット銀行 Visaデビット明細CSV
// 1行目: "1","お取引日","お取引内容",... / データ行: 先頭列"2" / 金額 "3300.00" 形式
// ============================================
export function parseSbiDebitCsv(text: string): ParsedRow[] {
  const rows = parseCsvText(text);
  const out: ParsedRow[] = [];
  for (const r of rows) {
    if ((r[0] ?? '').trim() !== '2') continue; // データ行のみ
    const date = toIsoDate(r[1]);
    if (!date) continue;
    const withdraw = parseAmount(r[4]);
    if (withdraw <= 0) continue;
    out.push({
      date,
      description: (r[2] ?? '').trim(),
      deposit: 0,
      withdraw,
      balance: null,
    });
  }
  return out;
}

// ============================================
// 楽天カード明細 (pdftotext -layout 済みテキスト)
// 明細行: 行頭 YYYY/MM/DD + 2スペース以上 + 利用店名 + 利用者 + 支払方法 + 利用金額 + ...
// 店名内の単一スペースは保持 (2スペース以上でsplit)。txn_dateは利用日。
// ============================================
export function parseRakutenText(text: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^\d{4}\/\d{2}\/\d{2}\s{2,}/.test(line)) continue;
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length < 5) continue; // 利用日/店名/利用者/支払方法/利用金額 が最低限
    const date = toIsoDate(parts[0]);
    if (!date) continue;
    const withdraw = parseAmount(parts[4]);
    if (withdraw <= 0) continue;
    out.push({
      date,
      description: `[楽天] ${parts[1]}`,
      deposit: 0,
      withdraw,
      balance: null,
    });
  }
  return out;
}

// ============================================
// recurring_expenses シードデータ (固定費マスタv1・2026-07-11 TARO承認)
// 配列順にINSERTしid昇順を保証する (id順マッチ・最初勝ちの前提)。
// ⚠️評価順が意味を持つ組: #1→#3 (`anthropic`は#1に含まれる)。
// amount=予算額 (budget_amount にも同値を入れる)。実額は取込時に bank_txn 側で計上。
// ============================================
export type RecurringSeed = {
  category: string;
  subcategory: string;
  amount: number;
  match_pattern: string;
  description: string | null;
};

export const RECURRING_SEED: RecurringSeed[] = [
  { category: 'システム費', subcategory: 'Claude Max(20x直課金)', amount: 36365, match_pattern: 'anthropic* claude sub', description: 'AI使い放題・6月〜。※API行より先に登録(id順マッチ)' },
  { category: 'システム費', subcategory: 'Claude(Apple請求期)', amount: 21400, match_pattern: 'apple com bill', description: '3〜5月の歴史行対応(6月以降出現しない)' },
  { category: 'システム費', subcategory: 'Anthropic API', amount: 1000, match_pattern: 'anthropic', description: 'ロボット用チャージ(#1,#2の後に評価)' },
  { category: 'システム費', subcategory: 'HACOMONO', amount: 20000, match_pattern: 'ハコモノ', description: '会員システム(月1〜2回変動)' },
  { category: 'システム費', subcategory: 'Lステップ', amount: 2980, match_pattern: 'maneql', description: null },
  { category: 'システム費', subcategory: 'LINE公式ライトプラン', amount: 5500, match_pattern: 'line公式', description: null },
  { category: 'システム費', subcategory: 'Google One', amount: 2900, match_pattern: 'google one', description: null },
  { category: 'システム費', subcategory: 'freee', amount: 1958, match_pattern: 'フリー', description: '半角ﾌﾘｰはNFKCでフリーに正規化される' },
  { category: 'システム費', subcategory: 'SUNO', amount: 1638, match_pattern: 'suno', description: null },
  { category: 'システム費', subcategory: 'Motion Array', amount: 3940, match_pattern: 'motionarr', description: null },
  { category: 'システム費', subcategory: 'Adobe', amount: 12474, match_pattern: 'adobe', description: '楽天カード側' },
  { category: 'システム費', subcategory: '弥生(2027年5月に更新停止予定)', amount: 1082, match_pattern: 'ヤヨイ', description: '年12,980の実績計上用・楽天側' },
  { category: 'システム費', subcategory: 'リベシティ', amount: 3300, match_pattern: 'リベシテ', description: 'SBI側・経費算入=TARO判断' },
  { category: '通信費', subcategory: '日本通信SIM(カナ)', amount: 7300, match_pattern: 'ニホンツウシン', description: null },
  { category: '通信費', subcategory: '日本通信SIM(英字)', amount: 300, match_pattern: 'japan communications', description: null },
  { category: '広告費', subcategory: 'Google広告', amount: 6500, match_pattern: 'google ads', description: null },
  { category: '会場費', subcategory: 'エル・パーク/エル・ソーラ', amount: 20000, match_pattern: 'ダンジヨ', description: 'センダイダンジヨキヨウドウサンカク' },
  { category: '会場費', subcategory: 'インスタベース', amount: 4400, match_pattern: 'インスタベ', description: null },
  { category: '備品', subcategory: 'Amazon(事業口座)', amount: 10000, match_pattern: 'amazon', description: 'GMOのみ到達(SBIは許可リスト外)' },
  { category: 'その他', subcategory: '振込手数料', amount: 2700, match_pattern: '振込手数料', description: null },
  { category: 'システム費', subcategory: 'GOOGLE CLOUD(nanobanana)', amount: 2000, match_pattern: 'google*cloud', description: '変動0〜5千' },
];

/** シード配列 → Master[] (id=配列順1..N)。テスト・dry-run用。 */
export function seedToMasters(seed: RecurringSeed[]): Master[] {
  return seed.map((s, i) => ({
    id: i + 1,
    category: s.category,
    subcategory: s.subcategory,
    match_pattern: s.match_pattern,
  }));
}

// ============================================
// 分類ルール (対象は出金行のみ。入金はGMOのみ保存・経費処理なし)
// ============================================

/** GMO ignoreリスト (正規化済みパターン, ラベル)。判定順。 */
const GMO_IGNORE: ReadonlyArray<readonly [string, string]> = [
  ['キムラ シンタロウ', '経費外(事業主貸)'],
  ['atm利用手数料', '経費外(現金・事業主貸)'],
  ['atm ', '経費外(現金・事業主貸)'],
  ['コナミ', '経費外(スタジオ料=studio_billing側)'],
  ['カ.デクト', '経費外(スタジオ料=studio_billing側)'],
  ['マイダンスシヨツプ', '経費外(スタジオ料=studio_billing側)'],
];

/** 楽天カード privateスキップリスト (正規化して部分一致・DB非投入)。 */
const RAKUTEN_PRIVATE_SKIP: readonly string[] = ['オオエドオンセン', '楽天モバイル', 'オプテージ', '年会費', 'チユーリツヒ'];

export const DEPOSIT_LABEL = '経費外(入金)';
export const TRANSFER_LABEL = '経費外(振込=給与/その他・payroll側)';

/**
 * GMO(事業口座)のみ到達させるパターン。私用口座(SBI)・楽天カードの同名行は
 * 私費の可能性があるため自動登録しない(SBIはdrop・楽天はqueueでTARO判断)。
 * 原則: 固定費マスタv1でSBI側と明記されているのは#13リベシティのみ。
 * BOOM側の支払いが同月GMOに存在するサブスクがSBI(私用口座)にも現れる場合、
 * それは別アカウント(私用)の可能性が高い＝「私費はアプリDBに入れない」を優先する。
 * - amazon: シード#19の備考「GMOのみ到達(SBIは許可リスト外)」どおり
 * - apple com bill: シード#2はGMOの3〜5月Claude(Apple請求)の歴史行対応。
 *   SBIデビットに私用Appleサブスク行(実データで¥590〜1,594)があり、誤経費化を防ぐ
 * - anthropic* claude sub / anthropic: BOOMのClaude Max・APIチャージはGMO側(¥36,365/¥908〜)。
 *   SBI側の¥3,560(Pro相当)は私用アカウント。#1を除外しても#3(anthropic)が拾うため両方除外
 * - フリー: BOOMのfreeeはGMO側(¥1,958/6月7日)。SBI側の同月同額行(6月9日)は別アカウント(私用)
 */
const GMO_ONLY_PATTERNS: ReadonlySet<string> = new Set(['amazon', 'apple com bill', 'anthropic* claude sub', 'anthropic', 'フリー']);

/**
 * recurringマスタ照合: 正規化文字列への includes 部分一致・配列順(=id昇順)で最初勝ち。
 */
function matchMaster(all: string, masters: Master[], source: ImportSource): Master | null {
  for (const m of masters) {
    const pat = normalizeDesc(m.match_pattern ?? '');
    if (!pat) continue;
    if (source !== 'gmo' && GMO_ONLY_PATTERNS.has(pat)) continue;
    if (all.includes(pat)) return m;
  }
  return null;
}

/**
 * 1行を分類する。
 * - GMO: 全行保存前提。入金→ignore(入金) / ignoreリスト / master一致→expense /
 *        振込で始まる→ignore(振込) / amazon→備品 / 残り→queue (guessCategoryは使わない)
 * - SBI(入出金・デビット): 許可リスト方式。master一致の出金のみexpense、他は全てdrop(DB非投入)
 * - 楽天: privateスキップ→drop / master一致→expense / 残り→queue
 */
export function classify(row: ParsedRow, masters: Master[], source: ImportSource): ClassifyResult {
  if (row.skip) return { action: 'drop' };
  const isWithdraw = row.withdraw > 0;

  if (source === 'gmo') {
    // 入金: bank_transactionsへ保存のみ・経費処理なし。未確定キューに残さないようラベル付きignore。
    if (!isWithdraw) return { action: 'ignore', label: DEPOSIT_LABEL };
    // 照合規約(import-bank準拠): `${description} ${counterparty}` 相当 = 摘要+メモ列
    const all = normalizeDesc(`${row.description} ${row.memo ?? ''}`);
    for (const [pat, label] of GMO_IGNORE) {
      if (all.includes(pat)) return { action: 'ignore', label };
    }
    const m = matchMaster(all, masters, source);
    if (m) return { action: 'expense', category: m.category, subcategory: m.subcategory, masterId: m.id };
    if (all.startsWith('振込')) return { action: 'ignore', label: TRANSFER_LABEL };
    if (all.includes('amazon')) return { action: 'expense', category: '備品', subcategory: null };
    return { action: 'queue' };
  }

  if (source === 'sbi-bank' || source === 'sbi-debit') {
    if (!isWithdraw) return { action: 'drop' };
    const all = normalizeDesc(row.description);
    const m = matchMaster(all, masters, source);
    if (m) return { action: 'expense', category: m.category, subcategory: m.subcategory, masterId: m.id };
    return { action: 'drop' };
  }

  // rakuten
  if (!isWithdraw) return { action: 'drop' };
  const all = normalizeDesc(row.description);
  for (const pat of RAKUTEN_PRIVATE_SKIP) {
    if (all.includes(normalizeDesc(pat))) return { action: 'drop' };
  }
  const m = matchMaster(all, masters, source);
  if (m) return { action: 'expense', category: m.category, subcategory: m.subcategory, masterId: m.id };
  return { action: 'queue' };
}

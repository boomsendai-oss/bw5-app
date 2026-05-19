// GMO青空ネット銀行 総合振込CSV生成
// 全角カナ → 半角カナ変換
// CSV: 銀行コード,支店コード,預金種目,口座番号,受取人名(半角カナ),金額,EDI情報,振込依頼人名

// 全角→半角カナ変換テーブル
const KANA_FULL_TO_HALF: Record<string, string> = {
  'ア':'ｱ','イ':'ｲ','ウ':'ｳ','エ':'ｴ','オ':'ｵ',
  'カ':'ｶ','キ':'ｷ','ク':'ｸ','ケ':'ｹ','コ':'ｺ',
  'サ':'ｻ','シ':'ｼ','ス':'ｽ','セ':'ｾ','ソ':'ｿ',
  'タ':'ﾀ','チ':'ﾁ','ツ':'ﾂ','テ':'ﾃ','ト':'ﾄ',
  'ナ':'ﾅ','ニ':'ﾆ','ヌ':'ﾇ','ネ':'ﾈ','ノ':'ﾉ',
  'ハ':'ﾊ','ヒ':'ﾋ','フ':'ﾌ','ヘ':'ﾍ','ホ':'ﾎ',
  'マ':'ﾏ','ミ':'ﾐ','ム':'ﾑ','メ':'ﾒ','モ':'ﾓ',
  'ヤ':'ﾔ','ユ':'ﾕ','ヨ':'ﾖ',
  'ラ':'ﾗ','リ':'ﾘ','ル':'ﾙ','レ':'ﾚ','ロ':'ﾛ',
  'ワ':'ﾜ','ヲ':'ｦ','ン':'ﾝ',
  'ガ':'ｶﾞ','ギ':'ｷﾞ','グ':'ｸﾞ','ゲ':'ｹﾞ','ゴ':'ｺﾞ',
  'ザ':'ｻﾞ','ジ':'ｼﾞ','ズ':'ｽﾞ','ゼ':'ｾﾞ','ゾ':'ｿﾞ',
  'ダ':'ﾀﾞ','ヂ':'ﾁﾞ','ヅ':'ﾂﾞ','デ':'ﾃﾞ','ド':'ﾄﾞ',
  'バ':'ﾊﾞ','ビ':'ﾋﾞ','ブ':'ﾌﾞ','ベ':'ﾍﾞ','ボ':'ﾎﾞ',
  'パ':'ﾊﾟ','ピ':'ﾋﾟ','プ':'ﾌﾟ','ペ':'ﾍﾟ','ポ':'ﾎﾟ',
  'ァ':'ｧ','ィ':'ｨ','ゥ':'ｩ','ェ':'ｪ','ォ':'ｫ',
  'ッ':'ｯ','ャ':'ｬ','ュ':'ｭ','ョ':'ｮ',
  'ヴ':'ｳﾞ','ー':'-',
  '・':'.','　':' ',
};

// ひらがな→カタカナ
function hiraToKana(s: string): string {
  let r = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 0x3041 && c <= 0x3096) r += String.fromCharCode(c + 0x60);
    else r += ch;
  }
  return r;
}

export function toHankakuKana(s: string): string {
  if (!s) return '';
  s = hiraToKana(s);
  let r = '';
  for (const ch of s) {
    if (KANA_FULL_TO_HALF[ch]) {
      r += KANA_FULL_TO_HALF[ch];
    } else if (/[A-Za-z0-9]/.test(ch)) {
      r += ch;
    } else if (ch.charCodeAt(0) >= 0xff10 && ch.charCodeAt(0) <= 0xff19) {
      r += String.fromCharCode(ch.charCodeAt(0) - 0xfee0); // 全角数字
    } else if (ch.charCodeAt(0) >= 0xff21 && ch.charCodeAt(0) <= 0xff5a) {
      r += String.fromCharCode(ch.charCodeAt(0) - 0xfee0); // 全角英字
    } else if (ch === ' ' || ch === '　') {
      r += ' ';
    } else {
      // 未対応文字はスペースに
      r += ' ';
    }
  }
  return r.toUpperCase();
}

export type BankTransferLine = {
  recipient_name: string;     // 元の名前 (漢字でもOK、内部で半角カナ化)
  bank_code: string;          // 4桁
  branch_code: string;        // 3桁
  account_type: string;       // 1=普通 / 2=当座
  account_number: string;     // 7桁
  amount: number;
  notes?: string;
};

// 預金種別文字列の正規化
function normalizeAccountType(s: string | null | undefined): string {
  if (!s) return '1';
  const t = String(s).trim();
  if (t === '1' || t === '2') return t;
  if (/普通/.test(t)) return '1';
  if (/当座/.test(t)) return '2';
  return '1';
}

// GMO青空ネット銀行 総合振込フォーマット (CSV形式)
// 1行目: ヘッダー
// 2行目以降: データ
// ※ GMO公式の正確な仕様は要確認だが、一般的な全銀協フォーマットCSV版を採用
export function generateBankTransferCsv(
  lines: BankTransferLine[],
  options: { requester_name?: string; transfer_date?: string } = {}
): string {
  const header = ['銀行コード','支店コード','預金種目','口座番号','受取人名(半角カナ)','振込金額','EDI情報','振込依頼人名'];
  const rows = [header.join(',')];
  const requester = toHankakuKana(options.requester_name ?? 'ﾌﾞｰﾑ ﾀﾞﾝｽｽｸｰﾙ');
  for (const l of lines) {
    if (!l.bank_code || !l.account_number || l.amount <= 0) continue;
    const row = [
      l.bank_code.padStart(4, '0'),
      l.branch_code.padStart(3, '0'),
      normalizeAccountType(l.account_type),
      l.account_number.padStart(7, '0'),
      toHankakuKana(l.recipient_name).substring(0, 30),
      String(l.amount),
      '',
      requester.substring(0, 30),
    ];
    rows.push(row.map(escapeCsv).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

function escapeCsv(v: string): string {
  if (/[",\r\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

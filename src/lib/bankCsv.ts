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
    const code = ch.charCodeAt(0);
    if (KANA_FULL_TO_HALF[ch]) {
      r += KANA_FULL_TO_HALF[ch];
    } else if (code >= 0xff61 && code <= 0xff9f) {
      // 既に半角カナ(ﾜ ｺ ｳ 等・濁点含む)はそのまま通す
      r += ch;
    } else if (/[A-Za-z0-9]/.test(ch)) {
      r += ch;
    } else if (ch === '-' || ch === '.') {
      // 半角ハイフン・ピリオドはそのまま
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

// GMOあおぞらネット銀行 総合振込フォーマット (CSV形式)
// 2026年4月の実績CSV(GMOで取込成功済)に準拠:
//   ヘッダー行なし / 8列固定
//   銀行C(4), 支店C(3), 預金種別(1=普通), 口座番号(7), 受取人カナ, 金額, 区分(=1固定), 依頼人カナ
//   例: 0038,102,1,9253691,ｷﾑﾗｹｲｺ,60000,1,ﾌﾞｰﾑ
export function generateBankTransferCsv(
  lines: BankTransferLine[],
  options: { requester_name?: string; transfer_date?: string } = {}
): string {
  const rows: string[] = []; // ヘッダー行なし
  const requester = toHankakuKana(options.requester_name ?? 'ﾌﾞｰﾑ');
  for (const l of lines) {
    if (!l.bank_code || !l.account_number || l.amount <= 0) continue;
    const row = [
      l.bank_code.padStart(4, '0'),
      l.branch_code.padStart(3, '0'),
      normalizeAccountType(l.account_type),
      l.account_number.padStart(7, '0'),
      toHankakuKana(l.recipient_name).substring(0, 30),
      String(l.amount),
      '1', // 区分: 4月実績では全行 1
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

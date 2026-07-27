// 軽量 CSV パーサ (RFC4180 準拠ベース、ダブルクォート対応)
// 大規模CSVでなければ十分。

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  // BOM 除去
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

export function rowsToDicts(rows: string[][], headerRowIndex = 0): Record<string, string>[] {
  if (rows.length <= headerRowIndex) return [];
  const headers = rows[headerRowIndex];
  return rows.slice(headerRowIndex + 1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (row[i] ?? '').trim();
    });
    return obj;
  });
}

// CSV 行を引用符付きで出力
export function toCSVRow(values: (string | number | null | undefined)[]): string {
  return values
    .map((v) => {
      const s = v === null || v === undefined ? '' : String(v);
      if (/[",\r\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    })
    .join(',');
}

export function toCSV(rows: (string | number | null | undefined)[][]): string {
  return rows.map(toCSVRow).join('\r\n') + '\r\n';
}

export function normalizeKana(s: string): string {
  if (!s) return '';
  let result = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 0x3041 && c <= 0x3096) {
      result += String.fromCharCode(c + 0x60);
    } else {
      result += ch;
    }
  }
  return result
    .replace(/[\s　・,、.。\-ー－/]/g, '')
    // 四つ仮名の表記揺れを同一視 (ミヅキ=ミズキ 等。実際にマッチ漏れが起きた)
    .replace(/ヅ/g, 'ズ')
    .replace(/ヂ/g, 'ジ');
}

export function parseDate(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  // YYYYMMDD (8桁数字のみ) → YYYY-MM-DD
  if (/^\d{8}$/.test(t)) {
    return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  }
  return t.replace(/\//g, '-').slice(0, 10) || null;
}

// 'YYYY-MM-DD[(space|T)HH:MM[:SS]]' を受ける。区切りは - / どちらも可、各要素のゼロ埋めは任意。
const DATE_TIME_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:(T| +)(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/;

const pad2 = (n: string) => n.padStart(2, '0');

/**
 * CSV の日時文字列を `YYYY-MM-DD[ HH:MM[:SS]]` に正規化する。解釈できなければ null。
 *
 * 戻り値は DB 保存後に **'YYYY-MM-DD' 前提の文字列比較** で使われる
 * (`trialAttendance.resolveAttendance` の `day < todayJst` 等)。ゼロ埋めしないと
 * `'2026-7-1' < '2026-07-27'` が false になり ('7' > '0')、集計が静かに壊れる。
 * そのため正規化はこの関数の責務とし、壊れた文字列をそのまま通さず null を返す (fail closed)。
 *
 * 設計上の判断:
 * - **秒は入力に有ったときだけ付ける**。`10:00` に勝手に `:00` を補うと
 *   trial_records の重複判定キー `(lstep_id, reserved_at)` が既存行と変わり二重登録になる。
 *   各要素がゼロ埋めされていれば秒の有無が混在しても辞書順比較は暦順と一致する
 *   (秒なしは `:00` より前に並ぶ = 同義)。
 * - 月1-12・日1-31 の範囲検証のみで、暦上の実在判定 (2026-02-30 等) はしない。
 *   辞書順比較の安全性に不要な一方、fail closed で取込を落とす副作用が増えるため。
 */
export function parseDateTime(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  // YYYYMMDD (8桁数字のみ)。parseDate と同じ扱い。
  const src = /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : t;

  const m = DATE_TIME_RE.exec(src);
  if (!m) return null;
  const [, year, month, day, sep, hour, min, sec] = m;
  if (+month < 1 || +month > 12 || +day < 1 || +day > 31) return null;

  const date = `${year}-${pad2(month)}-${pad2(day)}`;
  if (hour === undefined) return date;
  if (+hour > 23 || +min > 59 || (sec !== undefined && +sec > 59)) return null;

  const time = `${pad2(hour)}:${pad2(min)}` + (sec !== undefined ? `:${pad2(sec)}` : '');
  return `${date}${sep === 'T' ? 'T' : ' '}${time}`;
}

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

export function parseDateTime(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  return t.replace(/\//g, '-');
}

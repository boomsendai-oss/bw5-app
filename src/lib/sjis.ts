// 軽量 Shift-JIS (CP932) エンコーダ
// Lstep の差分インポート CSV を cp932 で出力するためのもの。
// Node 標準の TextDecoder('shift-jis') を逆引きしてマップを構築する (起動時1回のみ)。

let encodeMap: Map<number, number[]> | null = null;

function buildEncodeMap(): Map<number, number[]> {
  const decoder = new TextDecoder('shift-jis', { fatal: false });
  const map = new Map<number, number[]>();

  // ASCII (0x00-0x7F)
  for (let b = 0x00; b < 0x80; b++) {
    map.set(b, [b]);
  }
  // 半角カナ (0xA1-0xDF)
  for (let b = 0xa1; b <= 0xdf; b++) {
    const ch = decoder.decode(new Uint8Array([b]));
    if (ch && ch !== '�') {
      map.set(ch.charCodeAt(0), [b]);
    }
  }
  // 2バイト範囲
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead >= 0xa0 && lead <= 0xdf) continue;
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      const decoded = decoder.decode(new Uint8Array([lead, trail]));
      if (!decoded || decoded === '�' || decoded.length === 0) continue;
      // サロゲートペアは無視 (Shift-JIS 基本面のみ対応)
      const code = decoded.charCodeAt(0);
      if (decoded.length !== 1) continue;
      if (!map.has(code)) {
        map.set(code, [lead, trail]);
      }
    }
  }
  return map;
}

export function encodeShiftJIS(input: string): Uint8Array {
  if (!encodeMap) encodeMap = buildEncodeMap();
  const out: number[] = [];
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    const bytes = encodeMap.get(code);
    if (bytes) {
      out.push(...bytes);
    } else {
      // 未対応文字は "?" にフォールバック
      out.push(0x3f);
    }
  }
  return new Uint8Array(out);
}

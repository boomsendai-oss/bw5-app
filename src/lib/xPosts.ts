// X(Twitter)投稿承認キューの純ロジック (2026-07-17設計)。
// DB行の型・ツリー分割・投稿対象の選定・JST予約日時の変換を集約する。
// I/O(DB・X API)は持たない — cron route と staff画面/actions から共用し、vitestで検証する。
//
// 日時規約 (src/lib/dateJst.ts に準拠):
//   - scheduled_at は UTC ISO8601(Z付き・ミリ秒あり = toISOString() 形式) で保存
//   - 画面の入出力は JST の datetime-local ('YYYY-MM-DDTHH:mm')
//   - 書式を統一することで辞書順比較 (scheduled_at <= now) が安全になる

export type XPostStatus = 'draft' | 'approved' | 'posting' | 'posted' | 'failed' | 'rejected';

/** x_posts テーブルの生の行 */
export type XPostRow = {
  id: number;
  account: string;
  parts: string; // JSON配列文字列
  scheduled_at: string | null;
  status: string;
  posted_tweet_ids: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

/** 1回のcron実行で処理する最大件数 (暴走防止) */
export const MAX_POSTS_PER_RUN = 5;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 本文テキストをツリー(スレッド)に分割する。
 * 区切り = 「空行2つ以上」(改行3つ以上)。ツイート本文内の空行1つは段落として保持する。
 * 手動追加フォーム・下書きのインライン編集の両方で使う。
 */
export function splitThreadText(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n[ \t]*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** splitThreadText の逆: parts をテキストエリア表示用に結合する(空行2つ区切り) */
export function joinThreadParts(parts: string[]): string {
  return parts.join('\n\n\n');
}

/** parts カラム(JSON)を安全にパースする。壊れていれば [] */
export function parsePartsJson(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.filter((p): p is string => typeof p === 'string');
  } catch {
    return [];
  }
}

/** posted_tweet_ids カラム(JSON)を安全にパースする */
export function parseTweetIdsJson(json: string | null): string[] {
  return parsePartsJson(json);
}

/**
 * 投稿対象の選定: status='approved' かつ scheduled_at が現在時刻(UTC ISO)以前のものを
 * 古い順に最大 limit 件。scheduled_at NULL は「手動トリガー待ち」で自動投稿しない。
 * 書式が揃っている前提で辞書順比較する(dateJst.ts の方針と同じ)。
 */
export function pickDuePosts<T extends { id: number; status: string; scheduled_at: string | null }>(
  rows: T[],
  nowUtcIso: string,
  limit: number = MAX_POSTS_PER_RUN
): T[] {
  return rows
    .filter((r) => r.status === 'approved' && r.scheduled_at !== null && r.scheduled_at <= nowUtcIso)
    .sort((a, b) => {
      if (a.scheduled_at! !== b.scheduled_at!) return a.scheduled_at! < b.scheduled_at! ? -1 : 1;
      return a.id - b.id;
    })
    .slice(0, Math.max(0, limit));
}

/**
 * JSTの datetime-local 入力 ('YYYY-MM-DDTHH:mm') → UTC ISO8601(Z)。
 * 不正な書式は null (呼び出し側でエラーにする)。
 */
export function jstInputToUtcIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) - JST_OFFSET_MS;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;
  // 実在日チェック('2026-02-30' 等はUTC変換でロールオーバーするので照合して弾く)
  const back = new Date(utcMs + JST_OFFSET_MS).toISOString().slice(0, 16);
  if (back !== `${y}-${mo}-${d}T${h}:${mi}`) return null;
  return date.toISOString();
}

/** UTC ISO8601 → JSTの datetime-local 表記 ('YYYY-MM-DDTHH:mm')。datetime-local の value 用 */
export function utcIsoToJstInput(iso: string): string {
  return new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);
}

/** UTC ISO8601 → 画面表示用 'M/D(曜) HH:mm' (JST) */
export function formatJst(iso: string): string {
  const local = utcIsoToJstInput(iso); // 'YYYY-MM-DDTHH:mm'
  const [datePart, timePart] = local.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const youbi = '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}(${youbi}) ${timePart}`;
}

/**
 * ツイート本文の重み付き文字数の目安。X は280単位で、CJK・全角はおおむね2単位。
 * URLの短縮(t.co=23固定)等は考慮しない簡易版 — 画面の文字数目安表示にだけ使う。
 */
export function tweetWeightedLength(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // X のweighted rangesの近似: ASCII/ラテン系(〜U+10FF)と一般句読点等は1、その他(CJK含む)は2
    const light =
      cp <= 0x10ff ||
      (cp >= 0x2000 && cp <= 0x200d) ||
      (cp >= 0x2010 && cp <= 0x201f) ||
      (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

/** ツイート1本の上限(weighted)。超過は画面で警告表示する(投稿自体はX API側が拒否する) */
export const TWEET_MAX_WEIGHTED = 280;

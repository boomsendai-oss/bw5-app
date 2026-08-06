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
  media: string | null; // JSON配列文字列 [{url, alt?}] (20260718_x_posts_media.sql)
  error: string | null;
  created_at: string;
  updated_at: string;
};

/** 1回のcron実行で処理する最大件数 (暴走防止) */
export const MAX_POSTS_PER_RUN = 5;

/** 画像添付1件。url = /api/upload が返す公開URL(本番=Vercel Blob / ローカル=/images/…) */
export type XPostMedia = { url: string; alt?: string };

/** ツイート1本に添付できる画像の最大枚数 (X APIの上限に合わせる) */
export const MAX_MEDIA_PER_POST = 4;

/**
 * media カラム(JSON)を安全にパースする(表示・投稿用の寛容版)。
 * 壊れたJSON・配列以外・url無し要素は捨て、上限を超えた分は切り捨てる。
 * 保存時の厳格な検証は validateMediaList で行う。
 */
export function parseMediaJson(json: string | null): XPostMedia[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && !Array.isArray(m))
      .filter((m) => typeof m.url === 'string' && (m.url as string).trim().length > 0)
      .slice(0, MAX_MEDIA_PER_POST)
      .map((m) => {
        const out: XPostMedia = { url: (m.url as string).trim() };
        if (typeof m.alt === 'string' && m.alt.trim()) out.alt = m.alt.trim();
        return out;
      });
  } catch {
    return [];
  }
}

/**
 * 添付画像URLとして妥当か。
 * 許可: http(s) の絶対URL、またはサイト内絶対パス('/images/…' 等。'//' 始まりのプロトコル相対は不可)。
 * javascript: / data: 等のスキームはここで弾く。
 */
export function isValidMediaUrl(url: string): boolean {
  if (url.startsWith('/')) return !url.startsWith('//');
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * 保存前の厳格検証。OKなら null、NGなら日本語エラーメッセージを返す。
 * (Server Action で使う — クライアントから直接POSTされ得るため信用しない)
 */
export function validateMediaList(list: unknown): string | null {
  if (!Array.isArray(list)) return '画像リストの形式が不正です';
  if (list.length > MAX_MEDIA_PER_POST) return `画像は最大${MAX_MEDIA_PER_POST}枚までです`;
  for (const m of list) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return '画像リストの形式が不正です';
    const url = (m as Record<string, unknown>).url;
    if (typeof url !== 'string' || !url.trim()) return '画像リストの形式が不正です';
    if (!isValidMediaUrl(url.trim())) return `画像URLが不正です: ${url.slice(0, 80)}`;
    const alt = (m as Record<string, unknown>).alt;
    if (alt !== undefined && typeof alt !== 'string') return '画像リストの形式が不正です';
  }
  return null;
}

/**
 * ツリー各ツイートの投稿ペイロード素材を組み立てる。
 * 画像(media_ids)は**1本目のツイートにのみ**添付し、2本目以降はテキストのみ。
 */
export function buildTweetPayloads(
  parts: string[],
  mediaIds: string[]
): Array<{ text: string; mediaIds?: string[] }> {
  return parts.map((text, i) => (i === 0 && mediaIds.length > 0 ? { text, mediaIds } : { text }));
}

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

/** 予約時刻からの許容遅延。これを超えて未投稿のものは自動見送り(expired)にする */
export const SCHEDULE_GRACE_MS = 2 * 60 * 60 * 1000;

/**
 * 承認済み投稿を「投稿してよいもの(due側)」と「予約時刻を大きく過ぎたもの(expired)」に分ける。
 * 古い予約のまま承認された投稿が今の文脈に合わない内容のまま即時投稿される事故を防ぐ
 * (2026-08-06 TARO指摘: 過ぎた週次レッスン告知が承認と同時に流れてしまう問題)。
 * expired は呼び出し側で status='failed' + 理由保存にする(差し戻し→時刻再設定で再試行可能)。
 * scheduled_at が null のものは対象外(cronが触らない既存仕様のまま)。
 */
export function partitionExpired<T extends { id: number; scheduled_at: string | null }>(
  posts: T[],
  nowIso: string
): { due: T[]; expired: T[] } {
  const now = Date.parse(nowIso);
  const due: T[] = [];
  const expired: T[] = [];
  for (const p of posts) {
    if (!p.scheduled_at) continue;
    const sched = Date.parse(p.scheduled_at);
    if (Number.isFinite(sched) && now - sched > SCHEDULE_GRACE_MS) expired.push(p);
    else due.push(p);
  }
  return { due, expired };
}

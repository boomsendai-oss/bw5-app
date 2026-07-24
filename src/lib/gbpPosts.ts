// GBP予約投稿の自動作成 (2026-07-25)
// クラウドルーティンが boom-events-hub/docs/gbp-drafts/YYYY-MM.md に生成する
// 月次ドラフト(4本)をパースし、v4 localPosts API へ scheduledTime 付きで登録する。
// このファイルは純関数のみ(パース・作成計画)。API呼び出しは gbp.ts 側。
//
// ドラフトの書式(ルーティン生成・固定):
//   ## 投稿1/4 — 第1週(体験告知)
//   **予約日時: 2026年8月3日(月) 9:00 JST**
//   ```
//   本文...
//   ```

/** GBP localPost の summary 上限 (Google仕様: 1500文字) */
export const GBP_SUMMARY_MAX = 1500;

/** 投稿の「詳細」ボタンの飛び先 (ドラフト冒頭の宣言と一致させる) */
export const GBP_CTA_URL = 'https://www.boom-sendai.com/';

export type ParsedDraftPost = {
  /** 見出し上の番号 (1〜4)。ログ用 */
  index: number;
  /** 見出しテキスト (例: 第1週(体験告知)) */
  title: string;
  /** 公開予定日時 (UTC ISO, 例 2026-08-03T00:00:00.000Z = JST 9:00) */
  scheduledTimeUtc: string;
  /** 投稿本文 */
  summary: string;
};

export type ParseResult = {
  posts: ParsedDraftPost[];
  errors: string[];
};

/**
 * 月次ドラフトMarkdownをパースする。
 * セクション単位で欠陥を errors に隔離し、正常な投稿だけ posts に返す
 * (1本の書式崩れで残り3本まで道連れにしない)。
 */
export function parseGbpDraftMarkdown(markdown: string): ParseResult {
  const posts: ParsedDraftPost[] = [];
  const errors: string[] = [];

  // "## 投稿N/4 — ..." で分割 (先頭のヘッダ部は捨てる)
  const sections = markdown.split(/^## /m).slice(1);
  const postSections = sections.filter((s) => /^投稿\d+\s*\/\s*\d+/.test(s));
  if (postSections.length === 0) {
    return { posts, errors: ['投稿セクション(## 投稿N/4)が1つも見つかりません'] };
  }

  for (const sec of postSections) {
    const headLine = sec.split('\n', 1)[0].trim();
    const idxMatch = headLine.match(/^投稿(\d+)/);
    const index = idxMatch ? Number(idxMatch[1]) : 0;
    const title = headLine.replace(/^投稿\d+\s*\/\s*\d+\s*[—-]*\s*/, '').trim() || headLine;

    const dt = sec.match(
      /予約日時[::]\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日[^\d]*?(\d{1,2}):(\d{2})/
    );
    if (!dt) {
      errors.push(`投稿${index}: 予約日時が読み取れません (${headLine})`);
      continue;
    }
    const [, y, mo, d, h, mi] = dt.map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) {
      errors.push(`投稿${index}: 予約日時が不正です (${dt[0]})`);
      continue;
    }
    // JST → UTC (-9h)
    const utcMs = Date.UTC(y, mo - 1, d, h, mi) - 9 * 60 * 60 * 1000;
    const scheduledTimeUtc = new Date(utcMs).toISOString();

    const body = sec.match(/```[^\n]*\n([\s\S]*?)\n```/);
    if (!body || !body[1].trim()) {
      errors.push(`投稿${index}: 本文のコードブロックが見つかりません`);
      continue;
    }
    const summary = body[1].trim();
    if (summary.length > GBP_SUMMARY_MAX) {
      errors.push(`投稿${index}: 本文が${summary.length}文字でGBP上限${GBP_SUMMARY_MAX}を超過`);
      continue;
    }

    posts.push({ index, title, scheduledTimeUtc, summary });
  }

  return { posts, errors };
}

export type ExistingPostLite = {
  state?: string;
  scheduledTime?: string;
};

export type CreationPlan = {
  toCreate: ParsedDraftPost[];
  skipped: { post: ParsedDraftPost; reason: 'already_exists' | 'time_passed' }[];
};

/**
 * 作成計画を立てる(冪等性の要)。
 * - 同じ scheduledTime の投稿がGBP側に既にある(REJECTED以外) → skip
 *   (TARO手動予約や過去のcron実行との二重登録を防ぐ)
 * - 予約時刻が過去 → skip (月中の再実行で即時公開事故を起こさない)
 */
export function planPostCreation(
  parsed: ParsedDraftPost[],
  existing: ExistingPostLite[],
  nowUtcIso: string
): CreationPlan {
  const existingTimes = new Set(
    existing
      .filter((p) => p.state !== 'REJECTED' && p.scheduledTime)
      .map((p) => new Date(p.scheduledTime!).getTime())
  );
  const nowMs = new Date(nowUtcIso).getTime();

  const toCreate: ParsedDraftPost[] = [];
  const skipped: CreationPlan['skipped'] = [];
  for (const post of parsed) {
    const t = new Date(post.scheduledTimeUtc).getTime();
    if (existingTimes.has(t)) {
      skipped.push({ post, reason: 'already_exists' });
    } else if (t <= nowMs) {
      skipped.push({ post, reason: 'time_passed' });
    } else {
      toCreate.push(post);
    }
  }
  return { toCreate, skipped };
}

/**
 * 対象月 'YYYY-MM' を返す。既定は「JST今日の翌月」
 * (毎月20日のcronで翌月分ドラフトを処理する運用)。
 */
export function nextMonthJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth(); // 0-11
  const next = new Date(Date.UTC(y, m + 1, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

// リールの他SNS横展開 — 純関数のみ(API呼び出しは youtube.ts / xApi.ts 側)。
//
// Instagram向けに書いたキャプションをそのまま他所へ流すと、それぞれの作法から外れる:
//   - X: 280文字。ハッシュタグを盛ると読みにくく、リンクも文字数を食う
//   - YouTube: タイトルと説明が別。#Shorts が無いとShortsとして扱われないことがある
// ここでプラットフォームごとに整形する。

/** 横展開する配信先 */
export const CROSSPOST_PLATFORMS = ['youtube', 'x'] as const;
export type Platform = (typeof CROSSPOST_PLATFORMS)[number];

/** X の本文上限(通常アカウント) */
export const X_TEXT_MAX = 280;
/** YouTube のタイトル上限 */
export const YT_TITLE_MAX = 100;
/** YouTube の説明上限 */
export const YT_DESCRIPTION_MAX = 5000;

/**
 * キャプションからハッシュタグ行を切り離す。
 * BOOMのリールは「本文 → 空行 → #タグの塊」という形なので、末尾のタグ群だけを抜く。
 */
export function splitCaption(caption: string): { body: string; tags: string[] } {
  const lines = (caption ?? '').split('\n');
  const tags: string[] = [];
  let end = lines.length;
  // 末尾から、タグだけ/空行の行を食べる
  while (end > 0) {
    const line = lines[end - 1].trim();
    if (line === '') {
      end--;
      continue;
    }
    const words = line.split(/\s+/);
    if (words.length > 0 && words.every((w) => w.startsWith('#') && w.length > 1)) {
      tags.unshift(...words);
      end--;
      continue;
    }
    break;
  }
  return { body: lines.slice(0, end).join('\n').trim(), tags };
}

/** 全角を2文字として数えない(Xは日本語も1文字=1カウントではないが、実運用は文字数で足りる) */
function truncate(s: string, max: number): string {
  const chars = [...s];
  if (chars.length <= max) return s;
  return chars.slice(0, max - 1).join('') + '…';
}

/**
 * X用の本文を作る。
 * - 本文を優先し、余った文字数にだけタグを足す(タグで本文が削れるのを防ぐ)
 * - リンクは呼び出し側で足さない。Xは動画付きポストにリンクを入れると表示が弱くなる
 */
export function buildXText(caption: string, opts?: { maxTags?: number }): string {
  const { body, tags } = splitCaption(caption);
  const maxTags = opts?.maxTags ?? 3;
  const base = truncate(body, X_TEXT_MAX);
  if ([...base].length >= X_TEXT_MAX - 8) return base;

  let out = base;
  for (const tag of tags.slice(0, maxTags)) {
    const next = `${out}\n${tag}`;
    if ([...next].length > X_TEXT_MAX) break;
    // 同じ行に足せるならそちらを優先(改行を無駄に増やさない)
    const inline = out.endsWith('\n') ? `${out}${tag}` : `${out} ${tag}`;
    out = [...inline].length <= X_TEXT_MAX ? inline : next;
    if ([...out].length > X_TEXT_MAX) break;
  }
  return out;
}

/**
 * YouTube Shorts用のタイトルと説明を作る。
 * タイトル = キャプション1行目(【】があれば中身を優先)。
 * 説明     = 本文全体 + タグ + #Shorts。
 */
export function buildYouTubeMeta(
  title: string,
  caption: string
): { title: string; description: string; tags: string[] } {
  const { body, tags } = splitCaption(caption);
  const firstLine = body.split('\n').find((l) => l.trim()) ?? '';
  // 【〜】で始まるキャプションが多いので、括弧の中身を見出しにする
  const bracket = firstLine.match(/^【(.+?)】(.*)$/);
  const headline = bracket ? `${bracket[1]}${bracket[2] ? ' ' + bracket[2].trim() : ''}` : firstLine;
  const ytTitle = truncate((headline || title).trim(), YT_TITLE_MAX);

  // #Shorts はShortsとして認識させるための保険(縦動画かつ3分以内が本来の条件)
  const tagLine = [...new Set([...tags, '#Shorts'])].join(' ');
  const description = truncate(`${body}\n\n${tagLine}`.trim(), YT_DESCRIPTION_MAX);

  // YouTubeのtagsフィールドは # を含めない
  const ytTags = tags.map((t) => t.replace(/^#/, '')).filter(Boolean).slice(0, 15);
  return { title: ytTitle, description, tags: ytTags };
}

export type CrosspostRow = {
  id: number;
  reel_id: number;
  platform: string;
  status: string;
  attempts: number;
};

/** 1回の実行で許すリトライ回数。これを超えたら failed のまま放置してTAROに見せる */
export const MAX_ATTEMPTS = 3;

/**
 * 今回処理する対象を選ぶ。
 * - pending か、failed でまだ試行回数が残っているもの
 * - 1回の実行で1件だけ(APIのレート制限を食い潰さない。特にXの無料枠は
 *   /initialize と /finalize が24時間で17回しかない)
 */
export function pickNext(rows: CrosspostRow[]): CrosspostRow | null {
  const candidates = rows.filter(
    (r) => r.status === 'pending' || (r.status === 'failed' && r.attempts < MAX_ATTEMPTS)
  );
  if (candidates.length === 0) return null;
  // pending を先に、次に試行回数の少ないもの
  candidates.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    return a.attempts - b.attempts;
  });
  return candidates[0];
}

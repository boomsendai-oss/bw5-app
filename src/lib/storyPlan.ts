// ストーリー素材の選択ロジック(cron本番と /staff/instagram の「明日の投稿予定」プレビューで共用)。
// 優先チェーン: ①日付指定 {YYYY-MM-DD}.(mp4|jpg) ②曜日 {曜日}.(mp4|jpg) ③埋め草キュー ④出さない。
// 同一優先度内は mp4 > jpg (静止画を先に置き、動画完成後に同名.mp4を置くだけで自動格上げ)。
// 設計: docs/decisions/2026-07-16_instagram-story-posting-time.md

export const WEEKDAY_FILES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export type ChainMedia = {
  url: string;
  type: 'video' | 'image';
  base: string; // 'YYYY-MM-DD' または曜日名。メンションsidecar {base}.json の参照にも使う
  source: 'date-file' | 'weekday-file';
};

/** 日付指定→曜日の順で public/stories/ の素材を探す(HEADで実在確認)。無ければnull。 */
export async function findChainMedia(origin: string, date: string, weekday: number): Promise<ChainMedia | null> {
  const tiers: Array<{ base: string; source: ChainMedia['source'] }> = [
    { base: date, source: 'date-file' },
    { base: WEEKDAY_FILES[weekday], source: 'weekday-file' },
  ];
  const exts: Array<{ ext: string; type: ChainMedia['type'] }> = [
    { ext: 'mp4', type: 'video' },
    { ext: 'jpg', type: 'image' },
  ];
  for (const { base, source } of tiers) {
    for (const { ext, type } of exts) {
      const url = `${origin}/stories/${base}.${ext}`;
      const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
      if (head?.ok) return { url, type, base, source };
    }
  }
  return null;
}

/**
 * メンションsidecar {base}.json ({"mentions":["ig_username",...]}) を読む。無ければundefined。
 * タグ付けは公開アカウントのみ有効(非公開だと投稿失敗→cron側でメンション無し再試行の保険あり)。
 */
export async function loadMentions(origin: string, base: string): Promise<string[] | undefined> {
  const res = await fetch(`${origin}/stories/${base}.json`).catch(() => null);
  if (!res?.ok) return undefined;
  const j = await res.json().catch(() => null);
  if (!Array.isArray(j?.mentions)) return undefined;
  const mentions = j.mentions.filter((m: unknown) => typeof m === 'string');
  return mentions.length > 0 ? mentions : undefined;
}

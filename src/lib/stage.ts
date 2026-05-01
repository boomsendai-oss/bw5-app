/**
 * 4段階のコンテンツ解禁ステージ
 *
 *   pre      : 〜 5/5 09:00         事前公開（ショップ・オリジナル曲・SNSのみ）
 *   morning  : 5/5 09:00 〜 13:45   + 演目情報
 *   open     : 5/5 13:45 〜 14:30   + パンフレット・投票・舞台裏ライブフォト
 *   show     : 5/5 14:30 〜          全解禁（物販は取り置きモード）
 *
 * ?stage=pre / morning / open / show でプレビュー上書き。
 */

export type Stage = 'pre' | 'morning' | 'open' | 'show';

export const STAGE_BOUNDARIES = {
  morning: '2026-05-05T09:00:00+09:00',
  open:    '2026-05-05T13:45:00+09:00',
  show:    '2026-05-05T14:30:00+09:00',
} as const;

export function getStage(): Stage {
  if (typeof window !== 'undefined') {
    const p = new URLSearchParams(window.location.search).get('stage');
    if (p === 'pre' || p === 'morning' || p === 'open' || p === 'show') return p;
  }
  const now = Date.now();
  if (now >= new Date(STAGE_BOUNDARIES.show).getTime()) return 'show';
  if (now >= new Date(STAGE_BOUNDARIES.open).getTime()) return 'open';
  if (now >= new Date(STAGE_BOUNDARIES.morning).getTime()) return 'morning';
  return 'pre';
}

/**
 * 各ステージで解禁されるセクション（key と一致）。
 * ここに含まれていないセクションは LockedSection で COMING SOON 表示。
 */
export const STAGE_UNLOCKED: Record<Stage, ReadonlyArray<string>> = {
  pre:     ['merch', 'music', 'sns'],
  morning: ['merch', 'music', 'sns', 'schedule'],
  open:    ['merch', 'music', 'sns', 'schedule', 'pamphlet', 'vote', 'backstage'],
  show:    ['merch', 'music', 'sns', 'schedule', 'pamphlet', 'vote', 'backstage', 'video'],
};

export function isUnlockedAtStage(sectionId: string, stage: Stage): boolean {
  return STAGE_UNLOCKED[stage].includes(sectionId);
}

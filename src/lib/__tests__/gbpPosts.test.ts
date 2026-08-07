import { describe, expect, it } from 'vitest';
import {
  GBP_SUMMARY_MAX,
  nextMonthJst,
  parseGbpDraftMarkdown,
  planPostCreation,
  type ParsedDraftPost,
} from '../gbpPosts';

// ルーティンが実際に生成した 2026-08.md と同じ書式のサンプル
const SAMPLE = `# GBP予約投稿ドラフト 2026年8月分

作成日: 2026-07-24(自動生成)
ボタン: すべて「詳細」→ https://www.boom-sendai.com/

---

## 投稿1/4 — 第1週(体験告知)

**予約日時: 2026年8月3日(月) 9:00 JST**

\`\`\`
【8月も体験レッスン受付中】

体験レッスンのご予約は公式LINEから。
\`\`\`

---

## 投稿2/4 — 第2週(レッスンの様子)

**予約日時: 2026年8月10日(月) 9:00 JST**

\`\`\`
【レッスンの様子をちょっとだけ】
\`\`\`
`;

describe('parseGbpDraftMarkdown', () => {
  it('投稿セクションを予約日時(JST→UTC)と本文つきでパースする', () => {
    const { posts, errors } = parseGbpDraftMarkdown(SAMPLE);
    expect(errors).toEqual([]);
    expect(posts).toHaveLength(2);
    // JST 9:00 = UTC 0:00
    expect(posts[0].scheduledTimeUtc).toBe('2026-08-03T00:00:00.000Z');
    expect(posts[0].summary).toContain('【8月も体験レッスン受付中】');
    expect(posts[0].summary).toContain('公式LINEから。');
    expect(posts[0].index).toBe(1);
    expect(posts[1].scheduledTimeUtc).toBe('2026-08-10T00:00:00.000Z');
  });

  it('JST深夜(9時前)はUTCで前日になる', () => {
    const md = SAMPLE.replace('2026年8月3日(月) 9:00 JST', '2026年8月3日(月) 7:30 JST');
    const { posts } = parseGbpDraftMarkdown(md);
    expect(posts[0].scheduledTimeUtc).toBe('2026-08-02T22:30:00.000Z');
  });

  it('1本の書式崩れは errors に隔離し残りはパースする', () => {
    const md = SAMPLE.replace('**予約日時: 2026年8月3日(月) 9:00 JST**', '(日時未定)');
    const { posts, errors } = parseGbpDraftMarkdown(md);
    expect(posts).toHaveLength(1);
    expect(posts[0].index).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('投稿1');
  });

  it('本文コードブロック欠落をエラーにする', () => {
    const md = `## 投稿1/4 — テスト\n\n**予約日時: 2026年8月3日(月) 9:00 JST**\n\n本文なし\n`;
    const { posts, errors } = parseGbpDraftMarkdown(md);
    expect(posts).toHaveLength(0);
    expect(errors[0]).toContain('本文');
  });

  it('GBP上限(1500文字)超過をエラーにする', () => {
    const long = 'あ'.repeat(GBP_SUMMARY_MAX + 1);
    const md = `## 投稿1/4 — テスト\n\n**予約日時: 2026年8月3日(月) 9:00 JST**\n\n\`\`\`\n${long}\n\`\`\`\n`;
    const { posts, errors } = parseGbpDraftMarkdown(md);
    expect(posts).toHaveLength(0);
    expect(errors[0]).toContain('1500');
  });

  it('投稿セクションが無ければエラー', () => {
    const { posts, errors } = parseGbpDraftMarkdown('# 空ファイル\n');
    expect(posts).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });
});

function post(scheduledTimeUtc: string, index = 1): ParsedDraftPost {
  return { index, title: 't', scheduledTimeUtc, summary: 'body' };
}

describe('planPostCreation (冪等性)', () => {
  const now = '2026-07-25T00:00:00.000Z';

  it('同じscheduledTimeが既存にあればskip (表記ゆれ .000Z vs Z も同一視)', () => {
    const parsed = [post('2026-08-03T00:00:00.000Z'), post('2026-08-10T00:00:00.000Z', 2)];
    const existing = [{ state: 'SCHEDULED', scheduledTime: '2026-08-03T00:00:00Z' }];
    const plan = planPostCreation(parsed, existing, now);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].index).toBe(2);
    expect(plan.skipped[0].reason).toBe('already_exists');
  });

  it('REJECTEDの既存投稿は冪等判定に使わない(作り直しを許す)', () => {
    const parsed = [post('2026-08-03T00:00:00.000Z')];
    const existing = [{ state: 'REJECTED', scheduledTime: '2026-08-03T00:00:00Z' }];
    const plan = planPostCreation(parsed, existing, now);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('予約時刻が過去ならskip(即時公開事故の防止)', () => {
    const parsed = [post('2026-07-20T00:00:00.000Z')];
    const plan = planPostCreation(parsed, [], now);
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('time_passed');
  });

  it('既存なし・未来なら全件作成', () => {
    const parsed = [post('2026-08-03T00:00:00.000Z'), post('2026-08-10T00:00:00.000Z', 2)];
    const plan = planPostCreation(parsed, [], now);
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.skipped).toHaveLength(0);
  });
});

describe('nextMonthJst', () => {
  it('JST基準で翌月を返す(20日cron→翌月分)', () => {
    expect(nextMonthJst(new Date('2026-07-20T01:00:00Z'))).toBe('2026-08');
  });
  it('年跨ぎ: JST 12/20 → 翌年1月', () => {
    expect(nextMonthJst(new Date('2026-12-20T01:00:00Z'))).toBe('2027-01');
  });
  it('UTC月末23時(=JST翌月1日朝)はJSTの月で判定する', () => {
    // UTC 2026-07-31T23:00 = JST 2026-08-01 08:00 → 翌月は9月
    expect(nextMonthJst(new Date('2026-07-31T23:00:00Z'))).toBe('2026-09');
  });
});

// Facebook版の同時起草(TARO 2026-08-07)。GBP文面の転載でなく別文を書く前提で、
// ドラフトMDの「**Facebook版**」ブロックをパースする。
describe('parseGbpDraftMarkdown: Facebook版', () => {
  const base = (fbBlock: string) => `# ドラフト

## 投稿1/4 — 第1週(出来事報告)

**予約日時: 2026年9月7日(月) 9:00 JST**

\`\`\`
GBP向けの本文です。
\`\`\`

${fbBlock}
`;

  it('Facebook版ブロックがあれば fbText に入る', () => {
    const md = base('**Facebook版**\n\n```\nFB向けの本文です。場面を描いた長めの文。\n```');
    const { posts, errors } = parseGbpDraftMarkdown(md);
    expect(errors).toEqual([]);
    expect(posts[0].summary).toBe('GBP向けの本文です。');
    expect(posts[0].fbText).toBe('FB向けの本文です。場面を描いた長めの文。');
  });

  it('Facebook版が無ければ fbText は undefined (後方互換)', () => {
    const { posts, errors } = parseGbpDraftMarkdown(base(''));
    expect(errors).toEqual([]);
    expect(posts[0].fbText).toBeUndefined();
  });

  it('マーカーはあるが本文が無い場合はエラーに隔離し、GBP側は生かす', () => {
    const md = base('**Facebook版**\n\n(書き忘れ)');
    const { posts, errors } = parseGbpDraftMarkdown(md);
    expect(posts).toHaveLength(1);
    expect(posts[0].fbText).toBeUndefined();
    expect(errors.some((e) => e.includes('Facebook版'))).toBe(true);
  });

  it('複数投稿でFB版の有無が混在してよい', () => {
    const md = `# ドラフト

## 投稿1/4 — 第1週

**予約日時: 2026年9月7日(月) 9:00 JST**

\`\`\`
GBP1
\`\`\`

**Facebook版**

\`\`\`
FB1
\`\`\`

## 投稿2/4 — 第2週

**予約日時: 2026年9月14日(月) 9:00 JST**

\`\`\`
GBP2
\`\`\`
`;
    const { posts, errors } = parseGbpDraftMarkdown(md);
    expect(errors).toEqual([]);
    expect(posts.map((p) => p.fbText)).toEqual(['FB1', undefined]);
  });
});

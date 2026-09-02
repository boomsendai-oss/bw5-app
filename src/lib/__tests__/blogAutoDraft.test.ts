import { describe, expect, it } from 'vitest';
import {
  buildCoverageCorpus,
  buildSystemPrompt,
  buildUserPrompt,
  isExcludedQuery,
  isGenerationDay,
  isTokenCovered,
  makeSlug,
  normalizeQuery,
  parseModelJson,
  pickStructure,
  pickTopicClusters,
  tokenizeQuery,
  validateDraft,
} from '../blogAutoDraft';

describe('normalizeQuery / tokenizeQuery', () => {
  it('くっついた複合語を分け、#や全角空白を吸収する', () => {
    expect(normalizeQuery('仙台ダンススクール #大人')).toBe('仙台 ダンススクール 大人');
    expect(normalizeQuery('ダンス何歳から')).toBe('ダンス 何歳から');
  });
  it('汎用語(仙台/ダンス/教室)はトークンから落とす', () => {
    expect(tokenizeQuery('仙台 ダンス 初心者 大人')).toEqual(['初心者', '大人']);
    expect(tokenizeQuery('仙台市 ダンス')).toEqual([]);
  });
  it('分かち書きの1文字断片と態度語は落とす', () => {
    expect(tokenizeQuery('ダンス 何 歳 から')).toEqual([]);
    expect(tokenizeQuery('ダンス 何歳からでも 遅くない')).toEqual(['何歳からでも']);
  });
});

describe('isExcludedQuery', () => {
  it('BOOMが提供しないジャンルとブランド指名検索を除外する', () => {
    expect(isExcludedQuery('ポールダンス教室 仙台')).toBe(true);
    expect(isExcludedQuery('仙台長町 チアダンス')).toBe(true);
    expect(isExcludedQuery('boom仙台')).toBe(true);
    expect(isExcludedQuery('ちゃんなつ')).toBe(true);
    expect(isExcludedQuery('仙台 シニアダンス サークル')).toBe(false);
    expect(isExcludedQuery('多賀城 JAZZ')).toBe(false);
  });
});

describe('pickTopicClusters', () => {
  const corpus = buildCoverageCorpus([
    { slug: 'a', title: '子どものダンスは何歳から？', keywords: '何歳から,キッズ', excerpt: '' },
    { slug: 'b', title: '30代からダンスを始める', keywords: '大人,初心者,30代', excerpt: '' },
  ]);
  const queries = [
    { query: '仙台 シニアダンス サークル', impressions: 15, clicks: 1, position: 9.2 },
    { query: '60歳からのダンス教室 近く', impressions: 4, clicks: 0, position: 3.5 },
    { query: 'ダンス 何歳から', impressions: 84, clicks: 1, position: 8.3 },
    { query: '仙台市青葉区 ダンス', impressions: 16, clicks: 0, position: 23.9 },
    { query: 'ポールダンス教室 仙台', impressions: 9, clicks: 0, position: 51 },
    { query: '仙台ダンススクール 大人 初心者', impressions: 51, clicks: 2, position: 8.5 },
    { query: 'ダンス 習い事', impressions: 2, clicks: 0, position: 4.6 },
  ];

  it('受け皿のある語(何歳から/大人 初心者)と除外語は候補にならない', () => {
    const keys = pickTopicClusters(queries, corpus).map((c) => c.key);
    expect(keys).not.toContain('何歳から');
    expect(keys).not.toContain('ポールダンス教室');
    expect(keys).not.toContain('初心者');
  });

  it('未カバー語を束ねて表示回数順に返す', () => {
    const clusters = pickTopicClusters(queries, corpus);
    // 「シニアダンス」と「60歳からのダンス教室」は同じ束(代表語=シニア)に合流し、15+4=19で1位
    expect(clusters[0].key).toBe('シニア');
    expect(clusters[0].score).toBe(19);
    expect(clusters[0].queries.map((q) => q.query)).toEqual(['仙台 シニアダンス サークル', '60歳からのダンス教室 近く']);
    expect(clusters[1].key).toBe('仙台市青葉区');
    expect(clusters[1].score).toBe(16);
  });

  it('40-50代記事が「60代」に触れているだけではシニアの受け皿とみなさない', () => {
    const c = buildCoverageCorpus([{ slug: 'b', title: '40代・50代からダンスを始める｜60代の生徒も通う', keywords: '60代', excerpt: '' }]);
    expect(isTokenCovered('シニアダンス', c)).toBe(false);
    const cs = buildCoverageCorpus([{ slug: 's', title: 'シニアのダンス教室', keywords: 'シニア', excerpt: '' }]);
    expect(isTokenCovered('シニアダンス', cs)).toBe(true);
    expect(isTokenCovered('60歳からのダンス教室', cs)).toBe(false); // 束ねは合流するが受け皿判定は語が一致した時だけ
  });

  it('逆順の複合語(ダンススクール仙台)と講師名のカナ検索を扱う', () => {
    expect(tokenizeQuery('ダンススクール仙台 キッズ')).toEqual(['キッズ']);
    expect(isExcludedQuery('リュウキ ダンス')).toBe(true);
  });

  it('前回スナップショットに無い語は2倍に加点される', () => {
    const prev = new Set(['仙台市青葉区 ダンス'].map(normalizeQuery));
    const clusters = pickTopicClusters(queries, corpus, { prevQueries: prev });
    const senior = clusters.find((c) => c.key === 'シニア')!;
    expect(senior.score).toBe(38); // 15×2(新規) + 4×2(新規)
    expect(senior.queries[0].isNew).toBe(true);
    expect(clusters.find((c) => c.key === '仙台市青葉区')!.queries[0].isNew).toBe(false);
  });

  it('語尾違い(何歳から始める)と言い換え(お金→費用)は受け皿ありとみなす', () => {
    const c = buildCoverageCorpus([
      { slug: 'a', title: '子どものダンスは何歳から？', keywords: '', excerpt: '' },
      { slug: 'c', title: 'ダンススクールの費用は月いくら？', keywords: '月謝', excerpt: '' },
    ]);
    expect(isTokenCovered('何歳から始める', c)).toBe(true);
    expect(isTokenCovered('お金かかる', c)).toBe(true);
    expect(isTokenCovered('仙台市青葉区', c)).toBe(false);
    expect(isTokenCovered('シニアダンス', c)).toBe(false);
    const keys = pickTopicClusters(
      [
        { query: 'ダンス 何歳から始める', impressions: 24, clicks: 1, position: 9.9 },
        { query: 'ダンス お金かかる', impressions: 8, clicks: 0, position: 8.1 },
        { query: '仙台市青葉区 ダンス', impressions: 16, clicks: 0, position: 23.9 },
      ],
      c
    ).map((x) => x.key);
    expect(keys).toEqual(['仙台市青葉区']);
  });

  it('表示回数が閾値未満の語は捨てる', () => {
    const keys = pickTopicClusters(queries, corpus, { minImpressions: 3 }).map((c) => c.key);
    expect(keys).not.toContain('習い事');
  });
});

describe('validateDraft', () => {
  const allowed = { blogSlugs: ['dance-school-cost-guide'] };
  const body = (extra = '') =>
    `## 見出し1\n\n${'本文です。'.repeat(200)}\n\n## 見出し2\n\n${'本文です。'.repeat(200)}\n\n## 見出し3\n\n${'本文です。'.repeat(200)}${extra}`;

  it('規定の書式なら問題なし。先頭の # タイトル行は落とす', () => {
    const v = validateDraft(`# タイトル\n\n${body('\n\n🕺 BOOMくん「これで合ってる？」\n\n> 🕺 **BOOMくんメモ**: 補足だよ')}`, allowed);
    expect(v.issues).toEqual([]);
    expect(v.content_markdown.startsWith('## 見出し1')).toBe(true);
  });

  it('吹き出しにならないBOOMくんと太字の罠を検出する', () => {
    const v = validateDraft(body('\n\nBOOMくんが言っていました。\n\n**入門クラスは「初めての人向け」**です。'), allowed);
    expect(v.issues.some((s) => s.includes('BOOMくんの記法'))).toBe(true);
    expect(v.issues.some((s) => s.includes('太字が閉じない'))).toBe(true);
  });

  it('存在しない記事へのリンクは文字だけにして指摘に積む', () => {
    const v = validateDraft(body('\n\n[費用の記事](/blog/dance-school-cost-guide/) と [幻の記事](/blog/no-such-post/) と [外部](https://example.com/)'), allowed);
    expect(v.content_markdown).toContain('[費用の記事](/blog/dance-school-cost-guide/)');
    expect(v.content_markdown).toContain(' 幻の記事 ');
    expect(v.content_markdown).not.toContain('example.com');
    expect(v.issues.some((s) => s.includes('no-such-post'))).toBe(true);
  });

  it('短すぎる本文とNG表現を指摘する', () => {
    const v = validateDraft('## 短い\n\n勧誘はしません。', allowed);
    expect(v.issues.some((s) => s.includes('短い'))).toBe(true);
    expect(v.issues.some((s) => s.includes('勧誘はしません'))).toBe(true);
  });
});

describe('parseModelJson / makeSlug', () => {
  it('コードフェンス付きでもJSONを取り出す', () => {
    const d = parseModelJson('```json\n{"title":"T","slug_en":"Senior Dance Sendai","content_markdown":"## a","keywords":["x"]}\n```');
    expect(d.title).toBe('T');
    expect(d.keywords).toEqual(['x']);
    expect(d.category).toBe('コラム');
  });
  it('必須欠落は例外', () => {
    expect(() => parseModelJson('{"title":"T"}')).toThrow();
  });
  it('slugは英小文字ハイフンに整え、衝突したら日付を足す', () => {
    expect(makeSlug('Senior Dance Sendai', new Set(), '2026-09-02')).toBe('senior-dance-sendai');
    expect(makeSlug('senior-dance-sendai', new Set(['senior-dance-sendai']), '2026-09-02')).toBe('senior-dance-sendai-20260902');
    expect(makeSlug('', new Set(), '2026-09-02')).toBe('post-20260902');
  });
});

describe('スケジュール・構成', () => {
  it('生成日は月水金', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(isGenerationDay)).toEqual([false, true, false, true, false, true, false]);
  });
  it('構成型は交互(エピソード開始型は使わない)', () => {
    expect(pickStructure(0)).toBe('標準型');
    expect(pickStructure(1)).toBe('Q&A主導型');
    expect(pickStructure(2)).toBe('標準型');
  });
});

describe('プロンプト', () => {
  const facts = {
    classesByArea: { 長町: ['土 15:30 長町 WAACK 入門 / 60分 / 講師YURI / ララガーデン内'] },
    instructors: ['TARO(HIPHOP)'],
    existingPosts: [{ slug: 'dance-school-cost-guide', title: '費用' }],
  };
  it('事実ブロックと既存記事・禁止事項がシステムプロンプトに入る', () => {
    const s = buildSystemPrompt(facts);
    expect(s).toContain('ララガーデン内');
    expect(s).toContain('/blog/dance-school-cost-guide/');
    expect(s).toContain('K-POPはやっていない');
    expect(s).toContain('勧誘はしません');
    expect(s).not.toContain('長町コナスポスタジオ');
  });
  it('ユーザープロンプトにseed queriesと構成型が入る', () => {
    const u = buildUserPrompt(
      { key: 'シニアダンス', score: 30, uncovered: ['シニアダンス'], queries: [{ query: '仙台 シニアダンス サークル', impressions: 15, position: 9.2, isNew: true }] },
      'Q&A主導型'
    );
    expect(u).toContain('仙台 シニアダンス サークル');
    expect(u).toContain('今週新しく表示が付いた語');
    expect(u).toContain('Q&A主導型');
  });
});

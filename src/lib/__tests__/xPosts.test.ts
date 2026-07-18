import { describe, expect, it } from 'vitest';
import {
  splitThreadText,
  joinThreadParts,
  parsePartsJson,
  pickDuePosts,
  jstInputToUtcIso,
  utcIsoToJstInput,
  formatJst,
  tweetWeightedLength,
  MAX_POSTS_PER_RUN,
  MAX_MEDIA_PER_POST,
  parseMediaJson,
  validateMediaList,
  buildTweetPayloads,
} from '../xPosts';

describe('splitThreadText (空行2つ区切りのツリー分割)', () => {
  it('単発: 空行2つが無ければ1要素', () => {
    expect(splitThreadText('こんにちは')).toEqual(['こんにちは']);
  });

  it('空行2つ(改行3つ)で分割する', () => {
    expect(splitThreadText('1本目\n\n\n2本目')).toEqual(['1本目', '2本目']);
  });

  it('空行1つはツイート内の段落として保持する', () => {
    expect(splitThreadText('前段\n\n後段')).toEqual(['前段\n\n後段']);
  });

  it('空行3つ以上でも区切りは1つ', () => {
    expect(splitThreadText('A\n\n\n\n\nB')).toEqual(['A', 'B']);
  });

  it('空行にスペース/タブが混ざっても区切る', () => {
    expect(splitThreadText('A\n \n\t\nB')).toEqual(['A', 'B']);
  });

  it('CRLF改行を正規化する', () => {
    expect(splitThreadText('A\r\n\r\n\r\nB')).toEqual(['A', 'B']);
  });

  it('各要素をtrimし空要素を除く', () => {
    expect(splitThreadText('  A  \n\n\n\n\n\n')).toEqual(['A']);
    expect(splitThreadText('   ')).toEqual([]);
    expect(splitThreadText('')).toEqual([]);
  });

  it('joinThreadParts と往復できる', () => {
    const parts = ['1本目\n\n段落あり', '2本目', '3本目'];
    expect(splitThreadText(joinThreadParts(parts))).toEqual(parts);
  });
});

describe('parsePartsJson', () => {
  it('正常なJSON配列をパースする', () => {
    expect(parsePartsJson('["a","b"]')).toEqual(['a', 'b']);
  });
  it('壊れたJSON・非配列・null は []', () => {
    expect(parsePartsJson('{bad')).toEqual([]);
    expect(parsePartsJson('{"a":1}')).toEqual([]);
    expect(parsePartsJson(null)).toEqual([]);
  });
  it('文字列以外の要素は除外する', () => {
    expect(parsePartsJson('["a", 1, null, "b"]')).toEqual(['a', 'b']);
  });
});

describe('pickDuePosts (投稿対象の選定)', () => {
  const now = '2026-07-17T03:00:00.000Z'; // JST 12:00
  const row = (id: number, status: string, scheduled_at: string | null) => ({ id, status, scheduled_at });

  it('approved かつ scheduled_at<=now のみを古い順に返す', () => {
    const rows = [
      row(1, 'approved', '2026-07-17T02:00:00.000Z'),
      row(2, 'approved', '2026-07-17T04:00:00.000Z'), // 未来 → 対象外
      row(3, 'draft', '2026-07-17T01:00:00.000Z'), // 未承認 → 対象外
      row(4, 'approved', null), // 予約なし=手動待ち → 対象外
      row(5, 'approved', '2026-07-17T01:00:00.000Z'),
      row(6, 'posted', '2026-07-17T01:00:00.000Z'), // 投稿済み → 対象外
      row(7, 'failed', '2026-07-17T01:00:00.000Z'), // 失敗は自動リトライしない
    ];
    expect(pickDuePosts(rows, now).map((r) => r.id)).toEqual([5, 1]);
  });

  it('scheduled_at がちょうど now のものは対象', () => {
    expect(pickDuePosts([row(1, 'approved', now)], now).map((r) => r.id)).toEqual([1]);
  });

  it('同時刻は id 昇順', () => {
    const t = '2026-07-17T01:00:00.000Z';
    const rows = [row(9, 'approved', t), row(3, 'approved', t)];
    expect(pickDuePosts(rows, now).map((r) => r.id)).toEqual([3, 9]);
  });

  it('1回の実行で最大5件 (暴走防止)', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(i + 1, 'approved', `2026-07-17T00:0${i}:00.000Z`));
    const picked = pickDuePosts(rows, now);
    expect(picked).toHaveLength(MAX_POSTS_PER_RUN);
    expect(picked.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('JST予約日時の変換', () => {
  it('JST datetime-local → UTC ISO', () => {
    expect(jstInputToUtcIso('2026-07-17T09:00')).toBe('2026-07-17T00:00:00.000Z');
    expect(jstInputToUtcIso('2026-07-17T08:59')).toBe('2026-07-16T23:59:00.000Z'); // JST朝9時前=UTC前日
  });

  it('不正な書式・実在しない日付は null', () => {
    expect(jstInputToUtcIso('2026/07/17 09:00')).toBeNull();
    expect(jstInputToUtcIso('2026-7-17T09:00')).toBeNull();
    expect(jstInputToUtcIso('2026-02-30T09:00')).toBeNull();
    expect(jstInputToUtcIso('')).toBeNull();
  });

  it('UTC ISO → JST datetime-local (往復一致)', () => {
    expect(utcIsoToJstInput('2026-07-17T00:00:00.000Z')).toBe('2026-07-17T09:00');
    const local = '2026-12-31T23:30';
    expect(utcIsoToJstInput(jstInputToUtcIso(local)!)).toBe(local);
  });

  it('formatJst は JSTの月日(曜)時刻', () => {
    expect(formatJst('2026-07-17T00:00:00.000Z')).toBe('7/17(金) 09:00'); // 2026-07-17はJSTで金曜
  });
});

describe('tweetWeightedLength (文字数目安)', () => {
  it('ASCIIは1・日本語は2でカウントする', () => {
    expect(tweetWeightedLength('abc')).toBe(3);
    expect(tweetWeightedLength('ダンス')).toBe(6);
    expect(tweetWeightedLength('BOOM仙台')).toBe(8);
  });
  it('サロゲートペア(絵文字)を1文字=2としてカウントする', () => {
    expect(tweetWeightedLength('🔥')).toBe(2);
  });
});

// ---- 画像添付 (20260718_x_posts_media.sql) ----

describe('parseMediaJson (mediaカラムの寛容パース)', () => {
  it('NULL・空文字は []', () => {
    expect(parseMediaJson(null)).toEqual([]);
    expect(parseMediaJson('')).toEqual([]);
  });

  it('不正JSONは []', () => {
    expect(parseMediaJson('{oops')).toEqual([]);
    expect(parseMediaJson('"文字列"')).toEqual([]);
    expect(parseMediaJson('{"url":"https://a.example/x.png"}')).toEqual([]); // 配列でない
  });

  it('url を持つ要素だけ残し alt(文字列)を保持する', () => {
    const json = JSON.stringify([
      { url: 'https://blob.example/a.png', alt: 'A' },
      { url: '  https://blob.example/b.jpg  ' },
      { alt: 'urlなし' },
      'ただの文字列',
      null,
      { url: 42 },
    ]);
    expect(parseMediaJson(json)).toEqual([
      { url: 'https://blob.example/a.png', alt: 'A' },
      { url: 'https://blob.example/b.jpg' },
    ]);
  });

  it('5枚以上は4枚に切り詰める', () => {
    const json = JSON.stringify(
      [1, 2, 3, 4, 5, 6].map((n) => ({ url: `https://blob.example/${n}.png` }))
    );
    expect(parseMediaJson(json)).toHaveLength(MAX_MEDIA_PER_POST);
  });
});

describe('validateMediaList (保存前の厳格検証)', () => {
  it('空配列・4枚以内の妥当なURLは OK (null)', () => {
    expect(validateMediaList([])).toBeNull();
    expect(
      validateMediaList([
        { url: 'https://blob.example/a.png' },
        { url: '/images/upload_1.png' },
        { url: 'http://localhost:3000/images/b.jpg', alt: 'ロゴ' },
        { url: 'https://blob.example/d.webp' },
      ])
    ).toBeNull();
  });

  it('配列以外・要素の形式不正はエラー', () => {
    expect(validateMediaList('x')).not.toBeNull();
    expect(validateMediaList([null])).not.toBeNull();
    expect(validateMediaList([{ alt: 'urlなし' }])).not.toBeNull();
    expect(validateMediaList([{ url: 42 }])).not.toBeNull();
    expect(validateMediaList([{ url: 'https://a.example/x.png', alt: 1 }])).not.toBeNull();
  });

  it('5枚以上はエラー', () => {
    const five = [1, 2, 3, 4, 5].map((n) => ({ url: `https://blob.example/${n}.png` }));
    expect(validateMediaList(five)).toMatch(/最大4枚/);
  });

  it('不正URL(スキーム・プロトコル相対・非URL)は拒否する', () => {
    expect(validateMediaList([{ url: 'javascript:alert(1)' }])).not.toBeNull();
    expect(validateMediaList([{ url: 'data:image/png;base64,AAAA' }])).not.toBeNull();
    expect(validateMediaList([{ url: '//evil.example/x.png' }])).not.toBeNull();
    expect(validateMediaList([{ url: 'ただのテキスト' }])).not.toBeNull();
    expect(validateMediaList([{ url: 'ftp://a.example/x.png' }])).not.toBeNull();
  });
});

describe('buildTweetPayloads (media_idsは1本目のみ)', () => {
  it('ツリーでは1本目にだけ mediaIds が付く', () => {
    const p = buildTweetPayloads(['1本目', '2本目', '3本目'], ['m1', 'm2']);
    expect(p).toEqual([
      { text: '1本目', mediaIds: ['m1', 'm2'] },
      { text: '2本目' },
      { text: '3本目' },
    ]);
    expect(p[1]).not.toHaveProperty('mediaIds');
    expect(p[2]).not.toHaveProperty('mediaIds');
  });

  it('単発ツイート + 画像', () => {
    expect(buildTweetPayloads(['単発'], ['m1'])).toEqual([{ text: '単発', mediaIds: ['m1'] }]);
  });

  it('画像なしなら mediaIds プロパティ自体を付けない', () => {
    const p = buildTweetPayloads(['A', 'B'], []);
    expect(p).toEqual([{ text: 'A' }, { text: 'B' }]);
    expect(p[0]).not.toHaveProperty('mediaIds');
  });
});

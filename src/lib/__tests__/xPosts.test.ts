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

import { describe, expect, it } from 'vitest';
import { teachersOf, namesInTitle, judgeEntry, applySubstitutes, isAllowedSubstituteUrl } from '../storySubstitute';
import { matchDeclaredLesson } from '../storyPlan';

const KNOWN = ['K@TTSU', 'AOI', 'TARO', 'KEIKO', 'Ryuki', 'HARUKI', 'HARUKA', 'MY', 'MYU', 'KOKEKO'];
const ev = (start: string, summary: string, end?: string, note?: string) => ({ start, summary, end, note });

// 2026-11-11(水) の実際のカレンダー(18:30 は TAROの代わりに AOI)
const CAL_1111 = [
  ev('18:30', '【AOI】hiphop 入門初級（代行）', '20:00'),
  ev('18:45', '【HARUKI】HIPHOP入門 お試し体験会🔰', '19:45'),
  ev('20:00', '【K@TTSU】HOUSE 初級', '21:30'),
];
const WED = [{ start: '18:30', instructor: 'TARO' }, { start: '20:00', instructor: 'K@TTSU' }];

describe('teachersOf (その予定で教える講師)', () => {
  it('「（代行）」だけ付いた予定は【】の中の講師', () => {
    expect(teachersOf('【AOI】hiphop 入門初級（代行）', KNOWN)).toEqual({ marked: true, teachers: ['AOI'] });
  });
  it('「（代講）」でも同じ', () => {
    expect(teachersOf('【AOI】HOUSE 初級（代講）', KNOWN)).toEqual({ marked: true, teachers: ['AOI'] });
  });
  it('「代講 ○○」は○○の講師', () => {
    expect(teachersOf('【TARO】キッズHIPHOP 代講 KOKEKO', KNOWN)).toEqual({ marked: true, teachers: ['KOKEKO'] });
  });
  it('代講の印が無い予定はタイトルの講師名(全角も)', () => {
    expect(teachersOf('多賀城HOUSE【K＠TTSU】', KNOWN)).toEqual({ marked: false, teachers: ['K@TTSU'] });
  });
  it('短い名前が長い名前の一部なだけなら数えない(MY と MYU)', () => {
    expect(namesInTitle('【MYU】七ヶ浜 超入門', KNOWN)).toEqual(['MYU']);
  });
});

describe('judgeEntry (画像1枚がその日のカレンダーとどう食い違うか)', () => {
  it('11/11: 18:30 TARO→AOI の代講だけ → 代講版を作る', () => {
    const j = judgeEntry(CAL_1111, KNOWN, WED);
    expect(j).toEqual({
      kind: 'substitute',
      swaps: [{ start: '18:30', from: 'TARO', to: 'AOI', end: '20:00', summary: '【AOI】hiphop 入門初級（代行）' }],
      lessons: [{ start: '18:30', instructor: 'AOI' }, { start: '20:00', instructor: 'K@TTSU' }],
    });
  });
  it('11/25: 題名は【AOI】のまま説明欄に「代行」→ K@TTSU→AOI の代講', () => {
    const cal = [
      ev('18:30', 'TARO hiphop 入門初級', '20:00', '18:30〜20:00\nTARO HIPHOP 入門クラス'),
      ev('20:00', '【AOI】HOUSE 初級', '21:30', '※この回はK@TTSUの代行でAOIが担当（11/10 K@TTSUから連絡・TARO OK）'),
    ];
    const j = judgeEntry(cal, KNOWN, WED);
    expect(j.kind).toBe('substitute');
    if (j.kind === 'substitute') expect(j.swaps.map((s) => `${s.start} ${s.from}→${s.to}`)).toEqual(['20:00 K@TTSU→AOI']);
  });
  it('説明欄に「代行」の字があっても、講師が宣言どおりなら ok', () => {
    const cal = [ev('18:30', '【TARO】HIPHOP 入門初級', undefined, '代行のときはLINEでお知らせします'), ev('20:00', '【K@TTSU】HOUSE 初級')];
    expect(judgeEntry(cal, KNOWN, WED)).toEqual({ kind: 'ok' });
  });
  it('食い違いが無ければ ok', () => {
    const cal = [ev('18:30', '【TARO】HIPHOP 入門初級'), ev('20:00', '【K@TTSU】HOUSE 初級')];
    expect(judgeEntry(cal, KNOWN, WED)).toEqual({ kind: 'ok' });
  });
  it('休講(その時刻に予定が無い)は代講にしない', () => {
    const j = judgeEntry([ev('20:00', '【K@TTSU】HOUSE 初級')], KNOWN, WED);
    expect(j.kind).toBe('other');
  });
  it('講師が違っても代講の印が無ければ代講にしない(書き間違いの可能性)', () => {
    const cal = [ev('18:30', '【AOI】HIPHOP 入門初級'), ev('20:00', '【K@TTSU】HOUSE 初級')];
    expect(judgeEntry(cal, KNOWN, WED).kind).toBe('other');
  });
  it('代講の印があっても、代わりの講師が分からなければ代講にしない', () => {
    const cal = [ev('18:30', 'HIPHOP 入門初級（代行）'), ev('20:00', '【K@TTSU】HOUSE 初級')];
    expect(judgeEntry(cal, KNOWN, WED).kind).toBe('other');
  });
  it('代講と休講が混ざっていたら出さない', () => {
    const cal = [ev('18:30', '【AOI】hiphop 入門初級（代行）')];
    expect(judgeEntry(cal, KNOWN, WED).kind).toBe('other');
  });
});

describe('matchDeclaredLesson と代講の印', () => {
  it('「（代講）」の予定は、元の講師の画像では通らず、代わりの講師で通る', () => {
    const cal = [ev('20:00', '【AOI】HOUSE 初級（代講）')];
    expect(matchDeclaredLesson(cal, KNOWN, { start: '20:00', instructor: 'K@TTSU' })).toBe(false);
    expect(matchDeclaredLesson(cal, KNOWN, { start: '20:00', instructor: 'AOI' })).toBe(true);
  });
});

describe('applySubstitutes (投稿チェーンへの差し込み)', () => {
  const m = (base: string) => ({ base, url: `https://x/${base}.jpg`, type: 'image' as const, source: 'weekday-file' });
  const make = (s: { replacesBase: string; mediaUrl: string }) => ({ base: `sub:${s.replacesBase}`, url: s.mediaUrl, type: 'image' as const, source: 'substitute' });
  it('同じ素材があれば置き換える', () => {
    const out = applySubstitutes([m('wed')], [{ replacesBase: 'wed', mediaUrl: 'https://media.boom-sendai.com/a.jpg', lessons: [] }], make);
    expect(out.map((x) => x.base)).toEqual(['sub:wed']);
  });
  it('無ければ足す(台帳の自動選択が不一致の画像を外している場合)', () => {
    const out = applySubstitutes([m('a.jpg')], [{ replacesBase: 'b.jpg', mediaUrl: 'https://media.boom-sendai.com/b.jpg', lessons: [] }], make);
    expect(out.map((x) => x.base)).toEqual(['a.jpg', 'sub:b.jpg']);
  });
});

describe('isAllowedSubstituteUrl', () => {
  it('R2の公開ドメインの画像だけ受け付ける', () => {
    expect(isAllowedSubstituteUrl('https://media.boom-sendai.com/story-sub/2026-11-25_wed.jpg')).toBe(true);
    expect(isAllowedSubstituteUrl('https://evil.example.com/x.jpg')).toBe(false);
    expect(isAllowedSubstituteUrl('http://media.boom-sendai.com/x.jpg')).toBe(false);
    expect(isAllowedSubstituteUrl('https://media.boom-sendai.com/x.mp4')).toBe(false);
  });
});

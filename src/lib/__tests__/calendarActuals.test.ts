import { describe, it, expect } from 'vitest';
import {
  detectRoomHint,
  parseInstructors,
  stripDecorations,
  detectCancelled,
  parseInstructor,
  resolveStudio,
  resolveCalendarEvent,
  type CalendarEvent,
} from '../calendarActuals';

// 実データ由来 (2026-06〜08 のGoogleカレンダー108コマ + instructors/studios 本番値)
const INSTRUCTORS = [
  { id: 1, name: 'K@TTSU' }, { id: 2, name: 'AOI' }, { id: 3, name: 'TARO' },
  { id: 4, name: 'KEIKO' }, { id: 5, name: 'Ryuki' }, { id: 6, name: 'ちゃんなつ' },
  { id: 7, name: 'SAYUKI' }, { id: 8, name: 'おっちゃん' }, { id: 10, name: 'YURI' },
  { id: 12, name: 'KOKEKO' }, { id: 13, name: 'My' },
];

const STUDIOS = [
  { id: 1, name: 'GOATスタジオ', aliases: ['GOAT DANCE STUDIO', 'GOAT'] },
  { id: 2, name: 'GOAT 小スタジオ', aliases: ['GOAT小'] },
  { id: 3, name: "T's STUDIO", aliases: ["レンタルスタジオT's", "スタジオT's"] },
  { id: 4, name: 'AZUMA スタジオ', aliases: ['DanceStudioAzuma', 'スタジオAZUMA'] },
  { id: 7, name: '七ヶ浜国際村 リハーサル室', aliases: ['七ヶ浜国際村'] },
  { id: 8, name: 'アクアスタジオ', aliases: ['アクアリーナ', '七ヶ浜健康スポーツセンター'] },
  { id: 9, name: '長町コナスポスタジオ', aliases: ['コナスポ', 'コナミスポーツクラブ 仙台長町', 'KONAMI'] },
  { id: 10, name: 'マイダンスショップ', aliases: [] },
  { id: 12, name: '宮城野区文化センター　リハーサル室', aliases: ['宮城野区文化センター'] },
  { id: 90, name: '戦災復興記念館　展示ホール', aliases: ['戦災復興記念館'] },
  { id: 91, name: '七ヶ浜町中央公民館 中会議室', aliases: ['七ヶ浜町中央公民館', '生涯学習センター'] },
  { id: 92, name: 'エルパーク仙台　フィットネススタジオ', aliases: ['エルパーク', '男女共同参画'] },
];

const ev = (o: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e1', date: '2026-08-24', start: '18:30', end: '20:00',
  summary: 'テスト', location: null, ...o,
});

describe('stripDecorations', () => {
  it('装飾記号を落とす', () => {
    expect(stripDecorations('★おっちゃんNJS')).toBe('おっちゃんNJS');
    expect(stripDecorations('🔥Ryuki HIPHOP レベルアップWS')).toBe('Ryuki HIPHOP レベルアップWS');
    expect(stripDecorations('【YURI】長町WAACK 入門🔰')).toBe('【YURI】長町WAACK 入門');
    expect(stripDecorations('⚔️ダンスバトル練習会')).toBe('ダンスバトル練習会');
  });
});

describe('detectCancelled — 休講は削除されずタイトルに残る運用', () => {
  it('2形式とも休講と判定する', () => {
    expect(detectCancelled('休講【YURI】長町WAACK 入門🔰')).toBe(true);
    expect(detectCancelled('【休講】TARO hiphop 中級')).toBe(true);
  });
  it('通常のレッスンは休講にしない', () => {
    expect(detectCancelled('【YURI】長町WAACK 初級')).toBe(false);
    expect(detectCancelled('TARO hiphop 中級')).toBe(false);
  });
});

describe('parseInstructor — 実データの5パターン', () => {
  it('【講師】が先頭', () => {
    expect(parseInstructor('【YURI】長町WAACK 初級', INSTRUCTORS)).toMatchObject({ id: 10, name: 'YURI' });
    expect(parseInstructor('【Ryuki】キッズHIPHOP 入門', INSTRUCTORS)).toMatchObject({ id: 5 });
  });
  it('【講師】が末尾', () => {
    expect(parseInstructor('多賀城HOUSE【AOI】', INSTRUCTORS)).toMatchObject({ id: 2, name: 'AOI' });
    expect(parseInstructor('七ヶ浜HIPHOP 入門クラス【AOI】🔰', INSTRUCTORS)).toMatchObject({ id: 2 });
  });
  it('括弧なしで名前が先頭', () => {
    expect(parseInstructor('SAYUKI free style', INSTRUCTORS)).toMatchObject({ id: 7 });
    expect(parseInstructor('TARO hiphop 中級', INSTRUCTORS)).toMatchObject({ id: 3 });
    expect(parseInstructor('KEIKO STREET JAZZ 強化クラス', INSTRUCTORS)).toMatchObject({ id: 4 });
  });
  it('装飾つきでも読める', () => {
    expect(parseInstructor('★おっちゃんNJS', INSTRUCTORS)).toMatchObject({ id: 8, name: 'おっちゃん' });
    expect(parseInstructor('🔥Ryuki HIPHOP レベルアップWS', INSTRUCTORS)).toMatchObject({ id: 5 });
  });
  it('全角スペース入りの【 KEIKO】も読める', () => {
    expect(parseInstructor('【 KEIKO】長町ガールズ 初級', INSTRUCTORS)).toMatchObject({ id: 4 });
  });
  it('代講は「実際にやった人」を返し substitute=true にする', () => {
    // 給与は実施者に払う。マスタの担当(Ryuki)ではなく KOKEKO が正。
    expect(parseInstructor('【Ryuki】キッズ HIPHOP 代講 KOKEKO', INSTRUCTORS)).toMatchObject({
      id: 12, name: 'KOKEKO', substitute: true,
    });
  });
  it('区切り文字のあとに名前が来る形 (実データ: 七ヶ浜HIPHOP 初級クラス|TARO)', () => {
    expect(parseInstructor('七ヶ浜HIPHOP 初級クラス|TARO', INSTRUCTORS)).toMatchObject({ id: 3, name: 'TARO' });
    expect(parseInstructor('七ヶ浜HIPHOP 初級クラス｜KEIKO', INSTRUCTORS)).toMatchObject({ id: 4 });
  });

  it('名簿に無い名前は null (推測しない)', () => {
    expect(parseInstructor('⚔️ダンスバトル練習会', INSTRUCTORS)).toBeNull();
    expect(parseInstructor('体験レッスン', INSTRUCTORS)).toBeNull();
  });
});

describe('parseInstructors — 連名(2人体制)', () => {
  // 生徒もこのカレンダーを見て「今日は誰が担当か」を確認するため、
  // 連名で書ける必要がある(TARO要件 2026-08-28)。区切り文字は指定させず全部受ける。
  it('区切り文字が何であれ2人とも取れる', () => {
    for (const sep of ['/', '／', '・', '&', '＆', '、', ',']) {
      const got = parseInstructors(`【TARO${sep}KOKEKO】長町 HIPHOP クラス`, INSTRUCTORS).map((x) => x.id);
      expect(got, `区切り=${sep}`).toEqual([3, 12]);
    }
  });

  it('順序は書いたとおりに保つ (生徒への見え方と一致させる)', () => {
    expect(parseInstructors('【KOKEKO／TARO】長町 HIPHOP クラス', INSTRUCTORS).map((x) => x.id)).toEqual([12, 3]);
  });

  it('1人のときは1件だけ返す', () => {
    expect(parseInstructors('【YURI】長町WAACK 初級', INSTRUCTORS).map((x) => x.id)).toEqual([10]);
    expect(parseInstructors('SAYUKI free style', INSTRUCTORS).map((x) => x.id)).toEqual([7]);
    expect(parseInstructors('多賀城HOUSE【AOI】', INSTRUCTORS).map((x) => x.id)).toEqual([2]);
  });

  it('代講は実施者だけを返す (マスタの担当には払わない)', () => {
    const r = parseInstructors('【Ryuki】キッズ HIPHOP 代講 KOKEKO', INSTRUCTORS);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 12, substitute: true });
  });

  it('名簿に無い名前が混ざっていても、読めた人だけ返す', () => {
    expect(parseInstructors('【TARO/ダレカ】クラス', INSTRUCTORS).map((x) => x.id)).toEqual([3]);
    expect(parseInstructors('⚔️ダンスバトル練習会', INSTRUCTORS)).toEqual([]);
  });

  it('同じ人を2回書いても重複しない', () => {
    expect(parseInstructors('【TARO/TARO】クラス', INSTRUCTORS).map((x) => x.id)).toEqual([3]);
  });
});

describe('resolveStudio — 表記ゆれは起こる前提', () => {
  it('住所つきでも会場を特定する', () => {
    expect(resolveStudio('GOAT DANCE STUDIO, 日本、〒980-0014 宮城県仙台市青葉区本町１丁目９−２３ BFEビル 3F', STUDIOS))
      .toMatchObject({ id: 1 });
    expect(resolveStudio('コナミスポーツクラブ 仙台長町, 日本、〒982-0011 宮城県仙台市太白区長町７丁目', STUDIOS))
      .toMatchObject({ id: 9 });
  });
  it('同じ会場の別表記を同じidに寄せる', () => {
    expect(resolveStudio('戦災復興記念館　展示ホール', STUDIOS)).toMatchObject({ id: 90 });
    expect(resolveStudio('仙台市戦災復興記念館　展示ホール', STUDIOS)).toMatchObject({ id: 90 });
    expect(resolveStudio('コナスポ', STUDIOS)).toMatchObject({ id: 9 });
    expect(resolveStudio('長町コナスポ', STUDIOS)).toMatchObject({ id: 9 });
    expect(resolveStudio('宮城野区文化センター/リハーサル室', STUDIOS)).toMatchObject({ id: 12 });
    expect(resolveStudio('仙台市宮城野区文化センター　リハーサル室', STUDIOS)).toMatchObject({ id: 12 });
    expect(resolveStudio("レンタルスタジオＴ's", STUDIOS)).toMatchObject({ id: 3 });
    expect(resolveStudio("スタジオT's", STUDIOS)).toMatchObject({ id: 3 });
    expect(resolveStudio('DanceStudioAzuma, 日本、〒980-0802', STUDIOS)).toMatchObject({ id: 4 });
    expect(resolveStudio('スタジオAZUMA', STUDIOS)).toMatchObject({ id: 4 });
    expect(resolveStudio('七ヶ浜健康スポーツセンター「アクアリーナ」, 日本、〒985-0802', STUDIOS)).toMatchObject({ id: 8 });
  });
  it('施設名の途中に括弧が挟まる公共施設も拾える', () => {
    // 正式名「七ヶ浜町中央公民館 中会議室」に対し、カレンダーは
    // 「七ヶ浜町中央公民館(生涯学習センター) 中会議室」と書かれている
    expect(resolveStudio('七ヶ浜町中央公民館(生涯学習センター) 中会議室', STUDIOS)).toMatchObject({ id: 91 });
    // 領収書名義は「男女共同参画推進センター」だが会場はエルパーク仙台
    expect(resolveStudio('エルパーク仙台　フィットネススタジオ', STUDIOS)).toMatchObject({ id: 92 });
  });

  it('より具体的な別名を優先する (GOAT小スタジオ が GOAT に負けない)', () => {
    expect(resolveStudio('GOAT小スタジオ', STUDIOS)).toMatchObject({ id: 2 });
  });
  it('未知の会場・空欄は null (推測しない)', () => {
    expect(resolveStudio('どこかの新しい会場', STUDIOS)).toBeNull();
    expect(resolveStudio('', STUDIOS)).toBeNull();
    expect(resolveStudio(null, STUDIOS)).toBeNull();
  });
});

describe('detectRoomHint — 説明欄の部屋指定(GOAT A/B)', () => {
  it('部屋を特定する語に反応する', () => {
    expect(detectRoomHint('今日は小スタジオです')).toBe('B');
    expect(detectRoomHint('Bスタジオに変更')).toBe('B');
    expect(detectRoomHint('GOAT B')).toBe('B');
    expect(detectRoomHint('大スタジオ')).toBe('A');
  });
  it('道案内の定型文(会場リンク集)では誤検知しない', () => {
    const boilerplate = '＝＝＝＝\n🛣️スタジオへの道案内(動画)🛣️\nGOAT【〒980-0014 宮城県仙台市】\nhttps://example.com\nKスタジオ【花京院】\nAZUMA【二日町】';
    expect(detectRoomHint(boilerplate)).toBeNull();
    expect(detectRoomHint(null)).toBeNull();
  });
});

describe('resolveCalendarEvent — 1件を実績行にする', () => {
  it('通常のレッスン', () => {
    const r = resolveCalendarEvent(
      ev({ summary: '【KEIKO】多賀城 JAZZ', location: "スタジオT's", start: '18:30', end: '19:30' }),
      INSTRUCTORS, STUDIOS
    );
    expect(r).toMatchObject({
      cancelled: false, substitute: false, instructor_id: 4, studio_id: 3, duration_minutes: 60,
    });
    expect(r.issues).toEqual([]);
  });

  it('休講は cancelled=true・要確認にはしない', () => {
    const r = resolveCalendarEvent(
      ev({ summary: '【休講】TARO hiphop 中級', location: 'スタジオAZUMA' }), INSTRUCTORS, STUDIOS
    );
    expect(r.cancelled).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('代講は金額を推測しないので要確認に積む', () => {
    const r = resolveCalendarEvent(
      ev({ summary: '【Ryuki】キッズ HIPHOP 代講 KOKEKO', location: 'GOAT DANCE STUDIO' }), INSTRUCTORS, STUDIOS
    );
    expect(r).toMatchObject({ substitute: true, instructor_id: 12 });
    expect(r.issues).toContain('代講のため単価が自動で決まらない');
  });

  it('会場が空欄なら要確認 (黙って落とさない)', () => {
    const r = resolveCalendarEvent(
      ev({ summary: '【 KEIKO】長町ガールズ 初級', location: '' }), INSTRUCTORS, STUDIOS
    );
    expect(r.studio_id).toBeNull();
    expect(r.issues).toContain('会場が特定できない');
  });

  it('講師が読めなければ要確認', () => {
    const r = resolveCalendarEvent(
      ev({ summary: '長町 HIPHOP クラス', location: 'GOAT DANCE STUDIO' }), INSTRUCTORS, STUDIOS
    );
    expect(r.instructor_id).toBeNull();
    expect(r.issues).toContain('講師が特定できない');
  });

  it('練習会は給与対象外。講師が読めなくても要確認に積まない', () => {
    // TARO確認(2026-08-28): ダンスバトル練習会はTAROが見ているが給与は付かない。
    // これを要確認に積むと本物の要確認が埋もれる。会場は使うので studio は解決する。
    const r = resolveCalendarEvent(
      ev({ summary: '⚔️ダンスバトル練習会', location: 'GOAT DANCE STUDIO' }), INSTRUCTORS, STUDIOS
    );
    expect(r.payable).toBe(false);
    expect(r.issues).toEqual([]);
    expect(r.studio_id).toBe(1);
  });

  it('休講なら会場も講師も読めなくても要確認にしない (支払いが発生しないため)', () => {
    const r = resolveCalendarEvent(
      ev({ summary: '【休講】謎のクラス', location: '' }), INSTRUCTORS, STUDIOS
    );
    expect(r.cancelled).toBe(true);
    expect(r.issues).toEqual([]);
  });
});

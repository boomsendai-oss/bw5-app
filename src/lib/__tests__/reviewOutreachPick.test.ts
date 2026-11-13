import { describe, it, expect } from 'vitest';
import {
  isEligible,
  pickNextFamilies,
  greetingFor,
  buildReviewRequest,
  kataToHira,
  type OutreachCandidate,
} from '../reviewOutreachPick';

const TODAY = '2026-11-10';

function cand(over: Partial<OutreachCandidate> = {}): OutreachCandidate {
  return {
    familyKey: 1,
    familyName: '山田 花子',
    members: [{ name: '山田 花子', kana: 'ヤマダ ハナコ', birthday: '2016-04-01' }],
    lineLinks: [{ relation: '保護者', lineName: '花子ママ' }],
    enrolledAt: '2026-08-01 10:00:00',
    checkins: 5,
    lastCheckin: '2026-11-08',
    isInstructorFamily: false,
    askedAt: null,
    postedAt: null,
    hasMatchedReview: false,
    ...over,
  };
}

describe('kataToHira', () => {
  it('カタカナをひらがなにする', () => {
    expect(kataToHira('リュウノスケ')).toBe('りゅうのすけ');
  });
});

describe('isEligible', () => {
  it('条件をすべて満たせば対象', () => {
    expect(isEligible(cand(), TODAY)).toBe(true);
  });
  it('入会から30日未満は対象外', () => {
    expect(isEligible(cand({ enrolledAt: '2026-10-20 10:00:00' }), TODAY)).toBe(false);
  });
  it('入会からちょうど30日なら対象', () => {
    expect(isEligible(cand({ enrolledAt: '2026-10-11 10:00:00' }), TODAY)).toBe(true);
  });
  it('入会日が不明なら対象外(送らない側に倒す)', () => {
    expect(isEligible(cand({ enrolledAt: null }), TODAY)).toBe(false);
  });
  it('来館1回以下は対象外', () => {
    expect(isEligible(cand({ checkins: 1 }), TODAY)).toBe(false);
  });
  it('依頼済み・投稿済み・口コミ照合済みは対象外', () => {
    expect(isEligible(cand({ askedAt: '2026-07-31' }), TODAY)).toBe(false);
    expect(isEligible(cand({ postedAt: '2026-07-31' }), TODAY)).toBe(false);
    expect(isEligible(cand({ hasMatchedReview: true }), TODAY)).toBe(false);
  });
  it('講師の家族は対象外', () => {
    expect(isEligible(cand({ isInstructorFamily: true }), TODAY)).toBe(false);
  });
  it('TAROが恒久的に外した家族は対象外', () => {
    expect(isEligible(cand({ excludedAt: '2026-11-13' }), TODAY)).toBe(false);
  });
  it('LINEのつながりが無ければ対象外', () => {
    expect(isEligible(cand({ lineLinks: [] }), TODAY)).toBe(false);
  });
  it('呼び名が決められない家族は対象外', () => {
    // 子どもで、つながっているLINEが本人のものだけ
    expect(isEligible(cand({ lineLinks: [{ relation: '本人', lineName: 'はな' }] }), TODAY)).toBe(false);
  });
});

describe('greetingFor', () => {
  it('子どもの家族で保護者のLINEなら「(子の名前ひらがな)ママ」', () => {
    expect(greetingFor(cand(), TODAY)).toBe('はなこママ');
  });
  it('子どもが複数なら会員一覧の先頭の子の名前', () => {
    const c = cand({
      members: [
        { name: '須藤 星麗', kana: 'スドウ セラ', birthday: '2014-01-01' },
        { name: '須藤 咲花', kana: 'スドウ サナ', birthday: '2016-01-01' },
      ],
    });
    expect(greetingFor(c, TODAY)).toBe('せらママ');
  });
  it('大人の会員で本人のLINEなら「(姓)さん」', () => {
    const c = cand({
      familyName: '佐藤 美咲',
      members: [{ name: '佐藤 美咲', kana: 'サトウ ミサキ', birthday: '1990-05-05' }],
      lineLinks: [{ relation: '本人', lineName: 'misaki' }],
    });
    expect(greetingFor(c, TODAY)).toBe('佐藤さん');
  });
  it('子どもで本人のLINEしか無ければ決められない(null)', () => {
    expect(greetingFor(cand({ lineLinks: [{ relation: '本人', lineName: 'はな' }] }), TODAY)).toBeNull();
  });
  it('18歳の誕生日を迎えていれば大人', () => {
    const c = cand({
      members: [{ name: '高橋 葵', kana: 'タカハシ アオイ', birthday: '2008-11-10' }],
      lineLinks: [{ relation: '本人', lineName: 'aoi' }],
    });
    expect(greetingFor(c, TODAY)).toBe('高橋さん');
  });
});

describe('pickNextFamilies', () => {
  it('対象だけを最終来館の新しい順に最大n件', () => {
    const list = [
      cand({ familyKey: 1, lastCheckin: '2026-11-01' }),
      cand({ familyKey: 2, lastCheckin: '2026-11-09' }),
      cand({ familyKey: 3, checkins: 0, lastCheckin: null }),
      cand({ familyKey: 4, lastCheckin: '2026-11-05' }),
    ];
    expect(pickNextFamilies(list, TODAY, 2).map((c) => c.familyKey)).toEqual([2, 4]);
  });
  it('同じ日なら来館回数の多い順・それも同じなら家族番号の小さい順', () => {
    const list = [
      cand({ familyKey: 9, checkins: 3 }),
      cand({ familyKey: 5, checkins: 3 }),
      cand({ familyKey: 7, checkins: 10 }),
    ];
    expect(pickNextFamilies(list, TODAY).map((c) => c.familyKey)).toEqual([7, 5, 9]);
  });
});

describe('buildReviewRequest', () => {
  it('呼び名と現在の口コミ件数を差し込み、リンクと結びの一文を含む', () => {
    const t = buildReviewRequest('せらママ', 57);
    expect(t.startsWith('せらママお疲れ様です🙇\n\nちょっとお願いがあるのですが良いでしょうか？？💦')).toBe(true);
    expect(t).toContain('現在57件。目標は100件です！');
    expect(t).toContain('https://g.page/r/CYUIsn9ZQ3TBEAE/review');
    expect(t.endsWith('もうすでに書いてくださっていたら、本当にありがとうございます！その場合はスルーしてください🙏')).toBe(true);
  });
});

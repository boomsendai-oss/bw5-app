// BW6 発表会（段階1）のマイページの文（recitalMyPage.ts・純）の試験。文の正本は設計書 04 4-2 マイページ。
import { describe, it, expect } from 'vitest';
import { myTopLines, closedNotice, nextTodos, payAreaText, type MyTopInput } from '../recitalMyPage';

const m = (total: number, paid: number) => ({ total, paid, remaining: Math.max(0, total - paid), overpaid: Math.max(0, paid - total) });
const base: Omit<MyTopInput, 'view' | 'm'> = { hasIn: true, hasMaybe: false, payDue: '2027-02-10', todayYmd: '2026-12-20', changeClose: '2027-01-31 23:59', afterChangeClose: false, payMethod: null };
const DUE = 'お支払いは、2月10日（水）までです。今すぐでも、あとからでも大丈夫です。';
const MAYBE = '迷っている作品がある方は、決まってからお支払いください。お支払いのあとは、お返しできません。';

describe('いちばん上の文（04 4-2 マイページ）', () => {
  it('仮受付', () => {
    expect(myTopLines({ ...base, view: 'tentative', m: m(26500, 0) })).toEqual([DUE, 'いまは『仮受付』です。お支払いが済むと、『申込完了』になります。']);
    expect(myTopLines({ ...base, view: 'tentative', m: m(26500, 0), hasMaybe: true })[2]).toBe(MAYBE);
  });
  it('仮受付（迷っている作品だけ・0円）', () => {
    expect(myTopLines({ ...base, view: 'tentative', m: m(0, 0), hasIn: false, hasMaybe: true })).toEqual([
      'いまは『仮受付』です。', '迷っている作品を、1月31日（日）までに決めてください。', '出る作品が決まったら、ここからお支払いいただけます。',
    ]);
  });
  it('申込完了（追加分の待ち）＝場面B', () => {
    expect(myTopLines({ ...base, view: 'complete_extra', m: m(32500, 26500) })).toEqual([
      '追加分のお支払いは 6,000円です。2月10日（水）までにお支払いください。今のお申し込みは、そのままです。',
    ]);
  });
  it('申込完了。合計0円で「出る」がある時は「お支払いはありません」', () => {
    expect(myTopLines({ ...base, view: 'complete', m: m(26500, 26500) })).toEqual(['お申し込みが完了しました']);
    expect(myTopLines({ ...base, view: 'complete', m: m(0, 0) })).toEqual(['お申し込みが完了しました', 'お支払いはありません']);
  });
  it('払ったあとにへらした（へらす例 35,500→32,500）。2/1 からは文が変わる', () => {
    expect(myTopLines({ ...base, view: 'complete', m: m(32500, 35500) })).toEqual([
      'お申し込みが完了しました',
      'お支払いずみ 35,500円／今のお申し込み 32,500円。差の 3,000円は、1/31（日）までに作品を足すと、その分に当てられます。お返しはできません。',
    ]);
    expect(myTopLines({ ...base, view: 'complete', m: m(32500, 35500), afterChangeClose: true })[1]).toBe(
      'お支払いずみ 35,500円／今のお申し込み 32,500円。差の 3,000円は、スタッフが作品を足したときは、その分に当てます。お返しはできません。');
  });
  it('払ったあとに「出る」が無く迷っているだけ（K222）は「お支払いはありません」を出さず、お支払いずみの分の文', () => {
    const lines = myTopLines({ ...base, view: 'complete', m: m(0, 26500), hasIn: false, hasMaybe: true });
    expect(lines).not.toContain('お支払いはありません');
    expect(lines[1]).toContain('差の 26,500円は');
  });
  it('出演なし（払っていない／払っていた）', () => {
    expect(myTopLines({ ...base, view: 'none', m: m(0, 0), hasIn: false })).toEqual(['お支払いはありません。出たいお気持ちがあるときは、公式LINEでお知らせください。']);
    expect(myTopLines({ ...base, view: 'none', m: m(0, 26500), hasIn: false })[0]).toContain('お支払いずみ 26,500円／今のお申し込み 0円。');
  });
  it('期限を過ぎて残りがある（2/11 から）。振込の世帯は確認の日数の文を足す', () => {
    const late = { ...base, view: 'tentative' as const, m: m(26500, 0), todayYmd: '2027-02-11' };
    expect(myTopLines(late)[0]).toBe('お支払いの期限が過ぎました。お申し込みは、まだ完了していません。下の『払う』から、今もお支払いいただけます。');
    expect(myTopLines(late)).not.toContain(DUE);
    expect(myTopLines({ ...late, payMethod: 'bank' })[1]).toBe('お振込みずみのときは、ご入金の確認に、ふだん1〜2日、土日や祝日をはさむと数日かかることがあります。確認できましたら、メールでお知らせします。');
  });
  it('期限を過ぎても「払う」が出ていない時（確認中・準備中など）は、『払う』を指す文を出さない（Task 21）', () => {
    const late = { ...base, view: 'tentative' as const, m: m(26500, 0), todayYmd: '2027-02-11' };
    expect(myTopLines({ ...late, payShown: false })[0]).toBe('お支払いの期限が過ぎました。お申し込みは、まだ完了していません。');
    expect(myTopLines({ ...late, payShown: true })[0]).toBe('お支払いの期限が過ぎました。お申し込みは、まだ完了していません。下の『払う』から、今もお支払いいただけます。');
  });
});

describe('締切のあとの文（H19）', () => {
  it('残りがあれば期限を続ける', () => {
    expect(closedNotice({ afterChangeClose: true, remaining: 6000, payDue: '2027-02-10', changeClose: '2027-01-31 23:59' })).toEqual([
      'お申し込みと変更の受付は、1月31日（日）で終わりました。中身を変えたいときは、公式LINEでお知らせください。', 'お支払いは、2月10日（水）までです。',
    ]);
    expect(closedNotice({ afterChangeClose: false, remaining: 6000, payDue: '2027-02-10', changeClose: '2027-01-31 23:59' })).toEqual([]);
  });
});

describe('つぎにやること（K221：その時マイページでできる物だけ）', () => {
  it('払えて残りがある／迷っている作品があり、作品を変えられる時だけ', () => {
    expect(nextTodos({ payState: 'show', remaining: 26500, payDue: '2027-02-10', hasMaybe: true, canEditWorks: true, changeClose: '2027-01-31 23:59' }))
      .toEqual(['お支払い（2月10日（水）まで）', '迷っている作品を決める（1月31日（日）まで）']);
    expect(nextTodos({ payState: 'preparing', remaining: 26500, payDue: '2027-02-10', hasMaybe: true, canEditWorks: false, changeClose: '2027-01-31 23:59' })).toEqual([]);
  });
});

describe('払うの置き場の文（K224・K207）', () => {
  it('開く前／準備中／お預かり／出さない', () => {
    expect(payAreaText('before', '2026-12-22 12:00')).toBe('お支払いは 12月22日（火）から');
    expect(payAreaText('preparing', '2026-12-15 12:00')).toBe('お支払いは、準備中です');
    expect(payAreaText('refund_hold', '2026-12-15 12:00')).toBe('お預かりしている分があります。スクールからご連絡します');
    expect(payAreaText('hidden', '2026-12-15 12:00')).toBeNull();
    expect(payAreaText('show', '2026-12-15 12:00')).toBeNull();
  });
});

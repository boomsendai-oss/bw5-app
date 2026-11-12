// src/lib/__tests__/recitalEntryForm.test.ts
import { describe, it, expect } from 'vitest';
import { toKatakana, entryStepErrors, workCountNotice, draftToSubmission, doneScreen, type EntryDraft, type DraftPerson } from '../recitalEntryForm';

const person = (over: Partial<DraftPerson> = {}): DraftPerson => ({
  tempId: 'p1', sameAsContact: false, lastName: '山田', firstName: '花子', lastKana: 'ヤマダ', firstKana: 'ハナコ',
  birthday: '2015-05-01', instaHandle: '', tshirtSize: null, works: { 1: 'in' }, ...over,
});
const draft = (people: DraftPerson[] = [person()]): EntryDraft => ({
  contact: { lastName: '山田', firstName: '太郎', lastKana: 'ヤマダ', firstKana: 'タロウ', email: 'a@example.com', phone: '090-1234-5678' },
  people,
});
const ctx = { todayYmd: '2026-12-20', minSelfApplyAge: 18, maxWorks: 5 };

describe('カナ', () => {
  it('ひらがなはカタカナに直す', () => expect(toKatakana('やまだ はなこ')).toBe('ヤマダ ハナコ'));
});

describe('画面1 連絡する人', () => {
  it('そろっていれば空', () => expect(entryStepErrors(1, draft(), 0, ctx)).toEqual({}));
  it('メールの形・電話のけた・カタカナ以外は止める', () => {
    const d = draft(); d.contact.email = 'a@'; d.contact.phone = '0901'; d.contact.firstKana = 'たろう1';
    expect(Object.keys(entryStepErrors(1, d, 0, ctx)).sort()).toEqual(['email', 'firstKana', 'phone']);
  });
  it('iPhone の全角の電話・メールでも通る', () => {
    const d = draft(); d.contact.phone = '０９０－１２３４－５６７８'; d.contact.email = ' Ａ@Example.com ';
    expect(entryStepErrors(1, d, 0, ctx)).toEqual({});
  });
});

describe('画面2 出る人（18歳より下は「連絡する人と同じ」で進めない）', () => {
  const msg = '18歳より下の方が出るときは、前の画面に、保護者の方のことを書いてください';
  it('16歳で「連絡する人と同じ」は止める', () => {
    expect(entryStepErrors(2, draft([person({ sameAsContact: true, birthday: '2010-05-01' })]), 0, ctx).sameAsContact).toBe(msg);
  });
  it('申込の日にちょうど18歳なら進める', () => {
    expect(entryStepErrors(2, draft([person({ sameAsContact: true, birthday: '2008-12-20' })]), 0, ctx)).toEqual({});
  });
  it('生年月日が無いと止める。インスタは空でよい', () => {
    expect(Object.keys(entryStepErrors(2, draft([person({ birthday: '' })]), 0, ctx))).toEqual(['birthday']);
  });
});

describe('画面3 作品', () => {
  it('出る・迷っているが0なら止める', () => {
    expect(entryStepErrors(3, draft([person({ works: {} })]), 0, ctx).works).toBe('作品を1つ以上えらんでください（迷っているだけでも送れます）');
  });
  it('迷っているだけでも進める', () => {
    expect(entryStepErrors(3, draft([person({ works: { 1: 'maybe' } })]), 0, ctx)).toEqual({});
  });
  it('出る＋迷っているが6つは止める', () => {
    const works = { 1: 'in', 2: 'in', 3: 'in', 4: 'maybe', 5: 'maybe', 6: 'maybe' } as const;
    expect(entryStepErrors(3, draft([person({ works })]), 0, ctx).works).toBeTruthy();
  });
  it('「出る」が3つ以上で1行（止めない）', () => {
    expect(workCountNotice(person({ works: { 1: 'in', 2: 'in', 3: 'in' } }))).toBe('3作品以上に出るときは、担当イントラに相談してからにしてください');
    expect(workCountNotice(person({ works: { 1: 'in', 2: 'in', 3: 'maybe' } }))).toBeNull();
  });
});

describe('送る形への詰め替え', () => {
  it('「連絡する人と同じ」は名前を写し、空のインスタは null、Tシャツ欄が無ければ null', () => {
    const s = draftToSubmission(draft([person({ sameAsContact: true, birthday: '1990-01-01', tshirtSize: 'M', works: { 3: 'in', 4: 'maybe' } })]),
      { eventKey: 't-x', submitKey: 'k'.repeat(32), confirmNotFamily: false, confirmSamePerson: false, consentAccepted: true, tshirtOn: false });
    expect(s.people[0]).toMatchObject({ lastName: '山田', firstName: '太郎', lastKana: 'ヤマダ', firstKana: 'タロウ', isContact: true, category: 'student', instaHandle: null, tshirtSize: null });
    expect(s.people[0].works).toEqual([{ workId: 3, status: 'in' }, { workId: 4, status: 'maybe' }]);
    expect(s.contact.phone).toBe('090-1234-5678');
  });
});

describe('画面7（04 4-2 の世帯ごとのちがい）', () => {
  const base = { payOpenAt: '2026-12-15 12:00', payDue: '2027-02-10', hasMaybe: false };
  it('払うが開いている仮受付', () => {
    expect(doneScreen({ ...base, view: 'tentative', total: 26500, gate: 'open' })).toEqual({
      lines: ['お申し込みを受け付けました。いまは『仮受付』です。お支払いが済むと、『申込完了』になります。', 'お支払いは、2月10日（水）までです。今すぐでも、あとからでも大丈夫です。'],
      button: 'マイページでお支払いへ進む',
    });
  });
  it('迷っている作品もあれば1行足す', () => {
    expect(doneScreen({ ...base, view: 'tentative', total: 26500, gate: 'open', hasMaybe: true }).lines[2]).toBe('迷っている作品がある方は、決まってからお支払いください。お支払いのあとは、お返しできません。');
  });
  it('払うがまだ開いていない／時刻を過ぎて準備中', () => {
    expect(doneScreen({ ...base, view: 'tentative', total: 26500, gate: 'before' })).toEqual({
      lines: ['お申し込みを受け付けました。いまは『仮受付』です。お支払いが済むと、『申込完了』になります。', 'お支払いは、12月15日（火）から、マイページでできます。'],
      button: 'マイページを見る',
    });
    expect(doneScreen({ ...base, view: 'tentative', total: 26500, gate: 'preparing' }).lines[1]).toBe('お支払いは、準備ができしだい、マイページでできます。');
  });
  it('迷っている作品だけ（0円）', () => {
    expect(doneScreen({ ...base, view: 'tentative', total: 0, gate: 'open', hasMaybe: true })).toEqual({
      lines: ['いまは『仮受付』です。迷っている作品を、1月31日（日）までに決めてください。出る作品が決まったら、マイページからお支払いいただけます。'],
      button: 'マイページを見る',
    });
  });
  it('合計0円で「出る」がある', () => {
    expect(doneScreen({ ...base, view: 'complete', total: 0, gate: 'open' })).toEqual({ lines: ['お申し込みが完了しました。お支払いはありません。'], button: 'マイページを見る' });
  });
});

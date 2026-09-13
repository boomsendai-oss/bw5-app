import { describe, it, expect } from 'vitest';
import { isAlwaysFullDomain, isDropDomain, ruleClassify } from '../inboxAlert/rules';

describe('ruleClassify: 決め打ちの tier(A-1)', () => {
  it('Lステップの体験・見学の申し込みは必ず鳴らす(AIの判定がぶれると新規のお客さんを落とすため)', () => {
    expect(ruleClassify('service.linestep.net', '【BOOM】体験レッスン・見学が入りました')).toMatchObject({
      tier: 'now', kind: 'new_inquiry', source: 'fixed',
    });
    expect(ruleClassify('service.linestep.net', '見学が入りました')).toMatchObject({ tier: 'now', kind: 'new_inquiry' });
    expect(ruleClassify('service.linestep.net', '回答フォーム申し込みがありました')).toMatchObject({
      tier: 'now', kind: 'new_inquiry',
    });
  });

  it('キャンセル・取消・日程変更は、Lステップもhacomonoも鳴らす', () => {
    for (const subject of ['予約がキャンセルされました', '予約の取消がありました', '日程変更がありました']) {
      expect(ruleClassify('service.linestep.net', subject)).toMatchObject({ tier: 'now', kind: 'other' });
      expect(ruleClassify('em.hacomono.jp', subject)).toMatchObject({ tier: 'now', kind: 'other' });
    }
  });

  it('hacomonoの契約・プラン変更は鳴らし、口座振替・決済・請求は朝のまとめに回す', () => {
    expect(ruleClassify('em.hacomono.jp', 'プラン契約完了のお知らせ')).toMatchObject({ tier: 'now', kind: 'other' });
    expect(ruleClassify('em.hacomono.jp', 'プラン変更完了のお知らせ')).toMatchObject({ tier: 'now', kind: 'other' });
    expect(ruleClassify('em.hacomono.jp', '口座振替のお知らせ')).toMatchObject({ tier: 'digest', kind: 'money_later' });
    expect(ruleClassify('em.hacomono.jp', '決済処理のお知らせ')).toMatchObject({ tier: 'digest', kind: 'money_later' });
    expect(ruleClassify('em.hacomono.jp', '請求のお知らせ')).toMatchObject({ tier: 'digest', kind: 'money_later' });
  });

  it('「口座振替不能」は「口座振替」より先に当たり、朝のまとめに埋もれない', () => {
    expect(ruleClassify('hacomono.co.jp', '口座振替不能のお知らせ')).toMatchObject({ tier: 'now', kind: 'money_deadline' });
    // 同じ知らせが em.hacomono.jp から来ても、digest の決め打ちに負けない
    expect(ruleClassify('em.hacomono.jp', '口座振替不能のお知らせ')).toMatchObject({ tier: 'now', kind: 'money_deadline' });
  });

  it('ルールのドメインはサブドメインも見る。関係ないドメインには当たらない', () => {
    expect(ruleClassify('mail.service.linestep.net', '体験レッスンが入りました')).toMatchObject({ tier: 'now' });
    expect(ruleClassify('example.jp', '体験レッスン・見学が入りました')).toBeNull();
    expect(ruleClassify('notlinestep.net', '体験レッスン・見学が入りました')).toBeNull();
  });

  it('決め打ちのドメインでも、当てはまる件名でなければAIに任せる', () => {
    expect(ruleClassify('em.hacomono.jp', '月次レポートのお知らせ')).toBeNull();
    expect(ruleClassify('service.linestep.net', '配信が完了しました')).toBeNull();
  });
});

describe('ruleClassify: 例外キーワード(A-2)', () => {
  const trouble = ['振替不成立のお知らせ', '引き落とし不能', '出金停止のお知らせ', '振込が実施されませんでした', 'カードご利用不可のお知らせ'];
  it('「本当に何かが起きている」合図は、AIに読ませないドメインでも鳴らす', () => {
    for (const subject of trouble) {
      expect(ruleClassify('netbk.co.jp', subject)).toMatchObject({ tier: 'now', kind: 'money_deadline', source: 'exception' });
    }
  });

  it('「不可」だけでは鳴らさない(返信不可・学生不可で鳴っていた)', () => {
    expect(ruleClassify('netbk.co.jp', 'このメールは返信不可です')).toBeNull();
    expect(ruleClassify('netbk.co.jp', '学生不可のセミナーのご案内')).toBeNull();
  });

  it('未精算・利用停止は鳴らすが、「解除」が付く復旧の知らせでは鳴らさない', () => {
    expect(ruleClassify('paypay-bank.co.jp', '未精算のお知らせ')).toMatchObject({ tier: 'now', kind: 'money_deadline' });
    expect(ruleClassify('paypay-bank.co.jp', '利用停止のお知らせ')).toMatchObject({ tier: 'now', kind: 'money_deadline' });
    expect(ruleClassify('paypay-bank.co.jp', '利用停止解除のお知らせ')).toBeNull();
    expect(ruleClassify('paypay-bank.co.jp', '未精算解除のお知らせ')).toBeNull();
  });

  it('「エラー」は銀行・証券のドメインだけ(Search Consoleのエラー通知では鳴らさない)', () => {
    expect(ruleClassify('netbk.co.jp', '振込エラーのお知らせ')).toMatchObject({ tier: 'now', kind: 'money_deadline' });
    expect(ruleClassify('mail.rakuten-bank.co.jp', 'エラーが発生しました')).toMatchObject({ tier: 'now' });
    expect(ruleClassify('google.com', 'エラーが検出されました')).toBeNull();
    expect(ruleClassify('zozo.jp', 'エラーのお知らせ')).toBeNull();
  });
});

describe('isDropDomain: AIに読ませない一覧(A-3)', () => {
  const dropped = [
    'netbk.co.jp', 'bank.gmo-aozora.com', 'mail.gmo-aozora.com', 'cc.paypay-bank.co.jp', 'paypay-bank.co.jp',
    'mail.rakuten-bank.co.jp', '77bank.jp', 'rakuten-sec.co.jp', 'facebookmail.com', 'emagazine.rakuten.co.jp',
    'zozo.jp', 'superdelivery.com', 'uber.com', 'moneyforward.com', 'email.beatport.com', 'amazon.co.jp', 'hacomono.jp',
  ];
  it('一覧のドメインとそのサブドメインは読ませない', () => {
    for (const domain of dropped) {
      expect(isDropDomain(domain)).toBe(true);
      expect(isDropDomain(`mail.${domain}`)).toBe(true);
    }
    expect(isDropDomain('em.hacomono.jp')).toBe(true);
  });
  it('似ているだけのドメインは読ませる(部分一致にしない)', () => {
    expect(isDropDomain('templatebank.com')).toBe(false);
    expect(isDropDomain('notamazon.co.jp')).toBe(false);
    expect(isDropDomain('amazon.co.jp.evil.com')).toBe(false);
    expect(isDropDomain('myuber.com')).toBe(false);
    expect(isDropDomain('gmail.com')).toBe(false);
  });
});

describe('isAlwaysFullDomain: 必ず全文を読む(A-4)', () => {
  it('本物の仕事が混ざるドメインは、宣伝の印があっても全文を読む', () => {
    for (const domain of ['libecity.com', 'form.run', 'siip.city.sendai.jp', 'hacomono.co.jp']) {
      expect(isAlwaysFullDomain(domain)).toBe(true);
    }
    expect(isAlwaysFullDomain('mail.libecity.com')).toBe(true);
    expect(isAlwaysFullDomain('gmail.com')).toBe(false);
    expect(isAlwaysFullDomain('hacomono.jp')).toBe(false);
  });
});

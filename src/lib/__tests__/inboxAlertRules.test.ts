import { describe, it, expect } from 'vitest';
import { isAlwaysFullSender, isDropSender, ruleClassify } from '../inboxAlert/rules';

describe('ruleClassify: 鳴らす決め打ち(now)', () => {
  it('R1 乗っ取りの兆候は、どの差出人から来ても鳴らす', () => {
    const subjects = [
      'Security alert for your linked Google Account',
      'A passkey added to your account',
      'A new trusted device added',
      'A new access token has been added to your account',
      '新しい環境からログインがありました',
    ];
    for (const subject of subjects) {
      expect(ruleClassify('no-reply@accounts.google.com', subject)).toMatchObject({ tier: 'now', kind: 'other' });
      expect(ruleClassify('someone@example.jp', subject)).toMatchObject({ tier: 'now', kind: 'other' });
    }
  });

  it('R4 Lステップの体験・見学の申し込みは必ず鳴らす', () => {
    expect(ruleClassify('noreply@service.linestep.net', '【BOOM】体験レッスン・見学が入りました')).toMatchObject({
      tier: 'now', kind: 'new_inquiry',
    });
    expect(ruleClassify('noreply@service.linestep.net', '回答フォーム申し込みがありました')).toMatchObject({ tier: 'now' });
    expect(ruleClassify('noreply@service.linestep.net', '予約がキャンセルされました')).toMatchObject({ tier: 'now', kind: 'other' });
  });

  it('R3 hacomonoの契約・プラン変更は鳴らし、口座振替・決済・請求は朝のまとめ', () => {
    expect(ruleClassify('no-reply@em.hacomono.jp', 'プラン契約完了のお知らせ')).toMatchObject({ tier: 'now', kind: 'other' });
    expect(ruleClassify('no-reply@em.hacomono.jp', 'プラン変更完了のお知らせ')).toMatchObject({ tier: 'now' });
    expect(ruleClassify('no-reply@em.hacomono.jp', '口座振替のお知らせ')).toMatchObject({ tier: 'digest', kind: 'money_later' });
    expect(ruleClassify('no-reply@hacomono.co.jp', '口座振替不能のお知らせ')).toMatchObject({ tier: 'now', kind: 'money_deadline' });
  });
});

describe('ruleClassify: 朝のまとめに回す決め打ち(digest)', () => {
  it('R2 ログイン・確認コードはアドレス・件名・GitHubの確認コードで拾う', () => {
    for (const address of [
      'no-reply@accounts.google.com',
      'families-noreply@google.com',
      'hello@1password.com',
      'security@facebookmail.com',
    ]) {
      expect(ruleClassify(address, 'お知らせ')).toMatchObject({ tier: 'digest', kind: 'other' });
    }
    expect(ruleClassify('noreply@example.jp', '新しいデバイスでログインがありました')).toMatchObject({ tier: 'digest' });
    expect(ruleClassify('noreply@github.com', '[GitHub] Please verify your device — verification code')).toMatchObject({
      tier: 'digest',
    });
    expect(ruleClassify('noreply@github.com', 'Your weekly digest')).toBeNull();
  });

  it('R5 Amazonの出品者とのやりとりは、amazon.co.jp を読ませない一覧に入れたままでも拾う', () => {
    expect(isDropSender('order-update@amazon.co.jp', 'ご注文の発送')).toBe(true);
    expect(ruleClassify('marketplace-messages@amazon.co.jp', '出品者からのメッセージ')).toMatchObject({
      tier: 'digest', kind: 'reply',
    });
    // 件名の条件は無い(どの件名でも拾う)
    expect(ruleClassify('marketplace-messages@amazon.co.jp', '')).toMatchObject({ tier: 'digest', kind: 'reply' });
  });

  it('R6 請求書・課金は朝のまとめ。領収書や宣伝の文言が混ざるものは拾わない', () => {
    for (const subject of ['Invoice #123 from Cloudflare', '請求書の送付', '課金のお知らせ', '適格請求書の発行']) {
      expect(ruleClassify('billing@example.com', subject)).toMatchObject({ tier: 'digest', kind: 'money_later' });
    }
    for (const subject of [
      '領収書の発行について',
      'Your receipt from Apple',
      '請求書の支払いを先延ばしにできます',
      '請求書の支払いは延ばせる',
      '請求書の新機能のご案内',
      '請求書キャンペーンのお知らせ',
      '請求書サービスのご紹介',
      '請求書機能リリース予告',
      '請求書がもっとお得に',
    ]) {
      expect(ruleClassify('billing@example.com', subject)).toBeNull();
    }
  });

  it('R7 障害情報は朝のまとめ(自動化の失敗として出す)', () => {
    for (const subject of ['障害発生のご報告', '障害情報のお知らせ', '障害のお知らせ']) {
      expect(ruleClassify('info@example.jp', subject)).toMatchObject({ tier: 'digest', kind: 'automation_failure' });
    }
    expect(ruleClassify('info@example.jp', '障害について')).toBeNull();
  });

  it('R8 受付・審査完了は朝のまとめ。Re: の付いた本物の返信は落とさない', () => {
    for (const subject of ['審査完了のお知らせ', 'お問合せありがとうございます', 'お問い合わせありがとうございます', '追加情報をご提供いただきありがとうございます']) {
      expect(ruleClassify('support@example.com', subject)).toMatchObject({ tier: 'digest', kind: 'reply' });
    }
    expect(ruleClassify('support@example.com', 'Re: お問い合わせありがとうございます')).toBeNull();
    expect(ruleClassify('support@example.com', 're: 審査完了のお知らせ')).toBeNull();
  });

  it('R9 行政手続きは朝のまとめ。手続き開始・期限・締切だけ鳴らす', () => {
    for (const address of ['noreply@gbiz-id.go.jp', 'info@water.city.sendai.jp', 'noreply@suido.f-regi.com']) {
      expect(ruleClassify(address, 'お知らせ')).toMatchObject({ tier: 'digest', kind: 'other' });
      expect(ruleClassify(address, '手続き開始のお知らせ')).toMatchObject({ tier: 'now' });
      expect(ruleClassify(address, 'お支払い期限のお知らせ')).toMatchObject({ tier: 'now' });
      expect(ruleClassify(address, '申請締切のお知らせ')).toMatchObject({ tier: 'now' });
    }
  });

  it('R10 Search Consoleは件名を絞る(アクセスレポートまで拾わない)', () => {
    for (const address of ['sc-noreply@google.com', 'googlebase-noreply@google.com']) {
      expect(ruleClassify(address, 'インデックス登録の問題が検出されました')).toMatchObject({ tier: 'digest' });
      expect(ruleClassify(address, 'エラーが検出されました')).toMatchObject({ tier: 'digest' });
      expect(ruleClassify(address, 'Product quality report')).toMatchObject({ tier: 'digest' });
      expect(ruleClassify(address, '検索パフォーマンスの月次レポート')).toBeNull();
    }
  });
});

describe('ruleClassify: 例外キーワード(A-2)', () => {
  it('「本当に何かが起きている」合図は、読ませない一覧のドメインでも鳴らす', () => {
    for (const subject of ['振替不成立のお知らせ', '引き落とし不能', '出金停止のお知らせ', '振込が実施されませんでした', 'カードご利用不可のお知らせ']) {
      expect(ruleClassify('info@netbk.co.jp', subject)).toMatchObject({ tier: 'now', kind: 'money_deadline', source: 'exception' });
    }
  });

  it('Action required / Action needed は鳴らす(支払い失敗が朝のまとめに落ちないように)', () => {
    expect(ruleClassify('billing@cloudflare.com', 'Action required: payment failed for your account')).toMatchObject({
      tier: 'now', kind: 'money_deadline', source: 'exception',
    });
    expect(ruleClassify('billing@cloudflare.com', 'ACTION NEEDED: update your payment method')).toMatchObject({ tier: 'now' });
    // 請求書の決め打ち(digest)より例外が優先される
    expect(ruleClassify('billing@cloudflare.com', 'Action required: invoice unpaid')).toMatchObject({ tier: 'now' });
  });

  it('failed だけでは鳴らさない(GitHub ActionsやVercelの失敗通知は朝のまとめのまま)', () => {
    expect(ruleClassify('notifications@github.com', 'Run failed: Deploy to production')).toBeNull();
    expect(ruleClassify('notifications@vercel.com', 'Deployment failed for bw5-app')).toBeNull();
  });

  it('【重要】だけでは鳴らさない(宣伝にも付くため)', () => {
    expect(ruleClassify('news@example.com', '【重要】キャンペーンのお知らせ')).toBeNull();
  });

  it('「不可」だけ・「解除」付きでは鳴らさない', () => {
    expect(ruleClassify('info@netbk.co.jp', 'このメールは返信不可です')).toBeNull();
    expect(ruleClassify('info@netbk.co.jp', '学生不可のセミナーのご案内')).toBeNull();
    expect(ruleClassify('info@paypay-bank.co.jp', '利用停止解除のお知らせ')).toBeNull();
    expect(ruleClassify('info@paypay-bank.co.jp', '未精算のお知らせ')).toMatchObject({ tier: 'now' });
  });

  it('「エラー」は銀行・証券だけ(Search Consoleのエラーでは鳴らさない)', () => {
    expect(ruleClassify('info@netbk.co.jp', '振込エラーのお知らせ')).toMatchObject({ tier: 'now', source: 'exception' });
    expect(ruleClassify('someone@example.jp', 'エラーが発生しました')).toBeNull();
  });
});

describe('isDropSender: AIに読ませない(C)', () => {
  it('アドレスを指定して止める(同じドメインの他のアドレスは読む)', () => {
    expect(isDropSender('mail@form.run', 'お知らせ')).toBe(true);
    expect(isDropSender('notify@form.run', 'フォームに回答がありました')).toBe(false);

    expect(isDropSender('e-kigyoudayori@siip.city.sendai.jp', '企業だより')).toBe(true);
    expect(isDropSender('tantou@siip.city.sendai.jp', 'ご相談の件')).toBe(false);

    expect(isDropSender('info@sendaicci.or.jp', '会報のご案内')).toBe(true);
    expect(isDropSender('yamada@sendaicci.or.jp', 'ご相談の件')).toBe(false);

    expect(isDropSender('marketing@hacomono.co.jp', 'セミナーのご案内')).toBe(true);
    expect(isDropSender('partnersales@hacomono.co.jp', 'ご提案')).toBe(true);
    expect(isDropSender('info@hacomono.jp', 'お知らせ')).toBe(true);
    // 同じ hacomono.co.jp でも、請求とサポートのアドレスは読み続ける
    expect(isDropSender('accounting@hacomono.co.jp', 'ご請求のご案内')).toBe(false);
    expect(isDropSender('info@hacomono.co.jp', 'お問い合わせの件')).toBe(false);
    expect(isDropSender('yamada@hacomono.co.jp', 'サポートの返信')).toBe(false);
  });

  it('件名で止めるのは共有カレンダーだけ。gmail.com 全体は絶対に止めない', () => {
    expect(isDropSender('someone@gmail.com', '共有カレンダーの更新')).toBe(true);
    expect(isDropSender('someone@gmail.com', '体験レッスンの相談')).toBe(false);
  });

  it('銀行・通販などのドメインはこれまでどおり止める。似たドメインは止めない', () => {
    for (const address of [
      'info@netbk.co.jp', 'info@bank.gmo-aozora.com', 'info@mail.gmo-aozora.com', 'info@cc.paypay-bank.co.jp',
      'info@paypay-bank.co.jp', 'info@mail.rakuten-bank.co.jp', 'info@77bank.jp', 'info@rakuten-sec.co.jp',
      'info@facebookmail.com', 'info@emagazine.rakuten.co.jp', 'info@zozo.jp', 'info@superdelivery.com',
      'info@uber.com', 'info@moneyforward.com', 'info@email.beatport.com', 'info@amazon.co.jp', 'info@hacomono.jp',
    ]) {
      expect(isDropSender(address, 'お知らせ')).toBe(true);
    }
    expect(isDropSender('info@templatebank.com', 'お知らせ')).toBe(false);
    expect(isDropSender('info@notamazon.co.jp', 'お知らせ')).toBe(false);
  });
});

describe('isAlwaysFullSender: 必ず全文を読む(A-4)', () => {
  it('本物の仕事が混ざるドメインは全文を読む', () => {
    for (const address of ['no-reply@libecity.com', 'notify@form.run', 'info@hacomono.co.jp']) {
      expect(isAlwaysFullSender(address)).toBe(true);
    }
  });
  it('仙台市の企業だよりは1アドレスだけなので、ドメインごと読む扱いはやめた', () => {
    expect(isAlwaysFullSender('info@siip.city.sendai.jp')).toBe(false);
  });
  it('関係ないドメインは対象外', () => {
    expect(isAlwaysFullSender('someone@gmail.com')).toBe(false);
  });
});

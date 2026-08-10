import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  verifyStripeSignature,
  buildBf6LineItems,
  buildCheckoutFormParams,
} from '../bf6Stripe';
import { buildBf6OrderEmail } from '../bf6Email';
import type { OwnBf6Order } from '../bf6Db';

const SECRET = 'whsec_test_secret';

function sign(payload: string, t: number, secret: string = SECRET): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

describe('verifyStripeSignature: Webhook署名検証', () => {
  const payload = '{"id":"evt_1","type":"checkout.session.completed"}';
  const now = 1_750_000_000_000;

  test('正しい署名はtrue', () => {
    const header = sign(payload, Math.floor(now / 1000));
    expect(verifyStripeSignature(payload, header, SECRET, 300, now)).toBe(true);
  });

  test('別のシークレットで作った署名はfalse', () => {
    const header = sign(payload, Math.floor(now / 1000), 'whsec_wrong');
    expect(verifyStripeSignature(payload, header, SECRET, 300, now)).toBe(false);
  });

  test('payloadが改ざんされていたらfalse', () => {
    const header = sign(payload, Math.floor(now / 1000));
    expect(verifyStripeSignature(payload + 'x', header, SECRET, 300, now)).toBe(false);
  });

  test('タイムスタンプが古すぎる(リプレイ)とfalse', () => {
    const header = sign(payload, Math.floor(now / 1000) - 600);
    expect(verifyStripeSignature(payload, header, SECRET, 300, now)).toBe(false);
  });

  test('ヘッダ欠落・形式不正はfalse', () => {
    expect(verifyStripeSignature(payload, null, SECRET, 300, now)).toBe(false);
    expect(verifyStripeSignature(payload, 'garbage', SECRET, 300, now)).toBe(false);
    expect(verifyStripeSignature(payload, 't=123', SECRET, 300, now)).toBe(false);
  });

  test('複数v1のうち1つが一致すればtrue(キーローテーション対応)', () => {
    const t = Math.floor(now / 1000);
    const good = createHmac('sha256', SECRET).update(`${t}.${payload}`).digest('hex');
    const header = `t=${t},v1=${'0'.repeat(64)},v1=${good}`;
    expect(verifyStripeSignature(payload, header, SECRET, 300, now)).toBe(true);
  });
});

function sampleOrder(): OwnBf6Order {
  return {
    orderId: 12,
    buyerName: '山田花子',
    email: 'hanako@example.com',
    phone: '09012345678',
    payMethod: 'prepaid',
    paymentStatus: 'pending',
    amountTotal: 5500,
    expiresAt: '',
    createdAt: '2026-08-08T01:00:00.000Z',
    items: [
      {
        itemId: 1,
        itemType: 'entry', performerName: 'ヤマダタロウ', dancerName: 'TARO', dancerKana: 'タロー',
        grade: 'es4', genre: 'HIPHOP', rep: 'BOOM', instagram: '@taro', isFirstBattle: true,
        divisions: ['beginner'], qty: 1, unitAmount: 2000,
      },
      {
        itemId: 2,
        itemType: 'ticket_adult', performerName: '', dancerName: '', dancerKana: '',
        grade: '', genre: '', rep: '', instagram: '', isFirstBattle: false,
        divisions: [], qty: 1, unitAmount: 2000,
      },
      {
        itemId: 3,
        itemType: 'ticket_child', performerName: '', dancerName: '', dancerKana: '',
        grade: '', genre: '', rep: '', instagram: '', isFirstBattle: false,
        divisions: [], qty: 1, unitAmount: 1000,
      },
    ],
  };
}

describe('buildBf6LineItems: 注文明細→Stripe line_items', () => {
  test('エントリーはダンサーネーム+部門数、観覧は種別で名前を作る', () => {
    const items = buildBf6LineItems(sampleOrder());
    expect(items).toEqual([
      { name: 'バトルエントリー TARO(1部門)', unitAmount: 2000, qty: 1 },
      { name: '観覧チケット(大人)', unitAmount: 2000, qty: 1 },
      { name: '観覧チケット(小学生)', unitAmount: 1000, qty: 1 },
    ]);
  });
});

describe('buildBf6LineItems: 配信チケットの明細名', () => {
  test('stream itemは「オンライン配信視聴チケット」になる(小学生扱いにしない)', () => {
    const base = sampleOrder();
    const order = {
      ...base,
      items: [
        {
          itemId: 4,
          itemType: 'stream', performerName: '', dancerName: '', dancerKana: '',
          grade: '', genre: '', rep: '', instagram: '', isFirstBattle: false,
          divisions: [], qty: 2, unitAmount: 1500,
        },
      ],
    };
    expect(buildBf6LineItems(order)).toEqual([
      { name: 'オンライン配信視聴チケット', unitAmount: 1500, qty: 2 },
    ]);
  });
});

describe('buildBf6OrderEmail: 配信チケット購入', () => {
  test('配信のみの注文は件名が配信チケットで、視聴キー別送の案内が入る', async () => {
    const { buildBf6OrderEmail } = await import('../bf6Email');
    const base = sampleOrder();
    const order = {
      ...base,
      paymentStatus: 'paid',
      amountTotal: 1500,
      items: [
        {
          itemId: 5,
          itemType: 'stream', performerName: '', dancerName: '', dancerKana: '',
          grade: '', genre: '', rep: '', instagram: '', isFirstBattle: false,
          divisions: [], qty: 1, unitAmount: 1500,
        },
      ],
    };
    const mail = buildBf6OrderEmail(order, 'tok123');
    expect(mail.subject).toContain('配信');
    expect(mail.text).toContain('視聴キー');
  });
});

describe('buildCheckoutFormParams: Checkout Session作成パラメータ', () => {
  test('金額・URL・冪等な注文参照が入る', () => {
    const params = buildCheckoutFormParams({
      lineItems: buildBf6LineItems(sampleOrder()),
      successUrl: 'https://bw5-app.vercel.app/bf6/complete?t=tok123',
      cancelUrl: 'https://bw5-app.vercel.app/bf6/complete?t=tok123',
      customerEmail: 'hanako@example.com',
      orderId: 12,
      expiresAtEpochSec: 1_750_001_800,
    });
    expect(params.get('mode')).toBe('payment');
    expect(params.get('client_reference_id')).toBe('12');
    expect(params.get('metadata[order_id]')).toBe('12');
    expect(params.get('customer_email')).toBe('hanako@example.com');
    expect(params.get('success_url')).toContain('/bf6/complete?t=tok123');
    expect(params.get('expires_at')).toBe('1750001800');
    expect(params.get('line_items[0][price_data][currency]')).toBe('jpy');
    expect(params.get('line_items[0][price_data][product_data][name]')).toBe('バトルエントリー TARO(1部門)');
    expect(params.get('line_items[0][price_data][unit_amount]')).toBe('2000');
    expect(params.get('line_items[0][quantity]')).toBe('1');
    expect(params.get('line_items[2][price_data][unit_amount]')).toBe('1000');
  });
});

describe('buildBf6OrderEmail: 完了メール文面', () => {
  test('カード決済完了: 受付番号・内容・金額・確認URLが入る', () => {
    const order = { ...sampleOrder(), paymentStatus: 'paid' };
    const mail = buildBf6OrderEmail(order, 'tok123');
    expect(mail.subject).toContain('BF6-012');
    expect(mail.subject).toContain('エントリー確定');
    expect(mail.text).toContain('TARO');
    expect(mail.text).toContain('ビギナー部門');
    expect(mail.text).toContain('観覧チケット(大人) × 1');
    expect(mail.text).toContain('¥5,500');
    expect(mail.text).toContain('お支払い済み');
    expect(mail.text).toContain('/bf6/complete?t=tok123');
  });

  test('当日現金: 当日支払いの案内が入る', () => {
    const order = { ...sampleOrder(), paymentStatus: 'cash_due', payMethod: 'onsite' as const };
    const mail = buildBf6OrderEmail(order, 'tok123');
    expect(mail.subject).toContain('BF6-012');
    expect(mail.text).toContain('当日会場受付にて');
    expect(mail.text).toContain('¥5,500');
  });

  test('観覧のみ(エントリーなし)は件名が観覧チケットになる', () => {
    const base = sampleOrder();
    const order = {
      ...base,
      paymentStatus: 'paid',
      items: base.items.filter((i) => i.itemType !== 'entry'),
      amountTotal: 3000,
    };
    const mail = buildBf6OrderEmail(order, 'tok123');
    expect(mail.subject).toContain('観覧チケット');
  });
});

describe('無料エントリー(SSM学生枠)の完了メール', () => {
  test('¥0で確定済みの注文は「お支払い不要」の文面になる', () => {
    const order = {
      orderId: 42,
      buyerName: '専門太郎',
      email: 'ssm@example.com',
      phone: '09012345678',
      payMethod: 'onsite' as const,
      paymentStatus: 'paid',
      amountTotal: 0,
      stripeSessionId: '',
      editToken: 'tok',
      expiresAt: '',
      createdAt: '2026-08-11T00:00:00.000Z',
      items: [
        {
          itemId: 99,
          itemType: 'entry',
          performerName: 'センモンタロウ',
          dancerName: 'TARO-SSM',
          dancerKana: 'タロウ',
          grade: 'adult',
          genre: 'HIPHOP',
          rep: 'SSM',
          instagram: '',
          isFirstBattle: false,
          divisions: ['general' as const],
          qty: 1,
          unitAmount: 0,
        },
      ],
    };
    const mail = buildBf6OrderEmail(order, 'tok');
    expect(mail.subject).toContain('エントリー確定');
    expect(mail.text).toContain('お支払いは不要');
    expect(mail.text).not.toContain('カード決済でお支払い済み');
    expect(mail.text).not.toContain('当日会場受付にて現金');
  });
});

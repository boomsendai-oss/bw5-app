// BW6 発表会（段階1）のメールの文面（純）と sendEmailNoBcc の試験。Task 10。
// 見本の値は設計書 04 4-2・07 7-8・決まりの紙 2-24 のまま（整理番号 4827 は検査に合わない見本の番号）。
import { describe, it, expect, vi } from 'vitest';
import { buildRecitalMail, type RecitalMailData } from '../recitalEmail';

const D: RecitalMailData = {
  contactName: 'ヤマダ ハナコ',
  refCode: '4827',
  myUrl: 'https://event.boom-sendai.com/bw6/my?t=' + 'a'.repeat(48),
  eventLine: 'BW6（2027年4月11日（日）・若林区文化センター）',
  people: [{ name: 'ヤマダ タロウ', inWorks: ['作品A（W01）', '作品B（W02）'], maybeWorks: [] }],
  chargeLines: [
    { label: '本体', amount: 16000 },
    { label: 'Tシャツ', amount: 3000 },
    { label: '協力チケット3枚', amount: 7500 },
    { label: '2作品目', amount: 6000 },
  ],
  m: { total: 32500, paid: 0, remaining: 32500, overpaid: 0 },
  hasMaybe: false,
  zeroComplete: false,
  payDue: '2月10日（水）',
  payDueLong: '2027年2月10日（水）',
  payNotice: 'open',
  payOpenLabel: '12月15日（火）',
  changeCloseLabel: '1月31日（日）23:59',
  mypageItems: 'お支払い、インスタ',
  nextContact: '2月ごろ',
  guide: { amount: 32500, bankText: 'TEST-BANK-TEXT', nameLine: '4827 ヤマダ ハナコ', restLine: null },
};
const CH: NonNullable<RecitalMailData['change']> = {
  lines: ['ヤマダ タロウ「作品B（W02）」を足しました'], totalBefore: 26500, totalAfter: 32500, kind: 'unpaid', afterFeb1: false, refundAmount: 0,
};

describe('buildRecitalMail', () => {
  it('件名9つが決まりの紙 6-3 と 04 4-2 のまま', () => {
    const s = (k: Parameters<typeof buildRecitalMail>[0], over: Partial<RecitalMailData> = {}) => buildRecitalMail(k, { ...D, ...over }).subject;
    expect(s('receipt')).toBe('【BOOM】BW6 お申し込みを受け付けました（仮受付）（整理番号 4827）');
    expect(s('resend_url')).toBe('【BOOM】BW6 マイページのご案内');
    expect(s('change', { change: CH })).toBe('【BOOM】BW6 お申し込みの中身が変わりました（整理番号 4827）');
    expect(s('bank_guide')).toBe('【BOOM】BW6 お振込みのご案内（整理番号 4827）');
    expect(s('complete', { via: 'card' })).toBe('【BOOM】BW6 お申し込みが完了しました（整理番号 4827）');
    expect(s('complete', { via: 'bank' })).toBe('【BOOM】BW6 ご入金を確認しました（お申し込み完了・整理番号 4827）');
    expect(s('extra_complete', { via: 'card' })).toBe('【BOOM】BW6 追加分のお支払いを受け付けました（整理番号 4827）');
    expect(s('extra_complete', { via: 'bank' })).toBe('【BOOM】BW6 ご入金を確認しました（追加分・整理番号 4827）');
    expect(s('remaining', { via: 'bank', m: { total: 32500, paid: 26500, remaining: 6000, overpaid: 0 } })).toBe('【BOOM】BW6 ご入金を確認しました（あと 6,000円です）');
  });

  it('合計0円で「出る」がある控えは、申込完了の件名で「お支払いはありません」・「■ お支払い」を出さない', () => {
    const z = buildRecitalMail('complete', { ...D, zeroComplete: true, chargeLines: [], m: { total: 0, paid: 0, remaining: 0, overpaid: 0 } });
    expect(z.subject).toBe('【BOOM】BW6 お申し込みが完了しました（整理番号 4827）'); // via が無い0円の完了はカード・現金と同じ件名
    expect(z.text).toContain('お支払いはありません');
    expect(z.text).not.toContain('■ お支払い');
  });

  it('振込先を書くのは bank_guide だけ（控え・変更の控え・完了には出ない）', () => {
    for (const k of ['receipt', 'change', 'complete', 'extra_complete', 'remaining', 'resend_url'] as const)
      expect(buildRecitalMail(k, { ...D, change: CH, via: 'bank' }).text).not.toContain('TEST-BANK-TEXT');
    const g = buildRecitalMail('bank_guide', D).text;
    expect(g).toContain('TEST-BANK-TEXT');
    expect(g).toContain('4827 ヤマダ ハナコ');
    expect(g).toContain('お振込み金額　32,500円（ちょうどの金額でお願いします）');
    expect(g).toContain('作品を足したときは、新しい金額のメールをお送りします。前のメールの金額は、古くなります。');
    expect(g).not.toContain('［コピーする］');
  });

  it('控えの金額と内わけは請求の行から（直書きしない）', () => {
    const t = buildRecitalMail('receipt', D).text;
    expect(t).toContain('■ 金額　32,500円');
    expect(t).toContain('2作品目');
    expect(t).toContain('6,000円');
  });

  it('払うがまだ開いていない控え：pay_open_at より前は「お支払いは、12月15日（火）から、マイページでできます。」、過ぎて pay_ok_at が空は「お支払いは、準備ができしだい、マイページでできます。」', () => {
    expect(buildRecitalMail('receipt', { ...D, payNotice: 'before', payOpenLabel: '12月15日（火）' }).text).toContain('お支払いは、12月15日（火）から、マイページでできます。');
    expect(buildRecitalMail('receipt', { ...D, payNotice: 'preparing' }).text).toContain('お支払いは、準備ができしだい、マイページでできます。');
    const open = buildRecitalMail('receipt', D).text;
    expect(open).not.toContain('準備ができしだい');
    expect(open).not.toContain('12月15日（火）から');
  });

  it('迷っている作品だけの控えは「0円（迷っている作品は、金額に入っていません）」', () => {
    const t = buildRecitalMail('receipt', {
      ...D, hasMaybe: true, chargeLines: [], m: { total: 0, paid: 0, remaining: 0, overpaid: 0 },
      people: [{ name: 'ヤマダ タロウ', inWorks: [], maybeWorks: ['作品C（W03）'] }],
    }).text;
    expect(t).toContain('■ 金額　0円（迷っている作品は、金額に入っていません）');
    expect(t).toContain('作品C（W03）');
  });

  it('年末年始の1行は restLine があるときだけ', () => {
    const g = (restLine: string | null) => buildRecitalMail('bank_guide', { ...D, guide: { ...D.guide!, restLine } }).text;
    expect(g('年末年始（12月30日〜1月3日）の確認は、1月4日からです。')).toContain('年末年始（12月30日〜1月3日）の確認は、1月4日からです。');
    expect(g(null)).not.toContain('年末年始');
  });

  it('どのメールも終わりに「このメールに心当たりがないときは、そのままにしてください。」', () => {
    const P = { amount: 32500, dateLabel: '12月21日' };
    for (const k of ['receipt', 'change', 'complete', 'extra_complete', 'remaining', 'resend_url', 'bank_guide'] as const)
      expect(
        buildRecitalMail(k, { ...D, change: CH, via: 'bank', paid: P, paidTotal: 32500 }).text.trimEnd().endsWith('このメールに心当たりがないときは、そのままにしてください。'),
      ).toBe(true);
  });

  it('振込の完了は1行目「12月21日のお振込み 32,500円を確認しました。」、払い方「銀行振込」', () => {
    const t = buildRecitalMail('complete', {
      ...D, via: 'bank', paid: { amount: 32500, dateLabel: '12月21日' }, paidTotal: 32500, m: { total: 32500, paid: 32500, remaining: 0, overpaid: 0 },
    }).text;
    const body = t.split('\n').filter((l) => l.trim() && !l.endsWith('様') && !l.startsWith('こんにちは'));
    expect(body[0]).toBe('12月21日のお振込み 32,500円を確認しました。');
    expect(t).toContain('銀行振込');
    expect(t).not.toContain('カード');
  });

  it('宛名は「（名前）様」（空白を入れない）', () => {
    for (const k of ['receipt', 'change', 'complete', 'extra_complete', 'remaining', 'bank_guide'] as const)
      expect(buildRecitalMail(k, { ...D, change: CH }).text.startsWith('ヤマダ ハナコ様\n')).toBe(true);
  });

  it('申込完了のマイページの行に「お支払い」を出さない（まだ出ている物だけ・K221）', () => {
    const paidM = { total: 32500, paid: 32500, remaining: 0, overpaid: 0 };
    const c = buildRecitalMail('complete', { ...D, via: 'card', m: paidM, paid: { amount: 32500, dateLabel: '12月21日' }, paidTotal: 32500 }).text;
    expect(c).toContain('■ マイページ（インスタはこちら）');
    expect(c).not.toContain('■ マイページ（お支払い');
    const z = buildRecitalMail('complete', { ...D, zeroComplete: true, chargeLines: [], m: { total: 0, paid: 0, remaining: 0, overpaid: 0 } }).text;
    expect(z).toContain('■ マイページ（インスタはこちら）');
    expect(z).not.toContain('■ マイページ（お支払い');
    // 受付の控えは「お支払い」をそのまま出す
    expect(buildRecitalMail('receipt', D).text).toContain('■ マイページ（お支払い、インスタはこちら）');
  });

  it('世帯をまとめた時の変更の控えは「1つにまとめて」とまとめ先の整理番号を出す', () => {
    const t = buildRecitalMail('change', { ...D, change: { ...CH, merged: { intoRefCode: '5724' } } }).text;
    expect(t).toContain('5724');
    expect(t).toContain('1つにまとめて');
  });
});

describe('sendEmailNoBcc', () => {
  it('sendEmailNoBcc は鍵が無いと投げる', async () => {
    delete process.env.GMAIL_APP_PASSWORD;
    vi.resetModules();
    const { sendEmailNoBcc } = await import('../email');
    await expect(sendEmailNoBcc({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow('mail_not_configured');
  });
});

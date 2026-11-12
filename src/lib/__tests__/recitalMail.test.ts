// BW6 発表会（段階1）の recitalMail.ts（送る・記録・待ち・ご案内の出し直し）の試験（実 DB・試験用のファイル DB）。Task 10。
// 自分の event_key（t-mail*）の行だけを見る。送る口（@/lib/email）は mock して、本物のメールは1通も出さない。
// 試しの発表会（is_test=1）なので、宛先は設定 test_mail_to（test@example.com）にすりかわる。
import { describe, it, expect, vi } from 'vitest';
import { setupRecitalTestDb, seedRecitalTestEvent, seedHousehold } from './recitalTestSeed';
import { RECITAL_MAIL_DAILY_WARN } from '../recitalEmail';

type SendArg = { to: string; subject: string; text?: string };
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 呼び出しの引数を mock.calls に残すため受ける
const sendEmailNoBcc = vi.fn(async (_o: SendArg) => {});
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 同上
const sendEmail = vi.fn(async (_o: SendArg) => {});
let configured = true;
vi.mock('@/lib/email', () => ({
  isMailConfigured: () => configured,
  sendEmailNoBcc: (o: SendArg) => sendEmailNoBcc(o),
  sendEmail: (o: SendArg) => sendEmail(o),
}));
vi.mock('@/lib/email.ts', () => ({
  isMailConfigured: () => configured,
  sendEmailNoBcc: (o: SendArg) => sendEmailNoBcc(o),
  sendEmail: (o: SendArg) => sendEmail(o),
}));

await setupRecitalTestDb('mail');
await seedRecitalTestEvent('t-mail');
const core = await import('../db');
const money = await import('../recitalMoneyDb');
const mail = await import('../recitalMail');

const at = (jst: string) => new Date(jst.replace(' ', 'T') + ':00+09:00');
const lastCall = () => sendEmailNoBcc.mock.calls.at(-1)![0];
/** sendPaidMail の返り値の種類（出さないときは 'none'） */
const kindOf = (r: { status: string } | { kind: string }) => ('kind' in r ? r.kind : 'none');

async function eventOf(hid: number): Promise<string> {
  return String((await core.getOne('SELECT event_key FROM recital_households WHERE id = ?', [hid])).event_key);
}

async function ref(hid: number): Promise<string> {
  return String((await core.getOne('SELECT ref_code FROM recital_households WHERE id = ?', [hid])).ref_code);
}

/** カードの入金を1行入れて paymentId を返す */
async function cardPay(hid: number, amount: number): Promise<number> {
  const r = await core.withWriteTx((tx) =>
    money.insertPaymentTx(tx, { householdId: hid, method: 'card', amount, paidOn: '2026-12-20', source: 'stripe_webhook', stripeEventId: `evt_${hid}_${Date.now()}_${Math.random()}` }, 'system'),
  );
  return r.paymentId;
}

let bankRowSeq = 0;
/** 台帳の行（matched）を1つ作って、その行で振込の入金を1行入れる。paymentId を返す */
async function bankPay(hid: number, amount: number): Promise<number> {
  const eventKey = await eventOf(hid);
  bankRowSeq++;
  const row = await core.execute(
    `INSERT INTO recital_bank_rows (event_key, created_at, row_date, dir, amount, kind, row_key, source, state)
     VALUES (?, ?, '2026-12-21', 'in', ?, 'transfer', ?, 'chat', 'matched')`,
    [eventKey, new Date().toISOString(), amount, 'm|' + bankRowSeq],
  );
  const r = await core.withWriteTx((tx) =>
    money.insertPaymentTx(
      tx,
      { householdId: hid, method: 'bank', amount, paidOn: '2026-12-21', source: 'bank_staff', bankRowId: Number(row.lastInsertRowid), bankDate: '2026-12-21' },
      'TARO',
    ),
  );
  return r.paymentId;
}

/** 生きている請求の行を void にして額 n の base を1行足す */
async function setTotal(hid: number, n: number): Promise<void> {
  const eventKey = await eventOf(hid);
  const now = new Date().toISOString();
  await core.execute("UPDATE recital_charges SET status='void', void_reason='試し', voided_at=? WHERE household_id=? AND status='active'", [now, hid]);
  await core.execute(
    `INSERT INTO recital_charges (event_key, household_id, person_id, item_code, ref, label, qty, unit_amount, amount, status, created_at)
     VALUES (?, ?, NULL, 'base', '', '出演料（本体）', 1, ?, ?, 'active', ?)`,
    [eventKey, hid, n, n, now],
  );
}

it('鍵が無ければ送らず failed を記録', async () => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  configured = false;
  sendEmailNoBcc.mockClear();
  const r = await mail.sendRecitalMail({ kind: 'resend_url', householdId: hid }, at('2026-12-20 10:00'));
  configured = true;
  expect(r.status).toBe('failed');
  expect(sendEmailNoBcc).not.toHaveBeenCalled();
});

it('is_test=1 は test_mail_to へ。空なら送らず failed', async () => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  await mail.sendRecitalMail({ kind: 'receipt', householdId: hid }, at('2026-12-20 10:00'));
  expect(lastCall().to).toBe('test@example.com');
  await core.execute("UPDATE recital_settings SET value='' WHERE event_key='t-mail' AND key='test_mail_to'");
  const calls = sendEmailNoBcc.mock.calls.length;
  expect((await mail.sendRecitalMail({ kind: 'resend_url', householdId: hid }, at('2026-12-20 10:01'))).status).toBe('failed');
  expect(sendEmailNoBcc.mock.calls.length).toBe(calls);
  await core.execute("UPDATE recital_settings SET value='test@example.com' WHERE event_key='t-mail' AND key='test_mail_to'");
});

it('mail_bcc_staff=1 のときだけ写しつきの sendEmail', async () => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  const setBcc = (v: string) => core.execute("UPDATE recital_settings SET value=? WHERE event_key='t-mail' AND key='mail_bcc_staff'", [v]);
  sendEmail.mockClear();
  sendEmailNoBcc.mockClear();
  await setBcc('1');
  await mail.sendRecitalMail({ kind: 'resend_url', householdId: hid }, at('2026-12-20 10:00'));
  expect([sendEmail.mock.calls.length, sendEmailNoBcc.mock.calls.length]).toEqual([1, 0]);
  await setBcc('0');
  await mail.sendRecitalMail({ kind: 'resend_url', householdId: hid }, at('2026-12-20 10:01'));
  expect([sendEmail.mock.calls.length, sendEmailNoBcc.mock.calls.length]).toEqual([1, 1]);
});

it('dedupe で2回目を送らない', async () => {
  const hid = await seedHousehold('t-mail', { total: 0, cast: 'in' });
  const a = await mail.sendRecitalMail({ kind: 'complete', householdId: hid, dedupeKey: `complete:${hid}` }, at('2026-12-20 10:00'));
  const b = await mail.sendRecitalMail({ kind: 'complete', householdId: hid, dedupeKey: `complete:${hid}` }, at('2026-12-20 10:05'));
  expect([a.status, b.status]).toEqual(['sent', 'duplicate']);
  expect(sendEmailNoBcc.mock.calls.filter((c) => c[0].subject.includes('完了'))).toHaveLength(1);
});

it.each([
  ['2026-12-20 21:00', 'sent'],
  ['2026-12-20 21:01', 'waiting'],
  ['2026-12-21 07:59', 'waiting'],
  ['2026-12-21 08:00', 'sent'],
])('夜の待ち：%s は %s', async (t, want) => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  expect((await mail.sendRecitalMail({ kind: 'receipt', householdId: hid, deferAtNight: true }, at(t))).status).toBe(want);
});

it('flushWaitingMails は 8:00〜21:00 だけ待ちを出し、取りやめは出さない', async () => {
  await seedRecitalTestEvent('t-mail-flush'); // ほかの試験の待ちが混ざらないように別の発表会
  const h1 = await seedHousehold('t-mail-flush', { total: 26500, cast: 'in' });
  const h2 = await seedHousehold('t-mail-flush', { total: 26500, cast: 'in' });
  const p1 = await bankPay(h1, 26500);
  const p2 = await bankPay(h2, 26500);
  expect((await mail.sendPaidMail(h1, p1, 'bank', { now: at('2026-12-20 22:00') })).status).toBe('waiting');
  expect((await mail.sendPaidMail(h2, p2, 'bank', { now: at('2026-12-20 22:00') })).status).toBe('waiting');
  await core.withWriteTx((tx) => mail.cancelWaitingMailsTx(tx, p2));
  expect((await mail.flushWaitingMails('t-mail-flush', at('2026-12-21 07:30'))).sent).toBe(0);
  expect((await mail.flushWaitingMails('t-mail-flush', at('2026-12-21 08:00'))).sent).toBe(1);
  expect((await core.getOne('SELECT status s FROM recital_mail_log WHERE dedupe_key=?', [`bank_paid:${p2}`])).s).toBe('cancelled');
  expect((await core.getOne('SELECT status s FROM recital_mail_log WHERE dedupe_key=?', [`bank_paid:${p1}`])).s).toBe('sent');
  // 待ちから出したメールも、振込の形（件名・1行目）で作り直している
  expect(lastCall().subject).toBe(`【BOOM】BW6 ご入金を確認しました（お申し込み完了・整理番号 ${await ref(h1)}）`);
  expect(lastCall().text).toContain('12月21日のお振込み 26,500円を確認しました。');
});

it('flushWaitingMails を同時に2回呼んでも、待ちの1通は1回だけ送る', async () => {
  await seedRecitalTestEvent('t-mail-race');
  const ids: number[] = [];
  for (let i = 0; i < 3; i++) {
    const hid = await seedHousehold('t-mail-race', { total: 26500, cast: 'in' });
    ids.push((await mail.sendRecitalMail({ kind: 'receipt', householdId: hid, deferAtNight: true }, at('2026-12-20 22:00'))).logId!);
  }
  sendEmailNoBcc.mockClear();
  const [a, b] = await Promise.all([
    mail.flushWaitingMails('t-mail-race', at('2026-12-21 08:00')),
    mail.flushWaitingMails('t-mail-race', at('2026-12-21 08:00')),
  ]);
  expect(sendEmailNoBcc).toHaveBeenCalledTimes(3);
  expect(a.sent + b.sent).toBe(3);
  expect(a.failed + b.failed).toBe(0);
  for (const id of ids) expect((await core.getOne('SELECT status s FROM recital_mail_log WHERE id = ?', [id])).s).toBe('sent');
});

it('すぐ送っている途中の行は、その間に動いた flushWaitingMails が送り直さない', async () => {
  await seedRecitalTestEvent('t-mail-race2');
  const hid = await seedHousehold('t-mail-race2', { total: 26500, cast: 'in' });
  sendEmailNoBcc.mockClear();
  let during: { sent: number; failed: number } | null = null;
  sendEmailNoBcc.mockImplementationOnce(async () => {
    during = await mail.flushWaitingMails('t-mail-race2', at('2026-12-20 10:00')); // SMTP を待っている間に待ちを出す
  });
  const r = await mail.sendRecitalMail({ kind: 'receipt', householdId: hid }, at('2026-12-20 10:00'));
  expect(r.status).toBe('sent');
  expect(during).toEqual({ sent: 0, failed: 0 });
  expect(sendEmailNoBcc).toHaveBeenCalledTimes(1);
  expect((await core.getOne('SELECT status s FROM recital_mail_log WHERE id = ?', [r.logId])).s).toBe('sent');
});

describe('sendPaidMail', () => {
  it('カードで残り0 → complete（カードの件名）', async () => {
    const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
    const pid = await cardPay(hid, 26500);
    expect(kindOf(await mail.sendPaidMail(hid, pid, 'card', { now: at('2026-12-20 10:00') }))).toBe('complete');
    expect(lastCall().subject).toBe(`【BOOM】BW6 お申し込みが完了しました（整理番号 ${await ref(hid)}）`);
  });

  it('足したあとまた0 → extra_complete', async () => {
    const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
    await mail.sendPaidMail(hid, await cardPay(hid, 26500), 'card', { now: at('2026-12-20 10:00') });
    await setTotal(hid, 32500);
    expect(kindOf(await mail.sendPaidMail(hid, await cardPay(hid, 6000), 'card', { now: at('2026-12-22 10:00') }))).toBe('extra_complete');
  });

  it('振込で 21:30 に当たる → waiting・鍵は bank_paid:<入金id>', async () => {
    const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
    const pid = await bankPay(hid, 26500);
    expect((await mail.sendPaidMail(hid, pid, 'bank', { now: at('2026-12-20 21:30') })).status).toBe('waiting');
    expect((await core.getOne('SELECT dedupe_key k FROM recital_mail_log WHERE household_id=? ORDER BY id DESC', [hid])).k).toBe(`bank_paid:${pid}`);
  });

  it('全額が返す分（もう払い済みだった）→ 出さない', async () => {
    const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
    await cardPay(hid, 26500);
    const pid = await bankPay(hid, 26500); // 返す分1番 26,500 ができる
    expect(await mail.sendPaidMail(hid, pid, 'bank', { now: at('2026-12-20 10:00') })).toEqual({ status: 'none' });
  });

  it('一部の入金で sendRemaining → remaining（あと 6,000円）、なし → 出さない', async () => {
    const hid = await seedHousehold('t-mail', { total: 32500, cast: 'in' });
    const p1 = await bankPay(hid, 26500);
    expect((await mail.sendPaidMail(hid, p1, 'bank', { now: at('2026-12-20 10:00') })).status).toBe('none');
    const hid2 = await seedHousehold('t-mail', { total: 32500, cast: 'in' });
    const p2 = await bankPay(hid2, 26500);
    expect(kindOf(await mail.sendPaidMail(hid2, p2, 'bank', { sendRemaining: true, now: at('2026-12-20 10:00') }))).toBe('remaining');
    expect(lastCall().subject).toBe('【BOOM】BW6 ご入金を確認しました（あと 6,000円です）');
  });

  it('出演なしの世帯（view none）に 26,500 を当てても、どのメールも出さない（場面10・44）', async () => {
    const hid = await seedHousehold('t-mail', { total: 0, cast: 'out' });
    const pid = await bankPay(hid, 26500);
    expect(await mail.sendPaidMail(hid, pid, 'bank', { now: at('2026-12-20 10:00') })).toEqual({ status: 'none' });
    expect(Number((await core.getOne('SELECT COUNT(*) n FROM recital_mail_log WHERE household_id=?', [hid])).n)).toBe(0);
  });
});

it('マイページの URL は家庭向けのドメイン', async () => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  await mail.sendRecitalMail({ kind: 'receipt', householdId: hid }, at('2026-12-20 10:00'));
  expect(lastCall().text).toMatch(/https:\/\/event\.boom-sendai\.com\/bw6\/my\?t=[0-9a-f]{48}&from=mail/);
  expect(lastCall().text).not.toContain('vercel.app');
});

it('countRecitalMailsToday：今日（JST）の sent＋failed を数え、しきい値以上で warn', async () => {
  const t = at('2026-12-20 12:00');
  const c0 = (await mail.countRecitalMailsToday(t)).count;
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  configured = false; // 送らずに failed を記録させる
  for (let i = c0; i < RECITAL_MAIL_DAILY_WARN; i++) await mail.sendRecitalMail({ kind: 'resend_url', householdId: hid }, t);
  configured = true;
  await mail.sendRecitalMail({ kind: 'receipt', householdId: hid, deferAtNight: true }, at('2026-12-20 22:00')); // waiting は数えない
  const c = await mail.countRecitalMailsToday(at('2026-12-20 23:00'));
  expect(c.count).toBe(RECITAL_MAIL_DAILY_WARN);
  expect(c.count).toBeGreaterThanOrEqual(RECITAL_MAIL_DAILY_WARN);
  expect(c.warn).toBe(true);
  expect((await mail.countRecitalMailsToday(at('2026-12-21 08:00'))).warn).toBe(false);
}, 120_000); // 数百回まわすので既定の5秒では足りない

it('flushWaitingMails は1回に20通まで', async () => {
  await seedRecitalTestEvent('t-mail-cap');
  for (let i = 0; i < 25; i++) {
    const hid = await seedHousehold('t-mail-cap', { total: 26500, cast: 'in' });
    await mail.sendRecitalMail({ kind: 'receipt', householdId: hid, deferAtNight: true }, at('2026-12-20 22:00'));
  }
  expect((await mail.flushWaitingMails('t-mail-cap', at('2026-12-21 08:00'))).sent).toBe(20);
  expect((await mail.flushWaitingMails('t-mail-cap', at('2026-12-21 08:05'))).sent).toBe(5);
}, 60_000);

it('ご案内は同じ金額を続けて出さず、元の金額に戻れば出す（26,500→26,500→32,500→26,500 で3通）', async () => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in', payMethod: 'bank' });
  await mail.maybeResendBankGuide(hid);
  await mail.maybeResendBankGuide(hid);
  await setTotal(hid, 32500);
  await mail.maybeResendBankGuide(hid);
  await setTotal(hid, 26500);
  await mail.maybeResendBankGuide(hid);
  const keys = (await core.getAll("SELECT dedupe_key FROM recital_mail_log WHERE household_id=? AND mail_kind='bank_guide' ORDER BY id", [hid])).map((r) => r.dedupe_key);
  expect(keys).toEqual([`bank_guide:${hid}:26500:1`, `bank_guide:${hid}:32500:2`, `bank_guide:${hid}:26500:3`]);
});

it('ご案内：振込でない世帯・残り0・bank_text が空・返す分≧残り のときは出さない', async () => {
  const n = async (hid: number) => Number((await core.getOne("SELECT COUNT(*) n FROM recital_mail_log WHERE household_id=? AND mail_kind='bank_guide'", [hid])).n);
  const card = await seedHousehold('t-mail', { total: 26500, cast: 'in', payMethod: 'card' });
  await mail.maybeResendBankGuide(card);
  expect(await n(card)).toBe(0);
  const done = await seedHousehold('t-mail', { total: 26500, cast: 'in', payMethod: 'bank' });
  await cardPay(done, 26500);
  await mail.maybeResendBankGuide(done);
  expect(await n(done)).toBe(0);
  const big = await seedHousehold('t-mail', { total: 32500, cast: 'in', payMethod: 'bank' });
  await cardPay(big, 32500); // 全額。下の返す分 6,000 で 払った額 26,500・残り 6,000＝返す分 6,000（返す分 ≧ 残り になるのは入金 ≧ 合計 の時だけ。5-7・K220）
  await core.execute(
    "INSERT INTO recital_refunds (event_key, household_id, amount, reason_no, reason, status, created_at, created_by) VALUES ('t-mail', ?, 6000, 4, 'テスト', 'todo', ?, 'TARO')",
    [big, new Date().toISOString()],
  );
  await mail.maybeResendBankGuide(big);
  expect(await n(big)).toBe(0);
  const nob = await seedHousehold('t-mail', { total: 26500, cast: 'in', payMethod: 'bank' });
  await core.execute("UPDATE recital_settings SET value='' WHERE event_key='t-mail' AND key='bank_text'");
  await mail.maybeResendBankGuide(nob);
  expect(await n(nob)).toBe(0);
  await core.execute("UPDATE recital_settings SET value='TEST-BANK-TEXT' WHERE event_key='t-mail' AND key='bank_text'");
});

it('error に宛先を書かない', async () => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  sendEmailNoBcc.mockRejectedValueOnce(Object.assign(new Error('x@example.com rejected'), { code: 'EENVELOPE' }));
  const r = await mail.sendRecitalMail({ kind: 'resend_url', householdId: hid }, at('2026-12-20 10:00'));
  expect(r.status).toBe('failed');
  const e = String((await core.getOne('SELECT error FROM recital_mail_log WHERE id=?', [r.logId])).error);
  expect(e).not.toContain('@');
  expect(e).toContain('EENVELOPE');
});

it('変更の控え：前の控えより後の変えた記録から「変わった所」と前後の金額を作る（Task 8 の applyHouseholdEdits から出る）', async () => {
  const entry = await import('../recitalEntryDb');
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  await mail.sendRecitalMail({ kind: 'receipt', householdId: hid }); // 前の控え（今の時刻）
  const pid = Number((await core.getOne('SELECT id FROM recital_people WHERE household_id = ?', [hid])).id);
  const w02 = Number((await core.getOne("SELECT id FROM recital_works WHERE event_key = 't-mail' AND work_code = 'W02'")).id);
  sendEmailNoBcc.mockClear();
  const r = await entry.applyHouseholdEdits(hid, [{ type: 'cast_set', personId: pid, workId: w02, status: 'in' }], { actor: 'family', by: 'family' });
  expect(r.ok).toBe(true);
  expect(sendEmailNoBcc).toHaveBeenCalledTimes(1);
  const c = lastCall();
  expect(c.subject).toBe(`【BOOM】BW6 お申し込みの中身が変わりました（整理番号 ${await ref(hid)}）`);
  expect(c.text).toContain('テスト ハナ『作品B（W02）』を足しました');
  expect(c.text).toContain('■ 金額　26,500円 → 32,500円');
  expect(c.text).toContain('お支払いは、2月10日（水）までです。今すぐでも、あとからでも大丈夫です。');
  expect(c.text).not.toContain('TEST-BANK-TEXT');
});

it('countRecitalMailsToday：夜に待ちになって次の朝に出したメールは、出した日に数える', async () => {
  await seedRecitalTestEvent('t-mail-day');
  const hid = await seedHousehold('t-mail-day', { total: 26500, cast: 'in' });
  await mail.sendRecitalMail({ kind: 'receipt', householdId: hid, deferAtNight: true }, at('2027-03-01 22:00'));
  const before20 = (await mail.countRecitalMailsToday(at('2027-03-01 23:00'))).count;
  const before21 = (await mail.countRecitalMailsToday(at('2027-03-02 12:00'))).count;
  expect((await mail.flushWaitingMails('t-mail-day', at('2027-03-02 08:00'))).sent).toBe(1);
  expect((await mail.countRecitalMailsToday(at('2027-03-01 23:00'))).count).toBe(before20);
  expect((await mail.countRecitalMailsToday(at('2027-03-02 12:00'))).count).toBe(before21 + 1);
});

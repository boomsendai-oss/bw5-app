// BW6 発表会（段階1）の家庭の画面が読む物（recitalFamilyDb.ts）と、申込フォームの公開 Server Actions の試験（実 DB・試験用のファイル DB）。
// 自分の event_key（t-entrypub*）の行だけを見る。メールは本物の sendRecitalMail を通す（試しの発表会で test_mail_to が空なので、記録は failed になり送らない）。
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { setupRecitalTestDb } from './recitalTestSeed';

// Server Action の IP の読み（next/headers）は、試験ではリクエストが無いので差し替える
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }) }));

process.env.RECITAL_PREVIEW_SECRET = 'test-secret-entrypub';

const EV = 't-entrypub';
const NOW = new Date('2026-12-20T12:00:00+09:00');

let core: typeof import('../db');
let fam: typeof import('../recitalFamilyDb');
let entry: typeof import('../recitalEntryDb');
let seed: typeof import('./recitalFamilySeed');
let w: Record<string, number>;

beforeAll(async () => {
  await setupRecitalTestDb('entrypub');
  core = await import('../db');
  fam = await import('../recitalFamilyDb');
  entry = await import('../recitalEntryDb');
  seed = await import('./recitalFamilySeed');
  ({ w } = await seed.seedFamilyEvent(core, EV));
});

describe('listPublicWorks', () => {
  it('フォームで受ける open と draft だけ。staff は出さない。担当イントラの名前が付く', async () => {
    const list = await fam.listPublicWorks(EV);
    expect(list.map((x) => x.workCode)).toEqual(['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07']);
    expect(list.find((x) => x.workCode === 'W07')!.status).toBe('draft');
    expect(list[0].instructors).toEqual(['イントラA']);
  });
});

describe('quoteEntry（画面3・5 の金額）は「送る」と同じ額', () => {
  it('1人3作品＝35,500', async () => {
    const q = await fam.quoteEntry(EV, [{ lastName: '山田', firstName: '花子', lastKana: 'ヤマダ', firstKana: 'ハナコ', birthday: '2015-05-01', works: [{ workId: w.W01, status: 'in' }, { workId: w.W02, status: 'in' }, { workId: w.W03, status: 'in' }] }]);
    expect(q.total).toBe(35500);
    const r = await entry.submitEntry(seed.entryFor(EV, 'a'.repeat(32), [  // 合い鍵は16進32けた（指示書の 'q' は16進でないので a に）
      { firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: [{ workId: w.W01, status: 'in' }, { workId: w.W02, status: 'in' }, { workId: w.W03, status: 'in' }] }]), NOW);
    expect(r.ok && r.total).toBe(35500);
  });
  it('兄2作品・妹1作品＝37,500（1人目は自動で妹）', async () => {
    const q = await fam.quoteEntry(EV, [
      { lastName: '山田', firstName: '一郎', lastKana: 'ヤマダ', firstKana: 'イチロウ', birthday: '2012-04-10', works: [{ workId: w.W01, status: 'in' }, { workId: w.W02, status: 'in' }] },
      { lastName: '山田', firstName: 'さくら', lastKana: 'ヤマダ', firstKana: 'サクラ', birthday: '2016-06-01', works: [{ workId: w.W03, status: 'in' }] },
    ]);
    expect(q.total).toBe(37500);
  });
  it('迷っている作品は合計に入らず、totalIfAllIn に入る', async () => {
    const q = await fam.quoteEntry(EV, [{ lastName: '山田', firstName: '花子', lastKana: 'ヤマダ', firstKana: 'ハナコ', birthday: '2015-05-01', works: [{ workId: w.W01, status: 'in' }, { workId: w.W02, status: 'maybe' }] }]);
    expect(q.total).toBe(26500);
    expect(q.totalIfAllIn).toBe(32500);
  });
  it('事前登録の会員とカナ＋生年月日が合う人は、その料金（free なら0円）。「送る」と同じ額', async () => {
    const m = await core.execute(`INSERT INTO boom_members (hacomono_member_id, full_name, full_name_kana, birthday, status) VALUES ('t-free-1', '試し 一郎', 'タメシ イチロウ', '2014-03-03', 'active')`);
    await core.execute(`INSERT INTO recital_fee_presets (event_key, member_id, fee_class, created_by, created_at) VALUES (?, ?, 'free', 'テスト', ?)`, [EV, Number(m.lastInsertRowid), new Date().toISOString()]);
    const people = [{ lastName: '試し', firstName: '一郎', lastKana: 'タメシ', firstKana: 'イチロウ', birthday: '2014-03-03', works: [{ workId: w.W04, status: 'in' as const }] }];
    const q = await fam.quoteEntry(EV, people);
    expect(q.total).toBe(0);
    const r = await entry.submitEntry({ ...seed.entryFor(EV, 'f'.repeat(32), []), contact: { lastName: '試し', firstName: '一郎', lastKana: 'タメシ', firstKana: 'イチロウ', email: 'free@example.com', phone: '09000000001' },
      people: [{ tempId: 'p1', lastName: '試し', firstName: '一郎', lastKana: 'タメシ', firstKana: 'イチロウ', birthday: '2014-03-03', isContact: false, category: 'student', tshirtSize: null, instaHandle: null, works: [{ workId: w.W04, status: 'in' }] }] }, NOW);
    expect(r.ok && r.total).toBe(0);
  });
});

describe('resendMyPageUrl（申込があるかは返り値でしか分からない。画面には出さない）', () => {
  it('知らないメールは0件で、メールの記録も作らない', async () => {
    const before = await core.getAll(`SELECT id FROM recital_mail_log WHERE mail_kind='resend_url'`);
    expect(await fam.resendMyPageUrl(EV, { email: 'none@example.com' })).toEqual({ sent: 0 });
    const after = await core.getAll(`SELECT id FROM recital_mail_log WHERE mail_kind='resend_url'`);
    expect(after.length).toBe(before.length);
  });
  it('大文字・前後の空白をそろえて、生きている世帯へ1通（resend_url）', async () => {
    const before = await core.getAll(`SELECT id FROM recital_mail_log WHERE mail_kind='resend_url'`);
    expect(await fam.resendMyPageUrl(EV, { email: '  A@Example.com ' })).toEqual({ sent: 1 });
    const after = await core.getAll(`SELECT id FROM recital_mail_log WHERE mail_kind='resend_url'`);
    expect(after.length - before.length).toBe(1);
  });
  it('電話は数字だけにしてくらべる', async () => {
    expect((await fam.resendMyPageUrl(EV, { phone: '090-1234-5678' })).sent).toBe(1);
  });
});

// ---------- 公開 Server Actions（actions.ts） ----------

describe('申込フォームの Server Actions は、画面から来た eventKey を信じない', () => {
  const quotePeople = [{ lastName: '山田', firstName: '花子', lastKana: 'ヤマダ', firstKana: 'ハナコ', birthday: '2015-05-01', works: [{ workId: 0, status: 'in' as const }] }];

  it('偽の ev（鍵の合わない試し・試しでない発表会・無い発表会・別の発表会の鍵）は、送る・確かめる・金額のどれも断る', async () => {
    const actions = await import('@/app/bw6/entry/actions');
    const { recitalPreviewKey } = await import('../recitalPreview');
    const now = new Date().toISOString();
    // 試しでない（is_test=0）発表会。鍵が合っても通さない
    await core.execute(`INSERT INTO recital_events (event_key, title, show_date, is_test, created_at) VALUES ('t-entrypub-real', '試しでない', '2027-04-11', 0, ?)`, [now]);
    const forged: [string, string | null][] = [
      [EV, null],
      [EV, '0'.repeat(32)],
      [EV, recitalPreviewKey('bw6')],
      ['t-entrypub-real', recitalPreviewKey('t-entrypub-real')],
      ['t-entrypub-none', recitalPreviewKey('t-entrypub-none')],
    ];
    const countBefore = await core.getAll('SELECT id FROM recital_households');
    for (const [ev, pv] of forged) {
      const sub = seed.entryFor(ev, 'b'.repeat(32), [{ firstName: '偽子', firstKana: 'ニセコ', birthday: '2015-06-01', works: [{ workId: w.W01, status: 'in' }] }], { email: 'forged@example.com', phone: '09000000099' });
      expect(await actions.submitEntryAction(sub, pv)).toEqual({ ok: false, code: 'invalid', message: 'このページからは送れません。' });
      expect(await actions.precheckEntryAction(ev, pv, { email: 'a@example.com', phone: '', people: [] })).toMatchObject({ ok: false, code: 'invalid' });
      expect(await actions.quoteEntryAction(ev, pv, quotePeople)).toMatchObject({ ok: false, code: 'invalid' });
    }
    const countAfter = await core.getAll('SELECT id FROM recital_households');
    expect(countAfter.length).toBe(countBefore.length);
  });

  it('鍵の合う試しの発表会なら通る（確かめは中身を返さず、同じメールかどうかだけ）', async () => {
    const actions = await import('@/app/bw6/entry/actions');
    const { recitalPreviewKey } = await import('../recitalPreview');
    const pv = recitalPreviewKey(EV);
    const r = await actions.precheckEntryAction(EV, pv, { email: 'none-yet@example.com', phone: '', people: [] });
    expect(r).toEqual({ ok: true, sameEmail: false, samePhone: false, samePersonIdx: [] });
    const q = await actions.quoteEntryAction(EV, pv, [{ ...quotePeople[0], works: [{ workId: w.W01, status: 'in' }] }]);
    expect(q.ok && q.total).toBe(26500);
  });

  it('同じメールの URL のメールは、大文字・空白を変えても、そろえたあとのメールごとに上限（3回）で止まる', async () => {
    const actions = await import('@/app/bw6/entry/actions');
    const { recitalPreviewKey } = await import('../recitalPreview');
    const pv = recitalPreviewKey(EV);
    const before = await core.getAll(`SELECT id FROM recital_mail_log WHERE mail_kind='resend_url'`);
    for (const email of ['a@example.com', ' A@example.com', 'a@EXAMPLE.com ', '　ａ@example.com']) {
      const r = await actions.precheckEntryAction(EV, pv, { email, phone: '', people: [] });
      expect(r).toMatchObject({ ok: true, sameEmail: true }); // 表示は変えない
    }
    const after = await core.getAll(`SELECT id FROM recital_mail_log WHERE mail_kind='resend_url'`);
    expect(after.length - before.length).toBe(3);
    const keys = await core.getAll(`SELECT key FROM rate_limits WHERE key LIKE 'bw6:resend-to:%'`);
    expect(keys.every((k) => !String(k.key).includes('@'))).toBe(true);
  });
});

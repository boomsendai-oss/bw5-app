// BW6 発表会（段階1）の recitalEntryDb.ts の試験（実 DB・試験用のファイル DB）。「送る」と「送る前の確かめ」（Task 7）、
// 代わりに直す・マイページの変更・請求の作り直し（Task 8）。
// 自分の event_key（t-entry*）の行だけを見る。メールは 10 の sendRecitalMail を mock する。
import { describe, it, expect, vi } from 'vitest';
import { setupRecitalTestDb, seedRecitalTestEvent } from './recitalTestSeed';
import { dammDigit, isValidRef, RESERVED_REFS } from '../recitalRef';
import { expectedCharges } from '../recitalFee';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 呼び出しの引数を mock.calls に残すため受ける
const sendRecitalMail = vi.fn(async (..._a: unknown[]) => ({ status: 'sent', logId: 1 }));
vi.mock('@/lib/recitalMail', () => ({ sendRecitalMail: (...a: unknown[]) => sendRecitalMail(...a) }));
vi.mock('@/lib/recitalMail.ts', () => ({ sendRecitalMail: (...a: unknown[]) => sendRecitalMail(...a) }));
vi.mock('@/lib/recitalMoneyDb', () => ({ afterMoneyChanged: vi.fn(async () => {}) }));
vi.mock('@/lib/recitalMoneyDb.ts', () => ({ afterMoneyChanged: vi.fn(async () => {}) }));

// 書き込みの失敗を作るための差し込み口（本物の同時の書き込みではなく、withWriteTx が投げる形で試す）。
// 空のときは本物の withWriteTx をそのまま通す。
const txFault = vi.hoisted(() => ({ next: null as Error | null }));
vi.mock('@/lib/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...real,
    withWriteTx: async <T,>(fn: Parameters<typeof real.withWriteTx<T>>[0]): Promise<T> => {
      const e = txFault.next;
      if (e) { txFault.next = null; throw e; }
      return real.withWriteTx(fn);
    },
  };
});

// 番号を出す関数の差し込み口（番号切れ・ぶつかり続けを作る）。空のときは本物の pickRef を通す。
const refFault = vi.hoisted(() => ({ mode: null as null | 'none' | { always: string } }));
vi.mock('@/lib/recitalRef', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/recitalRef')>();
  return {
    ...real,
    pickRef: (...a: Parameters<typeof real.pickRef>) => {
      const m = refFault.mode;
      if (m === 'none') return null;
      if (m) return m.always;
      return real.pickRef(...a);
    },
  };
});

await setupRecitalTestDb('entry');
const core = await import('../db');
const entry = await import('../recitalEntryDb');
const recitalDb = await import('../recitalDb');
const { workIds: W } = await seedRecitalTestEvent('t-entry');

// 手元のファイル DB（libsql の file:）は、書き込みが同時に来ると2つ目が開始の時点で busy になり、
// その接続が使えないまま残ってあとの書き込みが全部 busy になる（@libsql/client の作り）。
// 本物の同時の試験は、12/8 の通し試しの前に Turso の試しの DB に向けて回す：
//   RECITAL_TEST_DB_URL=libsql://<試しの DB> RECITAL_TEST_DB_TOKEN=<鍵> npx vitest run src/lib/__tests__/recitalEntryDb.test.ts
//   （setupRecitalTestDb がその DB に向ける。DB は消さないので毎回空の試しの DB を使う。本番の URL と同じなら止まる）
const LOCAL_FILE_DB = (process.env.TURSO_DATABASE_URL ?? '').startsWith('file:');

/* eslint-disable @typescript-eslint/no-explicit-any -- 試験の呼び出しの記録は動的 */
const mailCalls = (): any[] => sendRecitalMail.mock.calls.map((x) => x[0] as any);
/* eslint-enable @typescript-eslint/no-explicit-any */

const NOW = new Date('2026-12-20T03:00:00Z');
let n = 0;
const key = () => (++n).toString(16).padStart(32, '0');
const kid = (over = {}) => ({ tempId: 'p1', lastName: 'テスト', firstName: 'イチ', lastKana: 'テスト', firstKana: 'イチ', birthday: '2015-04-02', isContact: false, category: 'student' as const, tshirtSize: null, instaHandle: null, works: [{ workId: W.W01, status: 'in' as const }] as { workId: number; status: 'in' | 'maybe' }[], ...over });
const sub = (over = {}) => ({ eventKey: 't-entry', submitKey: key(), contact: { lastName: 'テスト', firstName: 'ハハ', lastKana: 'テスト', firstKana: 'ハハ', email: `m${n}@example.com`, phone: `0901000${String(n).padStart(4, '0')}` }, people: [kid()], confirmNotFamily: false, confirmSamePerson: true, consentAccepted: true, ...over });

it('1人2作品で送ると、仮受付 32,500・請求の行4つ・整理番号が検査に合う', async () => {
  const r = await entry.submitEntry(sub({ people: [kid({ works: [{ workId: W.W01, status: 'in' }, { workId: W.W02, status: 'in' }] })] }), NOW);
  expect(r.ok && r.total).toBe(32500);
  expect(r.ok && r.view).toBe('tentative');
  expect(r.ok && isValidRef(r.refCode)).toBe(true);
  expect(r.ok && r.token).toMatch(/^[0-9a-f]{48}$/);
  const lines = await core.getAll("SELECT item_code, ref, amount FROM recital_charges WHERE household_id=? AND status='active' ORDER BY id", [r.ok && r.householdId]);
  expect(lines.map((l) => [l.item_code, l.ref, Number(l.amount)])).toEqual([['base', '', 16000], ['tshirt', '', 3000], ['coop_ticket', '', 7500], ['add_work', '2', 6000]]);
  expect(sendRecitalMail).toHaveBeenCalledWith(expect.objectContaining({ kind: 'receipt', householdId: r.ok && r.householdId }));
});

it('請求の person_id は INSERT した人の id・coop_ticket は null・期日は pay_due', async () => {
  const r = await entry.submitEntry(sub(), NOW);
  const pid = (await core.getOne('SELECT id FROM recital_people WHERE household_id=?', [r.ok && r.householdId])).id;
  const lines = await core.getAll('SELECT item_code, person_id, due_on FROM recital_charges WHERE household_id=? ORDER BY id', [r.ok && r.householdId]);
  expect(lines.map((l) => [l.item_code, l.person_id == null ? null : Number(l.person_id), l.due_on])).toEqual([
    ['base', Number(pid), '2027-02-10'], ['tshirt', Number(pid), '2027-02-10'], ['coop_ticket', null, '2027-02-10'],
  ]);
});

it('同じ submit_key の2回目は1回目の結果（世帯は1つ・メールは1回）', async () => {
  const s = sub();
  const a = await entry.submitEntry(s, NOW); const b = await entry.submitEntry(s, NOW);
  expect(b.ok && b.replay).toBe(true);
  expect(b.ok && b.householdId).toBe(a.ok && a.householdId);
  expect(b.ok && b.refCode).toBe(a.ok && a.refCode);
  expect(b.ok && [b.token, b.total, b.view]).toEqual(a.ok && [a.token, a.total, a.view]);
  const c = await core.getOne('SELECT COUNT(*) n FROM recital_households WHERE submit_key=?', [s.submitKey]);
  expect(Number(c.n)).toBe(1);
  const hid = a.ok && a.householdId;
  const counts = await core.getOne(
    `SELECT (SELECT COUNT(*) FROM recital_people WHERE household_id=?) p,
            (SELECT COUNT(*) FROM recital_casts c JOIN recital_people x ON x.id=c.person_id WHERE x.household_id=?) c,
            (SELECT COUNT(*) FROM recital_charges WHERE household_id=?) g,
            (SELECT COUNT(*) FROM recital_changes WHERE household_id=?) l`, [hid, hid, hid, hid]);
  expect([counts.p, counts.c, counts.g, counts.l].map(Number)).toEqual([1, 1, 3, 1]);
  expect(mailCalls().filter((x) => x.householdId === (a.ok && a.householdId))).toHaveLength(1);
});

it('書き込みが SQLITE_BUSY で失敗したら busy の断り（何も書かない・送らない）', async () => {
  const s = sub();
  sendRecitalMail.mockClear();
  txFault.next = Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' });
  expect(await entry.submitEntry(s, NOW)).toEqual({ ok: false, code: 'busy', message: 'ただいま混み合っています。もう一度『送る』を押してください。二重にはなりません。' });
  expect(Number((await core.getOne('SELECT COUNT(*) n FROM recital_households WHERE submit_key=?', [s.submitKey])).n)).toBe(0);
  expect(sendRecitalMail).not.toHaveBeenCalled();
  // 同じ submit_key で押し直すと1つだけできる
  const r = await entry.submitEntry(s, NOW);
  expect(r.ok && r.replay).toBe(false);
  expect(Number((await core.getOne('SELECT COUNT(*) n FROM recital_households WHERE submit_key=?', [s.submitKey])).n)).toBe(1);
});

it('締切の直前に送り、締切のあとに同じ submit_key で押し直す → 1回目の結果・世帯は1つ', async () => {
  const { workIds: C } = await seedRecitalTestEvent('t-entry-close');
  const s = sub({ eventKey: 't-entry-close', people: [kid({ works: [{ workId: C.W01, status: 'in' }] })] });
  const a = await entry.submitEntry(s, new Date('2027-01-31T14:59:00Z'));
  expect(a.ok).toBe(true);
  const b = await entry.submitEntry(s, new Date('2027-01-31T15:00:00Z'));
  expect(b.ok && b.replay).toBe(true);
  expect(b.ok && [b.householdId, b.refCode, b.token, b.total]).toEqual(a.ok && [a.householdId, a.refCode, a.token, a.total]);
  expect(Number((await core.getOne('SELECT COUNT(*) n FROM recital_households WHERE submit_key=?', [s.submitKey])).n)).toBe(1);
  // 新しい submit_key なら締切の断り
  expect(await entry.submitEntry(sub({ eventKey: 't-entry-close', people: [kid({ works: [{ workId: C.W01, status: 'in' }] })] }), new Date('2027-01-31T15:00:00Z'))).toMatchObject({ ok: false, code: 'closed' });
});

it('整理番号が尽きた（pickRef が null）→ busy・何も書かない', async () => {
  const s = sub();
  refFault.mode = 'none';
  try {
    expect(await entry.submitEntry(s, NOW)).toMatchObject({ ok: false, code: 'busy' });
  } finally { refFault.mode = null; }
  expect(Number((await core.getOne('SELECT COUNT(*) n FROM recital_households WHERE submit_key=?', [s.submitKey])).n)).toBe(0);
});

it('整理番号が4回続けて一意に当たる → busy・何も書かない', async () => {
  const first = await entry.submitEntry(sub(), NOW);
  const s = sub();
  refFault.mode = { always: first.ok ? first.refCode : '' };
  try {
    expect(await entry.submitEntry(s, NOW)).toMatchObject({ ok: false, code: 'busy' });
  } finally { refFault.mode = null; }
  expect(Number((await core.getOne('SELECT COUNT(*) n FROM recital_households WHERE submit_key=?', [s.submitKey])).n)).toBe(0);
});

it('seq の一意エラーも busy・ほかの例外は投げ直す', async () => {
  txFault.next = new Error('SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: recital_households.event_key, recital_households.seq');
  expect(await entry.submitEntry(sub(), NOW)).toMatchObject({ ok: false, code: 'busy' });
  txFault.next = new Error('SQLITE_CONSTRAINT_NOTNULL: NOT NULL constraint failed: recital_households.edit_token');
  await expect(entry.submitEntry(sub(), NOW)).rejects.toThrow('NOT NULL constraint failed');
});

it('同じメールでは作らず、もとの世帯へURLのメール', async () => {
  const a = await entry.submitEntry(sub({ contact: { ...sub().contact, email: 'same@example.com' } }), NOW);
  const b = await entry.submitEntry(sub({ contact: { ...sub().contact, email: 'same@example.com' } }), NOW);
  expect(b).toMatchObject({ ok: false, code: 'same_email', message: 'このメールアドレスに、ご案内を送りました。メールをご確認ください。' });
  expect(sendRecitalMail).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resend_url', householdId: a.ok && a.householdId }));
});

it('same email ignores case and spaces', async () => {
  await entry.submitEntry(sub({ contact: { ...sub().contact, email: 'Case@Example.com' } }), NOW);
  const b = await entry.submitEntry(sub({ contact: { ...sub().contact, email: '  case@example.COM ' } }), NOW);
  expect(b).toMatchObject({ ok: false, code: 'same_email' });
});

it.skipIf(LOCAL_FILE_DB)('同じメールを同時に2件送っても世帯は1つ（Turso の試しの DB で回す）', async () => {
  const email = 'race@example.com';
  const rs = await Promise.all([1, 2].map(() => entry.submitEntry(sub({ contact: { ...sub().contact, email } }), NOW)));
  // busy で返った方は同じ submit_key でもう1回送る
  const c = await core.getOne("SELECT COUNT(*) n FROM recital_households WHERE event_key='t-entry' AND lower(email)=?", [email]);
  expect(Number(c.n)).toBe(1);
  expect(rs.filter((r) => r.ok)).toHaveLength(1);
});

it('合計0円で「出る」がある → 申込完了・メールは complete 1通', async () => {
  const r = await entry.submitEntry(sub({ people: [kid({ works: [{ workId: W.W08, status: 'in' }] })] }), NOW);
  expect(r.ok && [r.total, r.view]).toEqual([0, 'complete']);
  expect(sendRecitalMail).toHaveBeenCalledWith(expect.objectContaining({ kind: 'complete', householdId: r.ok && r.householdId, dedupeKey: `complete:${r.ok && r.householdId}` }));
  expect(mailCalls().filter((x) => x.householdId === (r.ok && r.householdId))).toHaveLength(1);
});

it('迷っているだけ → 仮受付 0円・控えは receipt', async () => {
  const r = await entry.submitEntry(sub({ people: [kid({ works: [{ workId: W.W01, status: 'maybe' }] })] }), NOW);
  expect(r.ok && [r.total, r.view]).toEqual([0, 'tentative']);
  expect(sendRecitalMail).toHaveBeenCalledWith(expect.objectContaining({ kind: 'receipt', householdId: r.ok && r.householdId }));
});

it('出る1つ＋迷っている2つ → 迷っている分は請求に数えない（1作品の 26,500）', async () => {
  const r = await entry.submitEntry(sub({ people: [kid({ works: [{ workId: W.W01, status: 'in' }, { workId: W.W02, status: 'maybe' }, { workId: W.W03, status: 'maybe' }] })] }), NOW);
  expect(r.ok && r.total).toBe(26500);
  const casts = await core.getAll('SELECT c.status, c.decided_at FROM recital_casts c JOIN recital_people p ON p.id=c.person_id WHERE p.household_id=? ORDER BY c.id', [r.ok && r.householdId]);
  expect(casts.map((c) => [c.status, c.decided_at != null])).toEqual([['in', true], ['maybe', false], ['maybe', false]]);
});

it('6作品目は弾く（出る＋迷っている）', async () => {
  const works = ['W01', 'W02', 'W03', 'W04', 'W05'].map((c) => ({ workId: W[c], status: 'in' as 'in' | 'maybe' })).concat([{ workId: W.W06, status: 'maybe' }]);
  const r = await entry.submitEntry(sub({ people: [kid({ works })] }), NOW);
  expect(r).toMatchObject({ ok: false, code: 'invalid' });
  expect(!r.ok && r.fieldErrors?.['people.0.works']).toBeTruthy();
});

it('準備中・スタッフだけの作品・別の発表会の作品は選べない', async () => {
  for (const id of [W.W09, W.W10]) expect(await entry.submitEntry(sub({ people: [kid({ works: [{ workId: id, status: 'in' }] })] }), NOW)).toMatchObject({ ok: false, code: 'invalid' });
});

it('rejects work of another event', async () => {
  const other = (await seedRecitalTestEvent('t-entry-other')).workIds.W01;
  expect(await entry.submitEntry(sub({ people: [kid({ works: [{ workId: other, status: 'in' }] })] }), NOW)).toMatchObject({ ok: false, code: 'invalid' });
});

it('取りやめの作品・同じ作品を2回は選べない', async () => {
  const { workIds: D } = await seedRecitalTestEvent('t-entry-drop');
  await core.execute("UPDATE recital_works SET status='dropped' WHERE id=?", [D.W02]);
  const base = { eventKey: 't-entry-drop' };
  expect(await entry.submitEntry(sub({ ...base, people: [kid({ works: [{ workId: D.W02, status: 'in' }] })] }), NOW)).toMatchObject({ ok: false, code: 'invalid' });
  const r = await entry.submitEntry(sub({ people: [kid({ works: [{ workId: W.W01, status: 'in' }, { workId: W.W01, status: 'maybe' }] })] }), NOW);
  expect(!r.ok && r.fieldErrors?.['people.0.works']).toBeTruthy();
});

it('18歳未満は「連絡する人と同じ」を選べない（年齢は申込の日）', async () => {
  const r = await entry.submitEntry(sub({ people: [kid({ isContact: true, birthday: '2009-04-02' })] }), NOW);
  expect(!r.ok && r.fieldErrors?.['people.0.isContact']).toBeTruthy();
  expect((await entry.submitEntry(sub({ people: [kid({ isContact: true, birthday: '2008-12-20' })] }), NOW)).ok).toBe(true);
});

it('入力のまちがいは invalid と欄ごとの文（メール・電話・カナ・生年月日・同意・人数・サイズ・submit_key）', async () => {
  const r = await entry.submitEntry(sub({
    contact: { lastName: ' ', firstName: 'ハハ', lastKana: 'てすと', firstKana: 'ハハ', email: 'not-mail', phone: '090-1234' },
    people: [kid({ birthday: '2027-01-01', tshirtSize: 'XXXXL', firstKana: 'イチ1' })],
    consentAccepted: false,
  }), NOW);
  expect(r).toMatchObject({ ok: false, code: 'invalid', message: '入力を確かめてください。' });
  const fe = (!r.ok && r.fieldErrors) || {};
  for (const k of ['contact.lastName', 'contact.lastKana', 'contact.email', 'contact.phone', 'people.0.birthday', 'people.0.tshirtSize', 'people.0.firstKana', 'consentAccepted']) expect(fe[k], k).toBeTruthy();
  expect(await entry.submitEntry(sub({ people: [] }), NOW)).toMatchObject({ ok: false, code: 'invalid' });
  expect(await entry.submitEntry(sub({ people: Array.from({ length: 11 }, () => kid()) }), NOW)).toMatchObject({ ok: false, code: 'invalid' });
  expect(await entry.submitEntry(sub({ people: [kid({ works: [] })] }), NOW)).toMatchObject({ ok: false, code: 'invalid' });
  expect(await entry.submitEntry(sub({ submitKey: 'abc' }), NOW)).toMatchObject({ ok: false, code: 'invalid' });
  expect(await entry.submitEntry(sub({ eventKey: 't-entry-none' }), NOW)).toMatchObject({ ok: false, code: 'invalid' });
});

it('サイズ・インスタは整えて入れる（空のインスタは null）', async () => {
  const r = await entry.submitEntry(sub({ people: [kid({ tshirtSize: 'M', instaHandle: '   ' }), kid({ tempId: 'p2', firstName: 'ニ', firstKana: 'ニ', instaHandle: ' boom_test ' })] }), NOW);
  const ps = await core.getAll('SELECT tshirt_size, insta_handle, display_name, match_status, name_ok, photo_ok, sns_ok FROM recital_people WHERE household_id=? ORDER BY seq', [r.ok && r.householdId]);
  expect(ps.map((p) => [p.tshirt_size, p.insta_handle, p.display_name])).toEqual([['M', null, 'テスト イチ'], [null, 'boom_test', 'テスト ニ']]);
  expect(ps.every((p) => Number(p.name_ok) === 1 && Number(p.photo_ok) === 1 && Number(p.sns_ok) === 1)).toBe(true);
});

it('同じ電話は「家族ではない」なしで止まる／同じカナ＋生年月日は「それでも進む」なしで止まる', async () => {
  const a = sub(); await entry.submitEntry(a, NOW);
  expect(await entry.submitEntry(sub({ contact: { ...sub().contact, phone: a.contact.phone } }), NOW)).toMatchObject({ ok: false, code: 'same_phone', message: 'ご家族のお申し込みが、すでにあります。マイページをご確認ください。' });
  expect((await entry.submitEntry(sub({ contact: { ...sub().contact, phone: a.contact.phone }, confirmNotFamily: true }), NOW)).ok).toBe(true);
  const p = kid({ lastKana: 'オナジ', firstKana: 'ヒト', birthday: '2016-06-06' });
  await entry.submitEntry(sub({ people: [p] }), NOW);
  expect(await entry.submitEntry(sub({ people: [p], confirmSamePerson: false }), NOW)).toMatchObject({ ok: false, code: 'same_person', message: '同じお名前・同じ生年月日のお申し込みが、もうあります。ご家族が申し込んでいないか、確かめてください。' });
});

it('same_phone では何も送らない', async () => {
  const a = sub(); await entry.submitEntry(a, NOW);
  sendRecitalMail.mockClear();
  expect(await entry.submitEntry(sub({ contact: { ...sub().contact, phone: a.contact.phone } }), NOW)).toMatchObject({ ok: false, code: 'same_phone' });
  expect(sendRecitalMail).not.toHaveBeenCalled();
});

it('受付の状態：止めている／受付前／締切のあと', async () => {
  const { workIds: S } = await seedRecitalTestEvent('t-entry-st', { settings: { suspended: '1' } });
  const st = (now: Date) => entry.submitEntry(sub({ eventKey: 't-entry-st', people: [kid({ works: [{ workId: S.W01, status: 'in' }] })] }), now);
  expect(await st(NOW)).toMatchObject({ ok: false, code: 'suspended', message: 'ただいま受付を止めています。再開までお待ちください' });
  await core.execute("UPDATE recital_settings SET value='0' WHERE event_key='t-entry-st' AND key='suspended'");
  await core.execute("UPDATE recital_settings SET value='2026-12-25 12:00' WHERE event_key='t-entry-st' AND key='entry_open_at'");
  expect(await st(NOW)).toMatchObject({ ok: false, code: 'before', message: '12月25日（金）12時から受け付けます' });
  await core.execute("UPDATE recital_settings SET value='2026-12-01 12:00' WHERE event_key='t-entry-st' AND key='entry_open_at'");
  expect(await st(new Date('2027-01-31T15:00:00Z'))).toMatchObject({ ok: false, code: 'closed', message: '受付は終わりました。ご相談は公式LINEへ' });
  expect((await st(new Date('2027-01-31T14:59:00Z'))).ok).toBe(true);
});

it('事前登録の会員とカナ＋生年月日が両方合う1人だけ → 特別な料金の印が入り、その料金で請求', async () => {
  const m = await core.execute(
    "INSERT INTO boom_members (hacomono_member_id, full_name, full_name_kana, birthday, status) VALUES ('t-1', 'テスト ムリョウ', 'テスト ムリョウ', '2014-07-07', 'active')",
  );
  await core.execute("INSERT INTO recital_fee_presets (event_key, member_id, fee_class, created_at) VALUES ('t-entry', ?, 'free', ?)", [Number(m.lastInsertRowid), new Date().toISOString()]);
  const r = await entry.submitEntry(sub({ people: [kid({ lastKana: 'テスト', firstKana: 'ムリョウ', birthday: '2014-07-07' })] }), NOW);
  expect(r.ok && r.total).toBe(0);
  const p = await core.getOne('SELECT fee_class_override, member_id, match_status FROM recital_people WHERE household_id=?', [r.ok && r.householdId]);
  expect(p.fee_class_override).toBe('free');
  expect([Number(p.member_id), p.match_status]).toEqual([Number(m.lastInsertRowid), 'auto']);
});

it('番号が検査に合い、欠番と ref_skip を出さない（30件）', async () => {
  const skip = '200' + dammDigit('200');
  await core.execute("INSERT INTO recital_settings (event_key, key, value, created_at) VALUES ('t-entry','ref_skip',?,?) ON CONFLICT(event_key,key) DO UPDATE SET value=excluded.value", [skip, new Date().toISOString()]);
  const codes: string[] = [];
  for (let i = 0; i < 30; i++) { const r = await entry.submitEntry(sub(), NOW); if (r.ok) codes.push(r.refCode); }
  expect(codes).toHaveLength(30);
  for (const c of codes) { expect(isValidRef(c)).toBe(true); expect(RESERVED_REFS).not.toContain(c); expect(c).not.toBe(skip); }
});

it.skipIf(LOCAL_FILE_DB)('同時20件で番号と seq が重ならない（Turso の試しの DB で回す）', async () => {
  const subs = Array.from({ length: 20 }, () => sub());
  const rs = await Promise.all(subs.map((s) => entry.submitEntry(s, NOW)));
  for (let i = 0; i < 20; i++) { let r = rs[i]; while (!r.ok && r.code === 'busy') r = await entry.submitEntry(subs[i], NOW); rs[i] = r; }
  const ok = rs.filter((r) => r.ok);
  expect(ok).toHaveLength(20);
  expect(new Set(ok.map((r) => r.ok && r.refCode)).size).toBe(20);
  const seqs = await core.getAll('SELECT seq FROM recital_households WHERE submit_key IN (' + subs.map(() => '?').join(',') + ')', subs.map((s) => s.submitKey));
  expect(new Set(seqs.map((x) => Number(x.seq))).size).toBe(20);
}, 120_000);

it('照合は書き込みのあと：会員と合わない人は unmatched', async () => {
  const r = await entry.submitEntry(sub({ people: [kid({ lastKana: 'ダレモ', firstKana: 'イナイ' })] }), NOW);
  const p = await core.getOne('SELECT match_status FROM recital_people WHERE household_id=?', [r.ok && r.householdId]);
  expect(p.match_status).toBe('unmatched');
});

it('変えた記録は apply・family・人数と出演の数と合計だけ', async () => {
  const r = await entry.submitEntry(sub({ people: [kid({ works: [{ workId: W.W01, status: 'in' }, { workId: W.W02, status: 'maybe' }] })] }), NOW);
  const c = await core.getOne("SELECT action, actor, after_json FROM recital_changes WHERE household_id=? AND action='apply'", [r.ok && r.householdId]);
  expect([c.action, c.actor]).toEqual(['apply', 'family']);
  expect(JSON.parse(String(c.after_json))).toEqual({ people: 1, casts: 2, total: 26500 });
});

it('precheckEntry は同じメール・電話・人を返し、何も送らない', async () => {
  const a = sub({ people: [kid({ lastKana: 'マエ', firstKana: 'カクニン', birthday: '2013-03-03' })] }); await entry.submitEntry(a, NOW);
  sendRecitalMail.mockClear();
  const r = await entry.precheckEntry('t-entry', { email: a.contact.email.toUpperCase(), phone: a.contact.phone, people: [{ lastKana: 'マエ', firstKana: 'カクニン', birthday: '2013-03-03' }] });
  expect(r).toEqual({ sameEmail: true, samePhone: true, samePersonIdx: [0] });
  expect(sendRecitalMail).not.toHaveBeenCalled();
  expect((await entry.precheckEntry('t-entry', { email: 'x@example.com', phone: '', people: [] })).samePhone).toBe(false);
});

it('全角の電話でも通り、半角ハイフンの電話と同じ電話になる', async () => {
  await entry.submitEntry(sub({ contact: { ...sub().contact, phone: '090-1234-5678' } }), NOW);
  expect(await entry.submitEntry(sub({ contact: { ...sub().contact, phone: '０９０－１２３４－５６７８' } }), NOW)).toMatchObject({ ok: false, code: 'same_phone' });
  const h = await core.getOne("SELECT phone FROM recital_households WHERE event_key='t-entry' AND phone='09012345678'");
  expect(h?.phone).toBe('09012345678');
});

it('buildEntryFeePeople は送る時と同じ額（1人2作品 → 32,500）', async () => {
  const b = await entry.buildEntryFeePeople('t-entry', [{ lastName: 'テスト', firstName: 'イチ', lastKana: 'テスト', firstKana: 'イチ', birthday: '2015-04-02', works: [{ workId: W.W01, status: 'in' }, { workId: W.W02, status: 'in' }] }]);
  expect(expectedCharges(b.rules, b.feePeople, null).total).toBe(32500);
  expect(b.presetClasses).toEqual([null]);
});

// ---------- Task 8：代わりに直す・マイページの変更・請求の作り直し ----------

/* eslint-disable @typescript-eslint/no-explicit-any -- 試験の DB の行は動的 */
let P = 0;
/** submitEntry で1人の世帯を作り householdId を返す。その人の id を P に入れる */
async function apply(ws: string[], maybe: string[] = []): Promise<number> {
  const works = [...ws.map((c) => ({ workId: W[c], status: 'in' as const })), ...maybe.map((c) => ({ workId: W[c], status: 'maybe' as const }))];
  const r = await entry.submitEntry(sub({ people: [kid({ works })] }), NOW);
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  P = Number((await core.getOne('SELECT id FROM recital_people WHERE household_id=?', [r.householdId])).id);
  return r.householdId;
}
/** submitEntry で兄・妹などの世帯を作る。pids は人の seq の順 */
async function applyKids(kids: { in: string[]; maybe?: string[] }[]): Promise<{ id: number; pids: number[] }> {
  const people = kids.map((k, i) => kid({
    tempId: `p${i + 1}`, firstName: `コ${i + 1}`, firstKana: `コ${'ァィゥェォ'[i]}`,
    works: [...k.in.map((c) => ({ workId: W[c], status: 'in' as const })), ...(k.maybe ?? []).map((c) => ({ workId: W[c], status: 'maybe' as const }))],
  }));
  const r = await entry.submitEntry(sub({ people }), NOW);
  if (!r.ok) throw new Error(`applyKids failed: ${r.code}`);
  const ps = await core.getAll('SELECT id FROM recital_people WHERE household_id=? ORDER BY seq', [r.householdId]);
  return { id: r.householdId, pids: ps.map((x) => Number(x.id)) };
}
async function pay(id: number, amount: number): Promise<void> {
  await core.execute(
    "INSERT INTO recital_payments (event_key, household_id, method, amount, paid_on, source, created_at) VALUES ('t-entry', ?, 'cash', ?, '2026-12-21', 'manual', ?)",
    [id, amount, new Date().toISOString()],
  );
}
function set(id: number, personId: number, code: string, status: 'in' | 'maybe' | 'out', by: 'family' | 'staff' = 'family') {
  return entry.applyHouseholdEdits(id, [{ type: 'cast_set', personId, workId: W[code], status }], {
    actor: by === 'family' ? 'family' : 'TARO', by, reason: by === 'staff' ? 'LINEで聞いた' : null, now: NOW,
  });
}
async function money(id: number): Promise<{ m: any; view: string }> {
  const d = await recitalDb.loadHouseholdDetail(id);
  return { m: d!.money, view: d!.view };
}
async function active(id: number): Promise<[number, string, number | null, string, number][]> {
  const rows = await core.getAll("SELECT id, item_code, person_id, ref, amount FROM recital_charges WHERE household_id=? AND status='active' ORDER BY id", [id]);
  return rows.map((r) => [Number(r.id), String(r.item_code), r.person_id == null ? null : Number(r.person_id), String(r.ref), Number(r.amount)]);
}
const amcFn = async () => vi.mocked((await import('@/lib/recitalMoneyDb')).afterMoneyChanged);
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('請求の行の流れの例（05 5-3。行ごとに足す／void だけ）', () => {
  it('12/20〜1/30 の6行', async () => {
    const id = await apply(['W01', 'W02']);
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 0, remaining: 32500, overpaid: 0 }, view: 'tentative' });
    const base0 = (await active(id)).map((r) => r[0]);
    await pay(id, 32500);
    expect((await money(id)).view).toBe('complete');
    await set(id, P, 'W03', 'in');
    expect(await money(id)).toEqual({ m: { total: 35500, paid: 32500, remaining: 3000, overpaid: 0 }, view: 'complete_extra' });
    expect((await active(id)).filter((r) => !base0.includes(r[0])).map((r) => [r[1], r[3], r[4]])).toEqual([['add_work', '3', 3000]]);
    await pay(id, 3000);
    await set(id, P, 'W02', 'out');
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 35500, remaining: 0, overpaid: 3000 }, view: 'complete' });
    expect((await active(id)).map((r) => r[0])).toEqual(base0);
    await set(id, P, 'W04', 'in');
    expect((await money(id)).m).toEqual({ total: 35500, paid: 35500, remaining: 0, overpaid: 0 });
  });
});

describe('足す例（払ったあと。05 5-5）', () => {
  it.each([
    [['W01'], 'W02', 26500, 32500, 6000],
    [['W01', 'W02'], 'W03', 32500, 35500, 3000],
  ] as const)('1人の世帯 %j で %s を足す → 差額が残り', async (ws, add, before, after, diff) => {
    const id = await apply([...ws]); await pay(id, before);
    await set(id, P, add, 'in');
    expect((await money(id)).m).toEqual({ total: after, paid: before, remaining: diff, overpaid: 0 });
  });
  it('兄1→兄1・妹1：26,500→34,500 差額 8,000', async () => {
    const { id, pids } = await applyKids([{ in: ['W01'] }, { in: [], maybe: ['W02'] }]);
    expect((await money(id)).m.total).toBe(26500); await pay(id, 26500);
    await set(id, pids[1], 'W02', 'in');
    expect((await money(id)).m).toEqual({ total: 34500, paid: 26500, remaining: 8000, overpaid: 0 });
  });
  it('兄2→兄2・妹1：32,500→37,500 差額 5,000（1人目が妹に入れかわる）', async () => {
    const { id, pids } = await applyKids([{ in: ['W01', 'W02'] }, { in: [], maybe: ['W03'] }]);
    await pay(id, 32500);
    await set(id, pids[1], 'W03', 'in');
    expect((await money(id)).m).toEqual({ total: 37500, paid: 32500, remaining: 5000, overpaid: 0 });
  });
  it('兄1・妹1→兄2・妹1：34,500→37,500 差額 3,000', async () => {
    const { id, pids } = await applyKids([{ in: ['W01'] }, { in: ['W02'] }]);
    await pay(id, 34500);
    await set(id, pids[0], 'W03', 'in');
    expect((await money(id)).m).toEqual({ total: 37500, paid: 34500, remaining: 3000, overpaid: 0 });
  });
  it('兄3・妹1→兄3・妹2：40,500→46,500 差額 6,000', async () => {
    const { id, pids } = await applyKids([{ in: ['W01', 'W02', 'W03'] }, { in: ['W04'] }]);
    await pay(id, 40500);
    await set(id, pids[1], 'W05', 'in');
    expect((await money(id)).m).toEqual({ total: 46500, paid: 40500, remaining: 6000, overpaid: 0 });
  });
});

describe('へらす例（1人の世帯）', () => {
  it('35,500→32,500（お支払いずみ 3,000）→35,500（当たる）→38,500（残り 3,000）', async () => {
    const id = await apply(['W01', 'W02', 'W03']); await pay(id, 35500);
    await set(id, P, 'W03', 'out');
    expect((await money(id)).m).toEqual({ total: 32500, paid: 35500, remaining: 0, overpaid: 3000 });
    await set(id, P, 'W04', 'in');
    expect((await money(id)).m).toEqual({ total: 35500, paid: 35500, remaining: 0, overpaid: 0 });
    await set(id, P, 'W05', 'in');
    expect((await money(id)).m).toEqual({ total: 38500, paid: 35500, remaining: 3000, overpaid: 0 });
  });
});

describe('場面 A〜E（05 5-5。Task 2 の it.each の13行を操作の並びにした物）', () => {
  it('A：申し込む → 26,500 を払う', async () => {
    const id = await apply(['W01']);
    expect(await money(id)).toEqual({ m: { total: 26500, paid: 0, remaining: 26500, overpaid: 0 }, view: 'tentative' });
    await pay(id, 26500);
    expect(await money(id)).toEqual({ m: { total: 26500, paid: 26500, remaining: 0, overpaid: 0 }, view: 'complete' });
  });
  it('B：1作品を足す → 6,000 を払う', async () => {
    const id = await apply(['W01']); await pay(id, 26500);
    await set(id, P, 'W02', 'in');
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 26500, remaining: 6000, overpaid: 0 }, view: 'complete_extra' });
    await pay(id, 6000);
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 32500, remaining: 0, overpaid: 0 }, view: 'complete' });
  });
  it('C：1作品をやめる → 別の1作品を足す', async () => {
    const id = await apply(['W01', 'W02']); await pay(id, 32500);
    await set(id, P, 'W02', 'out');
    expect(await money(id)).toEqual({ m: { total: 26500, paid: 32500, remaining: 0, overpaid: 6000 }, view: 'complete' });
    await set(id, P, 'W03', 'in');
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 32500, remaining: 0, overpaid: 0 }, view: 'complete' });
  });
  it('D：払う前の足す・やめるで入金の行は増えない', async () => {
    const id = await apply(['W01', 'W02']);
    expect((await money(id)).m.total).toBe(32500);
    await set(id, P, 'W03', 'in');
    expect(await money(id)).toEqual({ m: { total: 35500, paid: 0, remaining: 35500, overpaid: 0 }, view: 'tentative' });
    await set(id, P, 'W03', 'out');
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 0, remaining: 32500, overpaid: 0 }, view: 'tentative' });
    expect(Number((await core.getOne('SELECT COUNT(*) n FROM recital_payments WHERE household_id=?', [id])).n)).toBe(0);
  });
  it('E：兄1・妹1 34,500 → 払う → 兄が足す 37,500（妹が1人目・兄の base が 16,000→5,000）→ 妹をスタッフがやめる 32,500・お支払いずみ 2,000', async () => {
    const { id, pids } = await applyKids([{ in: ['W01'] }, { in: ['W02'] }]);
    await pay(id, 34500);
    const keep = (await active(id)).filter((r) => r[1] === 'coop_ticket' || (r[1] === 'tshirt' && r[2] === pids[0])).map((r) => r[0]);
    await set(id, pids[0], 'W03', 'in');
    expect(await money(id)).toEqual({ m: { total: 37500, paid: 34500, remaining: 3000, overpaid: 0 }, view: 'complete_extra' });
    expect((await active(id)).filter((r) => r[1] === 'base' && r[2] === pids[0]).map((r) => r[4])).toEqual([5000]);
    await set(id, pids[1], 'W02', 'out', 'staff');
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 34500, remaining: 0, overpaid: 2000 }, view: 'complete' });
    for (const k of keep) expect((await active(id)).map((r) => r[0])).toContain(k);
  });
});

describe('決まり', () => {
  it('払ったあとは in→maybe を拒む（家庭もスタッフも）', async () => {
    const id = await apply(['W01', 'W02']); await pay(id, 32500);
    expect(await set(id, P, 'W02', 'maybe')).toMatchObject({ ok: false, code: 'paid_no_maybe' });
    expect(await set(id, P, 'W02', 'maybe', 'staff')).toMatchObject({ ok: false, code: 'paid_no_maybe' });
  });
  it('払ったあと、その人の最後の「出る」はボタンでなく LINE（迷っているが残っていても）', async () => {
    const id = await apply(['W01'], ['W02']); await pay(id, 26500);
    expect(await set(id, P, 'W01', 'out')).toMatchObject({ ok: false, code: 'last_work', message: '出演を全部やめるときは、公式LINEでお知らせください。' });
    expect((await set(id, P, 'W01', 'out', 'staff')).ok).toBe(true);
  });
  it('家庭は5作品で止まる／スタッフは通る', async () => {
    const id = await apply(['W01', 'W02', 'W03', 'W04', 'W05']);
    expect(await set(id, P, 'W06', 'in')).toMatchObject({ ok: false, code: 'max_works', message: '1人5作品までです。' });
    expect((await set(id, P, 'W06', 'in', 'staff')).ok).toBe(true);
  });
  it('adjust の行は作り直しで残る', async () => {
    const id = await apply(['W01']);
    await core.execute("INSERT INTO recital_charges (event_key, household_id, person_id, item_code, ref, label, qty, unit_amount, amount, status, created_at) VALUES ('t-entry', ?, NULL, 'adjust', '', '手の調整', 1, -1000, -1000, 'active', ?)", [id, new Date().toISOString()]);
    await set(id, P, 'W02', 'in');
    expect((await active(id)).some((r) => r[1] === 'adjust' && r[4] === -1000)).toBe(true);
    expect((await money(id)).m.total).toBe(31500);
  });
  it('change_close_at の境目：1/31 23:59:59.999 は家庭も通る、2/1 0:00 は家庭 closed・スタッフは理由つきで通る／理由なしは invalid', async () => {
    const id = await apply(['W01']);
    const ed = (code: string) => [{ type: 'cast_set' as const, personId: P, workId: W[code], status: 'in' as const }];
    expect((await entry.applyHouseholdEdits(id, ed('W02'), { actor: 'family', by: 'family', now: new Date('2027-01-31T23:59:59.999+09:00') })).ok).toBe(true);
    const late = new Date('2027-02-01T00:00:00+09:00');
    expect(await entry.applyHouseholdEdits(id, ed('W03'), { actor: 'family', by: 'family', now: late })).toMatchObject({ ok: false, code: 'closed' });
    expect((await entry.applyHouseholdEdits(id, ed('W03'), { actor: 'TARO', by: 'staff', reason: 'LINEで聞いた', now: late })).ok).toBe(true);
    expect(await entry.applyHouseholdEdits(id, ed('W04'), { actor: 'TARO', by: 'staff', reason: '', now: late })).toMatchObject({ ok: false, code: 'invalid' });
  });
  it('rejects work of another event', async () => {
    const id = await apply(['W01']);
    const other = (await seedRecitalTestEvent('t-entry-other8')).workIds.W02;
    expect(await entry.applyHouseholdEdits(id, [{ type: 'cast_set', personId: P, workId: other, status: 'in' }], { actor: 'TARO', by: 'staff', reason: 'x', now: NOW })).toMatchObject({ ok: false, code: 'invalid' });
  });
  it('ほかの世帯の人を指した直しは invalid（家庭・スタッフ・dryRun とも）', async () => {
    const id = await apply(['W01']);
    const { pids } = await applyKids([{ in: ['W01'] }]);
    const ed = [{ type: 'cast_set' as const, personId: pids[0], workId: W.W02, status: 'in' as const }];
    expect(await entry.applyHouseholdEdits(id, ed, { actor: 'family', by: 'family', now: NOW })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await entry.applyHouseholdEdits(id, ed, { actor: 'TARO', by: 'staff', reason: 'x', now: NOW })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await entry.applyHouseholdEdits(id, ed, { actor: 'TARO', by: 'staff', reason: 'x', now: NOW, dryRun: true })).toMatchObject({ ok: false, code: 'invalid' });
  });
  it('合計が変わったら afterMoneyChanged(id,"total") と change のメール1通。変わらない直し（電話）は afterMoneyChanged を呼ばない', async () => {
    const amc = await amcFn();
    const id = await apply(['W01']); amc.mockClear(); sendRecitalMail.mockClear();
    await set(id, P, 'W02', 'in');
    expect(amc).toHaveBeenCalledWith(id, 'total');
    expect(sendRecitalMail.mock.calls.filter((c) => (c[0] as { kind: string; householdId: number }).kind === 'change' && (c[0] as { householdId: number }).householdId === id)).toHaveLength(1);
    amc.mockClear();
    await entry.applyHouseholdEdits(id, [{ type: 'contact', fields: { phone: '09099998888' } }], { actor: 'TARO', by: 'staff', reason: 'LINEで聞いた', now: NOW });
    expect(amc).not.toHaveBeenCalled();
  });
  it('dryRun は書かず、本番と同じ合計を返す', async () => {
    const id = await apply(['W01']); await pay(id, 26500); sendRecitalMail.mockClear();
    const ed = [{ type: 'cast_set' as const, personId: P, workId: W.W02, status: 'in' as const }];
    expect(await entry.applyHouseholdEdits(id, ed, { actor: 'family', by: 'family', now: NOW, dryRun: true }))
      .toEqual({ ok: true, totalBefore: 26500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 6000 });
    expect((await money(id)).m.total).toBe(26500);
    expect(sendRecitalMail).not.toHaveBeenCalled();
  });
  it('total_changed の記録に前と後の合計', async () => {
    const id = await apply(['W01']); await set(id, P, 'W02', 'in');
    const c = await core.getOne("SELECT before_json, after_json FROM recital_changes WHERE household_id=? AND action='total_changed' ORDER BY id DESC", [id]);
    expect([JSON.parse(c.before_json).total, JSON.parse(c.after_json).total]).toEqual([26500, 32500]);
  });
  it('メールを直すと古い鍵が使えない・新しいアドレスへ resend_url', async () => {
    const id = await apply(['W01']);
    const old = (await core.getOne('SELECT edit_token t FROM recital_households WHERE id=?', [id])).t;
    const { token } = await entry.changeHouseholdEmail(id, 'new-addr@example.com', 'TARO');
    expect(token).not.toBe(old);
    expect(await core.getOne('SELECT id FROM recital_households WHERE edit_token=?', [old])).toBeNull();
    expect(sendRecitalMail).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resend_url', householdId: id }));
    const ch = await core.getAll("SELECT action, after_json FROM recital_changes WHERE household_id=? AND action IN ('email_edit','token_regenerated')", [id]);
    expect(ch.map((c) => c.action).sort()).toEqual(['email_edit', 'token_regenerated']);
    expect(JSON.stringify(ch)).not.toContain('new-addr@example.com');
  });
  it('ほかの世帯と同じメールには直せない・形ちがいも直せない', async () => {
    const a = await apply(['W01']); const b = await apply(['W01']);
    const bMail = (await core.getOne('SELECT email FROM recital_households WHERE id=?', [b])).email;
    await expect(entry.changeHouseholdEmail(a, bMail, 'TARO')).rejects.toThrow('recital_entry:same_email');
    await expect(entry.changeHouseholdEmail(a, 'not-mail', 'TARO')).rejects.toThrow('recital_entry:bad_email');
  });
  it('人の欄：印だけの直しは flags_edit でメールなし、表示名は person_edit でメール1通、家庭は人の欄を直せない', async () => {
    const id = await apply(['W01']); sendRecitalMail.mockClear();
    const staff = { actor: 'TARO', by: 'staff' as const, reason: 'LINEで聞いた', now: NOW };
    expect((await entry.applyHouseholdEdits(id, [{ type: 'person', personId: P, fields: { sns_ok: 0 } }], staff)).ok).toBe(true);
    expect(sendRecitalMail).not.toHaveBeenCalled();
    expect((await entry.applyHouseholdEdits(id, [{ type: 'person', personId: P, fields: { display_name: 'テスト イチロウ' } }], staff)).ok).toBe(true);
    expect(sendRecitalMail.mock.calls.filter((c) => (c[0] as { kind: string }).kind === 'change')).toHaveLength(1);
    const p = await core.getOne('SELECT sns_ok, display_name FROM recital_people WHERE id=?', [P]);
    expect([Number(p.sns_ok), p.display_name]).toEqual([0, 'テスト イチロウ']);
    const acts = (await core.getAll('SELECT action FROM recital_changes WHERE household_id=? AND person_id=? ORDER BY id', [id, P])).map((r) => r.action);
    expect(acts).toEqual(['flags_edit', 'person_edit']);
    expect(await entry.applyHouseholdEdits(id, [{ type: 'person', personId: P, fields: { display_name: 'x' } }], { actor: 'family', by: 'family', now: NOW })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await entry.applyHouseholdEdits(id, [{ type: 'contact', fields: { phone: '090-12' } }], staff)).toMatchObject({ ok: false, code: 'invalid' });
  });
  it('regenerateToken で古い鍵が使えない', async () => {
    const id = await apply(['W01']);
    const old = (await core.getOne('SELECT edit_token t FROM recital_households WHERE id=?', [id])).t;
    const { token } = await entry.regenerateToken(id, 'TARO');
    expect(token).toMatch(/^[0-9a-f]{48}$/); expect(token).not.toBe(old);
    expect(await core.getOne('SELECT id FROM recital_households WHERE edit_token=?', [old])).toBeNull();
  });
});

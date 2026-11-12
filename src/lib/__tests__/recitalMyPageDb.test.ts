// BW6 発表会（段階1）のマイページの DB の試験（実 DB・試験用のファイル DB ./data/test_recital_mypage.db）。
// 鍵で世帯を引く（recitalGuard.ts）・インスタの欄（updateInstaHandle）・開いた印（markMyPageOpened）。自分の event_key（t-mypage）の行だけを見る。
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { setupRecitalTestDb } from './recitalTestSeed';

// Server Action の IP の読み（next/headers）は、試験ではリクエストが無いので差し替える
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }) }));

process.env.RECITAL_PREVIEW_SECRET = 'test-secret-mypage';

const EV = 't-mypage';
const NOW = new Date('2026-12-20T12:00:00+09:00');

let core: typeof import('../db');
let entry: typeof import('../recitalEntryDb');
let fam: typeof import('../recitalFamilyDb');
let guard: typeof import('../recitalGuard');
let seed: typeof import('./recitalFamilySeed');
let token = ''; let hid = 0; let pid = 0; let otherPid = 0;

beforeAll(async () => {
  await setupRecitalTestDb('mypage');
  core = await import('../db');
  entry = await import('../recitalEntryDb');
  fam = await import('../recitalFamilyDb');
  guard = await import('../recitalGuard');
  seed = await import('./recitalFamilySeed');
  const { w } = await seed.seedFamilyEvent(core, EV);
  const r = await entry.submitEntry(seed.entryFor(EV, 'c'.repeat(32), [  // 合い鍵は16進32けた（指示書の 'm' は16進でないので c に）
    { firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: [{ workId: w.W01, status: 'in' }] }]), NOW);
  if (!r.ok) throw new Error(r.message);
  token = r.token; hid = r.householdId;
  pid = Number((await core.getOne('SELECT id FROM recital_people WHERE household_id = ?', [hid]))!.id);
  const r2 = await entry.submitEntry(seed.entryFor(EV, 'd'.repeat(32), [  // 指示書の 'n' も16進でないので d に
    { firstName: '次郎', firstKana: 'ジロウ', birthday: '2014-01-01', works: [{ workId: w.W02, status: 'in' }] }], { email: 'b@example.com', phone: '09099990000' }), NOW);
  if (!r2.ok) throw new Error(r2.message);
  otherPid = Number((await core.getOne('SELECT id FROM recital_people WHERE household_id = ?', [r2.householdId]))!.id);
});

describe('requireHouseholdByToken', () => {
  it('形が合わない鍵・ちがう鍵は null、合えばその世帯', async () => {
    expect(await guard.requireHouseholdByToken('ABC')).toBeNull();
    expect(await guard.requireHouseholdByToken(token.toUpperCase())).toBeNull();
    expect(await guard.requireHouseholdByToken('0'.repeat(48))).toBeNull();
    expect((await guard.requireHouseholdByToken(token))!.household.id).toBe(hid);
  });
});

describe('updateInstaHandle', () => {
  it('自分の世帯の人なら、前後の空白だけ取って生のまま入れる', async () => {
    expect(await entry.updateInstaHandle(token, pid, '  @hanako_bsb ')).toEqual({ ok: true });
    expect((await core.getOne('SELECT insta_handle FROM recital_people WHERE id = ?', [pid]))!.insta_handle).toBe('@hanako_bsb');
  });
  it('空は null', async () => {
    await entry.updateInstaHandle(token, pid, '   ');
    expect((await core.getOne('SELECT insta_handle FROM recital_people WHERE id = ?', [pid]))!.insta_handle).toBeNull();
  });
  it('ほかの世帯の人・ちがう鍵は ok:false で何も変えない', async () => {
    expect(await entry.updateInstaHandle(token, otherPid, 'x')).toEqual({ ok: false });
    expect(await entry.updateInstaHandle('0'.repeat(48), pid, 'x')).toEqual({ ok: false });
  });
  it('変えた記録は insta_edit。値は残さない（R-18）', async () => {
    await entry.updateInstaHandle(token, pid, '@secret_handle');
    const rows = await core.getAll(`SELECT * FROM recital_changes WHERE action = 'insta_edit' AND household_id = ?`, [hid]);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain('secret_handle');
  });
  it('受付を止めている間は ok:false（見るだけ）', async () => {
    await core.execute(`UPDATE recital_settings SET value = '1' WHERE event_key = ? AND key = 'suspended'`, [EV]);
    expect(await entry.updateInstaHandle(token, pid, '@x')).toEqual({ ok: false });
    await core.execute(`UPDATE recital_settings SET value = '0' WHERE event_key = ? AND key = 'suspended'`, [EV]);
  });
});

describe('markMyPageOpened', () => {
  it('opened_at は初めの1回だけ。mail_opened_at は控えから開いた時の初めの1回だけ', async () => {
    await fam.markMyPageOpened(hid, false, new Date('2026-12-20T03:00:00Z'));
    await fam.markMyPageOpened(hid, false, new Date('2026-12-21T03:00:00Z'));
    let h = await core.getOne('SELECT opened_at, mail_opened_at FROM recital_households WHERE id = ?', [hid]);
    expect(h!.opened_at).toBe('2026-12-20T03:00:00.000Z');
    expect(h!.mail_opened_at).toBeNull();
    await fam.markMyPageOpened(hid, true, new Date('2026-12-22T03:00:00Z'));
    await fam.markMyPageOpened(hid, true, new Date('2026-12-23T03:00:00Z'));
    h = await core.getOne('SELECT opened_at, mail_opened_at FROM recital_households WHERE id = ?', [hid]);
    expect(h!.opened_at).toBe('2026-12-20T03:00:00.000Z');
    expect(h!.mail_opened_at).toBe('2026-12-22T03:00:00.000Z');
  });
});

describe('resendUrlAction（/bw6/resend。答えはいつも同じ文）', () => {
  const DONE = 'お申し込みがあれば、マイページのURLを送りました';
  it('ある・ないメール・形ちがい・鍵の合わない試しの発表会でも同じ文。同じメールは4回目で「少し時間をおいて…」', async () => {
    const { resendUrlAction } = await import('../../app/bw6/resend/actions');
    const { recitalPreviewKey } = await import('../recitalPreview');
    const pv = recitalPreviewKey(EV);
    expect(await resendUrlAction(EV, null, 'a@example.com')).toEqual({ message: DONE });
    expect(await resendUrlAction(EV, pv, 'nobody@example.com')).toEqual({ message: DONE });
    expect(await resendUrlAction(EV, pv, 'not-an-email')).toEqual({ message: DONE });
    for (let i = 0; i < 3; i++) expect(await resendUrlAction(EV, pv, ' A@Example.com ')).toEqual({ message: DONE });
    expect(await resendUrlAction(EV, pv, 'a@example.com')).toEqual({ message: '少し時間をおいて、もう一度お試しください。' });
    // 送ったのは、鍵の合う3回だけ（そろえたメールで世帯に当たる）。4回目は送らない
    const sent = await core.getAll(`SELECT id FROM recital_mail_log WHERE household_id = ? AND mail_kind = 'resend_url'`, [hid]);
    expect(sent.length).toBe(3);
  });
});

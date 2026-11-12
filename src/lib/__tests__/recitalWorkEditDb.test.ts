// BW6 発表会（段階1）のマイページの「作品を足す・やめる」の DB の試験（実 DB・試験用のファイル DB ./data/test_recital_workedit.db）。Task 15。
// 押す前の金額（previewHouseholdEdits）と決定（applyFamilyWorkEdits）が同じになること・止める所・控えのメールが1通。
// 自分の event_key（t-workedit）の行だけを見る。メールは本物の sendRecitalMail を通す（試しの発表会で test_mail_to が空なので、記録は failed になり送らない）。
import { describe, it, expect, beforeAll } from 'vitest';
import { setupRecitalTestDb } from './recitalTestSeed';

const EV = 't-workedit';
const NOW = new Date('2026-12-20T12:00:00+09:00');

let core: typeof import('../db');
let entry: typeof import('../recitalEntryDb');
let fam: typeof import('../recitalFamilyDb');
let money: typeof import('../recitalMoneyDb');
let seed: typeof import('./recitalFamilySeed');
let w: Record<string, number>; let n = 0;

beforeAll(async () => {
  await setupRecitalTestDb('workedit');
  core = await import('../db');
  entry = await import('../recitalEntryDb');
  fam = await import('../recitalFamilyDb');
  money = await import('../recitalMoneyDb');
  seed = await import('./recitalFamilySeed');
  ({ w } = await seed.seedFamilyEvent(core, EV));
});

async function household(people: { firstName: string; firstKana: string; birthday: string; works: string[] }[], paid: number) {
  n += 1;
  const r = await entry.submitEntry(seed.entryFor(EV, String(n).padStart(32, '0'),
    people.map((p) => ({ ...p, works: p.works.map((c) => ({ workId: w[c], status: 'in' as const })) })),
    { email: `h${n}@example.com`, phone: `0900000${String(n).padStart(4, '0')}` }), NOW);
  if (!r.ok) throw new Error(r.message);
  if (paid > 0) await money.recordManualPayment(r.householdId, { method: 'cash', amount: paid, paidOn: '2026-12-20', memo: '試し' }, 'テスト');
  const pids = (await core.getAll('SELECT id FROM recital_people WHERE household_id = ? ORDER BY seq', [r.householdId])).map((x) => Number(x.id));
  return { hid: r.householdId, token: r.token, pids };
}
const both = async (hid: number, token: string, edits: { personId: number; workId: number; status: 'in' | 'out' }[]) => {
  const p = await fam.previewHouseholdEdits(hid, edits, NOW);
  const a = await fam.applyFamilyWorkEdits(token, edits, NOW);
  return { p, a };
};

describe('押す前の金額は、決定のあとの金額と同じ（足す例・へらす例・場面）', () => {
  it('1人1作品を払ってから1作品足す：26,500→32,500、残り 6,000', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01'] }], 26500);
    const { p, a } = await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W02, status: 'in' }]);
    expect(p).toMatchObject({ ok: true, totalBefore: 26500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 6000 });
    expect(a).toEqual({ ok: true, totalBefore: 26500, totalAfter: 32500 });
    expect((await money.readHouseholdMoney(h.hid)).m.remaining).toBe(6000);
  });
  it('兄1・妹1を払ってから兄が1作品足す：34,500→37,500', async () => {
    const h = await household([{ firstName: '一郎', firstKana: 'イチロウ', birthday: '2012-04-10', works: ['W01'] }, { firstName: 'さくら', firstKana: 'サクラ', birthday: '2016-06-01', works: ['W02'] }], 34500);
    const { p, a } = await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W03, status: 'in' }]);
    expect(p).toMatchObject({ ok: true, totalBefore: 34500, totalAfter: 37500 });
    expect(a).toMatchObject({ ok: true, totalAfter: 37500 });
  });
  it('へらす例：3作品を払う→1つへらす 32,500→別の1つを足す 35,500→もう1つ足す 38,500（残り 3,000）', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01', 'W02', 'W03'] }], 35500);
    expect((await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W03, status: 'out' }])).a).toMatchObject({ ok: true, totalAfter: 32500 });
    expect((await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W04, status: 'in' }])).a).toMatchObject({ ok: true, totalAfter: 35500 });
    expect((await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W05, status: 'in' }])).a).toMatchObject({ ok: true, totalAfter: 38500 });
    expect((await money.readHouseholdMoney(h.hid)).m.remaining).toBe(3000);
  });
  it('場面D（払う前）：2作品 32,500→足す 35,500→やめる 32,500', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01', 'W02'] }], 0);
    expect((await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W03, status: 'in' }])).p).toMatchObject({ ok: true, totalBefore: 32500, totalAfter: 35500 });
    expect((await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W02, status: 'out' }])).a).toMatchObject({ ok: true, totalAfter: 32500 });
  });
});

describe('止める所', () => {
  it('場面E：払ったあと、妹の最後の「出る」をやめるのは last_work（LINE へ）', async () => {
    const h = await household([{ firstName: '一郎', firstKana: 'イチロウ', birthday: '2012-04-10', works: ['W01'] }, { firstName: 'さくら', firstKana: 'サクラ', birthday: '2016-06-01', works: ['W02'] }], 34500);
    const { p, a } = await both(h.hid, h.token, [{ personId: h.pids[1], workId: w.W02, status: 'out' }]);
    expect(p).toMatchObject({ ok: false, code: 'last_work' });
    expect(a).toMatchObject({ ok: false, code: 'last_work' });
  });
  it('6作品目は max_works', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01', 'W02', 'W03', 'W04', 'W05'] }], 0);
    expect((await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W06, status: 'in' }])).a).toMatchObject({ ok: false, code: 'max_works' });
  });
  it('change_close_at を過ぎたら closed', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01'] }], 0);
    const late = new Date('2027-02-01T00:00:00+09:00');
    expect(await fam.applyFamilyWorkEdits(h.token, [{ personId: h.pids[0], workId: w.W02, status: 'in' }], late)).toMatchObject({ ok: false, code: 'closed' });
  });
  it('ちがう鍵は not_found、ほかの世帯の人は invalid、準備中の作品は invalid', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01'] }], 0);
    const g = await household([{ firstName: '次郎', firstKana: 'ジロウ', birthday: '2014-01-01', works: ['W01'] }], 0);
    expect(await fam.applyFamilyWorkEdits('0'.repeat(48), [{ personId: h.pids[0], workId: w.W02, status: 'in' }], NOW)).toMatchObject({ ok: false, code: 'not_found' });
    expect(await fam.applyFamilyWorkEdits(h.token, [{ personId: g.pids[0], workId: w.W02, status: 'in' }], NOW)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await fam.applyFamilyWorkEdits(h.token, [{ personId: h.pids[0], workId: w.W07, status: 'in' }], NOW)).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('変更の控えは、決定1回に1通', () => {
  it('入れ替え（外す・足す）を一緒に決定しても change は1通。金額は変わらない', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01', 'W02'] }], 32500);
    const a = await fam.applyFamilyWorkEdits(h.token, [{ personId: h.pids[0], workId: w.W01, status: 'out' }, { personId: h.pids[0], workId: w.W03, status: 'in' }], NOW);
    expect(a).toEqual({ ok: true, totalBefore: 32500, totalAfter: 32500 });
    const rows = await core.getAll(`SELECT id FROM recital_mail_log WHERE household_id = ? AND mail_kind = 'change'`, [h.hid]);
    expect(rows.length).toBe(1);
  });
});

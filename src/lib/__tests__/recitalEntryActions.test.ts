// BW6 発表会（段階1）のスタッフの世帯の画面の Server Actions（Task 19）の試験（実 DB・試験用のファイル DB ./data/test_recital_entry_actions.db）。
// ログインの確かめ・revalidatePath・メールは mock する（メールは送らない）。試験ごとに自分の発表会のキー（t-act-…）の行だけを見る。
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { todayJst } from '../dateJst';
import { seedEvent, seedHousehold, seedRules, seedWork } from './recitalStaffSeed';

const mail = vi.hoisted(() => ({
  sendRecitalMail: vi.fn(async () => ({ status: 'sent', logId: 1 })),
  sendPaidMail: vi.fn(async () => ({ kind: 'complete', status: 'waiting', logId: 1 })),
}));
vi.mock('@/lib/eventAuth', () => ({ isAuthorizedServer: async () => true }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/recitalMail', () => mail);
vi.mock('@/lib/recitalMail.ts', () => mail);

const TEST_DB = './data/test_recital_entry_actions.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

let core: typeof import('../db');
let act: typeof import('../../app/staff/bw6/entries/[id]/actions');

beforeAll(async () => {
  for (const s of ['', '-shm', '-wal']) { try { rmSync(TEST_DB + s); } catch { /* 初回 */ } }
  core = await import('../db');
  await core.initDb();
  const dir = 'scripts/migrations';
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const stmt of sql.split(';').map((x) => x.trim()).filter(Boolean)) {
      try { await core.execute(stmt); } catch { /* 依存の無いものは飛ばす */ }
    }
  }
  act = await import('../../app/staff/bw6/entries/[id]/actions');
});

beforeEach(() => {
  mail.sendRecitalMail.mockClear();
  mail.sendPaidMail.mockClear();
});

const countOf = async (sql: string, args: (string | number)[]) => Number((await core.getOne(sql, args))?.n ?? 0);

describe('まとめた世帯にはお金とメールの操作をさせない（サーバで拒む）', () => {
  it('手で入金を記録・控えを送り直す・メールアドレスを直すが、どれも失敗で返り、何も書かない・送らない', async () => {
    const ev = 't-act-1'; await seedEvent(ev); await seedRules(ev); const w1 = await seedWork(ev, 'W01');
    const a = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    const m = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }], email: 'merged@example.com' });
    await core.execute(`UPDATE recital_households SET status='merged', merged_into=? WHERE id=?`, [a.householdId, m.householdId]);

    const p = await act.recordManualPaymentAction(m.householdId, { method: 'cash', amount: 26500, paidOn: todayJst(), memo: '' }, 'TARO');
    expect(p).toMatchObject({ ok: false });
    expect(await countOf('SELECT COUNT(*) AS n FROM recital_payments WHERE household_id = ?', [m.householdId])).toBe(0);
    expect(mail.sendPaidMail).not.toHaveBeenCalled();

    const r = await act.resendReceiptAction(m.householdId);
    expect(r).toMatchObject({ ok: false });
    expect(mail.sendRecitalMail).not.toHaveBeenCalled();

    const e = await act.changeEmailAction(m.householdId, 'new@example.com', 'TARO');
    expect(e).toMatchObject({ ok: false });
    expect((await core.getOne('SELECT email, edit_token FROM recital_households WHERE id = ?', [m.householdId]))).toMatchObject({ email: 'merged@example.com', edit_token: m.token });
    expect(mail.sendRecitalMail).not.toHaveBeenCalled();
  });

  it('active の世帯なら手で入金を記録でき、メールの状態（sent 以外も）をそのまま返す', async () => {
    const ev = 't-act-2'; await seedEvent(ev); await seedRules(ev); const w1 = await seedWork(ev, 'W01');
    const a = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    const p = await act.recordManualPaymentAction(a.householdId, { method: 'cash', amount: 26500, paidOn: todayJst(), memo: '' }, 'TARO');
    expect(p).toEqual({ ok: true, mail: { kind: 'complete', status: 'waiting' } });
    expect(await countOf('SELECT COUNT(*) AS n FROM recital_payments WHERE household_id = ?', [a.householdId])).toBe(1);
    const r = await act.resendReceiptAction(a.householdId);
    expect(r).toEqual({ ok: true, status: 'sent' });
  });
});

describe('代わりに直すの確かめ（dryRun・K227）', () => {
  it('作品を1つやめると、お支払いずみの分が 0 → 6,000円。書かない', async () => {
    const ev = 't-act-3'; await seedEvent(ev); await seedRules(ev);
    const w1 = await seedWork(ev, 'W01'); const w2 = await seedWork(ev, 'W02');
    const a = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in'], [w2, 'in']] }], payments: [32500] });
    const r = await act.editHouseholdAction(
      a.householdId,
      [{ type: 'cast_set', personId: a.personIds[0], workId: w2, status: 'out' }],
      { reason: '電話で聞いた', receivedAtJst: '2026-12-20T10:30', staffName: 'TARO', dryRun: true },
    );
    expect(r).toEqual({ ok: true, totalBefore: 32500, totalAfter: 26500, remainingBefore: 0, remainingAfter: 0, overpaidBefore: 0, overpaidAfter: 6000, extra: 0 });
    expect(await countOf("SELECT COUNT(*) AS n FROM recital_casts WHERE person_id = ? AND status = 'in'", [a.personIds[0]])).toBe(2);
  });

  it('払ったあとに作品を足すと、追加分 6,000円', async () => {
    const ev = 't-act-4'; await seedEvent(ev); await seedRules(ev);
    const w1 = await seedWork(ev, 'W01'); const w2 = await seedWork(ev, 'W02');
    const a = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }], payments: [26500] });
    const r = await act.editHouseholdAction(
      a.householdId,
      [{ type: 'cast_set', personId: a.personIds[0], workId: w2, status: 'in' }],
      { reason: '電話で聞いた', receivedAtJst: null, staffName: 'TARO', dryRun: true },
    );
    expect(r).toMatchObject({ ok: true, totalBefore: 26500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 6000, extra: 6000 });
  });
});

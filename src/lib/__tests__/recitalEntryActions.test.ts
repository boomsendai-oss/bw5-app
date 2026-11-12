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
// ログインの確かめ（Task 20 の試験で「ログインしていない」を作るために切りかえる。初めは true）
const auth = vi.hoisted(() => ({ ok: true }));
vi.mock('@/lib/eventAuth', () => ({ isAuthorizedServer: async () => auth.ok }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
// 書き込みの直前に1回だけ差し込む仕事（「画面の確かめのあと、書く前に別の人がまとめた」を作る）。空のときは本物の withWriteTx をそのまま通す
const txHook = vi.hoisted(() => ({ before: null as null | (() => Promise<void>) }));
vi.mock('@/lib/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...real,
    withWriteTx: async <T,>(fn: Parameters<typeof real.withWriteTx<T>>[0]): Promise<T> => {
      const h = txHook.before;
      if (h) { txHook.before = null; await h(); }
      return real.withWriteTx(fn);
    },
  };
});
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

  it('「振り込みましたの印を付ける」も、まとめた世帯は失敗で返り、印を書かない（Task 23）', async () => {
    const ev = 't-act-23'; await seedEvent(ev); await seedRules(ev); const w1 = await seedWork(ev, 'W01');
    const a = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    const m = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }], email: 'merged23@example.com' });
    await core.execute(`UPDATE recital_households SET status='merged', merged_into=? WHERE id=?`, [a.householdId, m.householdId]);
    const r = await act.markBankToldByStaffAction(m.householdId, { date: todayJst(), name: '4827 ヤマダ ハナコ', amount: '26500' }, 'TARO');
    expect(r).toMatchObject({ ok: false });
    expect((await core.getOne('SELECT bank_told_at FROM recital_households WHERE id = ?', [m.householdId])).bank_told_at).toBeNull();
    expect(await countOf("SELECT COUNT(*) AS n FROM recital_changes WHERE household_id = ? AND action = 'bank_told'", [m.householdId])).toBe(0);
    // active の世帯なら付けられる（スタッフが付けたことが残る）
    expect(await act.markBankToldByStaffAction(a.householdId, { date: todayJst(), name: '4827 ヤマダ ハナコ', amount: '26500' }, 'TARO')).toEqual({ ok: true });
    expect((await core.getOne('SELECT bank_told_by FROM recital_households WHERE id = ?', [a.householdId])).bank_told_by).toBe('staff');
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

describe('特別な料金・そのほかの金額の直し・まとめる・照合（Task 20）のサーバの守り', () => {
  it('ログインしていなければ、どれも throw（何も書かない）', async () => {
    const ev = 't-act-20a'; await seedEvent(ev); await seedRules(ev); const w1 = await seedWork(ev, 'W01');
    const a = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    const b = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    auth.ok = false;
    try {
      await expect(act.feeClassAction(a.personIds[0], 'no_coop', '登録もれ', 'TARO', false)).rejects.toThrow('Unauthorized');
      await expect(act.adjustAction(a.householdId, { direction: 'down', amount: 1000, reason: '試し' }, 'TARO', false)).rejects.toThrow('Unauthorized');
      await expect(act.voidAdjustAction(a.householdId, 1, '試し', 'TARO')).rejects.toThrow('Unauthorized');
      await expect(act.mergeAction(b.householdId, a.householdId, { reason: '家族', samePeople: [] }, 'TARO', false)).rejects.toThrow('Unauthorized');
      await expect(act.matchAction(a.personIds[0], { none: true }, '確かめた', 'TARO', false)).rejects.toThrow('Unauthorized');
      await expect(act.matchCandidatesAction(a.personIds[0])).rejects.toThrow('Unauthorized');
      await expect(act.searchHouseholdsAction(ev, '1')).rejects.toThrow('Unauthorized');
      await expect(act.householdPeopleAction(a.householdId)).rejects.toThrow('Unauthorized');
    } finally {
      auth.ok = true;
    }
    expect((await core.getOne('SELECT fee_class_override f FROM recital_people WHERE id = ?', [a.personIds[0]])).f).toBeNull();
    expect((await core.getOne('SELECT status FROM recital_households WHERE id = ?', [b.householdId])).status).toBe('active');
  });

  it('手で入金を記録：外の確かめのあと、書く前にまとめが入ったら拒み、入金の行を作らない', async () => {
    const ev = 't-act-20d'; await seedEvent(ev); await seedRules(ev); const w1 = await seedWork(ev, 'W01');
    const a = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    const b = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    // activeCheck（書き込みの外）は通る。そのあと、入金の書き込みの直前に、別の画面のまとめが先に書き終わる
    txHook.before = async () => {
      const r = await act.mergeAction(b.householdId, a.householdId, { reason: '家族', samePeople: [] }, 'KEIKO', false);
      expect(r).toMatchObject({ ok: true });
    };
    const r = await act.recordManualPaymentAction(b.householdId, { method: 'cash', amount: 26500, paidOn: todayJst(), memo: '' }, 'TARO');
    expect(r).toEqual({ ok: false, error: 'この世帯はまとめた（または有効でない）ので、できません' });
    expect(txHook.before).toBeNull();
    expect((await core.getOne('SELECT status FROM recital_households WHERE id = ?', [b.householdId])).status).toBe('merged');
    expect(await countOf("SELECT COUNT(*) AS n FROM recital_payments WHERE household_id = ? AND method = 'cash'", [b.householdId])).toBe(0);
    expect(mail.sendPaidMail).not.toHaveBeenCalled();
  });

  it('まとめた世帯は、特別な料金・手の調整・照合・まとめるを失敗で返し、何も書かない', async () => {
    const ev = 't-act-20b'; await seedEvent(ev); await seedRules(ev); const w1 = await seedWork(ev, 'W01');
    const a = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    const b = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }], payments: [26500] });
    expect(await act.mergeAction(b.householdId, a.householdId, { reason: '家族', samePeople: [] }, 'TARO', true)).toMatchObject({ ok: true, totalAfter: 34500, moved: 26500, refund: 0 });
    expect(await act.mergeAction(b.householdId, a.householdId, { reason: '家族', samePeople: [] }, 'TARO', false)).toMatchObject({ ok: true, totalAfter: 34500 });
    const changes = await countOf('SELECT COUNT(*) AS n FROM recital_changes WHERE household_id IN (?, ?)', [a.householdId, b.householdId]);
    expect(await act.mergeAction(b.householdId, a.householdId, { reason: '家族', samePeople: [] }, 'TARO', false))
      .toEqual({ ok: false, error: 'もうまとめてあります。画面を開き直してください' });
    expect(await act.adjustAction(b.householdId, { direction: 'up', amount: 1000, reason: '試し' }, 'TARO', false)).toMatchObject({ ok: false });
    // まとめた b には請求の行ができない（人は a へ移っているので、人の操作は a の世帯で受ける）
    expect(await countOf("SELECT COUNT(*) AS n FROM recital_charges WHERE household_id = ? AND status = 'active'", [b.householdId])).toBe(0);
    expect(await countOf('SELECT COUNT(*) AS n FROM recital_changes WHERE household_id IN (?, ?)', [a.householdId, b.householdId])).toBe(changes);

    // 人がまだ残っている、まとめた世帯（印だけ merged にした）の人の特別な料金・照合も拒む
    const m = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    await core.execute(`UPDATE recital_households SET status='merged', merged_into=? WHERE id=?`, [a.householdId, m.householdId]);
    const mChanges = await countOf('SELECT COUNT(*) AS n FROM recital_changes WHERE household_id = ?', [m.householdId]);
    const notActive = { ok: false, error: 'この世帯はまとめた（または有効でない）ので、できません' };
    expect(await act.feeClassAction(m.personIds[0], 'no_coop', '登録もれ', 'TARO', false)).toEqual(notActive);
    expect(await act.feeClassAction(m.personIds[0], 'no_coop', '登録もれ', 'TARO', true)).toEqual(notActive);
    expect(await act.matchAction(m.personIds[0], { none: true }, '確かめた', 'TARO', false)).toEqual(notActive);
    expect(await act.adjustAction(m.householdId, { direction: 'up', amount: 1000, reason: '試し' }, 'TARO', false)).toEqual(notActive);
    expect((await core.getOne('SELECT fee_class_override f, match_status s FROM recital_people WHERE id = ?', [m.personIds[0]]))).toEqual({ f: null, s: 'none' });
    expect(await countOf('SELECT COUNT(*) AS n FROM recital_changes WHERE household_id = ?', [m.householdId])).toBe(mChanges);
  });

  it('名前・理由が無ければ失敗で返す／特別な料金の dryRun は書かない', async () => {
    const ev = 't-act-20c'; await seedEvent(ev); await seedRules(ev); const w1 = await seedWork(ev, 'W01');
    const a = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    expect(await act.feeClassAction(a.personIds[0], 'no_coop', '登録もれ', '', true)).toEqual({ ok: false, error: '名前を選んでください' });
    expect(await act.feeClassAction(a.personIds[0], 'no_coop', ' ', 'TARO', true)).toEqual({ ok: false, error: '理由を入れてください' });
    expect(await act.feeClassAction(a.personIds[0], 'no_coop', '登録もれ', 'TARO', true)).toMatchObject({ ok: true, changed: true, totalBefore: 26500, totalAfter: 19000 });
    expect((await core.getOne('SELECT fee_class_override f FROM recital_people WHERE id = ?', [a.personIds[0]])).f).toBeNull();
    expect(await act.adjustAction(a.householdId, { direction: 'down', amount: 99999, reason: '試し' }, 'TARO', true)).toEqual({ ok: false, error: '今の合計より多くは下げられません' });
  });
});

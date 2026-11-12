// BW6 発表会（段階1）の作品の画面（Task 17）の DB の試験（実 DB・試験用のファイル DB ./data/test_recital_works_staff.db）。
// 選び肢（listWorkPickOptions）・取りやめ（dropWork）・作品ごとの数（listWorkCounts を1回の SQL にした分）・クラスと担当の読み出し（listWorkLinks）。
// 試験ごとに自分の発表会のキー（t-works-…）の行だけを見る。名前は「試験」などの仮の字だけ。
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { RECITAL_STAFF_NAMES } from '../recital';
import { seedEvent, seedRules, seedWork, seedHousehold } from './recitalStaffSeed';

const TEST_DB = './data/test_recital_works_staff.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

let core: typeof import('../db');
let db: typeof import('../recitalDb');
let entry: typeof import('../recitalEntryDb');
let money: typeof import('../recitalMoneyDb');

beforeAll(async () => {
  for (const s of ['', '-shm', '-wal']) { try { rmSync(TEST_DB + s); } catch { /* 初回 */ } }
  core = await import('../db');
  db = await import('../recitalDb');
  entry = await import('../recitalEntryDb');
  money = await import('../recitalMoneyDb');
  await core.initDb();
  const dir = 'scripts/migrations';
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const stmt of sql.split(';').map((x) => x.trim()).filter(Boolean)) {
      try { await core.execute(stmt); } catch { /* 依存の無いものは飛ばす */ }
    }
  }
});

describe('listWorkPickOptions', () => {
  it('active のクラスとイントラだけ', async () => {
    await core.execute("INSERT INTO lesson_master (class_name, target, active) VALUES ('試験クラスA', NULL, 1)");
    await core.execute("INSERT INTO lesson_master (class_name, target, active) VALUES ('試験クラス休み', NULL, 0)");
    await core.execute("INSERT INTO lesson_master (class_name, target, active) VALUES ('試験クラスB', '小学生', 1)");
    await core.execute("INSERT INTO instructors (name, active) VALUES ('試験講師', 1)");
    await core.execute("INSERT INTO instructors (name, active) VALUES ('試験講師休み', 0)");
    const o = await db.listWorkPickOptions();
    expect(o.classes.map((c) => c.label)).toContain('試験クラスA');
    expect(o.classes.map((c) => c.label)).toContain('試験クラスB（小学生）');
    expect(o.classes.map((c) => c.label)).not.toContain('試験クラス休み');
    expect(o.instructors.map((i) => i.name)).toContain('試験講師');
    expect(o.instructors.map((i) => i.name)).toEqual(expect.not.arrayContaining(['試験講師休み']));
    expect(o.classes.every((c) => typeof c.id === 'number')).toBe(true);
  });
});

describe('dropWork（段階1：払った世帯がいれば取りやめない）', () => {
  it('未払いの 1人2作品（32,500）の W02 を取りやめ → 26,500。作品は dropped', async () => {
    const ev = 't-works-1'; await seedEvent(ev); await seedRules(ev);
    const w1 = await seedWork(ev, 'W01'); const w2 = await seedWork(ev, 'W02');
    const h = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in'], [w2, 'in']] }] });
    expect((await money.readHouseholdMoney(h.householdId)).m.total).toBe(32500);
    expect(await entry.dropWork(w2, 1, RECITAL_STAFF_NAMES[0])).toEqual({ ok: true, households: 1 });
    expect((await money.readHouseholdMoney(h.householdId)).m.total).toBe(26500);
    expect((await core.getOne('SELECT status FROM recital_works WHERE id=?', [w2]))?.status).toBe('dropped');
  });
  it('払った世帯（26,500 済み）がその作品に出る → paid_household。作品も請求も変わらない', async () => {
    const ev = 't-works-2'; await seedEvent(ev); await seedRules(ev);
    const w1 = await seedWork(ev, 'W01');
    const h = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }], payments: [26500] });
    expect(await entry.dropWork(w1, 1, RECITAL_STAFF_NAMES[0])).toMatchObject({ ok: false, code: 'paid_household', count: 1, households: 1 });
    expect((await core.getOne('SELECT status FROM recital_works WHERE id=?', [w1]))?.status).toBe('open');
    expect((await money.readHouseholdMoney(h.householdId)).m.total).toBe(26500);
  });
  it('見た時の人数とちがえば count_changed（古い画面から押した）', async () => {
    const ev = 't-works-3'; await seedEvent(ev); await seedRules(ev);
    const w1 = await seedWork(ev, 'W01');
    await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    expect(await entry.dropWork(w1, 0, RECITAL_STAFF_NAMES[0])).toEqual({ ok: false, code: 'count_changed', count: 1 });
    expect((await core.getOne('SELECT status FROM recital_works WHERE id=?', [w1]))?.status).toBe('open');
  });
  it('出演が0の作品はそのまま取りやめ（households: 0）／名前が無ければ throw', async () => {
    const ev = 't-works-4'; await seedEvent(ev); await seedRules(ev);
    const w = await seedWork(ev, 'W01');
    await expect(entry.dropWork(w, 0, '')).rejects.toThrow('staff_name');
    expect(await entry.dropWork(w, 0, RECITAL_STAFF_NAMES[0])).toEqual({ ok: true, households: 0 });
    expect((await core.getOne('SELECT status FROM recital_works WHERE id=?', [w]))?.status).toBe('dropped');
  });
  it('無い作品は not_found', async () => {
    expect(await entry.dropWork(999999, 0, RECITAL_STAFF_NAMES[0])).toEqual({ ok: false, code: 'not_found', count: 0 });
  });
  it('迷っている人も数える。迷っているだけの世帯は払っていても止めない（in の世帯だけ見る）', async () => {
    const ev = 't-works-5'; await seedEvent(ev); await seedRules(ev);
    const w1 = await seedWork(ev, 'W01'); const w2 = await seedWork(ev, 'W02');
    const h = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in'], [w2, 'maybe']] }], payments: [26500] });
    await seedHousehold(ev, { recompute: true, people: [{ casts: [[w2, 'in']] }] });
    expect(await entry.dropWork(w2, 2, RECITAL_STAFF_NAMES[0])).toEqual({ ok: true, households: 2 });
    expect((await money.readHouseholdMoney(h.householdId)).m.total).toBe(26500);
  });
});

/** 前の listWorkCounts（世帯ごとに readMoneyViewTx で残りを読む）と同じ決め方で作った、比べるための値 */
async function countsByMoneyView(ev: string): Promise<Map<number, { in: number; maybe: number; paid: number; unpaid: number; snsNg: boolean }>> {
  const out = new Map<number, { in: number; maybe: number; paid: number; unpaid: number; snsNg: boolean }>();
  for (const w of await core.getAll('SELECT id FROM recital_works WHERE event_key = ?', [ev])) {
    out.set(Number(w.id), { in: 0, maybe: 0, paid: 0, unpaid: 0, snsNg: false });
  }
  const casts = await core.getAll(
    `SELECT c.work_id, c.status, p.sns_ok, h.id AS household_id
     FROM recital_casts c JOIN recital_people p ON p.id = c.person_id JOIN recital_households h ON h.id = p.household_id
     WHERE c.event_key = ? AND c.status IN ('in', 'maybe') AND p.status = 'active' AND h.status = 'active'`,
    [ev],
  );
  for (const c of casts) {
    const e = out.get(Number(c.work_id))!;
    if (c.status === 'maybe') { e.maybe++; continue; }
    e.in++;
    if ((await db.readMoneyViewTx(null, Number(c.household_id))).m.remaining > 0) e.unpaid++;
    else e.paid++;
    if (Number(c.sns_ok) === 0) e.snsNg = true;
  }
  return out;
}

describe('listWorkCounts（1回の SQL）', () => {
  it('readMoneyViewTx で数えた値と同じ', async () => {
    const ev = 't-works-cnt'; await seedEvent(ev); await seedRules(ev);
    const w1 = await seedWork(ev, 'W01'); const w2 = await seedWork(ev, 'W02');
    const w3 = await seedWork(ev, 'W03', { status: 'dropped' }); const w4 = await seedWork(ev, 'W04');
    // 未払い
    await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in'], [w2, 'maybe']] }] });
    // 払った（ちょうど）
    await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }], payments: [26500] });
    // 多く払って返す分 todo がある（残り 0）
    await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }, { casts: [[w2, 'in']] }], payments: [40000], refundsTodo: [3000] });
    // 一部だけ払った（残りがある）・SNS に出さない人
    const part = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w2, 'in'], [w3, 'in']] }], payments: [10000] });
    await core.execute('UPDATE recital_people SET sns_ok = 0 WHERE household_id = ?', [part.householdId]);
    // 返す分 todo で残りが出る（払った額 26,500 − 返す分 todo 5,000）
    await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }], payments: [26500], refundsTodo: [5000] });
    // 数えない：やめた人・まとめた世帯・out
    const gone = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    await core.execute("UPDATE recital_people SET status = 'withdrawn' WHERE household_id = ?", [gone.householdId]);
    const merged = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w2, 'in']] }] });
    await core.execute("UPDATE recital_households SET status = 'merged' WHERE id = ?", [merged.householdId]);
    await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'out']] }] });
    // 請求が無いまま in（合計 0・残り 0）
    await seedHousehold(ev, { people: [{ casts: [[w2, 'in']] }] });

    const got = await db.listWorkCounts(ev);
    const want = await countsByMoneyView(ev);
    expect(got).toEqual(want);
    // 値そのものも見る（比べる側が空でも通ってしまわないように）
    expect(got.get(w1)).toEqual({ in: 4, maybe: 0, paid: 2, unpaid: 2, snsNg: false });
    expect(got.get(w2)).toEqual({ in: 3, maybe: 1, paid: 2, unpaid: 1, snsNg: true });
    expect(got.get(w3)).toEqual({ in: 1, maybe: 0, paid: 0, unpaid: 1, snsNg: true });
    expect(got.get(w4)).toEqual({ in: 0, maybe: 0, paid: 0, unpaid: 0, snsNg: false });
  });
});

describe('listWorkLinks', () => {
  it('作品ごとのクラスと担当（担当は sort_order の順）', async () => {
    const ev = 't-works-links'; await seedEvent(ev);
    const base = {
      kind: 'class', title: '試験の作品', class_label: '', slot_label: '', target_label: '', genre: '',
      entry_mode: 'form' as const, fee_type: 'counted' as const, extra_fee: null, capacity: null, status: 'draft' as const,
      merged_into: null, public_note: '', staff_note: '', sort_order: 1,
    };
    const a = await db.saveWork(ev, {
      ...base,
      classes: [{ lesson_master_id: null, label: '外部のクラス' }],
      instructors: [
        { instructor_id: null, display_name: '試験の外部の人', role: 'assist', sort_order: 2 },
        { instructor_id: 7, display_name: '試験講師', role: 'choreo', sort_order: 1 },
      ],
    }, RECITAL_STAFF_NAMES[0]);
    const b = await db.saveWork(ev, { ...base, classes: [], instructors: [] }, RECITAL_STAFF_NAMES[0]);
    const links = await db.listWorkLinks(ev);
    expect(links.get(a.id)).toEqual({
      classes: [{ lesson_master_id: null, label: '外部のクラス' }],
      instructors: [
        { instructor_id: 7, display_name: '試験講師', role: 'choreo', sort_order: 1 },
        { instructor_id: null, display_name: '試験の外部の人', role: 'assist', sort_order: 2 },
      ],
    });
    expect(links.get(b.id)).toBeUndefined();
  });
});

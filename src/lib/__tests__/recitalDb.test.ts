// BW6 発表会（段階1）の recitalDb.ts の試験（実 DB・試験用のファイル DB）。
// 自分の event_key（t-db-*）の行だけを見る。種の bw6-test は台帳SQLから入る。
import { describe, it, expect } from 'vitest';
import { setupRecitalTestDb, seedRecitalTestEvent, seedHousehold } from './recitalTestSeed';
import type { WorkInput } from '../recitalDb';
import { recitalResetStatements } from '../recitalReset';

await setupRecitalTestDb('db');
const core = await import('../db');
const db = await import('../recitalDb');

const workInput = (over: Partial<WorkInput> = {}): WorkInput => ({
  kind: 'class', title: '試しの作品', class_label: '', slot_label: '', target_label: '', genre: '',
  entry_mode: 'form', fee_type: 'counted', extra_fee: null, capacity: null, status: 'draft', merged_into: null,
  public_note: '', staff_note: '', sort_order: 0, classes: [], instructors: [], ...over,
});

describe('getRecitalSettings', () => {
  it('行が無い発表会は初めの値（03 3-4）', async () => {
    const s = await db.getRecitalSettings('t-db-empty');
    expect(s.entry_open_at).toBe('2026-12-15 12:00');
    expect(s.entry_close_at).toBe('2027-01-31 23:59');
    expect(s.change_close_at).toBe('2027-01-31 23:59');
    expect(s.pay_open_at).toBe('2026-12-15 12:00');
    expect(s.pay_ok_at).toBeNull();
    expect(s.pay_due).toBe('2027-02-10');
    expect(s.max_works_per_person).toBe(5);
    expect(s.min_self_apply_age).toBe(18);
    expect(s.fee_check_first).toEqual([26500, 32500, 35500, 38500, 41500]);
    expect(s.fee_check_family).toBe(8000);
    expect([s.goal_people, s.breakeven_people, s.cap_people]).toEqual([150, 77, 175]);
    expect(s.tshirt_sizes).toEqual(['130','140','150','S','M','L','XL','XXL','XXXL']);
    expect(s.bank_ask_at).toEqual(['19:00', '20:30']);
    expect([s.bank_rest_from, s.bank_rest_to]).toEqual(['2026-12-30', '2027-01-03']);
    expect(s.pay_remind_stop_hours).toBe(15);
    expect(s.bank_close_on).toBe('2027-03-31');
    expect(s.mail_bcc_staff).toBe(false);
    expect(s.bank_text).toBe('');
    expect(s.ref_skip).toEqual([]);
  });
  it('種 bw6-test は試しの鍵・受付中・支払いを開けてある', async () => {
    const s = await db.getRecitalSettings('bw6-test');
    expect(s.stripe_mode).toBe('test');
    expect(s.suspended).toBe(false);
    expect(s.pay_ok_at).not.toBeNull();
    expect((await db.getRecitalEvent('bw6-test'))?.is_test).toBe(1);
  });
});

describe('saveRecitalSetting', () => {
  it('pay_ok_at と bank_audit_done_at は欄から直せない', async () => {
    await seedRecitalTestEvent('t-db-set');
    await expect(db.saveRecitalSetting('t-db-set', 'pay_ok_at', '2026-12-15 12:00', 'TARO')).rejects.toThrow('recital_setting:locked');
    await expect(db.saveRecitalSetting('t-db-set', 'bank_audit_done_at', '2027-02-12 20:00', 'TARO')).rejects.toThrow('recital_setting:locked');
  });
  it('知らない鍵・形ちがいは拒む／ふつうの鍵は保存して直した人が残る', async () => {
    await expect(db.saveRecitalSetting('t-db-set', 'fee_lock', '1', 'TARO')).rejects.toThrow('recital_setting:unknown');
    await expect(db.saveRecitalSetting('t-db-set', 'entry_close_at', '1/31', 'TARO')).rejects.toThrow('recital_setting:bad_value');
    await db.saveRecitalSetting('t-db-set', 'ref_skip', '2003', 'TARO');
    expect((await db.getRecitalSettings('t-db-set')).ref_skip).toEqual(['2003']);
    const row = await core.getOne("SELECT updated_by FROM recital_settings WHERE event_key='t-db-set' AND key='ref_skip'");
    expect(row.updated_by).toBe('TARO');
  });
  it('setPayOk は pay_ok_at を入れて pay_opened を残す（2回目は変えない）', async () => {
    // 下ごしらえが入れた pay_ok_at を消してから（core は '../db'）
    await core.execute("DELETE FROM recital_settings WHERE event_key='t-db-set' AND key='pay_ok_at'");
    await db.setPayOk('t-db-set', 'TARO');
    const first = (await db.getRecitalSettings('t-db-set')).pay_ok_at;
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    await db.setPayOk('t-db-set', 'TARO');
    expect((await db.getRecitalSettings('t-db-set')).pay_ok_at).toBe(first);
    const n = await core.getOne("SELECT COUNT(*) n FROM recital_changes WHERE event_key='t-db-set' AND action='pay_opened'");
    expect(Number(n.n)).toBe(1);
  });
});

describe('setSuspended', () => {
  // 下ごしらえの種は privacy_text・line_url を入れないので、ここで入れる
  const ready = { suspended: '1', privacy_text: '使い道の知らせ（試し）', line_url: 'https://example.invalid/line' };
  it('仮の金額の行があれば開けない → tentative', async () => {
    await seedRecitalTestEvent('t-db-sus1', { settings: ready });
    await core.execute("UPDATE recital_fee_rules SET is_tentative=1 WHERE event_key='t-db-sus1' AND item_code='tshirt' AND payer_role='first'");
    expect(await db.setSuspended('t-db-sus1', false, 'TARO')).toEqual({ ok: false, reason: 'tentative' });
  });
  it('検算が合わなければ開けない → fee_check', async () => {
    await seedRecitalTestEvent('t-db-sus2', { settings: { ...ready, fee_check_first: '26500,32500,35500,38500,41000' } });
    expect(await db.setSuspended('t-db-sus2', false, 'TARO')).toEqual({ ok: false, reason: 'fee_check' });
  });
  it.each([
    ['consent_items', 'consent_empty'], ['privacy_text', 'privacy_empty'], ['line_url', 'line_empty'],
  ])('%s が空なら開けない → %s', async (key, reason) => {
    const ev = 't-db-sus-' + key;
    await seedRecitalTestEvent(ev, { settings: { ...ready, [key]: ' ' } });
    expect(await db.setSuspended(ev, false, 'TARO')).toEqual({ ok: false, reason });
  });
  it('そろえば suspended=0 と entry_opened、止めると 1 と entry_suspended', async () => {
    await seedRecitalTestEvent('t-db-sus3', { settings: ready });
    expect(await db.setSuspended('t-db-sus3', false, 'TARO')).toEqual({ ok: true });
    expect((await db.getRecitalSettings('t-db-sus3')).suspended).toBe(false);
    expect(await db.setSuspended('t-db-sus3', true, 'TARO')).toEqual({ ok: true });
    expect((await db.getRecitalSettings('t-db-sus3')).suspended).toBe(true);
    const acts = (await core.getAll("SELECT action FROM recital_changes WHERE event_key='t-db-sus3' ORDER BY id")).map((r) => r.action);
    expect(acts).toEqual(['entry_opened', 'entry_suspended']);
  });
});

describe('listFeeRules', () => {
  it('規則8行を sort_order の順に id つきで返す', async () => {
    const rules = await db.listFeeRules('t-db-set');
    expect(rules).toHaveLength(8);
    expect(rules.map((r) => [r.payer_role, r.item_code, r.nth_from, r.nth_to, r.unit_amount, r.qty])).toEqual([
      ['first', 'base', 1, 1, 16000, 1], ['first', 'tshirt', 1, 1, 3000, 1], ['first', 'coop_ticket', 1, 1, 2500, 3],
      ['first', 'add_work', 2, 2, 6000, 1], ['first', 'add_work', 3, null, 3000, 1],
      ['family', 'base', 1, 1, 5000, 1], ['family', 'tshirt', 1, 1, 3000, 1], ['family', 'add_work', 2, null, 3000, 1],
    ]);
    expect(rules.every((r) => typeof r.id === 'number')).toBe(true);
  });
});

describe('loadMembersLite', () => {
  it('休会は leave・退会は withdrew', async () => {
    await core.execute("INSERT INTO boom_members (hacomono_member_id, full_name, full_name_kana, birthday, status, member_type) VALUES ('t-lite-1','テスト キュウ','テスト キュウ','2014-01-01','active','休会')");
    await core.execute("INSERT INTO boom_members (hacomono_member_id, full_name, full_name_kana, birthday, status, member_type) VALUES ('t-lite-2','テスト タイ','テスト タイ','2013-01-01','withdrew','regular')");
    const all = await db.loadMembersLite();
    const m = all.find((x) => x.fullName === 'テスト キュウ');
    expect(m?.status).toBe('leave');
    expect(all.find((x) => x.fullName === 'テスト タイ')?.status).toBe('withdrew');
  });
});

describe('saveWork', () => {
  it('W番号は登録順・取りやめても詰めない・直しても変わらない', async () => {
    await seedRecitalTestEvent('t-db-work'); // W01〜W12 がある
    const a = await db.saveWork('t-db-work', workInput({ title: '新しい作品' }), 'TARO');
    expect(a.workCode).toBe('W13');
    await db.saveWork('t-db-work', workInput({ id: a.id, status: 'dropped' }), 'TARO');
    const b = await db.saveWork('t-db-work', workInput({ title: 'もう1つ' }), 'TARO');
    expect(b.workCode).toBe('W14');
    const again = await db.saveWork('t-db-work', workInput({ id: b.id, title: '名前を直した' }), 'TARO');
    expect(again.workCode).toBe('W14');
  });
  it('クラスと講師のつなぎは入れ直す（前の行は残らない）', async () => {
    const a = await db.saveWork('t-db-work', workInput({
      title: 'つなぎ', classes: [{ lesson_master_id: 1, label: '月曜A' }, { lesson_master_id: null, label: '火曜B' }],
      instructors: [{ instructor_id: 1, display_name: '先生A', role: 'choreo', sort_order: 1 }],
    }), 'TARO');
    await db.saveWork('t-db-work', workInput({
      id: a.id, title: 'つなぎ', classes: [{ lesson_master_id: 2, label: '水曜C' }],
      instructors: [{ instructor_id: null, display_name: '先生B', role: 'perform', sort_order: 1 }],
    }), 'TARO');
    const cls = await core.getAll('SELECT event_key, label FROM recital_work_classes WHERE work_id = ?', [a.id]);
    expect(cls.map((r) => [r.event_key, r.label])).toEqual([['t-db-work', '水曜C']]);
    const ins = await core.getAll('SELECT event_key, display_name, role FROM recital_work_instructors WHERE work_id = ?', [a.id]);
    expect(ins.map((r) => [r.event_key, r.display_name, r.role])).toEqual([['t-db-work', '先生B', 'perform']]);
    const works = await db.listWorks('t-db-work');
    expect(works.find((w) => w.id === a.id)?.title).toBe('つなぎ');
  });
});

describe('logChangeTx', () => {
  it('メール・電話・生年月日・インスタ・名義の値は残さない', async () => {
    await core.withWriteTx((tx) => db.logChangeTx(tx, {
      eventKey: 't-db-log', action: 'contact_edit', actor: 'TARO', reason: 'LINEで聞いた',
      before: { email: 'old@example.com', phone: '09011112222', last_name: 'テスト' },
      after: { email: 'new@example.com', phone: '09033334444', birthday: '2015-04-02', insta_handle: 'abc_1', bank_told_name: '4827 ヤマダ ハナコ', name: '4827 ヤマダ ハナコ', bank_told_amount: 26500 },
    }));
    const r = await core.getOne("SELECT before_json, after_json FROM recital_changes WHERE event_key='t-db-log'");
    const all = String(r.before_json) + String(r.after_json);
    for (const v of ['example.com', '0901111', '0903333', '2015-04-02', 'abc_1', 'ヤマダ ハナコ']) expect(all).not.toContain(v);
    expect(all).toContain('テスト');   // 名前（姓・名）は残してよい
    expect(all).toContain('26500');    // 「振り込みました」の金額は値のまま
  });
  it('redacts nested values', async () => {
    await core.withWriteTx((tx) => db.logChangeTx(tx, { eventKey: 't-db-log2', action: 'apply', actor: 'family', after: { people: [{ birthday: '2014-05-06', email: 'k@example.com' }] } }));
    const r = await core.getOne("SELECT after_json FROM recital_changes WHERE event_key='t-db-log2'");
    expect(String(r.after_json)).not.toContain('2014-05-06');
    expect(String(r.after_json)).not.toContain('k@example.com');
  });
  it('空の値は null・actor が空なら書かない', async () => {
    await core.withWriteTx((tx) => db.logChangeTx(tx, { eventKey: 't-db-log3', action: 'contact_edit', actor: 'TARO', after: { phone: '', email: 'x@example.com' } }));
    const r = await core.getOne("SELECT after_json FROM recital_changes WHERE event_key='t-db-log3'");
    expect(JSON.parse(String(r.after_json))).toEqual({ phone: null, email: '(伏せた)' });
    await expect(core.withWriteTx((tx) => db.logChangeTx(tx, { eventKey: 't-db-log3', action: 'apply', actor: ' ' }))).rejects.toThrow();
  });
});

describe('loadHouseholdDetail', () => {
  it('お金の式4行と見え方を出す（請求 26,500・入金なし → 仮受付）', async () => {
    await seedRecitalTestEvent('t-db-hh');
    const id = await seedHousehold('t-db-hh', { total: 26500, cast: 'in' });
    const d = await db.loadHouseholdDetail(id);
    expect(d?.money).toEqual({ total: 26500, paid: 0, remaining: 26500, overpaid: 0 });
    expect(d?.view).toBe('tentative');
    expect(await db.loadHouseholdDetail(999999)).toBeNull();
  });
});

describe('readMoneyViewTx と listWorkCounts', () => {
  it('入金・返す分 todo を式に入れ、tx の有る無しで同じ値になる', async () => {
    const { workIds } = await seedRecitalTestEvent('t-db-cnt');
    const paidId = await seedHousehold('t-db-cnt', { total: 26500, cast: 'in' });
    const unpaidId = await seedHousehold('t-db-cnt', { total: 26500, cast: 'in' });
    await seedHousehold('t-db-cnt', { total: 0, cast: 'maybe' });
    const now = new Date().toISOString();
    await core.execute(
      "INSERT INTO recital_payments (event_key, household_id, method, amount, paid_on, source, created_at) VALUES ('t-db-cnt', ?, 'bank', 30000, '2026-12-20', 'manual', ?)",
      [paidId, now],
    );
    await core.execute(
      "INSERT INTO recital_refunds (event_key, household_id, amount, reason_no, reason, status, created_at, created_by) VALUES ('t-db-cnt', ?, 3500, 1, '多い分', 'todo', ?, 'TARO')",
      [paidId, now],
    );
    await core.execute("UPDATE recital_people SET sns_ok = 0 WHERE household_id = ?", [unpaidId]);
    const noTx = await db.readMoneyViewTx(null, paidId);
    expect(noTx.m).toEqual({ total: 26500, paid: 26500, remaining: 0, overpaid: 0 });
    expect(noTx.refundTodo).toBe(3500);
    expect(noTx.view).toBe('complete');
    expect([noTx.hasIn, noTx.hasMaybe]).toEqual([true, false]);
    const inTx = await core.withWriteTx((tx) => db.readMoneyViewTx(tx, paidId));
    expect(inTx).toEqual(noTx);

    const counts = await db.listWorkCounts('t-db-cnt');
    expect(counts.get(workIds.W01)).toEqual({ in: 2, maybe: 1, paid: 1, unpaid: 1, snsNg: true });
    expect(counts.get(workIds.W02)).toEqual({ in: 0, maybe: 0, paid: 0, unpaid: 0, snsNg: false });
  });
});

describe('resetTestEvent', () => {
  it('is_test=0 の発表会を渡すと何も消さない（全部0）', async () => {
    await seedRecitalTestEvent('t-reset-live', { isTest: 0 });
    const hid = await seedHousehold('t-reset-live', { total: 26500, cast: 'in' });
    const r = await db.resetTestEvent('t-reset-live', { dryRun: false });
    expect(Object.values(r).every((n) => n === 0)).toBe(true);
    expect(await core.getOne('SELECT id FROM recital_households WHERE id=?', [hid])).not.toBeNull();
  });
  it('is_test=1 は入金〜変えた記録まで消し、設定・規則・作品・事前登録は残す／dryRun は数えるだけ', async () => {
    await seedRecitalTestEvent('t-reset-test');
    const hid = await seedHousehold('t-reset-test', { total: 26500, cast: 'in' });
    await core.execute("INSERT INTO recital_payments (event_key, household_id, method, amount, paid_on, source, created_at) VALUES ('t-reset-test', ?, 'cash', 26500, '2026-12-21', 'manual', ?)", [hid, new Date().toISOString()]);
    const dry = await db.resetTestEvent('t-reset-test', { dryRun: true });
    expect(dry.recital_payments).toBe(1); expect(dry.recital_households).toBe(1);
    expect(await core.getOne('SELECT id FROM recital_households WHERE id=?', [hid])).not.toBeNull();
    await db.resetTestEvent('t-reset-test', { dryRun: false });
    for (const t of ['recital_payments', 'recital_charges', 'recital_casts', 'recital_people', 'recital_households']) expect(Number((await core.getOne(`SELECT COUNT(*) n FROM ${t} WHERE event_key='t-reset-test'`)).n)).toBe(0);
    for (const t of ['recital_settings', 'recital_fee_rules', 'recital_works']) expect(Number((await core.getOne(`SELECT COUNT(*) n FROM ${t} WHERE event_key='t-reset-test'`)).n)).toBeGreaterThan(0);
  });
  it('消す順は 入金→返す分→開いている支払い→請求→出演→人→世帯→台帳→束→メール記録→変えた記録', () => {
    expect(recitalResetStatements('x').map((s) => s.table)).toEqual(['recital_payments', 'recital_refunds', 'recital_checkouts', 'recital_charges', 'recital_casts', 'recital_people', 'recital_households', 'recital_bank_rows', 'recital_imports', 'recital_mail_log', 'recital_changes']);
  });
});

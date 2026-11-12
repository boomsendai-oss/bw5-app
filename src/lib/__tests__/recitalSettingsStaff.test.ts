// BW6 発表会（段階1）の設定の画面（Task 18）の DB の試験（実 DB・試験用のファイル DB ./data/test_recital_settings_staff.db）。
// 料金の規則を直す（saveFeeRule）・特別な料金の事前登録（listFeePresets／saveFeePreset／deleteFeePreset）・会員を探す（searchMembers）。
// 試験ごとに自分の発表会のキー（t-set-…）の行だけを見る。名前は「試験」などの仮の字だけ。
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { RECITAL_EVENT, RECITAL_STAFF_NAMES, checkSettingValue } from '../recital';
import { feeCheck } from '../recitalFee';
import { seedEvent, seedRules, seedHousehold, seedMember } from './recitalStaffSeed';

// 設定の画面の Server Action（openPayAction）を呼ぶ試験のため、ログインの確かめと revalidatePath だけ mock する
vi.mock('@/lib/eventAuth', () => ({ isAuthorizedServer: async () => true }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const TEST_DB = './data/test_recital_settings_staff.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

let core: typeof import('../db');
let db: typeof import('../recitalDb');

beforeAll(async () => {
  for (const s of ['', '-shm', '-wal']) { try { rmSync(TEST_DB + s); } catch { /* 初回 */ } }
  core = await import('../db');
  db = await import('../recitalDb');
  await core.initDb();
  const dir = 'scripts/migrations';
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const stmt of sql.split(';').map((x) => x.trim()).filter(Boolean)) {
      try { await core.execute(stmt); } catch { /* 依存の無いものは飛ばす */ }
    }
  }
});

const NAME = RECITAL_STAFF_NAMES[0];

describe('料金の規則', () => {
  it('受付を開ける前（suspended=1）は直せる／開けたあと（suspended=0）は opened で拒む', async () => {
    await seedEvent('t-set-1', { settings: { suspended: '1' } }); await seedRules('t-set-1');
    const r = (await db.listFeeRules('t-set-1'))[0];
    expect(await db.saveFeeRule('t-set-1', { ...r, unit_amount: 16500 }, NAME)).toMatchObject({ ok: true });
    await core.execute(`UPDATE recital_settings SET value='0' WHERE event_key='t-set-1' AND key='suspended'`);
    expect(await db.saveFeeRule('t-set-1', { ...r, unit_amount: 16000 }, NAME)).toEqual({ ok: false, code: 'opened' });
  });
  it('一度開けてから止め直しても opened で拒む（entry_opened の記録がある）', async () => {
    await seedEvent('t-set-1b', { settings: { suspended: '1' } }); await seedRules('t-set-1b');
    await core.execute(`INSERT INTO recital_changes (event_key, action, actor, created_at) VALUES ('t-set-1b', 'entry_opened', 'TARO', ?)`, [new Date().toISOString()]);
    const r = (await db.listFeeRules('t-set-1b'))[0];
    expect(await db.saveFeeRule('t-set-1b', { ...r, unit_amount: 16500 }, NAME)).toEqual({ ok: false, code: 'opened' });
  });
  it('初めの8行で検算が合う（feeCheck の ok）', async () => {
    await seedEvent('t-set-2'); await seedRules('t-set-2');
    expect(feeCheck(await db.listFeeRules('t-set-2'), [26500, 32500, 35500, 38500, 41500], 8000)).toMatchObject({ ok: true, tentative: false });
  });

  // ここから下は、ブリーフの試験に足した分（直した値が本当に入る・形ちがい・世帯・範囲の重なり・名前）
  it('直した値が DB に入り、id は変わらない。id が無ければ足す', async () => {
    await seedEvent('t-set-1c'); await seedRules('t-set-1c');
    const r = (await db.listFeeRules('t-set-1c'))[0];
    expect(await db.saveFeeRule('t-set-1c', { ...r, unit_amount: 16500, label: '直した名前', is_tentative: 1 }, NAME)).toEqual({ ok: true, id: r.id });
    const after = (await db.listFeeRules('t-set-1c')).find((x) => x.id === r.id);
    expect(after).toMatchObject({ unit_amount: 16500, label: '直した名前', is_tentative: 1 });
    const { id: _drop, ...noId } = r;
    void _drop;
    const added = await db.saveFeeRule('t-set-1c', { ...noId, payer_role: 'family', item_code: 'coop_ticket', nth_from: 1, nth_to: 1 }, NAME);
    expect(added).toMatchObject({ ok: true });
    expect(await db.listFeeRules('t-set-1c')).toHaveLength(9);
  });
  it('形ちがいは invalid（役・種類・何作品目・金額・数）', async () => {
    await seedEvent('t-set-1d'); await seedRules('t-set-1d');
    const r = (await db.listFeeRules('t-set-1d'))[0];
    const bad = [
      { payer_role: 'boss' }, { item_code: 'cake' }, { nth_from: 0 }, { nth_to: 0 }, { unit_amount: -1 }, { qty: 0 },
      { unit_amount: 1.5 }, { label: '   ' },
    ];
    for (const b of bad) {
      expect(await db.saveFeeRule('t-set-1d', { ...r, ...b } as typeof r, NAME)).toEqual({ ok: false, code: 'invalid' });
    }
    expect((await db.listFeeRules('t-set-1d'))[0].unit_amount).toBe(r.unit_amount);
  });
  it('同じ役・同じ種類で、何作品目の範囲が重なる行は invalid（請求の行が入れかわり続けるのを防ぐ）', async () => {
    await seedEvent('t-set-1e'); await seedRules('t-set-1e');
    const rules = await db.listFeeRules('t-set-1e');
    const add3 = rules.find((x) => x.payer_role === 'first' && x.item_code === 'add_work' && x.nth_from === 3)!;
    // first の add_work は 2〜2 と 3〜。3〜 を 2〜 にすると 2〜2 と重なる
    expect(await db.saveFeeRule('t-set-1e', { ...add3, nth_from: 2 }, NAME)).toEqual({ ok: false, code: 'invalid' });
    const { id: _drop, ...noId } = add3;
    void _drop;
    expect(await db.saveFeeRule('t-set-1e', { ...noId, nth_from: 5, nth_to: 6 }, NAME)).toEqual({ ok: false, code: 'invalid' });
    // 自分の行どうしは重なりに数えない
    expect(await db.saveFeeRule('t-set-1e', { ...add3, unit_amount: 3000 }, NAME)).toMatchObject({ ok: true });
  });
  it('本番の発表会（is_test=0）は、世帯が1つでもあれば opened。試しの発表会（is_test=1）は世帯があっても直せる', async () => {
    await seedEvent('t-set-1f'); await seedRules('t-set-1f');
    await seedHousehold('t-set-1f', { people: [] });
    const r = (await db.listFeeRules('t-set-1f'))[0];
    expect(await db.saveFeeRule('t-set-1f', { ...r, unit_amount: 16500 }, NAME)).toEqual({ ok: false, code: 'opened' });
    await seedEvent('t-set-1g', { isTest: true }); await seedRules('t-set-1g');
    await seedHousehold('t-set-1g', { people: [] });
    const g = (await db.listFeeRules('t-set-1g'))[0];
    expect(await db.saveFeeRule('t-set-1g', { ...g, unit_amount: 16500 }, NAME)).toMatchObject({ ok: true });
  });
  it('名前が RECITAL_STAFF_NAMES に無ければ throw', async () => {
    await seedEvent('t-set-1h'); await seedRules('t-set-1h');
    const r = (await db.listFeeRules('t-set-1h'))[0];
    await expect(db.saveFeeRule('t-set-1h', r, 'だれか')).rejects.toThrow();
  });
  it('ほかの発表会の行の id では直せない（invalid）', async () => {
    await seedEvent('t-set-1i'); await seedRules('t-set-1i');
    await seedEvent('t-set-1j'); await seedRules('t-set-1j');
    const other = (await db.listFeeRules('t-set-1j'))[0];
    expect(await db.saveFeeRule('t-set-1i', { ...other, unit_amount: 1 }, NAME)).toEqual({ ok: false, code: 'invalid' });
    expect((await db.listFeeRules('t-set-1j'))[0].unit_amount).toBe(other.unit_amount);
  });
});

describe('特別な料金の事前登録', () => {
  it('1人の会員に1行（2回目は種類を直す）。消せる。会員が無ければ no_member', async () => {
    await seedEvent('t-set-3');
    const m = await seedMember({ fullName: '試験 太郎', kana: 'シケン タロウ', birthday: '2010-05-05' });
    await db.saveFeePreset('t-set-3', { memberId: m, feeClass: 'no_coop', memo: null }, NAME);
    await db.saveFeePreset('t-set-3', { memberId: m, feeClass: 'free', memo: '直した' }, NAME);
    const rows = await db.listFeePresets('t-set-3');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ memberId: m, feeClass: 'free', member: { id: m } });
    await db.deleteFeePreset('t-set-3', rows[0].id, NAME);
    expect(await db.listFeePresets('t-set-3')).toHaveLength(0);
    expect(await db.saveFeePreset('t-set-3', { memberId: 999999, feeClass: 'free', memo: null }, NAME)).toEqual({ ok: false, code: 'no_member' });
  });
  it('searchMembers：ひらがなのカナでも漢字でも見つかる', async () => {
    const m = await seedMember({ fullName: '試験 花子', kana: 'シケン ハナコ', birthday: null });
    expect((await db.searchMembers('しけんはなこ')).map((x) => x.id)).toContain(m);
    expect((await db.searchMembers('試験')).map((x) => x.id)).toContain(m);
    expect(await db.searchMembers('  ')).toEqual([]);
  });

  // ここから下は、ブリーフの試験に足した分
  it('ほかの発表会の行は消さない・見せない。メモと入れた人が入る', async () => {
    await seedEvent('t-set-4a'); await seedEvent('t-set-4b');
    const m = await seedMember({ fullName: '試験 次郎', kana: 'シケン ジロウ', birthday: null });
    await db.saveFeePreset('t-set-4a', { memberId: m, feeClass: 'tshirt_only', memo: 'メモ' }, NAME);
    await db.saveFeePreset('t-set-4b', { memberId: m, feeClass: 'no_coop', memo: null }, NAME);
    const a = await db.listFeePresets('t-set-4a');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ feeClass: 'tshirt_only', memo: 'メモ', createdBy: NAME, member: { fullName: '試験 次郎' } });
    const b = await db.listFeePresets('t-set-4b');
    await db.deleteFeePreset('t-set-4a', b[0].id, NAME);
    expect(await db.listFeePresets('t-set-4b')).toHaveLength(1);
  });
  it('会員が消えた行は member: null', async () => {
    await seedEvent('t-set-4c');
    const m = await seedMember({ fullName: '試験 三郎', kana: 'シケン サブロウ', birthday: null });
    await db.saveFeePreset('t-set-4c', { memberId: m, feeClass: 'free', memo: null }, NAME);
    await core.execute('DELETE FROM boom_members WHERE id = ?', [m]);
    expect((await db.listFeePresets('t-set-4c'))[0]).toMatchObject({ memberId: m, member: null });
  });
  it('名前が無い・種類がちがうは throw', async () => {
    await seedEvent('t-set-4d');
    const m = await seedMember({ fullName: '試験 四郎', kana: 'シケン シロウ', birthday: null });
    await expect(db.saveFeePreset('t-set-4d', { memberId: m, feeClass: 'free', memo: null }, '')).rejects.toThrow();
    await expect(db.saveFeePreset('t-set-4d', { memberId: m, feeClass: 'half' as 'free', memo: null }, NAME)).rejects.toThrow();
    await expect(db.deleteFeePreset('t-set-4d', 1, 'だれか')).rejects.toThrow();
  });
  it('searchMembers は20件まで', async () => {
    for (let i = 0; i < 22; i++) await seedMember({ fullName: `多数 ${i}`, kana: `タスウ ${i}`, birthday: null });
    expect(await db.searchMembers('たすう')).toHaveLength(20);
  });
});

describe('公式LINEのURL（line_url）は https:// だけ（公開ページで href に出るため）', () => {
  it('checkSettingValue', () => {
    expect(checkSettingValue('line_url', 'https://lin.ee/abc')).toBeNull();
    expect(checkSettingValue('line_url', '')).toBeNull();
    for (const v of ['javascript:alert(1)', 'http://lin.ee/abc', ' https://lin.ee/abc', 'https://', 'https://a b', 'line://x']) {
      expect(checkSettingValue('line_url', v)).not.toBeNull();
    }
  });
  it('saveRecitalSetting も同じく拒む', async () => {
    await seedEvent('t-set-5');
    await expect(db.saveRecitalSetting('t-set-5', 'line_url', 'javascript:alert(1)', NAME)).rejects.toThrow();
    await db.saveRecitalSetting('t-set-5', 'line_url', 'https://lin.ee/abc', NAME);
    expect((await db.getRecitalSettings('t-set-5')).line_url).toBe('https://lin.ee/abc');
  });
});

describe('支払いを開ける（openPayAction）：本番の発表会でカードが試しのモードなら開けない', () => {
  const answers = { replied: true, smokeOk: true };
  const payOkAt = async (ev: string) => (await db.getRecitalSettings(ev)).pay_ok_at;

  it('本番（is_test=0）で stripe_mode=test は拒む・pay_ok_at は空のまま', async () => {
    await seedEvent(RECITAL_EVENT.live, { settings: { stripe_mode: 'test', bank_text: '（試しの振込先）' } });
    const act = await import('../../app/staff/bw6/settings/actions');
    expect(await act.openPayAction(RECITAL_EVENT.live, answers, NAME)).toEqual({
      ok: false, error: '本番の発表会なのに、カードが試しのモードです。開けられません。',
    });
    expect(await payOkAt(RECITAL_EVENT.live)).toBeNull();
  });
  it('本番で stripe_mode=live なら開けられる', async () => {
    await core.execute("UPDATE recital_settings SET value = 'live' WHERE event_key = ? AND key = 'stripe_mode'", [RECITAL_EVENT.live]);
    const act = await import('../../app/staff/bw6/settings/actions');
    expect(await act.openPayAction(RECITAL_EVENT.live, answers, NAME)).toMatchObject({ ok: true });
    expect(await payOkAt(RECITAL_EVENT.live)).not.toBeNull();
  });
  it('試しの発表会（is_test=1）は stripe_mode=test のままで開けられる', async () => {
    await seedEvent(RECITAL_EVENT.smoke, { isTest: true, settings: { stripe_mode: 'test', bank_text: '（試しの振込先）' } });
    const act = await import('../../app/staff/bw6/settings/actions');
    expect(await act.openPayAction(RECITAL_EVENT.smoke, answers, NAME)).toMatchObject({ ok: true });
    expect(await payOkAt(RECITAL_EVENT.smoke)).not.toBeNull();
  });
});

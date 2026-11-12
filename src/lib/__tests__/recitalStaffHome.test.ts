// BW6 発表会（段階1）のスタッフの最初の画面の DB の試験（実 DB・試験用のファイル DB ./data/test_recital_staff_home.db）。
// 人数（countRecitalPeople）・見てほしいこと（listAttention／dismissAttention）・探す（searchHouseholds）・鍵で世帯を引く。
// 試験ごとに自分の発表会のキー（t-home-…）の行だけを見る。
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { RECITAL_STAFF_NAMES } from '../recital';
import { seedEvent, seedWork, seedHousehold, seedMember } from './recitalStaffSeed';

const TEST_DB = './data/test_recital_staff_home.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

let core: typeof import('../db');
let db: typeof import('../recitalDb');
let guard: typeof import('../recitalGuard');

beforeAll(async () => {
  for (const s of ['', '-shm', '-wal']) { try { rmSync(TEST_DB + s); } catch { /* 初回 */ } }
  core = await import('../db');
  db = await import('../recitalDb');
  guard = await import('../recitalGuard');
  await core.initDb();
  const dir = 'scripts/migrations';
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const stmt of sql.split(';').map((x) => x.trim()).filter(Boolean)) {
      try { await core.execute(stmt); } catch { /* 依存の無いものは飛ばす */ }
    }
  }
});

type CastSpec = [string, 'in' | 'maybe' | 'out'][];

describe('countRecitalPeople（05 5-9 の例 6行）', () => {
  it.each([
    // [名前, 人と出演, 請求の合計, 入金, 出る, 済み, まだ, 迷っている]
    ['1人1作品・未払い',          [[['W1', 'in']]],                         [26500], [],            1, 0, 1, 0],
    ['その世帯が払った',          [[['W1', 'in']]],                         [26500], [26500],       1, 1, 0, 0],
    ['兄1妹1を払い兄が1作品足した', [[['W1', 'in'], ['W2', 'in']], [['W1', 'in']]], [37500], [34500], 2, 0, 2, 0],
    ['その 3,000 を払った',       [[['W1', 'in'], ['W2', 'in']], [['W1', 'in']]], [37500], [34500, 3000], 2, 2, 0, 0],
    ['兄1妹1を払い妹がやめた',     [[['W1', 'in']], [['W1', 'out']]],          [26500], [34500],       1, 1, 0, 0],
    ['迷っているだけ（1人）',      [[['W1', 'maybe']]],                       [],      [],            0, 0, 0, 1],
  ] as [string, CastSpec[], number[], number[], number, number, number, number][])('%s', async (name, people, charges, payments, going, paid, unpaid, maybe) => {
    const ev = `t-home-${name}`;
    await seedEvent(ev);
    const w: Record<string, number> = { W1: await seedWork(ev, 'W01'), W2: await seedWork(ev, 'W02') };
    await seedHousehold(ev, { people: people.map((cs) => ({ casts: cs.map(([c, s]) => [w[c], s] as [number, 'in' | 'maybe' | 'out']) })), charges, payments });
    expect(await db.countRecitalPeople(ev)).toMatchObject({ going, paid, unpaid, maybe });
  });
  it('参加費なし・Tシャツ代だけの人は「出る人」に入れず、別の行（special）', async () => {
    await seedEvent('t-home-sp');
    const w = await seedWork('t-home-sp', 'W01');
    await seedHousehold('t-home-sp', { people: [{ casts: [[w, 'in']] }, { feeClass: 'free', casts: [[w, 'in']] }, { feeClass: 'tshirt_only', casts: [[w, 'in']] }], charges: [29500] });
    expect(await db.countRecitalPeople('t-home-sp')).toMatchObject({ going: 1, special: 2 });
  });
  it('試しの発表会の世帯は数えない／ほかの発表会の数も変えない', async () => {
    await seedEvent('t-home-live'); await seedEvent('t-home-test', { isTest: true });
    const a = await seedWork('t-home-live', 'W01'); const b = await seedWork('t-home-test', 'W01');
    await seedHousehold('t-home-live', { people: [{ casts: [[a, 'in']] }], charges: [26500] });
    await seedHousehold('t-home-test', { people: [{ casts: [[b, 'in']] }], charges: [26500] });
    expect((await db.countRecitalPeople('t-home-test')).going).toBe(0);
    expect((await db.countRecitalPeople('t-home-live')).going).toBe(1);
    expect((await db.countRecitalPeople('t-home-live')).countedAt).not.toBe('');
  });
});

describe('listAttention', () => {
  it('1番：カナと生年月日が同じ人が別の世帯 → 1件（後の世帯）。「問題なし」で消え、記録に個人の値を書かない', async () => {
    const ev = 't-home-a1'; await seedEvent(ev); const w = await seedWork(ev, 'W01');
    const p = { lastKana: 'テスト', firstKana: 'ハナコ', birthday: '2015-04-02', casts: [[w, 'in']] as [number, 'in'][] };
    await seedHousehold(ev, { people: [p] });
    const b = await seedHousehold(ev, { people: [p] });
    const items = (await db.listAttention(ev)).filter((i) => i.no === 1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ householdId: b.householdId, personId: b.personIds[0], href: `/staff/bw6/entries/${b.householdId}` });
    await db.dismissAttention(ev, { no: 1, householdId: b.householdId, personId: b.personIds[0] }, RECITAL_STAFF_NAMES[0]);
    expect((await db.listAttention(ev)).filter((i) => i.no === 1)).toHaveLength(0);
    const log = await core.getOne(`SELECT after_json FROM recital_changes WHERE event_key=? AND action='attention_dismissed'`, [ev]);
    expect(String(log?.after_json)).not.toContain('ハナコ');
  });
  it('1番：同じ電話 → 「ご家族」の文。まとめた世帯（merged）は出ない', async () => {
    const ev = 't-home-a1p'; await seedEvent(ev); const w = await seedWork(ev, 'W01');
    await seedHousehold(ev, { phone: '090-1111-2222', people: [{ casts: [[w, 'in']] }] });
    const b = await seedHousehold(ev, { phone: '09011112222', people: [{ casts: [[w, 'in']] }] });
    const items = (await db.listAttention(ev)).filter((i) => i.no === 1);
    expect(items).toHaveLength(1);
    expect(items[0].label).toContain('ご家族');
    expect(items[0]).toMatchObject({ householdId: b.householdId });
    await core.execute(`UPDATE recital_households SET status='merged' WHERE id=?`, [b.householdId]);
    expect((await db.listAttention(ev)).filter((i) => i.no === 1)).toHaveLength(0);
  });
  it('2番：照合が pending・unmatched の人は出る／manual・none は出ない', async () => {
    const ev = 't-home-a2'; await seedEvent(ev); const w = await seedWork(ev, 'W01');
    await seedHousehold(ev, {
      people: [
        { matchStatus: 'pending', casts: [[w, 'in']] },
        { matchStatus: 'unmatched', casts: [[w, 'in']] },
        { matchStatus: 'manual', casts: [[w, 'in']] },
        { matchStatus: 'none', casts: [[w, 'in']] },
      ],
    });
    const items = (await db.listAttention(ev)).filter((i) => i.no === 2);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.label.split('：')[0])).toEqual(['会員との照合の確認待ち', '会員と合わない申込']);
  });
  it('2番：auto で退会した会員と合った人は出る（manual になれば消える）', async () => {
    const ev = 't-home-a2w'; await seedEvent(ev); const w = await seedWork(ev, 'W01');
    const m = await seedMember({ fullName: '試験 退会', kana: 'シケン タイカイ', birthday: '2011-01-01', status: 'withdrew' });
    const h = await seedHousehold(ev, { people: [{ matchStatus: 'auto', memberId: m, casts: [[w, 'in']] }] });
    const items = (await db.listAttention(ev)).filter((i) => i.no === 2);
    expect(items).toHaveLength(1);
    expect(items[0].label).toContain('退会した会員と合いました');
    await core.execute(`UPDATE recital_people SET match_status='manual' WHERE id=?`, [h.personIds[0]]);
    expect((await db.listAttention(ev)).filter((i) => i.no === 2)).toHaveLength(0);
  });
  it('3番：事前登録とカナだけ合う（生年月日ちがい）・印が空 → 出る／印が入っていれば出ない／「問題なし」で消える', async () => {
    const ev = 't-home-a3'; await seedEvent(ev); const w = await seedWork(ev, 'W01');
    const m = await seedMember({ fullName: '試験 花', kana: 'テスト ハナ', birthday: '2010-01-01' });
    await core.execute(`INSERT INTO recital_fee_presets (event_key, member_id, fee_class, created_at) VALUES (?, ?, 'free', ?)`, [ev, m, new Date().toISOString()]);
    const h = await seedHousehold(ev, {
      people: [
        { lastKana: 'テスト', firstKana: 'ハナ', birthday: '2012-02-02', casts: [[w, 'in']] },
        { lastKana: 'テスト', firstKana: 'ハナ', birthday: '2012-03-03', feeClass: 'free', casts: [[w, 'in']] },
      ],
    });
    const items = (await db.listAttention(ev)).filter((i) => i.no === 3);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ householdId: h.householdId, personId: h.personIds[0] });
    await db.dismissAttention(ev, { no: 3, householdId: h.householdId, personId: h.personIds[0] }, RECITAL_STAFF_NAMES[1]);
    expect((await db.listAttention(ev)).filter((i) => i.no === 3)).toHaveLength(0);
  });
  it('4番：払うを開ける前は出ない／開けたら台帳の new の行と「振り込みましたのまま3日」の世帯が出る', async () => {
    const ev = 't-home-a4';
    await seedEvent(ev, { settings: { pay_open_at: '2026-12-15 12:00', pay_ok_at: '' } });
    const w = await seedWork(ev, 'W01');
    await core.execute(
      `INSERT INTO recital_bank_rows (event_key, created_at, row_date, dir, amount, kind, row_key, source, state) VALUES (?, ?, '2027-02-06', 'in', 26500, 'transfer', 'k-a4-1', 'csv', 'new')`,
      [ev, new Date().toISOString()],
    );
    const h = await seedHousehold(ev, { people: [{ casts: [[w, 'in']] }], charges: [26500] });
    await core.execute(`UPDATE recital_households SET bank_told_at='2027-02-05T01:00:00.000Z' WHERE id=?`, [h.householdId]);
    const now = new Date('2027-02-08T08:00:00+09:00');
    expect((await db.listAttention(ev, now)).filter((i) => i.no === 4)).toHaveLength(0);
    await core.execute(`UPDATE recital_settings SET value='2026-12-14 10:00' WHERE event_key=? AND key='pay_ok_at'`, [ev]);
    expect((await db.listAttention(ev, now)).filter((i) => i.no === 4)).toHaveLength(2);
    expect((await db.listAttention(ev, new Date('2027-02-07T12:00:00+09:00'))).filter((i) => i.no === 4)).toHaveLength(1);
  });
  it('5番：返す分 todo 6,000 → 「6,000円」の1件。残りもある世帯は「返す分を、足した作品に当てるか、決めてください」も出る', async () => {
    const ev = 't-home-a5'; await seedEvent(ev); const w = await seedWork(ev, 'W01');
    const h1 = await seedHousehold(ev, { people: [{ casts: [[w, 'in']] }], charges: [26500], payments: [32500], refundsTodo: [6000] });
    const h2 = await seedHousehold(ev, { people: [{ casts: [[w, 'in']] }], charges: [32500], payments: [32500], refundsTodo: [6000] });
    const items = (await db.listAttention(ev)).filter((i) => i.no === 5);
    const of1 = items.filter((i) => i.householdId === h1.householdId);
    const of2 = items.filter((i) => i.householdId === h2.householdId);
    expect(of1).toHaveLength(1);
    expect(of1[0].label).toContain('6,000円');
    expect(of2).toHaveLength(2);
    expect(of2.some((i) => i.label.startsWith('返す分を、足した作品に当てるか、決めてください'))).toBe(true);
  });
  it('8番：いちばん新しいメールが failed → 出る／その後 sent → 出ない', async () => {
    const ev = 't-home-a8'; await seedEvent(ev); const w = await seedWork(ev, 'W01');
    const h = await seedHousehold(ev, { people: [{ casts: [[w, 'in']] }] });
    const now = new Date().toISOString();
    await core.execute(`INSERT INTO recital_mail_log (event_key, household_id, mail_kind, status, created_at) VALUES (?, ?, 'received', 'failed', ?)`, [ev, h.householdId, now]);
    expect((await db.listAttention(ev)).filter((i) => i.no === 8)).toHaveLength(1);
    await core.execute(`INSERT INTO recital_mail_log (event_key, household_id, mail_kind, status, sent_at, created_at) VALUES (?, ?, 'received', 'sent', ?, ?)`, [ev, h.householdId, now, now]);
    expect((await db.listAttention(ev)).filter((i) => i.no === 8)).toHaveLength(0);
  });
  it('名前を選んでいない「問題なし」は拒む', async () => {
    await expect(db.dismissAttention('t-home-a1', { no: 1, householdId: 1 }, '')).rejects.toThrow('staff_name');
  });
});

describe('searchHouseholds と requireHouseholdByToken', () => {
  it('整理番号・ひらがなのカナ・連絡する人の漢字で見つかる／ほかの発表会は出ない', async () => {
    const ev = 't-home-s'; await seedEvent(ev); await seedEvent('t-home-s2'); const w = await seedWork(ev, 'W01');
    const h = await seedHousehold(ev, { ref: '1001', contactLast: '試験', people: [{ lastKana: 'テスト', firstKana: 'ジロウ', casts: [[w, 'in']] }] });
    await seedHousehold('t-home-s2', { ref: '1001', people: [{ casts: [] }] });
    for (const q of ['1001', '１００１', ' 1001 ', 'てすと', 'ジロウ', '試験']) {
      expect((await db.searchHouseholds(ev, q)).map((r) => r.id)).toEqual([h.householdId]);
    }
  });
  it('鍵の形がちがえば null、知らない鍵も null、正しい鍵なら世帯の中身', async () => {
    const ev = 't-home-t'; await seedEvent(ev);
    const h = await seedHousehold(ev, { people: [{ casts: [] }] });
    expect(await guard.requireHouseholdByToken('xyz')).toBeNull();
    expect(await guard.requireHouseholdByToken('0'.repeat(48))).toBeNull();
    expect((await guard.requireHouseholdByToken(h.token))?.household.id).toBe(h.householdId);
  });
});

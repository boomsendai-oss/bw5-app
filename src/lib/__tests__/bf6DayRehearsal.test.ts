// 当日の通し稽古(実DB)。一般部門をA/B 2サークル・ベスト8にした形で、
// 受付のくじ引き① → 予選通過 → くじ引き② → トーナメント → 優勝者まで一気に流す。
// ⚠️ 本番前の二重チェック用(TARO 2026-09-25「デバッグまで済ませて」)。
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, rmSync } from 'node:fs';

const TEST_DB = './data/test_bf6_rehearsal.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

let core: typeof import('../db');
let draw: typeof import('../bf6DrawDb');
let qual: typeof import('../bf6QualifierDb');
let screen: typeof import('../bf6ScreenDb');
let fmt: typeof import('../bf6Format');

const GENERAL = 18;
const KIDS = 32;

beforeAll(async () => {
  for (const s of ['', '-shm', '-wal']) { try { rmSync(TEST_DB + s); } catch { /* 初回 */ } }
  core = await import('../db');
  draw = await import('../bf6DrawDb');
  qual = await import('../bf6QualifierDb');
  screen = await import('../bf6ScreenDb');
  fmt = await import('../bf6Format');
  await core.initDb();

  // 当日の記録用テーブル(bf_draw / bf_match / bf_qualifier …)は schema.ts ではなく
  // scripts/migrations の .sql でしか作られない。本番と同じ形にするため全部当てる。
  const dir = 'scripts/migrations';
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${dir}/${f}`, 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const stmt of sql.split(';').map((x) => x.trim()).filter(Boolean)) {
      try { await core.execute(stmt); } catch { /* 依存の無いものは飛ばす */ }
    }
  }

  // 申込を作る(当日と同じ payment_status)
  const now = new Date().toISOString();
  for (let i = 1; i <= GENERAL + KIDS; i++) {
    const general = i <= GENERAL;
    await core.execute(
      `INSERT INTO bf_orders (buyer_name,email,phone,pay_method,payment_status,amount_total,edit_token,created_at,updated_at)
       VALUES (?,?,'','prepaid','paid',2000,?,?,?)`,
      [`親${i}`, `t${i}@example.com`, `tok${i}`, now, now]
    );
    const oid = Number((await core.getOne('SELECT MAX(id) AS id FROM bf_orders'))!.id);
    await core.execute(
      `INSERT INTO bf_order_items (order_id,item_type,dancer_name,dancer_kana,genre,rep,divisions,qty,unit_amount,sort_order)
       VALUES (?, 'entry', ?, ?, 'HIPHOP', '仙台', ?, 1, 2000, 0)`,
      [oid, general ? `G${i}` : `K${i}`, general ? `ジー${i}` : `ケー${i}`, JSON.stringify([general ? 'general' : 'kids'])]
    );
  }
});

async function itemIds(division: string): Promise<number[]> {
  const rows = await core.getAll(
    `SELECT id FROM bf_order_items WHERE item_type='entry' AND divisions LIKE ? ORDER BY id`,
    [`%${division}%`]
  );
  return rows.map((r) => Number(r.id));
}

describe('当日の通し稽古: 一般 A/B → ベスト8', () => {
  it('① 受付のくじ枠が エントリー数ぶん用意される', async () => {
    await draw.syncBf6Slots();
    const g = await draw.listBf6Slots('general', 'block');
    const k = await draw.listBf6Slots('kids', 'block');
    expect(g).toHaveLength(GENERAL);
    expect(k).toHaveLength(KIDS);
  });

  it('② 18名が引くと A9/B9 に割れ、番号は重複しない', async () => {
    const ids = await itemIds('general');
    const got: number[] = [];
    const blocks: string[] = [];
    for (const id of ids) {
      const r = await draw.claimBf6Slot('general', 'block', id);
      expect(r).not.toBeNull();
      got.push(r!.slotNo);
      blocks.push(r!.block!);
      await draw.checkInBf6(id);
    }
    expect(new Set(got).size).toBe(GENERAL);
    expect(blocks.filter((b) => b === 'A')).toHaveLength(9);
    expect(blocks.filter((b) => b === 'B')).toHaveLength(9);
  });

  it('③ 満枠のあとに来た人は枠なし(受付で分かる)', async () => {
    const extra = 9999;
    const r = await draw.claimBf6Slot('general', 'block', extra);
    expect(r).toBeNull();
  });

  it('④ 予選通過は各ブロック4名まで・合計8名', async () => {
    const rows = await draw.listBf6ReceptionEntrants();
    const general = rows.filter((e) => e.divisions.includes('general'));
    const blockOf = (e: (typeof general)[number]) =>
      e.draws.find((d) => d.division === 'general' && d.phase === 'block')?.block ?? null;
    const a = general.filter((e) => blockOf(e) === 'A').slice(0, 4);
    const b = general.filter((e) => blockOf(e) === 'B').slice(0, 4);
    for (const e of [...a, ...b]) await qual.setBf6Qualifier('general', e.itemId, true);
    const q = await qual.listBf6Qualifiers();
    expect(q.general.size).toBe(fmt.qualifierCountFor('general'));
    expect(fmt.qualifierPerBlockFor('general')).toBe(4);
  });

  it('⑤ くじ引き②はベスト8の8枠。通過者だけが引ける', async () => {
    await draw.ensureBf6ReceptionSlots('bracket');
    const slots = await draw.listBf6Slots('general', 'bracket');
    expect(slots).toHaveLength(8);
    const q = await qual.listBf6Qualifiers();
    for (const id of q.general) {
      const r = await draw.claimBf6Slot('general', 'bracket', id);
      expect(r).not.toBeNull();
      expect(r!.block).toBeUndefined(); // 本戦はブロックを持たない
    }
    const after = await draw.listBf6Slots('general', 'bracket');
    expect(after.filter((s) => s.itemId !== null)).toHaveLength(8);
  });

  it('⑥ トーナメントは 準々決勝4試合 → 準決勝 → 決勝', async () => {
    const r = await screen.reflectBf6Bracket('general');
    expect(r.ok).toBe(true);
    const qf = (await screen.listBf6Matches('general')).filter((m) => m.round === 'qf');
    expect(qf).toHaveLength(4);
    expect(qf.map((m) => [m.slotA, m.slotB])).toEqual([[1, 2], [3, 4], [5, 6], [7, 8]]);

    for (const m of qf) await screen.setBf6Winner('general', 'qf', m.matchNo, m.slotA!);
    const sf = (await screen.listBf6Matches('general')).filter((m) => m.round === 'sf');
    expect(sf).toHaveLength(2);
    expect(sf.map((m) => [m.slotA, m.slotB])).toEqual([[1, 3], [5, 7]]);

    for (const m of sf) await screen.setBf6Winner('general', 'sf', m.matchNo, m.slotA!);
    const f = (await screen.listBf6Matches('general')).filter((m) => m.round === 'f');
    expect(f).toHaveLength(1);
    expect([f[0].slotA, f[0].slotB]).toEqual([1, 5]);
  });

  it('⑦ 決勝の勝者はLEDに渡さない(発表までネタバレしない)', async () => {
    await screen.setBf6Winner('general', 'f', 1, 1);
    // LEDに渡す形(API /api/bf6/screen と同じ加工)で確かめる
    const { hideFinalWinner } = await import('../bf6ScreenAnim');
    const forScreen = await screen.listBf6ScreenMatches('general');
    const fin = hideFinalWinner(forScreen.matches).find((m) => m.round === 'f');
    expect(fin?.winnerSlot).toBeNull();
    // 操作卓・集計側は本物の勝者を持っている(発表に使う)
    expect(forScreen.matches.find((m) => m.round === 'f')?.winnerSlot).toBe(1);
    const champs = await screen.listBf6Champions();
    const g = champs.find((c) => c.division === 'general');
    expect(g?.dancerName).toBeTruthy();
    expect(g?.slotNo).toBe(1);
    expect(g?.runnerUp?.slotNo).toBe(5);
    expect(g?.runnerUp?.dancerName).toBeTruthy();
  });

  it('⑧ 小中学生も同じ形(A16/B16 → ベスト8)で通る', async () => {
    const ids = await itemIds('kids');
    const blocks: string[] = [];
    for (const id of ids) {
      const r = await draw.claimBf6Slot('kids', 'block', id);
      blocks.push(r!.block!);
    }
    expect(blocks.filter((b) => b === 'A')).toHaveLength(16);
    expect(blocks.filter((b) => b === 'B')).toHaveLength(16);
    expect(fmt.qualifierPerBlockFor('kids')).toBe(4);
    expect(fmt.bracketSizeFor('kids')).toBe(8);
  });
});

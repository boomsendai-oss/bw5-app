// 会員Instagram収集の DB 層の結合テスト。
// 承認したときだけ boom_members に書かれること / 取り消しで確実に外れることを実DBで確かめる
// (ここを取り違えると「消したはずのアカウントが会員に残る」= 任意で預かった約束を破ることになる)。
//
// 一時ファイルDBを使う。db.ts は最初の接続時に TURSO_DATABASE_URL を読むため import より先に設定する。
import { describe, it, expect, beforeAll } from 'vitest';
import { rmSync } from 'node:fs';

const TEST_DB = './data/test_instagram_collect.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

type DbMod = typeof import('../instagramCollectDb');
type Core = typeof import('../db');
let db: DbMod;
let core: Core;

const validated = (entries: { memberName: string; memberNameKana: string; handle: string; ownerKind: 'self' | 'father' | 'mother' | 'other' }[]) => ({
  entries,
  note: '',
});

beforeAll(async () => {
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      rmSync(TEST_DB + suffix);
    } catch {
      /* 初回は存在しない */
    }
  }
  core = await import('../db');
  db = await import('../instagramCollectDb');

  await core.execute(
    `INSERT INTO boom_members (id, hacomono_member_id, full_name, full_name_kana, status)
     VALUES (901, 'T901', '突合 花子', 'トツゴウ ハナコ', 'active')`
  );
  await core.execute(
    `INSERT INTO boom_members (id, hacomono_member_id, full_name, full_name_kana, status)
     VALUES (902, 'T902', '突合 次郎', 'トツゴウ ジロウ', 'active')`
  );
});

async function handleOf(memberId: number): Promise<string | null> {
  const row = await core.getOne('SELECT instagram_handle FROM boom_members WHERE id = ?', [memberId]);
  return (row?.instagram_handle as string) ?? null;
}

describe('instagramCollectDb', () => {
  it('送信だけでは boom_members に書かれない（承認キュー方式）', async () => {
    await db.createSubmission('token-a', validated([
      { memberName: '突合 花子', memberNameKana: 'トツゴウ ハナコ', handle: 'hanako_ig', ownerKind: 'self' },
    ]));

    expect(await handleOf(901)).toBeNull();

    const entries = await db.listForStaff();
    const mine = entries.find((e) => e.handle === 'hanako_ig');
    expect(mine).toBeTruthy();
    expect(mine!.match_state).toBe('pending');
    expect(mine!.suggestion.confidence).toBe('高');
    expect(mine!.suggestion.candidates[0].member_id).toBe(901);
  });

  it('承認すると boom_members に書かれる', async () => {
    const entries = await db.listForStaff();
    const mine = entries.find((e) => e.handle === 'hanako_ig')!;
    const r = await db.approveEntry(mine.id, 901, 'test');
    expect(r).toEqual({ ok: true });

    expect(await handleOf(901)).toBe('hanako_ig');
    const row = await core.getOne('SELECT instagram_owner_kind, instagram_linked_at FROM boom_members WHERE id = 901');
    expect(row?.instagram_owner_kind).toBe('self');
    expect(row?.instagram_linked_at).toBeTruthy();

    const after = (await db.listForStaff()).find((e) => e.id === mine.id)!;
    expect(after.match_state).toBe('approved');
    expect(after.matched_member_id).toBe(901);
  });

  it('存在しない会員IDでの承認は拒否され、DBは変わらない', async () => {
    const mine = (await db.listForStaff()).find((e) => e.handle === 'hanako_ig')!;
    const r = await db.approveEntry(mine.id, 999999, 'test');
    expect(r.ok).toBe(false);
    expect(await handleOf(901)).toBe('hanako_ig');
  });

  it('存在しない回答IDでの承認は拒否される', async () => {
    const r = await db.approveEntry(999999, 901, 'test');
    expect(r.ok).toBe(false);
  });

  it('紐付け解除で boom_members から外れ、回答は未処理へ戻る', async () => {
    const mine = (await db.listForStaff()).find((e) => e.handle === 'hanako_ig')!;
    expect(await db.unlinkEntry(mine.id)).toEqual({ ok: true });
    expect(await handleOf(901)).toBeNull();
    const after = (await db.listForStaff()).find((e) => e.id === mine.id)!;
    expect(after.match_state).toBe('pending');
    expect(after.matched_member_id).toBeNull();
  });

  it('本人が取り消すと、承認済みでも boom_members から外れて回答も消える', async () => {
    const mine = (await db.listForStaff()).find((e) => e.handle === 'hanako_ig')!;
    await db.approveEntry(mine.id, 901, 'test');
    expect(await handleOf(901)).toBe('hanako_ig');

    expect(await db.deleteByToken('token-a')).toBe(true);

    expect(await handleOf(901)).toBeNull();
    expect(await db.loadByToken('token-a')).toBeNull();
    expect((await db.listForStaff()).find((e) => e.handle === 'hanako_ig')).toBeUndefined();
  });

  it('本人が差し替えると、古い紐付けは外れて pending に戻る', async () => {
    await db.createSubmission('token-b', validated([
      { memberName: '突合 次郎', memberNameKana: 'トツゴウ ジロウ', handle: 'jiro_old', ownerKind: 'father' },
    ]));
    const e1 = (await db.listForStaff()).find((e) => e.handle === 'jiro_old')!;
    await db.approveEntry(e1.id, 902, 'test');
    expect(await handleOf(902)).toBe('jiro_old');

    const ok = await db.updateByToken('token-b', validated([
      { memberName: '突合 次郎', memberNameKana: 'トツゴウ ジロウ', handle: 'jiro_new', ownerKind: 'mother' },
    ]));
    expect(ok).toBe(true);

    // 古いアカウントは会員から外れている（残ると嘘の情報が居座る）
    expect(await handleOf(902)).toBeNull();
    const e2 = (await db.listForStaff()).find((e) => e.handle === 'jiro_new')!;
    expect(e2.match_state).toBe('pending');
    expect((await db.listForStaff()).find((e) => e.handle === 'jiro_old')).toBeUndefined();
  });

  it('存在しないトークンでは他人の回答を読めない・消せない', async () => {
    expect(await db.loadByToken('no-such-token')).toBeNull();
    expect(await db.deleteByToken('no-such-token')).toBe(false);
    expect(await db.updateByToken('no-such-token', validated([
      { memberName: '突合 花子', memberNameKana: 'トツゴウ ハナコ', handle: 'x', ownerKind: 'self' },
    ]))).toBe(false);
  });

  it('自分のトークンでは自分の回答だけ読める', async () => {
    const own = await db.loadByToken('token-b');
    expect(own).toBeTruthy();
    expect(own!.entries).toHaveLength(1);
    expect(own!.entries[0].handle).toBe('jiro_new');
  });

  it('設定は保存して読み戻せる（既定は受付中）', async () => {
    const before = await db.resolveSettings();
    expect(before.isOpen).toBe(true);
    expect(before.introMd).toContain('任意');

    await db.saveSettings({ isOpen: false, introMd: 'テスト文面' });
    const after = await db.resolveSettings();
    expect(after.isOpen).toBe(false);
    expect(after.introMd).toBe('テスト文面');

    await db.saveSettings({ isOpen: true, introMd: db.DEFAULT_INTRO_MD });
  });

  it('サマリが数を返す', async () => {
    const s = await db.summary();
    expect(s.total).toBeGreaterThanOrEqual(1);
    expect(s.linkedMembers).toBeGreaterThanOrEqual(0);
  });
});

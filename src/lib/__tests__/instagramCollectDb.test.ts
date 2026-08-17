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

type H = Partial<{ handleSelf: string | null; handleMother: string | null; handleFather: string | null }>;
const V = (name: string, kana: string, h: H) => ({
  memberName: name, memberNameKana: kana,
  handleSelf: h.handleSelf ?? null, handleMother: h.handleMother ?? null, handleFather: h.handleFather ?? null,
});
const validated = (entries: ReturnType<typeof V>[]) => ({ entries, note: '' });

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

/** 会員に入っている3枠をまとめて読む。 */
async function handlesOf(memberId: number) {
  const row = await core.getOne(
    'SELECT instagram_handle, instagram_handle_mother, instagram_handle_father, instagram_owner_kind FROM boom_members WHERE id = ?',
    [memberId]
  );
  return {
    self: (row?.instagram_handle as string) ?? null,
    mother: (row?.instagram_handle_mother as string) ?? null,
    father: (row?.instagram_handle_father as string) ?? null,
    kind: (row?.instagram_owner_kind as string) ?? null,
  };
}

describe('instagramCollectDb', () => {
  it('送信だけでは boom_members に書かれない（承認キュー方式）', async () => {
    await db.createSubmission('token-a', validated([V('突合 花子', 'トツゴウ ハナコ', { handleSelf: 'hanako_ig' })]));

    expect(await handleOf(901)).toBeNull();

    const entries = await db.listForStaff();
    const mine = entries.find((e) => e.mention_handle === 'hanako_ig');
    expect(mine).toBeTruthy();
    expect(mine!.match_state).toBe('pending');
    expect(mine!.suggestion.confidence).toBe('高');
    expect(mine!.suggestion.candidates[0].member_id).toBe(901);
  });

  it('承認すると boom_members に書かれる', async () => {
    const entries = await db.listForStaff();
    const mine = entries.find((e) => e.mention_handle === 'hanako_ig')!;
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
    const mine = (await db.listForStaff()).find((e) => e.mention_handle === 'hanako_ig')!;
    const r = await db.approveEntry(mine.id, 999999, 'test');
    expect(r.ok).toBe(false);
    expect(await handleOf(901)).toBe('hanako_ig');
  });

  it('存在しない回答IDでの承認は拒否される', async () => {
    const r = await db.approveEntry(999999, 901, 'test');
    expect(r.ok).toBe(false);
  });

  it('紐付け解除で boom_members から外れ、回答は未処理へ戻る', async () => {
    const mine = (await db.listForStaff()).find((e) => e.mention_handle === 'hanako_ig')!;
    expect(await db.unlinkEntry(mine.id)).toEqual({ ok: true });
    expect(await handleOf(901)).toBeNull();
    const after = (await db.listForStaff()).find((e) => e.id === mine.id)!;
    expect(after.match_state).toBe('pending');
    expect(after.matched_member_id).toBeNull();
  });

  it('本人が取り消すと、承認済みでも boom_members から外れて回答も消える', async () => {
    const mine = (await db.listForStaff()).find((e) => e.mention_handle === 'hanako_ig')!;
    await db.approveEntry(mine.id, 901, 'test');
    expect(await handleOf(901)).toBe('hanako_ig');

    expect(await db.deleteByToken('token-a')).toBe(true);

    expect(await handleOf(901)).toBeNull();
    expect(await db.loadByToken('token-a')).toBeNull();
    expect((await db.listForStaff()).find((e) => e.mention_handle === 'hanako_ig')).toBeUndefined();
  });

  it('本人が差し替えると、古い値は外れて新しい値に置き換わる', async () => {
    await db.createSubmission('token-b', validated([V('突合 次郎', 'トツゴウ ジロウ', { handleFather: 'jiro_old' })]));
    const e1 = (await db.listForStaff()).find((e) => e.mention_handle === 'jiro_old')!;
    await db.approveEntry(e1.id, 902, 'test');
    expect(await handlesOf(902)).toMatchObject({ self: null, mother: null, father: 'jiro_old', kind: 'father' });

    const ok = await db.updateByToken('token-b', validated([V('突合 次郎', 'トツゴウ ジロウ', { handleMother: 'jiro_new' })]));
    expect(ok).toBe(true);

    // 古い父の値は残らない。新しい母の値だけになる
    expect(await handlesOf(902)).toMatchObject({ self: null, mother: 'jiro_new', father: null, kind: 'mother' });
    // 自動承認の条件(カナ・漢字とも一致/候補1人/在籍中/既存値と衝突しない)を満たすので紐付け直される
    const e2 = (await db.listForStaff()).find((e) => e.mention_handle === 'jiro_new')!;
    expect(e2.match_state).toBe('approved');
    expect(e2.matched_by).toBe('auto');
    expect((await db.listForStaff()).find((e) => e.mention_handle === 'jiro_old')).toBeUndefined();
  });

  it('本人・母・父を一度に出すと3枠すべてが会員に入る', async () => {
    await core.execute(
      `INSERT INTO boom_members (id, hacomono_member_id, full_name, full_name_kana, status)
       VALUES (903, 'T903', '突合 三郎', 'トツゴウ サブロウ', 'active')`
    );
    const id = await db.createSubmission(
      'token-c',
      validated([V('突合 三郎', 'トツゴウ サブロウ', { handleSelf: 'sab', handleMother: 'sab_mom', handleFather: 'sab_dad' })])
    );
    const e = (await db.listForStaff()).find((x) => x.mention_handle === 'sab')!;
    expect(e.handle_self).toBe('sab');
    expect(e.handle_mother).toBe('sab_mom');
    expect(e.handle_father).toBe('sab_dad');
    // メンション先は本人が優先される
    expect(e.mention_kind).toBe('self');

    await db.approveEntry(e.id, 903, 'test');
    expect(await handlesOf(903)).toMatchObject({ self: 'sab', mother: 'sab_mom', father: 'sab_dad', kind: 'self' });
    await db.deleteByToken('token-c');
  });

  it('自動承認: 条件を満たせば人が押さずに会員へ入る', async () => {
    const id = await db.createSubmission(
      'token-d',
      validated([V('突合 三郎', 'トツゴウ サブロウ', { handleSelf: 'sab3', handleMother: 'sab3_mom' })])
    );
    const n = await db.autoApproveSubmission(id);
    expect(n).toBe(1);
    expect(await handlesOf(903)).toMatchObject({ self: 'sab3', mother: 'sab3_mom', father: null, kind: 'self' });
  });

  it('自動承認: 同姓同名が2人いたら通さない（pendingのまま）', async () => {
    await core.execute(
      `INSERT INTO boom_members (id, hacomono_member_id, full_name, full_name_kana, status)
       VALUES (904, 'T904', '同名 四郎', 'ドウメイ シロウ', 'active')`
    );
    await core.execute(
      `INSERT INTO boom_members (id, hacomono_member_id, full_name, full_name_kana, status)
       VALUES (905, 'T905', '同名 四郎', 'ドウメイ シロウ', 'active')`
    );
    const id = await db.createSubmission('token-e', validated([V('同名 四郎', 'ドウメイ シロウ', { handleSelf: 'shiro' })]));
    expect(await db.autoApproveSubmission(id)).toBe(0);
    const e = (await db.listForStaff()).find((x) => x.mention_handle === 'shiro')!;
    expect(e.match_state).toBe('pending');
    expect(e.suggestion.confidence).toBe('要確認');
  });

  it('自動承認: 会員に一致しなければ通さない', async () => {
    const id = await db.createSubmission('token-f', validated([V('居ない 人', 'イナイ ヒト', { handleSelf: 'nobody2' })]));
    expect(await db.autoApproveSubmission(id)).toBe(0);
  });

  it('存在しないトークンでは他人の回答を読めない・消せない', async () => {
    expect(await db.loadByToken('no-such-token')).toBeNull();
    expect(await db.deleteByToken('no-such-token')).toBe(false);
    expect(await db.updateByToken('no-such-token', validated([V('突合 花子', 'トツゴウ ハナコ', { handleSelf: 'x' })]))).toBe(false);
  });

  it('自分のトークンでは自分の回答だけ読める', async () => {
    const own = await db.loadByToken('token-b');
    expect(own).toBeTruthy();
    expect(own!.entries).toHaveLength(1);
    expect(own!.entries[0].handleMother).toBe('jiro_new');
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

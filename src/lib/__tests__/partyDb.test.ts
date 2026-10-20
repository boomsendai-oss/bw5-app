// パーティー申込のDB層の結合テスト(一時ファイルDB)。
// 先着の上限・30分の仮押さえ・Webhookの冪等・トークン1件読みを実DBで確かめる。
// db.ts は最初の接続時に TURSO_DATABASE_URL を読むため import より先に設定する。
import { describe, it, expect, beforeAll } from 'vitest';
import { rmSync } from 'node:fs';

const TEST_DB = './data/test_party.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

type DbMod = typeof import('../partyDb');
type Core = typeof import('../db');
type Logic = typeof import('../party');
let db: DbMod;
let core: Core;
let logic: Logic;

const EV = 'test2026';

const ticket = {
  buyerName: '木村 太郎', buyerKana: 'きむら たろう', email: 't@example.com', phone: '09012345678',
  payMethod: 'cash' as const, isMember: true, peopleCount: 3, infantCount: 1,
};
const entry = (team: string, payMethod: 'card' | 'cash' = 'cash') => ({
  buyerName: '代表', buyerKana: 'だいひょう', email: 'e@example.com', phone: '09011112222',
  payMethod, teamName: team, teamKana: 'てすと', genre: 'HIPHOP',
  members: [{ name: 'あ', grade: 'g1_3' }, { name: 'い', grade: 'jhs' }, { name: 'う', grade: 'adult' }],
  ticketCount: 0,
});

beforeAll(async () => {
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      rmSync(TEST_DB + suffix);
    } catch {
      /* 初回は存在しない */
    }
  }
  db = await import('../partyDb');
  core = await import('../db');
  logic = await import('../party');
});

describe('設定', () => {
  it('未保存なら既定値・保存すると読み戻せる', async () => {
    expect(await db.getPartySettings(EV)).toEqual(logic.DEFAULT_PARTY_SETTINGS);
    const s = { ...logic.DEFAULT_PARTY_SETTINGS, openAt: '2026-10-20T20:00', teamCap: 2 };
    await db.savePartySettings(EV, s);
    expect(await db.getPartySettings(EV)).toEqual(s);
    // 他イベントには影響しない
    expect((await db.getPartySettings('other')).teamCap).toBe(8);
  });
});

describe('参加申込', () => {
  it('当日現金は cash_due で確定・金額はサーバ計算・トークン1件だけ読める', async () => {
    const s = await db.getPartySettings(EV);
    const r = await db.createPartyTicket(EV, ticket, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountTotal).toBe(6000);
    const o = await db.loadPartyOrderByToken(r.token);
    expect(o?.status).toBe('cash_due');
    expect(o?.unitPrice).toBe(2000);
    expect(o?.infantCount).toBe(1);
    expect(o?.isMember).toBe(true);
    expect(await db.loadPartyOrderByToken('nope')).toBeNull();
  });
});

describe('出演エントリーの先着', () => {
  it('上限(2)に達したら3チーム目は断る', async () => {
    const s = await db.getPartySettings(EV); // teamCap=2
    const a = await db.createPartyEntry(EV, { ...entry('A'), ticketCount: 2 }, s);
    const b = await db.createPartyEntry(EV, entry('B', 'card'), s);
    expect(a.ok && b.ok).toBe(true);
    const c = await db.createPartyEntry(EV, entry('C'), s);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toMatch(/定員/);
    if (a.ok) {
      expect(a.amountTotal).toBe(10000); // 3人×出演料2000 + 入場チケット2枚×2000
      const o = await db.loadPartyOrderByToken(a.token);
      expect(o?.peopleCount).toBe(2);
      expect(o?.members.map((m) => m.name)).toEqual(['あ', 'い', 'う']);
      expect(o?.members[1].grade).toBe('jhs');
      expect(o?.teamKana).toBe('てすと');
    }
  });
  it('カード決済待ちが30分切れたら枠が空く', async () => {
    await core.execute("UPDATE party_orders SET expires_at = '2000-01-01T00:00:00.000Z' WHERE team_name = 'B'");
    expect(await db.countHoldingTeams(EV)).toBe(1);
    const s = await db.getPartySettings(EV);
    const c = await db.createPartyEntry(EV, entry('C'), s);
    expect(c.ok).toBe(true);
  });
});

describe('Webhook', () => {
  it('pending/expired を paid に・同じイベントは二度適用しない', async () => {
    const s = await db.getPartySettings(EV);
    const r = await db.createPartyTicket(EV, { ...ticket, payMethod: 'card', peopleCount: 2 }, s);
    if (!r.ok) throw new Error(r.error);
    const ev = { eventId: 'evt_x', type: 'checkout.session.completed', sessionId: 'cs_x', paymentIntentId: 'pi_x', orderId: r.orderId, amountTotal: 4000 };
    const first = await db.applyPartyWebhookEvent(ev, '{}');
    expect(first.status).toBe('paid');
    if (first.status === 'paid') expect(first.amountMismatch).toBe(false);
    expect((await db.applyPartyWebhookEvent(ev, '{}')).status).toBe('duplicate');
    expect((await db.loadPartyOrderByToken(r.token))?.status).toBe('paid');
  });
  it('取消済みの申込は paid に戻さない', async () => {
    const s = await db.getPartySettings(EV);
    const r = await db.createPartyTicket(EV, { ...ticket, payMethod: 'card' }, s);
    if (!r.ok) throw new Error(r.error);
    await db.setPartyOrderStatusStaff(r.orderId, 'canceled');
    const res = await db.applyPartyWebhookEvent(
      { eventId: 'evt_y', type: 'checkout.session.completed', sessionId: 'cs_y', paymentIntentId: '', orderId: r.orderId, amountTotal: 6000 },
      '{}'
    );
    expect(res.status).toBe('not_updated');
  });
});

describe('スタッフ操作と音源', () => {
  it('取消→元に戻すと支払方法に応じた状態へ', async () => {
    const s = await db.getPartySettings(EV);
    const r = await db.createPartyTicket(EV, ticket, s);
    if (!r.ok) throw new Error(r.error);
    expect(await db.setPartyOrderStatusStaff(r.orderId, 'canceled')).toBe(true);
    expect((await db.restorePartyOrderStaff(r.orderId, 8)).ok).toBe(true);
    expect((await db.loadPartyOrderByToken(r.token))?.status).toBe('cash_due');
  });
  it('音源はエントリー(確定)だけ保存できる', async () => {
    const s = await db.getPartySettings(EV);
    const t = await db.createPartyTicket(EV, ticket, s);
    if (!t.ok) throw new Error(t.error);
    expect(await db.savePartyAudio(t.token, 'https://x/a.mp3', 'a.mp3')).toBe(false);
    const list = await db.listPartyOrdersStaff(EV);
    const a = list.find((o) => o.teamName === 'A');
    const tok = (await core.getOne('SELECT edit_token FROM party_orders WHERE id = ?', [a!.id])).edit_token as string;
    expect(await db.savePartyAudio(tok, 'https://x/b.mp3', 'b.mp3')).toBe(true);
    expect((await db.loadPartyOrderByToken(tok))?.audioFilename).toBe('b.mp3');
  });
});

describe('音源の後日提出', () => {
  it('未提出の確定エントリーだけがリマインド対象・メールで控えを探せる', async () => {
    const missing = await db.listEntriesMissingAudio(EV);
    expect(missing.map((m) => m.order.teamName).sort()).toEqual(['C']); // A は音源提出済み・B は期限切れ
    await db.markAudioReminded(missing[0].order.id);
    expect((await db.loadPartyOrderByToken(missing[0].token))?.audioRemindedAt).not.toBe('');
    const found = await db.findConfirmedOrdersByEmail(EV, 'E@EXAMPLE.COM');
    expect(found.length).toBeGreaterThan(0);
    expect(await db.findConfirmedOrdersByEmail(EV, 'nobody@example.com')).toEqual([]);
  });
});

describe('不具合チェックで見つかった点の再発防止', () => {
  it('取消中に枠が埋まったエントリーは元に戻せない', async () => {
    const s = await db.getPartySettings(EV); // teamCap=2・確定チームは A と C
    const a = (await db.listPartyOrdersStaff(EV)).find((o) => o.teamName === 'A')!;
    expect(await db.setPartyOrderStatusStaff(a.id, 'canceled')).toBe(true);
    const d = await db.createPartyEntry(EV, entry('D'), s); // 空いた枠に D が入る
    expect(d.ok).toBe(true);
    const r = await db.restorePartyOrderStaff(a.id, s.teamCap);
    expect(r.ok).toBe(false);
  });
  it('仮押さえ切れの後の入金で上限を超えたら paid にしつつ印を残す', async () => {
    const b = (await db.listPartyOrdersStaff(EV)).find((o) => o.teamName === 'B')!; // expired
    const res = await db.applyPartyWebhookEvent(
      { eventId: 'evt_over', type: 'checkout.session.completed', sessionId: 'cs_over', paymentIntentId: '', orderId: b.id, amountTotal: 12000 },
      '{}'
    );
    expect(res.status).toBe('paid');
    if (res.status === 'paid') expect(res.overCap).toBe(true);
    const after = (await db.listPartyOrdersStaff(EV)).find((o) => o.id === b.id)!;
    expect(after.staffNote).toMatch(/上限を超えています/);
  });
  it('支払済みの申込への二重決済は状態を変えずに印を残す', async () => {
    const b = (await db.listPartyOrdersStaff(EV)).find((o) => o.teamName === 'B')!;
    const res = await db.applyPartyWebhookEvent(
      { eventId: 'evt_dup2', type: 'checkout.session.completed', sessionId: 'cs_dup2', paymentIntentId: '', orderId: b.id, amountTotal: 12000 },
      '{}'
    );
    expect(res.status).toBe('not_updated');
    const after = (await db.listPartyOrdersStaff(EV)).find((o) => o.id === b.id)!;
    expect(after.staffNote).toMatch(/二重入金/);
  });
  it('決済ページの期限まで仮押さえを延ばす(短くはしない)', async () => {
    const s = await db.getPartySettings(EV);
    await db.savePartySettings(EV, { ...s, teamCap: 99 });
    const r = await db.createPartyTicket(EV, { ...ticket, payMethod: 'card' }, s);
    if (!r.ok) throw new Error(r.error);
    const later = new Date(Date.now() + 59 * 60 * 1000).toISOString();
    await db.extendPartyHold(r.orderId, later);
    expect((await db.loadPartyOrderByToken(r.token))?.expiresAt).toBe(later);
    await db.extendPartyHold(r.orderId, new Date(Date.now() + 60 * 1000).toISOString());
    expect((await db.loadPartyOrderByToken(r.token))?.expiresAt).toBe(later);
  });
});

describe('音源提出ページの照合(メールアドレスかチーム名)', () => {
  it('メールアドレスかチーム名(表記ゆれ込み)で確定エントリーが見つかる', async () => {
    const byName = await db.findEntriesForAudio(EV, 'c');
    expect(byName.map((o) => o.teamName)).toEqual(['C']);
    expect((await db.findEntriesForAudio(EV, 'テスト')).length).toBeGreaterThan(0); // ふりがな「てすと」
    expect((await db.findEntriesForAudio(EV, 'E@EXAMPLE.COM')).length).toBeGreaterThan(0);
    expect(await db.findEntriesForAudio(EV, 'nobody@example.com')).toEqual([]);
    expect(await db.findEntriesForAudio(EV, '存在しないチーム')).toEqual([]);
  });
  it('IDで保存できるのは確定エントリーだけ', async () => {
    const c = (await db.findEntriesForAudio(EV, 'c'))[0];
    expect(await db.savePartyAudioById(c.id, 'https://x/c.mp3', 'c.mp3')).toBe(true);
    expect((await db.loadConfirmedEntryById(c.id))?.audioFilename).toBe('c.mp3');
    expect(await db.savePartyAudioById(999999, 'https://x/z.mp3', 'z.mp3')).toBe(false);
  });
});

describe('控えメールのまとめ送り直し', () => {
  it('印を付けた申込は次から対象外', async () => {
    const before = await db.listConfirmedOrdersForResend(EV);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every(({ token }) => /^[0-9a-f]{20,64}$/.test(token))).toBe(true);
    const first = before[0].order.id;
    await db.appendPartyStaffMark(first, db.CONFIRMATION_RESENT_MARK, 'テスト');
    const after = await db.listConfirmedOrdersForResend(EV);
    expect(after.map(({ order }) => order.id)).not.toContain(first);
    expect(after.length).toBe(before.length - 1);
  });
});

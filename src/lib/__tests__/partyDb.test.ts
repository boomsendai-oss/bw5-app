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
  payMethod, teamName: team, genre: 'HIPHOP', members: ['あ', 'い', 'う'],
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
    const a = await db.createPartyEntry(EV, entry('A'), s);
    const b = await db.createPartyEntry(EV, entry('B', 'card'), s);
    expect(a.ok && b.ok).toBe(true);
    const c = await db.createPartyEntry(EV, entry('C'), s);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toMatch(/定員/);
    if (a.ok) {
      expect(a.amountTotal).toBe(12000); // 3人×(2000+2000)
      const o = await db.loadPartyOrderByToken(a.token);
      expect(o?.members).toEqual(['あ', 'い', 'う']);
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
    expect(await db.restorePartyOrderStaff(r.orderId)).toBe(true);
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

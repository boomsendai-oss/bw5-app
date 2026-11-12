// BW6 発表会（段階1）の家庭の画面（13 申込フォーム・14 マイページ・15）の試験の種。*.test.ts ではないので単独では回らない。
// DB の部品（'../db'）は呼ぶ側が試験用の DB に向けたあとで import して渡す（環境変数を先に入れるため）。
import type { EntrySubmission } from '../recitalEntryDb';

type Core = typeof import('../db');

const SETTINGS: Record<string, string> = {
  entry_open_at: '2026-01-01 00:00',
  pay_open_at: '2026-01-01 00:00',
  pay_ok_at: '2026-01-01 00:00',
  suspended: '0',
};

// 設計書 03 3-4 の規則の表（recitalPublic.test.ts の RULES と同じ8行）
const FEE_RULES: [string, string, number, number | null, number, number, string][] = [
  ['first', 'base', 1, 1, 16000, 1, '出演料（本体）'],
  ['first', 'tshirt', 1, 1, 3000, 1, 'Tシャツ'],
  ['first', 'coop_ticket', 1, 1, 2500, 3, '協力チケット3枚'],
  ['first', 'add_work', 2, 2, 6000, 1, '2作品目'],
  ['first', 'add_work', 3, null, 3000, 1, '3作品目から（1作品ごと）'],
  ['family', 'base', 1, 1, 5000, 1, 'ご家族の参加費'],
  ['family', 'tshirt', 1, 1, 3000, 1, 'Tシャツ'],
  ['family', 'add_work', 2, null, 3000, 1, '2作品目から（1作品ごと）'],
];

const WORKS: { code: string; mode: string; status: string }[] = [
  ...['W01', 'W02', 'W03', 'W04', 'W05', 'W06'].map((code) => ({ code, mode: 'form', status: 'open' })),
  { code: 'W07', mode: 'form', status: 'draft' },
  { code: 'W08', mode: 'staff', status: 'open' },
];

/** 試しの発表会1つ・受付中の設定・料金の規則8行・作品8本（W01〜W06 form/open、W07 form/draft、W08 staff/open）。W01 に担当イントラ1人 */
export async function seedFamilyEvent(core: Core, ev: string): Promise<{ w: Record<string, number> }> {
  const now = new Date().toISOString();
  await core.execute(
    `INSERT INTO recital_events (event_key, title, show_date, rehearsal_date, venue, is_test, created_at) VALUES (?, '試し', '2027-04-11', '2027-04-10', '試しの会場', 1, ?)`,
    [ev, now],
  );
  for (const [key, value] of Object.entries(SETTINGS)) {
    await core.execute(
      `INSERT INTO recital_settings (event_key, key, value, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(event_key, key) DO UPDATE SET value = excluded.value`,
      [ev, key, value, now],
    );
  }
  for (const [i, [role, item, from, to, unit, qty, label]] of FEE_RULES.entries()) {
    await core.execute(
      `INSERT INTO recital_fee_rules (event_key, payer_role, item_code, nth_from, nth_to, unit_amount, qty, label, is_tentative, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [ev, role, item, from, to, unit, qty, label, i + 1, now],
    );
  }
  const w: Record<string, number> = {};
  for (const [i, x] of WORKS.entries()) {
    const r = await core.execute(
      `INSERT INTO recital_works (event_key, work_code, kind, title, entry_mode, fee_type, status, sort_order, created_at)
       VALUES (?, ?, 'class', ?, ?, 'counted', ?, ?, ?)`,
      [ev, x.code, `${x.code}の作品`, x.mode, x.status, i + 1, now],
    );
    w[x.code] = Number(r.lastInsertRowid);
  }
  await core.execute(
    `INSERT INTO recital_work_instructors (event_key, work_id, display_name, role, sort_order, created_at) VALUES (?, ?, 'イントラA', 'choreo', 1, ?)`,
    [ev, w.W01, now],
  );
  return { w };
}

/** 「送る」の形。連絡する人は ヤマダ タロウ・a@example.com・09012345678（contact で上書き）。出る人の姓は 山田／ヤマダ */
export function entryFor(
  ev: string,
  submitKey: string,
  people: { firstName: string; firstKana: string; birthday: string; works: { workId: number; status: 'in' | 'maybe' }[] }[],
  contact?: Partial<EntrySubmission['contact']>,
): EntrySubmission {
  return {
    eventKey: ev,
    submitKey,
    contact: { lastName: '山田', firstName: '太郎', lastKana: 'ヤマダ', firstKana: 'タロウ', email: 'a@example.com', phone: '09012345678', ...contact },
    people: people.map((p, i) => ({
      tempId: `p${i + 1}`, lastName: '山田', firstName: p.firstName, lastKana: 'ヤマダ', firstKana: p.firstKana, birthday: p.birthday,
      isContact: false, category: 'student' as const, tshirtSize: null, instaHandle: null, works: p.works,
    })),
    confirmNotFamily: false,
    confirmSamePerson: true,
    consentAccepted: true,
  };
}

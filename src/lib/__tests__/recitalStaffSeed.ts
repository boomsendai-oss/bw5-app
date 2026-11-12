// BW6 発表会（段階1）のスタッフの画面（16〜20）の試験の種。*.test.ts ではないので単独では回らない。
// '../db' は環境変数（試験用のファイル DB）を先に入れるため、必ず関数の中で await import する。
// 6 の recitalTestSeed.ts の seedHousehold とは引数の形がちがう。1つの試験ファイルで2つを混ぜない。
// 名前は「試験」「テスト」などの仮の字だけ（実名を書かない）。
import { randomBytes } from 'node:crypto';
import { RECITAL_SETTING_DEFAULTS } from '../recital';

let serial = 0;
const nextSerial = () => ++serial;

/** 発表会1行（is_test）と、設定の初めの値に o.settings を重ねた全部の設定 */
export async function seedEvent(ev: string, o?: { isTest?: boolean; settings?: Record<string, string> }): Promise<void> {
  const core = await import('../db');
  const now = new Date().toISOString();
  await core.execute(
    `INSERT INTO recital_events (event_key, title, show_date, rehearsal_date, venue, is_test, created_at) VALUES (?, '試し', '2027-04-11', '2027-04-10', '試しの会場', ?, ?)`,
    [ev, o?.isTest ? 1 : 0, now],
  );
  const settings = { ...RECITAL_SETTING_DEFAULTS, ...(o?.settings ?? {}) };
  for (const [key, value] of Object.entries(settings)) {
    await core.execute(
      `INSERT INTO recital_settings (event_key, key, value, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(event_key, key) DO UPDATE SET value = excluded.value`,
      [ev, key, value, now],
    );
  }
}

// 設計書 03 3-4 の規則の表の初めの8行
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

export async function seedRules(ev: string): Promise<void> {
  const core = await import('../db');
  const now = new Date().toISOString();
  for (const [i, [role, item, from, to, unit, qty, label]] of FEE_RULES.entries()) {
    await core.execute(
      `INSERT INTO recital_fee_rules (event_key, payer_role, item_code, nth_from, nth_to, unit_amount, qty, label, is_tentative, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [ev, role, item, from, to, unit, qty, label, i + 1, now],
    );
  }
}

/** 作品1つ。初めの値は status='open'・fee_type='counted'。返り値は id */
export async function seedWork(ev: string, code: string, o?: { feeType?: string; status?: string; title?: string }): Promise<number> {
  const core = await import('../db');
  const r = await core.execute(
    `INSERT INTO recital_works (event_key, work_code, kind, title, entry_mode, fee_type, status, sort_order, created_at)
     VALUES (?, ?, 'class', ?, 'form', ?, ?, 0, ?)`,
    [ev, code, o?.title ?? `${code}の作品`, o?.feeType ?? 'counted', o?.status ?? 'open', new Date().toISOString()],
  );
  return Number(r.lastInsertRowid);
}

export type SeedPerson = {
  lastKana?: string; firstKana?: string; birthday?: string | null; category?: string; feeClass?: string | null;
  matchStatus?: string; memberId?: number | null; casts: [workId: number, status: 'in' | 'maybe' | 'out'][];
};

const KANA_TAIL = 'アイウエオカキクケコ';

/**
 * 世帯1つと人・出演・請求・入金・返す分。電話と連絡する人の姓は世帯ごとに変える（渡した物でだけ「同じ」が当たるように）。
 * charges は1つの数ごとに base の行（1人目）。recompute: true なら charges を使わず recomputeChargesTx で作る（seedRules が要る）。
 */
export async function seedHousehold(
  ev: string,
  o: {
    ref?: string; phone?: string; contactLast?: string; contactLastKana?: string; email?: string; people: SeedPerson[];
    charges?: number[]; payments?: number[]; refundsTodo?: number[]; recompute?: boolean;
  },
): Promise<{ householdId: number; personIds: number[]; token: string }> {
  const core = await import('../db');
  const now = new Date().toISOString();
  const hs = await core.getOne('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM recital_households WHERE event_key = ?', [ev]);
  const seq = Number(hs.n);
  const token = randomBytes(24).toString('hex');
  const h = await core.execute(
    `INSERT INTO recital_households (event_key, seq, ref_code, contact_last_name, contact_first_name, contact_last_kana, contact_first_kana,
       email, phone, edit_token, submit_key, source, status, applied_at, created_at)
     VALUES (?, ?, ?, ?, '試し', ?, 'タメシ', ?, ?, ?, ?, 'form', 'active', ?, ?)`,
    [
      ev, seq, o.ref ?? String(1000 + seq), o.contactLast ?? `試験${seq}`, o.contactLastKana ?? `シケン${KANA_TAIL[seq % 10]}`,
      o.email ?? `s${seq}@example.com`, o.phone ?? `0900000${String(seq).padStart(4, '0')}`, token, `seed-${nextSerial()}`, now, now,
    ],
  );
  const householdId = Number(h.lastInsertRowid);

  const personIds: number[] = [];
  for (const [i, p] of o.people.entries()) {
    const ps = await core.getOne('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM recital_people WHERE event_key = ?', [ev]);
    const r = await core.execute(
      `INSERT INTO recital_people (event_key, seq, household_id, category, member_id, match_status, last_name, first_name, last_kana, first_kana,
         birthday, fee_class_override, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '試験', ?, ?, ?, ?, ?, 'active', ?)`,
      [
        ev, Number(ps.n), householdId, p.category ?? 'student', p.memberId ?? null, p.matchStatus ?? 'none', `人${i + 1}`,
        p.lastKana ?? 'シケン', p.firstKana ?? `ヒト${KANA_TAIL[i % 10]}`, p.birthday ?? null, p.feeClass ?? null, now,
      ],
    );
    const personId = Number(r.lastInsertRowid);
    personIds.push(personId);
    for (const [workId, status] of p.casts) {
      await core.execute(
        `INSERT INTO recital_casts (event_key, person_id, work_id, status, source, applied_at, created_at) VALUES (?, ?, ?, ?, 'form', ?, ?)`,
        [ev, personId, workId, status, now, now],
      );
    }
  }

  if (o.recompute) {
    const entry = await import('../recitalEntryDb');
    await core.withWriteTx((tx) => entry.recomputeChargesTx(tx, householdId, 'test'));
  } else {
    for (const amount of o.charges ?? []) {
      await core.execute(
        `INSERT INTO recital_charges (event_key, household_id, person_id, item_code, ref, label, qty, unit_amount, amount, status, created_at)
         VALUES (?, ?, ?, 'base', '', '試験の請求', 1, ?, ?, 'active', ?)`,
        [ev, householdId, personIds[0] ?? null, amount, amount, now],
      );
    }
  }
  for (const amount of o.payments ?? []) {
    await core.execute(
      `INSERT INTO recital_payments (event_key, household_id, method, amount, paid_on, source, created_at) VALUES (?, ?, 'cash', ?, '2026-12-20', 'manual', ?)`,
      [ev, householdId, amount, now],
    );
  }
  for (const amount of o.refundsTodo ?? []) {
    await core.execute(
      `INSERT INTO recital_refunds (event_key, household_id, amount, reason_no, reason, status, created_at, created_by) VALUES (?, ?, ?, 1, '試験の返金', 'todo', ?, 'test')`,
      [ev, householdId, amount, now],
    );
  }
  return { householdId, personIds, token };
}

/** 会員1人（boom_members の NOT NULL の列を全部うめる）。status の初めの値は 'active'。返り値は id */
export async function seedMember(o: { fullName: string; kana: string; birthday: string | null; status?: string }): Promise<number> {
  const core = await import('../db');
  const r = await core.execute(
    `INSERT INTO boom_members (hacomono_member_id, full_name, full_name_kana, birthday, status) VALUES (?, ?, ?, ?, ?)`,
    [`seed-${nextSerial()}`, o.fullName, o.kana, o.birthday, o.status ?? 'active'],
  );
  return Number(r.lastInsertRowid);
}

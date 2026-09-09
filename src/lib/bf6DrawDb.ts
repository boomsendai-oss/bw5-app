// BF6 抽選の保存と排他。計算は bf6Draw.ts、ここは永続化と同時実行制御だけ。
//
// ⚠️ 最重要: 受付はiPad3台で同時に進むため、2人が同じ枠を引く事故を防ぐ必要がある。
// 「空き枠をSELECTしてからUPDATE」だと2台の間に割り込みが入る。
// 必ず ①ランダムな空き枠の選択と ②確定 を1本のUPDATEにまとめ、
// item_id IS NULL の条件を付けて、取れた台だけが rowsAffected=1 になるようにする。
import { getAll, getOne, execute } from './db';
import { nowUtcIso } from './dateJst';
import { slotCountFor, slotsToAdd, blockOfSlot, type Bf6DrawDivision, type Bf6DrawPhase } from './bf6Draw';

/** 部門・フェーズのスロットを用意する。既にある分は消さない(再実行しても安全)。 */
export async function seedBf6Slots(
  division: Bf6DrawDivision,
  phase: Bf6DrawPhase,
  entrantCount: number
): Promise<{ created: number; total: number }> {
  const total = slotCountFor(division, phase, entrantCount);
  let created = 0;
  for (let n = 1; n <= total; n++) {
    const r = await execute(
      'INSERT INTO bf_draw (division, phase, slot_no) VALUES (?, ?, ?) ON CONFLICT(division, phase, slot_no) DO NOTHING',
      [division, phase, n]
    );
    if ((r.rowsAffected ?? 0) > 0) created += 1;
  }
  return { created, total };
}

export type DrawResult = {
  slotNo: number;
  block?: 'A' | 'B';
  alreadyDrawn: boolean;
};

/**
 * 空き枠からランダムに1つ引いて確定する。
 * 同じ item を二度引かせない(二度押しでも同じ枠を返す)。
 */
export async function claimBf6Slot(
  division: Bf6DrawDivision,
  phase: Bf6DrawPhase,
  itemId: number
): Promise<DrawResult | null> {
  const existing = await getOne(
    'SELECT slot_no FROM bf_draw WHERE division = ? AND phase = ? AND item_id = ?',
    [division, phase, itemId]
  );
  if (existing) {
    const slotNo = Number(existing.slot_no);
    return { slotNo, block: await blockFor(division, phase, slotNo), alreadyDrawn: true };
  }

  // 空き枠の選択と確定を1本のUPDATEで行う。取れなければ他の端末が先に取っている。
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = await execute(
      `UPDATE bf_draw
          SET item_id = ?, drawn_at = ?
        WHERE id = (SELECT id FROM bf_draw
                     WHERE division = ? AND phase = ? AND item_id IS NULL
                     ORDER BY RANDOM() LIMIT 1)
          AND item_id IS NULL`,
      [itemId, nowUtcIso(), division, phase]
    );
    if ((r.rowsAffected ?? 0) > 0) {
      const row = await getOne(
        'SELECT slot_no FROM bf_draw WHERE division = ? AND phase = ? AND item_id = ?',
        [division, phase, itemId]
      );
      if (!row) continue;
      const slotNo = Number(row.slot_no);
      return { slotNo, block: await blockFor(division, phase, slotNo), alreadyDrawn: false };
    }
    const free = await getOne(
      'SELECT COUNT(*) AS n FROM bf_draw WHERE division = ? AND phase = ? AND item_id IS NULL',
      [division, phase]
    );
    if (Number(free?.n ?? 0) === 0) return null; // 満席
  }
  return null;
}

async function blockFor(
  division: Bf6DrawDivision,
  phase: Bf6DrawPhase,
  slotNo: number
): Promise<'A' | 'B' | undefined> {
  if (phase !== 'block') return undefined;
  const row = await getOne('SELECT COUNT(*) AS n FROM bf_draw WHERE division = ? AND phase = ?', [division, phase]);
  return blockOfSlot(slotNo, Number(row?.n ?? 0));
}

export type SlotRow = { slotNo: number; itemId: number | null; dancerName: string | null; drawnAt: string | null };

export async function listBf6Slots(division: Bf6DrawDivision, phase: Bf6DrawPhase): Promise<SlotRow[]> {
  const rows = await getAll(
    `SELECT d.slot_no, d.item_id, d.drawn_at, i.dancer_name
       FROM bf_draw d
       LEFT JOIN bf_order_items i ON i.id = d.item_id
      WHERE d.division = ? AND d.phase = ?
      ORDER BY d.slot_no`,
    [division, phase]
  );
  return rows.map((r) => ({
    slotNo: Number(r.slot_no),
    itemId: r.item_id === null ? null : Number(r.item_id),
    dancerName: r.dancer_name ? String(r.dancer_name) : null,
    drawnAt: r.drawn_at ? String(r.drawn_at) : null,
  }));
}

/** 受付チェックイン。二度押しでも1回として扱う。 */
export async function checkInBf6(itemId: number, note?: string): Promise<void> {
  await execute(
    'INSERT INTO bf_checkin (item_id, checked_in_at, staff_note) VALUES (?, ?, ?) ON CONFLICT(item_id) DO NOTHING',
    [itemId, nowUtcIso(), note ?? null]
  );
}

export async function listBf6CheckedIn(): Promise<Set<number>> {
  const rows = await getAll('SELECT item_id FROM bf_checkin').catch(() => []);
  return new Set(rows.map((r) => Number(r.item_id)));
}

/**
 * キャンセルされた申込の抽選枠・受付を手放す。
 *
 * これを忘れると、キャンセル済みの人がトーナメント表とVS画面に残り続ける
 * (bf_draw は payment_status を見ていないため、自動では消えない)。
 * 枠は item_id = NULL に戻すだけで削除しない。組み合わせの番号を保つため。
 * bf_match は slot_no を参照しているので、空いた枠は不戦勝として扱われる。
 */
export async function releaseBf6EntrySlots(
  orderId: number
): Promise<{ slots: number; checkins: number }> {
  const items = await getAll(
    "SELECT id FROM bf_order_items WHERE order_id = ? AND item_type = 'entry'",
    [orderId]
  );
  let slots = 0;
  let checkins = 0;
  for (const it of items) {
    const itemId = Number(it.id);
    const d = await execute('UPDATE bf_draw SET item_id = NULL, drawn_at = NULL WHERE item_id = ?', [
      itemId,
    ]).catch(() => ({ rowsAffected: 0 }));
    const c = await execute('DELETE FROM bf_checkin WHERE item_id = ?', [itemId]).catch(() => ({
      rowsAffected: 0,
    }));
    slots += Number(d.rowsAffected ?? 0);
    checkins += Number(c.rowsAffected ?? 0);
  }
  return { slots, checkins };
}

export type ReceptionEntrant = {
  itemId: number;
  orderId: number;
  dancerName: string;
  performerName: string;
  grade: string;
  divisions: string[];
  paymentStatus: string;
  amountDue: number;
  checkedIn: boolean;
  draws: { division: string; phase: string; slotNo: number; block?: 'A' | 'B' }[];
};

/** 受付画面用。バトルエントリー1件=1行で、抽選結果とチェックイン状態を添える。 */
export async function listBf6ReceptionEntrants(): Promise<ReceptionEntrant[]> {
  const rows = await getAll(
    `SELECT i.id, i.order_id, i.dancer_name, i.performer_name, i.grade, i.divisions,
            o.payment_status, o.amount_total, o.pay_method
       FROM bf_order_items i
       JOIN bf_orders o ON o.id = i.order_id
      WHERE i.item_type = 'entry'
        AND o.payment_status IN ('paid','cash_due')
      ORDER BY i.dancer_name`
  );
  const checked = await listBf6CheckedIn();
  const draws = await getAll(
    `SELECT division, phase, slot_no, item_id FROM bf_draw WHERE item_id IS NOT NULL`
  ).catch(() => []);
  const totals = new Map<string, number>();
  for (const d of draws) {
    const k = `${d.division}|${d.phase}`;
    totals.set(k, (totals.get(k) ?? 0) + 1);
  }
  const slotTotals = await getAll('SELECT division, phase, COUNT(*) AS n FROM bf_draw GROUP BY division, phase').catch(() => []);
  const totalByKey = new Map(slotTotals.map((r) => [`${r.division}|${r.phase}`, Number(r.n)]));

  const byItem = new Map<number, ReceptionEntrant['draws']>();
  for (const d of draws) {
    const itemId = Number(d.item_id);
    const list = byItem.get(itemId) ?? [];
    const phase = String(d.phase);
    const slotNo = Number(d.slot_no);
    list.push({
      division: String(d.division),
      phase,
      slotNo,
      block: phase === 'block'
        ? blockOfSlot(slotNo, totalByKey.get(`${d.division}|${phase}`) ?? 0)
        : undefined,
    });
    byItem.set(itemId, list);
  }

  return rows.map((r) => ({
    itemId: Number(r.id),
    orderId: Number(r.order_id),
    dancerName: String(r.dancer_name ?? ''),
    performerName: String(r.performer_name ?? ''),
    grade: String(r.grade ?? ''),
    divisions: JSON.parse(String(r.divisions ?? '[]')) as string[],
    paymentStatus: String(r.payment_status),
    amountDue: r.payment_status === 'cash_due' ? Number(r.amount_total) : 0,
    checkedIn: checked.has(Number(r.id)),
    draws: byItem.get(Number(r.id)) ?? [],
  }));
}

/**
 * エントリー数に合わせてくじの本数を自動で合わせる。
 * 受付画面を開くたびに走らせる想定(締切まで人数が動くため)。
 *
 * ⚠️ 減らすことはしない。すでに引かれた番号が変わると当日の組み合わせが崩れる。
 * すでにある本数はそのまま、足りないぶんだけ末尾に足す。
 */
export async function syncBf6Slots(): Promise<
  { division: string; phase: string; added: number; total: number }[]
> {
  const rows = await getAll(
    `SELECT i.divisions FROM bf_order_items i JOIN bf_orders o ON o.id = i.order_id
      WHERE i.item_type = 'entry' AND o.payment_status IN ('paid','cash_due')`
  ).catch(() => []);
  const count: Record<string, number> = { beginner: 0, kids: 0, general: 0 };
  for (const r of rows) {
    for (const d of JSON.parse(String(r.divisions ?? '[]')) as string[]) {
      if (d in count) count[d] += 1;
    }
  }

  const existing = await getAll(
    'SELECT division, phase, COUNT(*) AS n, MAX(slot_no) AS mx FROM bf_draw GROUP BY division, phase'
  ).catch(() => []);
  const have = new Map(existing.map((r) => [`${r.division}|${r.phase}`, { n: Number(r.n), mx: Number(r.mx ?? 0) }]));

  // ビギナーは受付でトーナメント位置まで決まる。小中・一般は予選ブロック。
  const plan: { division: Bf6DrawDivision; phase: Bf6DrawPhase }[] = [
    { division: 'beginner', phase: 'bracket' },
    { division: 'kids', phase: 'block' },
    { division: 'general', phase: 'block' },
  ];

  const out: { division: string; phase: string; added: number; total: number }[] = [];
  for (const { division, phase } of plan) {
    const cur = have.get(`${division}|${phase}`) ?? { n: 0, mx: 0 };
    const add = slotsToAdd({ division, phase, entrantCount: count[division] ?? 0, existing: cur.n });
    for (let i = 1; i <= add; i += 1) {
      await execute(
        'INSERT INTO bf_draw (division, phase, slot_no) VALUES (?, ?, ?) ON CONFLICT(division, phase, slot_no) DO NOTHING',
        [division, phase, cur.mx + i]
      );
    }
    out.push({ division, phase, added: add, total: cur.n + add });
  }
  return out;
}

/**
 * その枠を引いた人の名前。まだ誰も引いていなければ null。
 * 受付の結果画面で「1回戦の相手」を出すために使う。
 */
export async function getBf6SlotHolder(
  division: Bf6DrawDivision,
  phase: Bf6DrawPhase,
  slotNo: number
): Promise<string | null> {
  const row = await getOne(
    `SELECT i.dancer_name FROM bf_draw d
       JOIN bf_order_items i ON i.id = d.item_id
      WHERE d.division = ? AND d.phase = ? AND d.slot_no = ? AND d.item_id IS NOT NULL`,
    [division, phase, slotNo]
  ).catch(() => null);
  return row?.dancer_name ? String(row.dancer_name) : null;
}

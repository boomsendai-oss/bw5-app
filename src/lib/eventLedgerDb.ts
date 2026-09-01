// イベント収支台帳のDBアクセス。src/lib/db.ts 経由のみ(createClient直呼び禁止)。
import { getAll, execute } from '@/lib/db';
import { summarizeEventFinance, type AppRevenue, type EventFinance, type LedgerKind } from '@/lib/eventLedger';

export type LedgerEntry = {
  id: number;
  eventKey: string;
  kind: LedgerKind;
  category: string;
  label: string;
  qty: number;
  unitAmount: number;
  amount: number;
  collected: boolean;
  note: string;
  sortOrder: number;
};

const nowIso = () => new Date().toISOString();

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- DB行 */
function toEntry(r: any): LedgerEntry {
  return {
    id: Number(r.id),
    eventKey: String(r.event_key),
    kind: (r.kind === 'income' ? 'income' : 'cost') as LedgerKind,
    category: String(r.category ?? ''),
    label: String(r.label),
    qty: Number(r.qty ?? 1),
    unitAmount: Number(r.unit_amount ?? 0),
    amount: Number(r.amount),
    collected: Number(r.collected) === 1,
    note: String(r.note ?? ''),
    sortOrder: Number(r.sort_order ?? 0),
  };
}

export async function listLedger(eventKey: string): Promise<LedgerEntry[]> {
  const rows = await getAll(
    'SELECT * FROM event_ledger WHERE event_key = ? ORDER BY kind DESC, sort_order, id',
    [eventKey]
  ).catch(() => []);
  return rows.map(toEntry);
}

export async function addLedgerEntry(e: Omit<LedgerEntry, 'id'>): Promise<number> {
  const now = nowIso();
  const r = await execute(
    `INSERT INTO event_ledger
       (event_key, kind, category, label, qty, unit_amount, amount, collected, note, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.eventKey, e.kind, e.category, e.label, e.qty, e.unitAmount, e.amount,
      e.collected ? 1 : 0, e.note, e.sortOrder, now, now]
  );
  return Number(r.lastInsertRowid ?? 0);
}

export async function updateLedgerEntry(
  id: number,
  patch: Partial<Pick<LedgerEntry, 'label' | 'qty' | 'unitAmount' | 'amount' | 'collected' | 'note' | 'category'>>
): Promise<boolean> {
  const sets: string[] = [];
  const args: (string | number)[] = [];
  const map: Record<string, string> = {
    label: 'label', qty: 'qty', unitAmount: 'unit_amount', amount: 'amount',
    note: 'note', category: 'category',
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (patch as Record<string, unknown>)[k];
    if (v !== undefined) { sets.push(`${col} = ?`); args.push(v as string | number); }
  }
  if (patch.collected !== undefined) { sets.push('collected = ?'); args.push(patch.collected ? 1 : 0); }
  if (sets.length === 0) return false;
  sets.push('updated_at = ?'); args.push(nowIso());
  args.push(id);
  const r = await execute(`UPDATE event_ledger SET ${sets.join(', ')} WHERE id = ?`, args);
  return Number(r.rowsAffected ?? 0) > 0;
}

export async function deleteLedgerEntry(id: number): Promise<boolean> {
  const r = await execute('DELETE FROM event_ledger WHERE id = ?', [id]);
  return Number(r.rowsAffected ?? 0) > 0;
}

/** BF6のアプリ売上を集計する(有効な注文=入金済み・当日現金のみ)。 */
export async function getBf6AppRevenue(): Promise<AppRevenue> {
  const items = await getAll(
    `SELECT i.item_type, SUM(i.qty * i.unit_amount) AS amt
       FROM bf_order_items i JOIN bf_orders o ON o.id = i.order_id
      WHERE o.payment_status IN ('paid','cash_due')
      GROUP BY i.item_type`
  ).catch(() => []);
  const by = new Map(items.map((r) => [String(r.item_type), Number(r.amt ?? 0)]));

  const orders = await getAll(
    `SELECT payment_status, SUM(amount_total) AS amt FROM bf_orders
      WHERE payment_status IN ('paid','cash_due') GROUP BY payment_status`
  ).catch(() => []);
  const byStatus = new Map(orders.map((r) => [String(r.payment_status), Number(r.amt ?? 0)]));

  return {
    entry: by.get('entry') ?? 0,
    ticketAdult: by.get('ticket_adult') ?? 0,
    ticketChild: by.get('ticket_child') ?? 0,
    stream: by.get('stream') ?? 0,
    paid: byStatus.get('paid') ?? 0,
    cashDue: byStatus.get('cash_due') ?? 0,
  };
}

export type Bf6Counts = {
  entrants: number;
  byDivision: { beginner: number; kids: number; general: number };
  capacity: { beginner: number; kids: number; general: number };
  ticketAdult: number;
  ticketChild: number;
  stream: number;
  waitlist: number;
};

export async function getBf6Counts(): Promise<Bf6Counts> {
  const entries = await getAll(
    `SELECT i.divisions FROM bf_order_items i JOIN bf_orders o ON o.id = i.order_id
      WHERE o.payment_status IN ('paid','cash_due') AND i.item_type = 'entry'`
  ).catch(() => []);
  const byDivision = { beginner: 0, kids: 0, general: 0 };
  for (const e of entries) {
    for (const d of JSON.parse(String(e.divisions ?? '[]')) as string[]) {
      if (d in byDivision) byDivision[d as keyof typeof byDivision] += 1;
    }
  }

  const tickets = await getAll(
    `SELECT i.item_type, SUM(i.qty) AS q FROM bf_order_items i JOIN bf_orders o ON o.id = i.order_id
      WHERE o.payment_status IN ('paid','cash_due') GROUP BY i.item_type`
  ).catch(() => []);
  const q = new Map(tickets.map((r) => [String(r.item_type), Number(r.q ?? 0)]));

  const wl = await getAll(
    "SELECT COUNT(*) AS n FROM bf_waitlist WHERE status IN ('waiting','offered')"
  ).catch(() => []);

  const cap = await getAll("SELECT value FROM bf_settings WHERE key = 'capacity'").catch(() => []);
  let capacity = { beginner: 16, kids: 32, general: 32 };
  try {
    if (cap[0]) capacity = { ...capacity, ...JSON.parse(String(cap[0].value)) };
  } catch { /* 既定値のまま */ }

  return {
    entrants: entries.length,
    byDivision,
    capacity,
    ticketAdult: q.get('ticket_adult') ?? 0,
    ticketChild: q.get('ticket_child') ?? 0,
    stream: q.get('stream') ?? 0,
    waitlist: Number(wl[0]?.n ?? 0),
  };
}

/** 台帳とアプリ売上を合わせた収支。スタッフ画面と読み取りコマンドの両方がこれを使う。 */
export async function getBf6Finance(): Promise<{
  finance: EventFinance;
  ledger: LedgerEntry[];
  counts: Bf6Counts;
}> {
  const [app, ledger, counts] = await Promise.all([
    getBf6AppRevenue(),
    listLedger('bf6'),
    getBf6Counts(),
  ]);
  const finance = summarizeEventFinance({
    app,
    ledger: ledger.map((r) => ({
      kind: r.kind, label: r.label, amount: r.amount, collected: r.collected,
    })),
  });
  return { finance, ledger, counts };
}

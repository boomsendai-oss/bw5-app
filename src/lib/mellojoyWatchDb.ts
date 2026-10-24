// メロジョイ在庫見張りのDB読み書き(テーブルは台帳 20261024_mellojoy_watch.sql)。
// 計算は mellojoyWatch.ts、ここは問い合わせだけ。
import { batch, getAll } from './db';
import type { EventKind, MjEvent, MjState } from './mellojoyWatch';

/* eslint-disable @typescript-eslint/no-explicit-any -- DBの行は動的キー */
function toState(r: any): MjState {
  return {
    variantId: String(r.variant_id),
    productTitle: String(r.product_title ?? ''),
    variantTitle: String(r.variant_title ?? ''),
    handle: String(r.handle ?? ''),
    price: String(r.price ?? ''),
    available: Number(r.available) === 1,
    lastChangeAt: String(r.last_change_at ?? ''),
    lastSeenAt: String(r.last_seen_at ?? ''),
    variantUpdatedAt: String(r.variant_updated_at ?? ''),
  };
}

export type MjEventRow = MjEvent & { id: number };

function toEvent(r: any): MjEventRow {
  return {
    id: Number(r.id),
    at: String(r.at ?? ''),
    kind: String(r.kind ?? '') as EventKind,
    variantId: String(r.variant_id ?? ''),
    productTitle: String(r.product_title ?? ''),
    price: String(r.price ?? ''),
    detail: String(r.detail ?? ''),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function loadMellojoyState(): Promise<MjState[]> {
  const rows = await getAll(`SELECT * FROM mellojoy_watch_state ORDER BY product_title, variant_title`);
  return rows.map(toState);
}

/** 状態の上書きと履歴の追記を1往復(1トランザクション)で行う */
export async function saveMellojoyRun(states: MjState[], events: MjEvent[]): Promise<void> {
  const stmts = [
    ...states.map((s) => ({
      sql: `INSERT INTO mellojoy_watch_state
              (variant_id, product_title, variant_title, handle, price, available, last_change_at, last_seen_at, variant_updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(variant_id) DO UPDATE SET
              product_title = excluded.product_title,
              variant_title = excluded.variant_title,
              handle = excluded.handle,
              price = excluded.price,
              available = excluded.available,
              last_change_at = excluded.last_change_at,
              last_seen_at = excluded.last_seen_at,
              variant_updated_at = excluded.variant_updated_at`,
      args: [
        s.variantId,
        s.productTitle,
        s.variantTitle,
        s.handle,
        s.price,
        s.available ? 1 : 0,
        s.lastChangeAt,
        s.lastSeenAt,
        s.variantUpdatedAt,
      ],
    })),
    ...events.map((e) => ({
      sql: `INSERT INTO mellojoy_watch_events (at, kind, variant_id, product_title, price, detail) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [e.at, e.kind, e.variantId, e.productTitle, e.price, e.detail],
    })),
  ];
  if (stmts.length === 0) return;
  await batch(stmts, 'write');
}

export async function listMellojoyEvents(limit = 50): Promise<MjEventRow[]> {
  const rows = await getAll(`SELECT * FROM mellojoy_watch_events ORDER BY at DESC, id DESC LIMIT ?`, [limit]);
  return rows.map(toEvent);
}

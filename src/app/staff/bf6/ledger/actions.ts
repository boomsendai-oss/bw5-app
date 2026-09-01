'use server';

// 収支台帳のスタッフ操作。/staff/* 配下のためproxyの認証で保護される(規約4.5)。
import { revalidatePath } from 'next/cache';
import { addLedgerEntry, updateLedgerEntry, deleteLedgerEntry } from '@/lib/eventLedgerDb';

function refresh() {
  revalidatePath('/staff/bf6/ledger');
  revalidatePath('/staff/bf6');
}

export async function staffAddLedger(input: {
  kind: 'income' | 'cost';
  category: string;
  label: string;
  qty: number;
  unitAmount: number;
  collected: boolean;
  note: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const label = input.label.trim();
  if (!label) return { ok: false, error: '項目名を入力してください' };
  const qty = Number.isFinite(input.qty) && input.qty > 0 ? Math.floor(input.qty) : 1;
  const unit = Math.round(Number(input.unitAmount));
  if (!Number.isFinite(unit) || unit < 0) return { ok: false, error: '金額が正しくありません' };
  await addLedgerEntry({
    eventKey: 'bf6',
    kind: input.kind,
    category: input.category.trim(),
    label,
    qty,
    unitAmount: unit,
    amount: qty * unit,
    collected: input.collected,
    note: input.note.trim(),
    sortOrder: 100,
  });
  refresh();
  return { ok: true };
}

export async function staffToggleLedgerCollected(id: number, collected: boolean): Promise<void> {
  await updateLedgerEntry(id, { collected });
  refresh();
}

export async function staffDeleteLedger(id: number): Promise<void> {
  await deleteLedgerEntry(id);
  refresh();
}

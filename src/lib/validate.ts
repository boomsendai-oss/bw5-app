// 入力バリデーション & 列挙値の唯一の正本（PR-2 / 技術的負債改修設計 2026-07-06）。
// route.ts が受け取る status/日付/列挙を無検証で受けてDBを狂わせる事故(M4/M5/M9/M13/M17)を防ぐ。
// 日付形式の検証は dateJst.ts(isIsoDate 等)を使う。ここは列挙値と状態遷移を担う。
import { NextResponse } from 'next/server';

/** lesson_instances.status の許可値。 */
export const INSTANCE_STATUSES = ['scheduled', 'cancelled', 'removed'] as const;

/** payroll_runs / studio_billing_runs.status の許可値。 */
export const PAYROLL_STATUSES = ['draft', 'confirmed', 'paid'] as const;

/**
 * 給与runの許可される状態遷移。studio_billing_runs も構造同型なので同じ表を適用。
 * paid はAPI経由では遷移不可(手動SQLのみ)。confirmed→draft は確定取り消しの運用実態として許可。
 */
export const PAYROLL_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['confirmed'],
  confirmed: ['draft', 'paid'],
  paid: [],
};

/** v が allowed のいずれかであることを型ガード付きで検証。 */
export function oneOf<T extends readonly string[]>(v: unknown, allowed: T): v is T[number] {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v);
}

/** from→to の遷移が許可されているか。未知の from は不許可。 */
export function canTransition(from: string, to: string): boolean {
  return (PAYROLL_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

/** 400 Bad Request の統一レスポンス。 */
export function badRequest(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
}

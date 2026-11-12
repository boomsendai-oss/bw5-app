// BW6 発表会のマイページの「金額とお支払い」（04 4-2）。お支払いの所は、いつもページのいちばん上に置く。
// 文は呼ぶ側が作って渡す（いちばん上の文は recitalMyPage.ts の myTopLines、払うの置き場の文は payAreaText）。
// children は「払う」を入れる口（Task 21）。ここには電話・メール・生年月日を渡さない（R-66）。
import type { ReactNode } from 'react';
import type { MoneySummary } from '@/lib/recital';
import { jpDate, yenJa } from '@/lib/recitalPublic';

const METHOD_LABEL: Record<string, string> = { card: 'カード', bank: '銀行振込', cash: '現金', adjust: '調整' };

export type MoneyBoxProps = {
  refCode: string;
  viewLabel: string;
  lines: string[];
  money: MoneySummary;
  breakdown: { who: string; items: { label: string; amount: number }[] }[];
  lastPaid: { method: string; paidOn: string } | null;
  manyPeople: boolean;
  hasMaybe: boolean;
  payText: string | null;
  children?: ReactNode;
};

export function MoneyBox(props: MoneyBoxProps) {
  const { refCode, viewLabel, lines, money, breakdown, lastPaid, manyPeople, hasMaybe, payText, children } = props;
  return (
    <section className="space-y-4 rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      <p className="text-sm">
        あなたの整理番号 <span className="text-lg font-bold tracking-wider">{refCode}</span>
      </p>
      <p className="text-2xl font-bold">{viewLabel}</p>
      {lines.length > 0 && (
        <div className="space-y-2 text-base leading-relaxed">
          {lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}

      <div className="border-t border-sand-200 pt-3">
        <p className="text-sm font-bold">ご家族の合計</p>
        <p className="text-3xl font-bold">{yenJa(money.total)}</p>
        {manyPeople && <p className="mt-1 text-xs">ご家族の中で、いちばんお得になる組み合わせで計算しています。</p>}
        {hasMaybe && <p className="mt-1 text-xs">迷っている作品は、金額に入っていません。</p>}
      </div>

      {breakdown.length > 0 && (
        <div className="space-y-3">
          {breakdown.map((b, i) => (
            <div key={i}>
              <p className="text-sm font-bold">{b.who}</p>
              <ul className="mt-1 space-y-1 text-sm">
                {b.items.map((it, j) => (
                  <li key={j} className="flex justify-between gap-3">
                    <span>{it.label}</span>
                    <span className="shrink-0">{yenJa(it.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <dl className="space-y-1 border-t border-sand-200 pt-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt>お支払いずみ</dt>
          <dd className="font-bold">{yenJa(money.paid)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>残り</dt>
          <dd className="text-lg font-bold">{yenJa(money.remaining)}</dd>
        </div>
      </dl>
      {lastPaid && (
        <p className="text-sm">
          {jpDate(lastPaid.paidOn)} {METHOD_LABEL[lastPaid.method] ?? lastPaid.method} でお支払い
        </p>
      )}

      {payText && <p className="rounded-xl border border-sand-300 bg-sand-100 px-4 py-3 text-center text-base font-bold">{payText}</p>}
      {children}
    </section>
  );
}

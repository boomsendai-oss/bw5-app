// BW6 発表会の「短い5行」（04 4-2・R-35）。発表会のページ・ご案内・マイページで同じ文を出す。文は fiveLines(settings) で作る。
export function FiveLines({ lines }: { lines: string[] }) {
  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4">
      <h2 className="text-base font-bold text-navy-700">お金のこと（大事な5つ）</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-navy-700">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ol>
    </section>
  );
}

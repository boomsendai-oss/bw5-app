'use client';

// 出演のご案内の「印刷する」ボタン。印刷には出さない。
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-xl border-2 border-navy-700 bg-white px-4 py-2 font-bold text-navy-700 print:hidden"
    >
      印刷する
    </button>
  );
}

// クルー画面の共通ヘッダー。メニューへ戻るだけの単純なもの。
// StaffPageHeader は /staff のナビ前提なのでここでは使わない。
import Link from 'next/link';

export default function CrewHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="border-b border-sand-200 bg-white px-4 py-3">
      <Link
        href="/bf6/crew"
        className="inline-flex items-center gap-1 rounded-full border border-sand-300 bg-sand-50 px-3 py-1.5 text-sm font-black text-navy-800 active:scale-95 active:bg-sand-200"
      >
        ← 戻る<span className="text-xs font-bold text-neutral-500">(メニュー)</span>
      </Link>
      <h1 className="mt-1 text-xl font-black text-navy-900">{title}</h1>
      {description && <p className="text-xs text-neutral-500">{description}</p>}
    </header>
  );
}

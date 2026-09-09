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
      <Link href="/bf6/crew" className="text-xs font-bold text-brand-600">
        ← 当日オペ
      </Link>
      <h1 className="mt-1 text-xl font-black text-navy-900">{title}</h1>
      {description && <p className="text-xs text-neutral-500">{description}</p>}
    </header>
  );
}

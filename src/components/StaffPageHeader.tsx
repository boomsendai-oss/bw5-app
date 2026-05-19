'use client';

import Link from 'next/link';

type Props = {
  title: string;          // 例: "🗂️ マスターデータ管理"
  description?: string;   // 副題 (省略可)
  rightExtra?: React.ReactNode; // 右側に追加要素 (任意)
};

/**
 * スタッフ画面共通ヘッダー
 * - 左: タイトル
 * - 右: 「🏠 ホームに戻る」ボタン
 *
 * 全 /staff/* 配下のページで使う想定。
 */
export default function StaffPageHeader({ title, description, rightExtra }: Props) {
  return (
    <header className="bg-white border-b border-orange-100 px-4 py-3 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-orange-600 truncate">{title}</h1>
          {description && (
            <p className="text-[10px] sm:text-xs text-neutral-500 mt-0.5 truncate">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {rightExtra}
          <Link
            href="/staff"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 text-xs sm:text-sm font-semibold border border-orange-200"
          >
            🏠 <span className="hidden sm:inline">ホームに戻る</span><span className="sm:hidden">ホーム</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

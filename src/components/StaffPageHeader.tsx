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
      <div className="max-w-6xl mx-auto flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-base sm:text-lg font-bold text-orange-600 truncate">{title}</h1>
            <Link
              href="/staff"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-orange-50 hover:bg-orange-100 text-orange-700 text-[10px] sm:text-xs font-semibold border border-orange-200"
            >
              🏠 <span className="hidden sm:inline">ホーム</span>
            </Link>
          </div>
          {description && (
            <p className="text-[10px] sm:text-xs text-neutral-500 mt-0.5 truncate">{description}</p>
          )}
        </div>
        {rightExtra && (
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto sm:shrink-0 mt-1 sm:mt-0">
            {rightExtra}
          </div>
        )}
      </div>
    </header>
  );
}

'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

type Props = {
  title: string;          // 例: "🗂️ マスターデータ管理"
  description?: string;   // 副題 (省略可)
  backHref?: string;      // 親ページへ戻る導線 (ドリルダウン時のみ)
  backLabel?: string;     // 戻るラベル (省略時 "戻る")
  rightExtra?: React.ReactNode; // 右側に追加要素 (任意)
};

/**
 * スタッフ画面共通ヘッダー (全 /staff/* 配下で使う想定)
 * - 任意: 親ページへの「← 戻る」導線 (backHref)
 * - タイトル + 副題
 * - 右: ページ固有の操作 (rightExtra)
 *
 * ホームへの導線はレイアウト側 (サイドバー / モバイルヘッダー) に集約したため
 * ここには置かない。色はBOOMブランド (navy/brand/sand)。
 */
export default function StaffPageHeader({
  title,
  description,
  backHref,
  backLabel,
  rightExtra,
}: Props) {
  return (
    <header className="bg-white border-b border-sand-200 px-4 py-3 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          {backHref && (
            <Link
              href={backHref}
              className="inline-flex items-center gap-1 text-[11px] sm:text-xs text-brand-600 hover:text-brand-700 mb-1"
            >
              <ArrowLeft className="size-3.5" />
              {backLabel ?? '戻る'}
            </Link>
          )}
          <h1 className="text-base sm:text-lg font-bold text-navy-800 truncate">{title}</h1>
          {description && (
            <p className="text-[11px] sm:text-xs text-neutral-500 mt-0.5 truncate">{description}</p>
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

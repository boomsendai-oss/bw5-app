'use client';

// スマホ側の完了/キャンセルページの「閉じる」ボタン。
// カメラアプリから開いたタブは window.close() がブロックされることがあるため、
// 効かなかった場合は手動で閉じる案内に切り替える。
import { useState } from 'react';

export default function CloseButton() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <p className="text-sm text-navy-500">このページはブラウザの「×」やタブ一覧から閉じてください</p>;
  }
  return (
    <button
      type="button"
      onClick={() => {
        window.close();
        // closeがブロックされた場合はページが残るので案内に切り替える
        setTimeout(() => setFailed(true), 400);
      }}
      className="rounded-2xl bg-navy-900 px-10 py-4 text-xl font-bold text-white"
    >
      このページを閉じる
    </button>
  );
}

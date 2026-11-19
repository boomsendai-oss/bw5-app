import type { ReactNode } from 'react';

// ⚠️ アプリ全体のbody下地はBW5オレンジ。iPhoneの上下セーフエリアに色の帯が出ないよう、
// /battle 配下だけ下地を黒にする(/bf7 と同じやり方)。
// タイトル・説明は回ごとに設定(DB)から作るので、各ページの generateMetadata で出す。
export default function BattleLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{'html, body { background: #0a0a0a !important; }'}</style>
      {children}
    </>
  );
}

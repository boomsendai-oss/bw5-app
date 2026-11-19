import type { ReactNode } from 'react';
import { Oswald, Yuji_Syuku, Zen_Kaku_Gothic_New } from 'next/font/google';

// BOOM DOJO(/dojo)の世界観: 夜の道場・和紙のカード・墨の見出し・朱のはんこ(TARO 2026-11-19 デザイン案A)。
// 日本語の筆文字(Yuji Syuku)・本文(Zen Kaku Gothic New)は字数が多いので先読みしない(preload:false)。
const brush = Yuji_Syuku({ weight: '400', subsets: ['latin'], preload: false, variable: '--font-dojo-brush', display: 'swap' });
const gothic = Zen_Kaku_Gothic_New({ weight: ['400', '700', '900'], subsets: ['latin'], preload: false, variable: '--font-dojo-gothic', display: 'swap' });
const num = Oswald({ weight: ['500', '700'], subsets: ['latin'], variable: '--font-dojo-num', display: 'swap' });

// ⚠️ アプリ全体のbody下地はBW5オレンジ。iPhoneの上下セーフエリアに色の帯が出ないよう、
// /dojo 配下だけ下地を道場の黒にする(/bf7 と同じやり方)。
// タイトル・説明は回ごとに設定(DB)から作るので、各ページの generateMetadata で出す。
export default function BattleLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${brush.variable} ${gothic.variable} ${num.variable} dojo`}>
      <style>{`
        html, body { background: #0d0906 !important; }
        .dojo { font-family: var(--font-dojo-gothic), 'Hiragino Sans', 'Noto Sans JP', sans-serif; color: #f3eadb; }
        .f-brush { font-family: var(--font-dojo-brush), 'Hiragino Mincho ProN', serif; }
        .f-num { font-family: var(--font-dojo-num), 'Oswald', sans-serif; }
      `}</style>
      {children}
    </div>
  );
}

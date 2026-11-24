import type { ReactNode } from 'react';
import { Oswald } from 'next/font/google';

// 特設ワークショップ(/ws)の見た目: 生成りの下地・濃紺の見出し・BOOMのティールをアクセントに。シンプルで上品に。
// ⚠️ アプリ全体のbodyは白文字・BW5オレンジの下地。/ws 配下だけ下地と文字色を明示する(/dojo と同じやり方)。
const num = Oswald({ weight: ['400', '500', '700'], subsets: ['latin'], variable: '--font-ws-num', display: 'swap' });

export default function WsLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${num.variable} ws`}>
      <style>{`
        html, body { background: #f6f3ee !important; }
        .ws { font-family: 'Hiragino Sans', 'Noto Sans JP', sans-serif; color: #16142b; }
        .f-num { font-family: var(--font-ws-num), 'Oswald', 'Bebas Neue', sans-serif; letter-spacing: 0.01em; }
      `}</style>
      {children}
    </div>
  );
}

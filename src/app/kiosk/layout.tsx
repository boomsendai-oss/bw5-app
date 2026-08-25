import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'BOOM GOODS - セルフレジ',
  robots: { index: false, follow: false },
};

// iPadのガイドアクセス運用前提: ピンチズーム無効・全画面
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#F4EDE5] text-navy-900 select-none">
      {/* ルートlayoutのbody背景(BW5オレンジ)がオーバースクロールで見えないように上書き */}
      <style>{`body { background: #F4EDE5; }`}</style>
      {children}
    </div>
  );
}

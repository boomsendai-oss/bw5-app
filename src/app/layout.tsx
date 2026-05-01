import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaMetaTags from "@/components/PwaMetaTags";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#f27a1a',
};

export const metadata: Metadata = {
  title: "BOOM WOP vol.5 | BOOM Dance School",
  description: "2026年5月5日（火・祝）太白区文化センター 楽楽楽ホール｜BOOM Dance School 発表会",
  openGraph: {
    title: "BOOM WOP vol.5",
    description: "BOOM Dance School 発表会 2026.05.05",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@300;400;500;600;700;800;900&family=Noto+Sans+JP:wght@300;400;500;600;700;900&display=swap" rel="stylesheet" />
        {/*
          Path-aware bootstrap script — runs synchronously BEFORE iOS Safari reads the manifest
          so that adding /staff/* or /admin to home screen creates a regular bookmark
          (not a PWA shortcut to "/"). Without this, iOS would have already cached the manifest
          before <PwaMetaTags>'s useEffect could remove it.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              function setup() { try {
                var p = location.pathname;
                var isStaff = p.indexOf('/staff/') === 0 || p.indexOf('/admin') === 0;
                var d = document, head = d.head;
                function rm(sel){var ns=head.querySelectorAll(sel);for(var i=0;i<ns.length;i++){ns[i].parentNode.removeChild(ns[i]);}}
                // Next.js が自動注入する manifest を含めて全削除 → 必要なものだけを再注入
                rm('link[rel="manifest"]');
                rm('meta[name="apple-mobile-web-app-capable"]');
                rm('meta[name="mobile-web-app-capable"]');
                rm('meta[name="apple-mobile-web-app-title"]');
                rm('link[rel="apple-touch-icon"]');
                function add(tag, attrs){var e = d.createElement(tag); for(var k in attrs){e.setAttribute(k, attrs[k]);} head.appendChild(e); return e;}
                if (!isStaff) {
                  add('link', {rel: 'manifest', href: '/manifest.webmanifest'});
                  add('meta', {name: 'apple-mobile-web-app-capable', content: 'yes'});
                  add('meta', {name: 'mobile-web-app-capable', content: 'yes'});
                  add('meta', {name: 'apple-mobile-web-app-title', content: 'BW5 App'});
                  add('link', {rel: 'apple-touch-icon', href: '/apple-touch-icon.png'});
                } else {
                  var manifestHref = p.indexOf('/staff/orders') === 0 ? '/staff-orders-manifest.webmanifest'
                                   : p.indexOf('/staff/backstage') === 0 ? '/staff-backstage-manifest.webmanifest'
                                   : p.indexOf('/admin') === 0 ? '/admin-manifest.webmanifest' : null;
                  if (manifestHref) add('link', {rel: 'manifest', href: manifestHref});
                  add('meta', {name: 'apple-mobile-web-app-capable', content: 'yes'});
                  add('meta', {name: 'mobile-web-app-capable', content: 'yes'});
                  var title = p.indexOf('/staff/orders') === 0 ? 'BW5 物販スタッフ'
                            : p.indexOf('/staff/backstage') === 0 ? 'BW5 舞台裏'
                            : p.indexOf('/admin') === 0 ? 'BW5 管理' : 'BW5';
                  var icon  = p.indexOf('/staff/orders') === 0 ? '/images/icon-staff-orders.png'
                            : p.indexOf('/staff/backstage') === 0 ? '/images/icon-staff-backstage.png'
                            : p.indexOf('/admin') === 0 ? '/images/icon-admin.png' : '/apple-touch-icon.png';
                  add('meta', {name: 'apple-mobile-web-app-title', content: title});
                  add('link', {rel: 'apple-touch-icon', href: icon});
                  // ユーザー閲覧中もページタイトルを上書き(iOSがバックエンドから掴むため)
                  d.title = title;
                }
              } catch(e) { console.error('PWA bootstrap failed:', e); } }
              // 即時実行 (head 解析中)
              setup();
              // DOM完成後にもう一度 (Next.js が遅れて挿入する manifest を確実に上書き)
              if (d.readyState === 'loading') {
                d.addEventListener('DOMContentLoaded', setup);
              }
              // load 後にもう一度 (iOS がここで manifest を読み始める前に最終状態を確定)
              window.addEventListener('load', setup);
            })();`,
          }}
        />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-full flex flex-col">
        <PwaMetaTags />
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

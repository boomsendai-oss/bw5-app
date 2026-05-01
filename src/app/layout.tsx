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
            __html: `(function(){var p=location.pathname;var isStaff=p.indexOf('/staff/')===0||p.indexOf('/admin')===0;if(!isStaff){var ml=document.createElement('link');ml.rel='manifest';ml.href='/manifest.webmanifest';document.head.appendChild(ml);var m1=document.createElement('meta');m1.name='apple-mobile-web-app-capable';m1.content='yes';document.head.appendChild(m1);var m2=document.createElement('meta');m2.name='mobile-web-app-capable';m2.content='yes';document.head.appendChild(m2);var m3=document.createElement('meta');m3.name='apple-mobile-web-app-title';m3.content='BW5 App';document.head.appendChild(m3);}else{var m1=document.createElement('meta');m1.name='apple-mobile-web-app-capable';m1.content='no';document.head.appendChild(m1);var m2=document.createElement('meta');m2.name='mobile-web-app-capable';m2.content='no';document.head.appendChild(m2);var t=p.indexOf('/staff/orders')===0?'BW5 物販スタッフ':p.indexOf('/staff/backstage')===0?'BW5 舞台裏':p.indexOf('/admin')===0?'BW5 管理':'BW5';var m3=document.createElement('meta');m3.name='apple-mobile-web-app-title';m3.content=t;document.head.appendChild(m3);var icon=p.indexOf('/staff/orders')===0?'/images/icon-staff-orders.png':p.indexOf('/staff/backstage')===0?'/images/icon-staff-backstage.png':p.indexOf('/admin')===0?'/images/icon-admin.png':'/apple-touch-icon.png';var li=document.createElement('link');li.rel='apple-touch-icon';li.href=icon;document.head.appendChild(li);}})();`,
          }}
        />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
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

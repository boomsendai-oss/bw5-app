import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaMetaTags from "@/components/PwaMetaTags";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

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
    <html lang="ja" className={cn("h-full antialiased", "font-sans", geist.variable)}>
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
                var isStaff = p.indexOf('/staff/') === 0 || p === '/staff' || p.indexOf('/admin') === 0;
                // vol.6 と vol.7 の告知ページは黒基調。オレンジのバー(BW5のtheme-color)が
                // 画面の上下に出ると台無しになるので、同じ扱いにする(TARO 2026-09-24)
                var isBf7 = p.indexOf('/bf7') === 0;
                var isBf6 = p.indexOf('/bf6') === 0 || isBf7;
                var isKiosk = p.indexOf('/kiosk') === 0;
                // 物販ページ(黒×黒Tシャツ等)は黒基調。BW5オレンジのバーが上下に出ると台無しになる
                var isDark = isBf6 || p.indexOf('/merch') === 0;
                var d = document, head = d.head;
                // ⚠️ head のタグは消さない。rel/name を書き換えて無効にするだけにする(自分で足したタグも同じ)。
                //    React は起動時に head にある同じ種類のタグを「自分のもの」として拾うことがあり、
                //    ここで消すと、Server Action のあとの再描画で React がそれを消そうとして removeChild で落ち、
                //    ボタンが無効のまま画面が固まる(LED操作卓で再現・2026-09-23。受付iPad・集金・入場受付で
                //    3回起きた「固まる」もこれが原因だった可能性が高い)。
                function rm(sel){var ns=head.querySelectorAll(sel);for(var i=0;i<ns.length;i++){var n=ns[i];
                  if(n.hasAttribute('rel'))n.setAttribute('rel','x-pwa-off');if(n.hasAttribute('name'))n.setAttribute('name','x-pwa-off');}}
                // Next.js が自動注入する manifest を含めて全削除 → 必要なものだけを再注入
                rm('link[rel="manifest"]');
                rm('meta[name="apple-mobile-web-app-capable"]');
                rm('meta[name="mobile-web-app-capable"]');
                rm('meta[name="apple-mobile-web-app-title"]');
                rm('link[rel="apple-touch-icon"]');
                // ⚠️ d.title = ... は使わない。<title> の中の文字(React が持っている)を別物に差し替えてしまい、
                //    再描画で React が古い文字を消そうとして removeChild で落ちる(2026-09-23)。中の文字だけ書き換える
                function setTitle(t){var el=d.querySelector('title');if(el&&el.firstChild&&el.firstChild.nodeType===3){if(el.firstChild.nodeValue!==t)el.firstChild.nodeValue=t;}else if(d.title!==t){d.title=t;}}
                function add(tag, attrs){var e = d.createElement(tag); for(var k in attrs){e.setAttribute(k, attrs[k]);} e.setAttribute('data-pwa-boot','1'); head.appendChild(e); return e;}
                // theme-color もパス別: スタッフ=ネイビー / BF6=黒(イベント配色) / それ以外=BW5オレンジ
                rm('meta[name="theme-color"]');
                add('meta', {name: 'theme-color', content: isKiosk ? '#F4EDE5' : isStaff ? '#101040' : isBf7 ? '#0b1b36' : isDark ? '#0a0a0a' : '#f27a1a'});
                // BF6当日: /bf6/crew=スタッフ / /bf6/checkin=出場者が自分で触るiPad。
                // どちらもホーム画面に入れて使うので、start_url を自分のページにした
                // 専用manifestを当てる。ここを通さないと main-manifest の start_url "/" が
                // 効いてBW5のトップに飛ぶ(2026-09-09 TARO報告)。
                var isCrew = p.indexOf('/bf6/crew') === 0;
                var isCheckin = p.indexOf('/bf6/checkin') === 0;
                if (isCrew || isCheckin) {
                  add('link', {rel: 'manifest', href: isCrew ? '/bf6-crew-manifest.webmanifest' : '/bf6-checkin-manifest.webmanifest'});
                  add('meta', {name: 'apple-mobile-web-app-capable', content: 'yes'});
                  add('meta', {name: 'mobile-web-app-capable', content: 'yes'});
                  add('meta', {name: 'apple-mobile-web-app-title', content: isCrew ? 'BF6 当日オペ' : 'BF6 受付'});
                  add('link', {rel: 'apple-touch-icon', href: isCrew ? '/images/icon-bf6-crew.png' : '/images/icon-bf6-checkin.png'});
                  setTitle(isCrew ? 'BF6 当日オペ' : 'BF6 受付');
                } else if (isKiosk) {
                  // 無人物販kiosk: iPadのホーム画面登録で専用アイコン/名前+全画面(standalone)
                  add('link', {rel: 'manifest', href: '/kiosk-manifest.webmanifest'});
                  add('meta', {name: 'apple-mobile-web-app-capable', content: 'yes'});
                  add('meta', {name: 'mobile-web-app-capable', content: 'yes'});
                  add('meta', {name: 'apple-mobile-web-app-title', content: 'BOOMレジ'});
                  add('link', {rel: 'apple-touch-icon', href: '/images/icon-kiosk.png'});
                } else if (!isStaff) {
                  add('link', {rel: 'manifest', href: '/main-manifest.webmanifest'});
                  add('meta', {name: 'apple-mobile-web-app-capable', content: 'yes'});
                  add('meta', {name: 'mobile-web-app-capable', content: 'yes'});
                  add('meta', {name: 'apple-mobile-web-app-title', content: isBf7 ? "BOOMER'S FIGHT 7" : isBf6 ? "BOOMER'S FIGHT" : 'BW5 App'});
                  add('link', {rel: 'apple-touch-icon', href: isBf7 ? '/bf7/icon.png' : isBf6 ? '/bf6/icon.png' : '/apple-touch-icon.png'});
                } else {
                  // /staff/orders と /staff/backstage は専用manifest、それ以外の /staff* はスタッフハブ用manifest
                  var manifestHref = p.indexOf('/staff/orders') === 0 ? '/staff-orders-manifest.webmanifest'
                                   : p.indexOf('/staff/backstage') === 0 ? '/staff-backstage-manifest.webmanifest'
                                   : p.indexOf('/staff') === 0 ? '/staff-manifest.webmanifest'
                                   : p.indexOf('/admin') === 0 ? '/admin-manifest.webmanifest' : null;
                  if (manifestHref) add('link', {rel: 'manifest', href: manifestHref});
                  add('meta', {name: 'apple-mobile-web-app-capable', content: 'yes'});
                  add('meta', {name: 'mobile-web-app-capable', content: 'yes'});
                  var title = p.indexOf('/staff/orders') === 0 ? 'BW5 物販スタッフ'
                            : p.indexOf('/staff/backstage') === 0 ? 'BW5 舞台裏'
                            : p.indexOf('/staff') === 0 ? 'BOOM Staff'
                            : p.indexOf('/admin') === 0 ? 'BW5 管理' : 'BW5';
                  var icon  = p.indexOf('/staff/orders') === 0 ? '/images/icon-staff-orders.png'
                            : p.indexOf('/staff/backstage') === 0 ? '/images/icon-staff-backstage.png'
                            : p.indexOf('/staff') === 0 ? '/images/icon-staff.png'
                            : p.indexOf('/admin') === 0 ? '/images/icon-admin.png' : '/apple-touch-icon.png';
                  add('meta', {name: 'apple-mobile-web-app-title', content: title});
                  add('link', {rel: 'apple-touch-icon', href: icon});
                  // ユーザー閲覧中もページタイトルを上書き(iOSがバックエンドから掴むため)
                  setTitle(title);
                }
              } catch(e) { console.error('PWA bootstrap failed:', e); } }
              // 即時実行 (head 解析中)
              setup();
              // DOM完成後にもう一度 (Next.js が遅れて挿入する manifest を確実に上書き)
              // ⚠️ d は setup() 内のローカル変数。ここ(外側)で使うと ReferenceError で以降の
              // 再適用が登録されなくなる(2026-05-02〜全ページで発生・2026-09-08修正)
              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setup);
              }
              // load 後にもう一度 (iOS がここで manifest を読み始める前に最終状態を確定)
              window.addEventListener('load', setup);
              // 起動後にもう一度。React がメタデータを後から差し込むことがあり、上の2回より後に来た分を無効にする
              // (タグを消さない方式にしたため、後から来た分はここで rel/name を書き換えて止める・2026-09-23)
              window.addEventListener('load', function(){ setTimeout(setup, 1500); });
            })();`,
          }}
        />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-full flex flex-col">
        <PwaMetaTags />
        {children}
        <Toaster richColors position="top-right" />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

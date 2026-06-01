import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // 給与明細PDF生成(payslip.ts)は実行時に src/assets のロゴ画像と日本語フォント(.ttf)を
  // fs で読む。Next の自動トレースが動的パスを取りこぼすと Vercel 本番で空白になるため、
  // 該当APIルートに明示的に同梱する。
  outputFileTracingIncludes: {
    "/api/staff/payroll/**": ["./src/assets/**"],
  },
  // Allow LAN dev access from any origin — dev-only; ignored in production.
  // Wildcards mean any device on any network the dev machine is reachable from
  // (LAN, hotspot, venue Wi-Fi) can hit the dev server. Production
  // (bw5-app.vercel.app) is unaffected by this setting.
  allowedDevOrigins: ["*"],
  images: {
    // Vercel Blob 上の舞台裏フォトを Next/Image で最適化（WebP化・リサイズ）して配信する。
    // Blob からの直接転送ではなく Vercel の最適化キャッシュ経由になり、転送量を大幅削減。
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "drive.google.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 日
  },
};

export default nextConfig;

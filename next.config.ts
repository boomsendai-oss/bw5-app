import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow LAN dev access from any origin — dev-only; ignored in production.
  // Wildcards mean any device on any network the dev machine is reachable from
  // (LAN, hotspot, venue Wi-Fi) can hit the dev server. Production
  // (bw5-app.vercel.app) is unaffected by this setting.
  allowedDevOrigins: ["*"],
};

export default nextConfig;

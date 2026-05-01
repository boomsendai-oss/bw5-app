import type { Metadata } from "next";

// Staff pages: do NOT inherit the PWA manifest from root.
// When staff add this URL to home screen, iOS should treat it as a regular
// bookmark that opens the exact URL, not as a PWA shortcut to '/'.
export const metadata: Metadata = {
  title: "BW5 Staff",
  // Disable manifest inheritance for this segment
  manifest: undefined,
  other: {
    "apple-mobile-web-app-capable": "no",
    "mobile-web-app-capable": "no",
  },
};

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/*
        Override the root layout's manifest by injecting a no-op tag.
        Next.js doesn't have a built-in way to *remove* a parent <link>,
        so we point to a dummy per-route manifest with start_url = current URL.
        See public/staff-manifest.json.
      */}
      {children}
    </>
  );
}

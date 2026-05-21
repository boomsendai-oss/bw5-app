// ─────────────────────────────────────────────────────────────
// 演目別 写真 manifest ローダー
// rclone lsjson から生成された JSON ファイルを集約
// ─────────────────────────────────────────────────────────────
import M1 from "./M1.json";
import M3 from "./M3.json";
import M4 from "./M4.json";
import M5 from "./M5.json";
import M6 from "./M6.json";
import M7 from "./M7.json";
import M8 from "./M8.json";
import M9 from "./M9.json";
import M10 from "./M10.json";
import M11 from "./M11.json";
import M14 from "./M14.json";
import M15 from "./M15.json";
import M16 from "./M16.json";
import M17 from "./M17.json";
import M19 from "./M19.json";
import M20 from "./M20.json";
import M21 from "./M21.json";
import M22 from "./M22.json";
import M23 from "./M23.json";
import M24 from "./M24.json";
import M27 from "./M27.json";
import M28 from "./M28.json";
import M29 from "./M29.json";
import M30 from "./M30.json";
import M31 from "./M31.json";
import M33 from "./M33.json";
import M34 from "./M34.json";
import M35 from "./M35.json";
import M36 from "./M36.json";
import M37 from "./M37.json";
import M38 from "./M38.json";

export interface PhotoFile {
  id: string;
  name: string;
  mime: string;
  size: number;
}

const MANIFESTS: Record<string, PhotoFile[]> = {
  M1, M3, M4, M5, M6, M7, M8, M9, M10, M11,
  M14, M15, M16, M17, M19, M20, M21, M22, M23, M24,
  M27, M28, M29, M30, M31, M33, M34, M35, M36, M37, M38,
};

export function getPhotoManifest(mId: string): PhotoFile[] | null {
  return MANIFESTS[mId] ?? null;
}

// 画像配信は lh3.googleusercontent.com (Safari/iOS でも安定)
// drive.google.com/thumbnail だと iOS Safari でリダイレクトされて表示不可になる
export function thumbUrl(fileId: string, width = 800): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=w${width}`;
}

// プレビュー用 (大きいサイズ、Lightbox 表示)
export function previewUrl(fileId: string, width = 1600): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=w${width}`;
}

// オリジナル DL URL
export function originalUrl(fileId: string): string {
  return `https://drive.google.com/uc?id=${fileId}&export=download`;
}

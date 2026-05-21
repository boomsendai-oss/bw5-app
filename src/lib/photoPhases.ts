// ─────────────────────────────────────────────────────────────
// BW5 本番写真 公開Phase設定
// ─────────────────────────────────────────────────────────────
// Phase 割り当て / 公開日は TARO 決定 (2026-05 シーズン)。
// Drive URL は Phase ごとに後から記入。空欄なら「準備中」表示。
//
// 本番写真画像:
//   - クラス演目 (M3-M37): /public/performances/{mId}.webp (24本)
//   - ゲスト (M11/M21/M23/M34/M36): /public/guests/{title}.jpg
//   - M1 (イントラ) / M38 (エンディング): プレースホルダー必要
//     → TARO 確認待ち。暫定で /images/boomkun.png をフォールバック表示
// ─────────────────────────────────────────────────────────────

import { timetableData } from "./timetableData";

export interface PhotoPhaseItem {
  /** "M1" / "M11" など (timetableData の id と揃える: "M3" は M03 ではなく M3) */
  mId: string;
  /** Drive 共有フォルダ URL。空文字なら「準備中」表示 */
  driveUrl: string;
}

export interface PhotoPhase {
  phaseNo: number;
  /** YYYY-MM-DD (JST) — この日の 0:00 から公開扱い */
  releaseDate: string;
  items: PhotoPhaseItem[];
}

export const PHOTO_PHASES: PhotoPhase[] = [
  {
    phaseNo: 1,
    releaseDate: "2026-05-13",
    items: [
      { mId: "M1",  driveUrl: "https://drive.google.com/drive/folders/1PLVKpcx187z3TNG6mdlzTaNo80nGF2ws" }, // インストラクターナンバー
      { mId: "M11", driveUrl: "https://drive.google.com/drive/folders/1M8T1Oadwha_0mV8JytsBMmrfbyJw5K17" }, // ZIEL (GUEST)
      { mId: "M34", driveUrl: "https://drive.google.com/drive/folders/1wprmVn29LbH66uhOJAcz6T51myYKxPac" }, // NEW STYLERS (GUEST)
      { mId: "M21", driveUrl: "https://drive.google.com/drive/folders/1BBeGuNKZXZ1Xs2l9OrU8NDYY0DOI04Ox" }, // TARO & TAKE (GUEST)
      { mId: "M36", driveUrl: "https://drive.google.com/drive/folders/1XhP0yLKcJwZYFGjivY0Zk9w5oC0sKJHC" }, // FOODIES (GUEST)
      { mId: "M23", driveUrl: "https://drive.google.com/drive/folders/16BqDd-mjP8ksJPdaEqvDpxLfrHO1C3lg" }, // クレアラシル (GUEST)
    ],
  },
  {
    phaseNo: 2,
    releaseDate: "2026-05-14",
    items: [
      { mId: "M35", driveUrl: "https://drive.google.com/drive/folders/1VNi1Xuthq8MslJ7Q2qMLrdah-5K7MJSB" }, // full blast
      { mId: "M24", driveUrl: "https://drive.google.com/drive/folders/1xtwn0ia7qo0zvLIbvYTWjNPTg5NEnOSb" }, // Dreamin' Smoke
      { mId: "M5",  driveUrl: "https://drive.google.com/drive/folders/1lMFR--RgKFA4ZXR7WVXKjI5whnd-PVQz" }, // Waack The Soul
      { mId: "M15", driveUrl: "https://drive.google.com/drive/folders/12hint8wj9uCayQ65D_9wXPOLtCZeVMB6" }, // Grown ups
      { mId: "M33", driveUrl: "https://drive.google.com/drive/folders/1E0tAqG0vOH6Mmkt-wF7riYkVybU74jXt" }, // Drum Line
    ],
  },
  {
    phaseNo: 3,
    releaseDate: "2026-05-16",
    items: [
      { mId: "M28", driveUrl: "https://drive.google.com/drive/folders/1u6GWa4n9lkWEZdn8ICZJ-qwL08A2zFEl" }, // SEVEN BEATS
      { mId: "M10", driveUrl: "https://drive.google.com/drive/folders/1yv50pt7xWyp3WyJqWl2NDky-htoDsojT" }, // Katrs
      { mId: "M6",  driveUrl: "https://drive.google.com/drive/folders/1rqhzvHTF7yokIAHMhqWTreJ7-tiUBGpQ" }, // Funkastic Beats
      { mId: "M4",  driveUrl: "https://drive.google.com/drive/folders/1Xq-0CmXlX-LtqqoK_3kM3nWUJOLSzaCa" }, // Best Pals
      { mId: "M16", driveUrl: "https://drive.google.com/drive/folders/1hHoE_y6L5-X5szqOQWrXfDGv-UgEvP8U" }, // Focus
    ],
  },
  {
    phaseNo: 4,
    releaseDate: "2026-05-18",
    items: [
      { mId: "M37", driveUrl: "https://drive.google.com/drive/folders/1XlMuip9CSX2plFk8tXaGlUsh4BzN1Kwk" }, // Vibrant
      { mId: "M22", driveUrl: "https://drive.google.com/drive/folders/1PEuztu1mjv-9z6uJtaQ8UhH4fpozpQMU" }, // 7BOOM BAP C.R.E.W
      { mId: "M29", driveUrl: "https://drive.google.com/drive/folders/1zz9B4UxVJSvpsBIOCX3KRS0htxHzzNJI" }, // Slay Force
      { mId: "M31", driveUrl: "https://drive.google.com/drive/folders/1wf75zKoXF2Guc6Yxzr5y04KsJJ6Jn1bE" }, // GRAFFITI
      { mId: "M8",  driveUrl: "https://drive.google.com/drive/folders/1EWQyEtxKay9CFwR8hG7yORSxftKl-PYb" }, // Little Wave
    ],
  },
  {
    phaseNo: 5,
    releaseDate: "2026-05-20",
    items: [
      { mId: "M7",  driveUrl: "https://drive.google.com/drive/folders/13y2ktBPc79lH59xq0Q2wA1Ug-5FeKXrQ" }, // 諏訪GALS!!
      { mId: "M27", driveUrl: "https://drive.google.com/drive/folders/1zvM-i11bEXT7zt5_ze_0b9n_KvKW0op7" }, // Turn It Up
      { mId: "M3",  driveUrl: "https://drive.google.com/drive/folders/1eOEhG0XdFUTm7JQne0I0_j4CmMxb0B-w" }, // Sunshine
      { mId: "M30", driveUrl: "https://drive.google.com/drive/folders/10OgqODOqQwS7qjRMs0S8r0ix9-KiF97i" }, // そのまま
      { mId: "M19", driveUrl: "https://drive.google.com/drive/folders/1Q48mKD613V-Lq44tZmX967ROIa86oXu2" }, // Keep Grinding
    ],
  },
  {
    phaseNo: 6,
    releaseDate: "2026-05-22",
    items: [
      { mId: "M14", driveUrl: "https://drive.google.com/drive/folders/1ocb17UlKSzk8oKjPMYG7OjHKuaB3KUEy" }, // Teddy's Fam
      { mId: "M20", driveUrl: "https://drive.google.com/drive/folders/1ly1xnVsfVfF28np54z-E_2mCJiwjc8NU" }, // Change
      { mId: "M17", driveUrl: "https://drive.google.com/drive/folders/16OC2sj-_SnAyKFuQGqYY_85qp20UdBGF" }, // Mini Wave
      { mId: "M9",  driveUrl: "https://drive.google.com/drive/folders/1bBAJN6acZMiDf4nLT2YykaOABX53o3vL" }, // Beat Theory
      { mId: "M38", driveUrl: "https://drive.google.com/drive/folders/1DPl_D9HPMbwSUh6btO98Spi0qbaOISgd" }, // エンディングナンバー
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// 公開タイミング: 該当日の 19:00 JST (= 10:00 UTC)
// ─────────────────────────────────────────────────────────────
export function getPhaseReleaseDate(phase: PhotoPhase): Date {
  const [y, m, d] = phase.releaseDate.split("-").map(Number);
  // 19:00 JST = 10:00 UTC
  return new Date(Date.UTC(y, m - 1, d, 10, 0, 0));
}

export function isPhaseReleased(phase: PhotoPhase, now: Date = new Date()): boolean {
  return now >= getPhaseReleaseDate(phase);
}

export function findNextPhase(now: Date = new Date()): PhotoPhase | null {
  for (const p of PHOTO_PHASES) {
    if (!isPhaseReleased(p, now)) return p;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// timetableData から情報を引き、表示用に組み立てる
// ─────────────────────────────────────────────────────────────
const SPECIAL_META: Record<string, { title: string; subtitle: string }> = {
  M1:  { title: "インストラクターナンバー", subtitle: "BOOM Instructors" },
  M38: { title: "エンディングナンバー", subtitle: "All Cast" },
};

// 本番写真画像パスを返す。無い場合は null。
export function getGroupPhotoSrc(mId: string): string | null {
  const item = timetableData.find((i) => i.id === mId);
  // 1) クラス演目 + ダンス部 + GRAFFITI(special) + イントラ/エンディング は /performances/{mId}.webp
  const hasGroupPhoto = new Set([
    "M1",
    "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10",
    "M14", "M15", "M16", "M17", "M19", "M20", "M22", "M24",
    "M27", "M28", "M29", "M30", "M31", "M33", "M35", "M37",
    "M38",
  ]);
  if (hasGroupPhoto.has(mId)) return `/performances/${mId}.webp`;

  // 2) ゲストは /guests/{title}.jpg
  if (item && item.type === "guest") {
    return `/guests/${item.title}.jpg`;
  }

  // 3) M1 / M38 / 不明はプレースホルダー
  return null;
}

export function getPerformanceMeta(mId: string): { title: string; subtitle: string } {
  if (SPECIAL_META[mId]) return SPECIAL_META[mId];
  const item = timetableData.find((i) => i.id === mId);
  if (!item) return { title: mId, subtitle: "" };
  return { title: item.title, subtitle: item.subtitle || "" };
}

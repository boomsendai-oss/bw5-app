export interface TimetableItem {
  id: string;
  /** Start time as "HH:MM" or "HH:MM:SS" (JST, 2026-05-05) */
  startTime: string;
  /** Duration in seconds */
  durationSec: number;
  /** Number title (e.g., "Sunshine", "Keep Grinding") – primary headline */
  title: string;
  /** "{instructor} / {class name}" – shown small below title */
  subtitle?: string;
  type: 'performance' | 'guest' | 'special' | 'break';
  part: 1 | 2 | 3;
}

/**
 * 各ナンバーの通常レッスン枠 (曜日 + 開始時刻)。パンフレット入稿データ
 * (BW5_14,15.pdf P.14 週間レッスン表 + 各ナンバー紹介ページ) を元に作成。
 * 演目詳細ページの「クラス」直下に表示される。
 */
export const REGULAR_SCHEDULE: Record<string, string> = {
  M3:  '水 18:30',          // TARO / HIPHOP 初級
  M4:  '日 12:15',          // Ryuki / はじめての HIPHOP
  M5:  '土 15:30',          // YURI / 長町 WAACK 入門
  M6:  '土 11:00 (月2)',    // K@TTSU & AOI / 多賀城 HOUSE
  M7:  'BOOM 外部レッスン',  // HARUKA / 諏訪キッズ
  M8:  'BOOM 外部レッスン',  // TARO / 長町 キッズ HIPHOP
  M9:  '日 11:00',          // AOI / 多賀城 HIPHOP 初級
  M10: '',                   // BOOM ダンス部 — 表示なし
  M14: '日 14:00 (隔週)',   // おっちゃん / NEW JACK SWING
  M15: '日 15:00',          // Ryuki & TARO / ベーシックダンスクラス
  M16: '月 18:30',          // KEIKO / 多賀城 JAZZ
  M17: 'BOOM 外部レッスン',  // KOKEKO & TARO / 長町 ちびっこ HIPHOP
  M19: '日 12:45',          // AOI / 多賀城 HIPHOP 基礎
  M20: '水 20:00',          // K@TTSU / HOUSE
  M22: '金 18:30',          // AOI / 七ヶ浜 HIPHOP 入門
  M24: '日 14:00 (隔週)',   // ちゃんなつ / HIPHOP
  M27: '土 16:30',          // KEIKO / 長町 ガールズ 合同
  M28: '金 19:30',          // TARO / 七ヶ浜 HIPHOP 初級
  M29: '日 13:30',          // Ryuki / キッズ HIPHOP
  M30: '日 (隔週)',         // SAYUKI / FREE STYLE
  M31: 'SPECIAL ナンバー / 不定期', // TARO & Ryuki / GRAFFITI
  M33: '土 10:00',          // TARO / キッズ 強化
  M35: '土 11:30',          // K@TTSU / HOUSE エキスパート
  M37: '月 20:15',          // TARO / HIPHOP 中級
};

// Helper: parse "HH:MM" or "HH:MM:SS" to Date on 2026-05-05 JST
export function parseTime(time: string): Date {
  const parts = time.split(':').map(Number);
  const h = parts[0];
  const m = parts[1];
  const s = parts[2] ?? 0;
  const d = new Date(Date.UTC(2026, 4, 5, h - 9, m, s));
  return d;
}

export function getEndTime(item: TimetableItem): Date {
  const start = parseTime(item.startTime);
  return new Date(start.getTime() + item.durationSec * 1000);
}

function dur(min: number, sec = 0): number {
  return min * 60 + sec;
}

export const EVENT_DATE = '2026-05-05';

export const PARTS = [
  { part: 1 as const, label: '1部', startTime: '14:30' },
  { part: 2 as const, label: '2部', startTime: '15:45' },
  { part: 3 as const, label: '3部', startTime: '17:05' },
];

// ─────────────────────────────────────────────────────────────
// Public timetable
// ─────────────────────────────────────────────────────────────
// Source: 舞台進行表 v8 (2026-04-30 更新版 / 最新)
// /Users/kimurashintarou/Library/Mobile Documents/com~apple~CloudDocs/
//   2026_5_5 BW5/01_運営・管理/舞台進行表/BW5_舞台進行表_v8.pdf
//
// 方針:
//   - MC / オープニング映像 / エンドロール / インストラクターナンバー /
//     エンディングナンバー / ジングル / 開場・予ベル・緞帳操作は非公開
//   - 表示はナンバータイトル（演目名）を主役に、下段にイントラ / クラス名
//   - ゲストには GUEST バッジ
// ─────────────────────────────────────────────────────────────
export const timetableData: TimetableItem[] = [
  // ── 1部 (14:30 本ベル) ──
  { id: 'M3',  startTime: '14:45:35', durationSec: dur(5, 12), part: 1, type: 'performance', title: 'Sunshine',           subtitle: 'TARO / HIPHOP 初級' },
  { id: 'M4',  startTime: '14:51:17', durationSec: dur(2, 54), part: 1, type: 'performance', title: 'Best Pals',          subtitle: 'Ryuki / はじめての HIPHOP' },
  { id: 'M5',  startTime: '14:54:41', durationSec: dur(3,  6), part: 1, type: 'performance', title: 'Waack The Soul',     subtitle: 'YURI / 長町 WAACK 入門' },
  { id: 'M6',  startTime: '14:58:17', durationSec: dur(4,  7), part: 1, type: 'performance', title: 'Funkastic Beats',    subtitle: 'K@TTSU & AOI / 多賀城 HOUSE' },
  { id: 'M7',  startTime: '15:02:54', durationSec: dur(2, 52), part: 1, type: 'performance', title: '諏訪GALS!!',          subtitle: 'HARUKA / キッズ ガールズ' },
  { id: 'M8',  startTime: '15:06:16', durationSec: dur(4, 13), part: 1, type: 'performance', title: 'Little Wave',        subtitle: 'TARO / 長町 キッズ HIPHOP' },
  { id: 'M9',  startTime: '15:10:59', durationSec: dur(4, 38), part: 1, type: 'performance', title: 'Beat Theory',        subtitle: 'AOI / 多賀城 HIPHOP 初級' },
  { id: 'M10', startTime: '15:16:07', durationSec: dur(2, 41), part: 1, type: 'performance', title: 'Katrs',              subtitle: 'BOOM ダンス部' },
  { id: 'M11', startTime: '15:19:18', durationSec: dur(5),     part: 1, type: 'guest',       title: 'ZIEL',               subtitle: 'GUEST' },
  { id: 'BR1', startTime: '15:27:18', durationSec: dur(17, 42), part: 1, type: 'break',      title: '休憩' },

  // ── 2部 (15:45 本ベル) ──
  { id: 'M14', startTime: '15:50:30', durationSec: dur(4, 22), part: 2, type: 'performance', title: "Teddy's Fam",        subtitle: 'おっちゃん / NEW JACK SWING' },
  { id: 'M15', startTime: '15:55:22', durationSec: dur(3, 58), part: 2, type: 'performance', title: 'Grown ups',          subtitle: 'Ryuki & TARO / ベーシックダンスクラス' },
  { id: 'M16', startTime: '15:59:50', durationSec: dur(3, 56), part: 2, type: 'performance', title: 'Focus',              subtitle: 'KEIKO / 多賀城 JAZZ' },
  { id: 'M17', startTime: '16:04:16', durationSec: dur(3, 55), part: 2, type: 'performance', title: 'Mini Wave',          subtitle: 'KOKEKO & TARO / 長町 ちびっこ HIPHOP' },
  { id: 'M19', startTime: '16:13:41', durationSec: dur(4, 32), part: 2, type: 'performance', title: 'Keep Grinding',      subtitle: 'AOI / 多賀城 HIPHOP 基礎' },
  { id: 'M20', startTime: '16:18:43', durationSec: dur(4, 40), part: 2, type: 'performance', title: 'Change',             subtitle: 'K@TTSU / K@TTSU HOUSE' },
  { id: 'M21', startTime: '16:23:53', durationSec: dur(5),     part: 2, type: 'guest',       title: 'TARO & TAKE',        subtitle: 'GUEST' },
  { id: 'M22', startTime: '16:29:23', durationSec: dur(4, 55), part: 2, type: 'performance', title: '7BOOM BAP C.R.E.W',  subtitle: 'AOI / 七ヶ浜 HIPHOP 入門' },
  { id: 'M23', startTime: '16:34:48', durationSec: dur(5),     part: 2, type: 'guest',       title: 'クレアラシル',        subtitle: 'GUEST' },
  { id: 'M24', startTime: '16:40:18', durationSec: dur(4, 22), part: 2, type: 'performance', title: "Dreamin' Smoke",     subtitle: 'ちゃんなつ / HIPHOP' },
  { id: 'BR2', startTime: '16:47:40', durationSec: dur(17, 20), part: 2, type: 'break',      title: '休憩' },

  // ── 3部 (17:05 本ベル) ──
  { id: 'M27', startTime: '17:10:30', durationSec: dur(4, 55), part: 3, type: 'performance', title: 'Turn It Up',         subtitle: 'KEIKO / 長町 ガールズ 合同' },
  { id: 'M28', startTime: '17:15:55', durationSec: dur(4, 56), part: 3, type: 'performance', title: 'SEVEN BEATS',        subtitle: 'TARO / 七ヶ浜 HIPHOP 初級' },
  { id: 'M29', startTime: '17:21:21', durationSec: dur(3, 24), part: 3, type: 'performance', title: 'Slay Force',         subtitle: 'Ryuki / キッズ HIPHOP' },
  { id: 'M30', startTime: '17:25:15', durationSec: dur(3, 34), part: 3, type: 'performance', title: 'そのまま',            subtitle: 'SAYUKI / FREE STYLE' },
  { id: 'M31', startTime: '17:29:19', durationSec: dur(4, 50), part: 3, type: 'special',     title: 'GRAFFITI',           subtitle: 'TARO & Ryuki / SPECIAL ナンバー' },
  { id: 'M33', startTime: '17:39:39', durationSec: dur(4, 34), part: 3, type: 'performance', title: 'Drum Line',          subtitle: 'TARO / キッズ 強化' },
  { id: 'M34', startTime: '17:44:43', durationSec: dur(5),     part: 3, type: 'guest',       title: 'NEW STYLERS',        subtitle: 'GUEST' },
  { id: 'M35', startTime: '17:50:13', durationSec: dur(3, 57), part: 3, type: 'performance', title: 'full blast',         subtitle: 'K@TTSU / HOUSE エキスパート' },
  { id: 'M36', startTime: '17:54:40', durationSec: dur(5),     part: 3, type: 'guest',       title: 'FOODIES',            subtitle: 'GUEST' },
  { id: 'M37', startTime: '18:00:10', durationSec: dur(5, 36), part: 3, type: 'performance', title: 'Vibrant',            subtitle: 'TARO / TARO HIP HOP 中級' },
];

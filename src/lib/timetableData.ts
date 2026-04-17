export interface TimetableItem {
  id: string;
  /** Start time as "HH:MM" or "HH:MM:SS" (JST, 2026-05-05) */
  startTime: string;
  /** Duration in seconds */
  durationSec: number;
  title: string;
  type: 'performance' | 'video' | 'mc' | 'break';
  part: 1 | 2 | 3;
}

// Helper: parse "HH:MM" or "HH:MM:SS" to Date on 2026-05-05 JST
export function parseTime(time: string): Date {
  const parts = time.split(':').map(Number);
  const h = parts[0];
  const m = parts[1];
  const s = parts[2] ?? 0;
  // Create date in JST (UTC+9)
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
  { part: 2 as const, label: '2部', startTime: '15:40' },
  { part: 3 as const, label: '3部', startTime: '16:55' },
];

export const timetableData: TimetableItem[] = [
  // --- Part 1 (14:30 start) ---
  { id: 'M1',  startTime: '14:30:00', durationSec: dur(5),     title: 'BOOMインストラクターナンバー', type: 'performance', part: 1 },
  { id: 'V1',  startTime: '14:35:00', durationSec: dur(5),     title: 'オープニング映像', type: 'video', part: 1 },
  { id: 'MC1', startTime: '14:40:00', durationSec: dur(5),     title: 'MC', type: 'mc', part: 1 },
  { id: 'M2',  startTime: '14:45:30', durationSec: dur(5),     title: 'TARO HH 初級', type: 'performance', part: 1 },
  { id: 'M3',  startTime: '14:51:00', durationSec: dur(3, 30), title: 'はじめてHH', type: 'performance', part: 1 },
  { id: 'M4',  startTime: '14:55:00', durationSec: dur(3, 30), title: 'YURI WAACK', type: 'performance', part: 1 },
  { id: 'M5',  startTime: '14:59:00', durationSec: dur(4),     title: '諏訪キッズ', type: 'performance', part: 1 },
  { id: 'M6',  startTime: '15:03:30', durationSec: dur(4),     title: '多賀城HOUSE', type: 'performance', part: 1 },
  { id: 'M7',  startTime: '15:08:00', durationSec: dur(4, 15), title: '長町キッズ', type: 'performance', part: 1 },
  { id: 'M8',  startTime: '15:12:45', durationSec: dur(3),     title: 'ダンス部', type: 'performance', part: 1 },
  { id: 'M9',  startTime: '15:16:15', durationSec: dur(5),     title: 'ZIEL ゲスト', type: 'performance', part: 1 },
  { id: 'M10', startTime: '15:21:45', durationSec: dur(5),     title: 'おっちゃんNJS', type: 'performance', part: 1 },
  { id: 'MC2', startTime: '15:26:45', durationSec: dur(3),     title: 'MC', type: 'mc', part: 1 },
  { id: 'BR1', startTime: '15:29:45', durationSec: dur(10),    title: '休憩', type: 'break', part: 1 },

  // --- Part 2 (15:40 start) ---
  { id: 'M11', startTime: '15:45:30', durationSec: dur(3, 30), title: '多賀城HH入門', type: 'performance', part: 2 },
  { id: 'M12', startTime: '15:49:30', durationSec: dur(3, 30), title: 'ベーシックダンスクラス', type: 'performance', part: 2 },
  { id: 'M13', startTime: '15:53:30', durationSec: dur(4, 40), title: '多賀城JAZZ', type: 'performance', part: 2 },
  { id: 'M14', startTime: '15:58:40', durationSec: dur(3, 30), title: '長町ちびっこ', type: 'performance', part: 2 },
  { id: 'MC3', startTime: '16:02:10', durationSec: dur(5),     title: 'MC', type: 'mc', part: 2 },
  { id: 'M15', startTime: '16:07:40', durationSec: dur(5),     title: '多賀城HH初級', type: 'performance', part: 2 },
  { id: 'M16', startTime: '16:13:10', durationSec: dur(5),     title: 'SAYUKIフリースタイル', type: 'performance', part: 2 },
  { id: 'M17', startTime: '16:18:40', durationSec: dur(5),     title: 'TARO&TAKE', type: 'performance', part: 2 },
  { id: 'M18', startTime: '16:24:10', durationSec: dur(5),     title: 'K@TTSU HOUSE', type: 'performance', part: 2 },
  { id: 'M19', startTime: '16:29:40', durationSec: dur(5),     title: 'FOODIES', type: 'performance', part: 2 },
  { id: 'M20', startTime: '16:35:10', durationSec: dur(5),     title: 'GRAFFITIナンバー', type: 'performance', part: 2 },
  { id: 'MC4', startTime: '16:40:10', durationSec: dur(3),     title: 'MC', type: 'mc', part: 2 },
  { id: 'BR2', startTime: '16:43:10', durationSec: dur(10),    title: '休憩', type: 'break', part: 2 },

  // --- Part 3 (16:55 start) ---
  { id: 'M21', startTime: '17:00:30', durationSec: dur(5),     title: '七ヶ浜HH初級', type: 'performance', part: 3 },
  { id: 'M22', startTime: '17:06:00', durationSec: dur(5),     title: '長町ガールズ合同', type: 'performance', part: 3 },
  { id: 'M23', startTime: '17:11:30', durationSec: dur(4),     title: '日曜キッズHH', type: 'performance', part: 3 },
  { id: 'M24', startTime: '17:16:00', durationSec: dur(5),     title: 'ちゃんなつHH', type: 'performance', part: 3 },
  { id: 'M25', startTime: '17:21:30', durationSec: dur(5),     title: '七ヶ浜HH入門', type: 'performance', part: 3 },
  { id: 'MC5', startTime: '17:26:30', durationSec: dur(5),     title: 'MC', type: 'mc', part: 3 },
  { id: 'M26', startTime: '17:32:00', durationSec: dur(5),     title: 'キッズ強化', type: 'performance', part: 3 },
  { id: 'M27', startTime: '17:37:30', durationSec: dur(5),     title: 'クレアラシル', type: 'performance', part: 3 },
  { id: 'M28', startTime: '17:43:00', durationSec: dur(5),     title: 'HOUSEエキスパート', type: 'performance', part: 3 },
  { id: 'M29', startTime: '17:48:30', durationSec: dur(5),     title: 'NEW STYLERS', type: 'performance', part: 3 },
  { id: 'M30', startTime: '17:54:00', durationSec: dur(5),     title: 'TARO HH中級', type: 'performance', part: 3 },
  { id: 'V30', startTime: '17:59:00', durationSec: dur(5),     title: 'エンドロール映像', type: 'video', part: 3 },
  { id: 'M31', startTime: '18:04:00', durationSec: dur(5),     title: 'エンディングナンバー', type: 'performance', part: 3 },
  { id: 'MC6', startTime: '18:09:00', durationSec: dur(5),     title: '締めMC', type: 'mc', part: 3 },
];

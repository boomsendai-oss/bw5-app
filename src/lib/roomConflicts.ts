// 同じ部屋・同じ時間に2つのレッスンが入っている「物理的に不可能」な状態の検出。
// 2026-08-23の実例(TARO発見): ダンスバトル練習会14:30-16:00とベーシック15:00-16:00が
// どちらもGOAT Aで計上されていた。実際は練習会がB(小スタジオ)を借りていた。
// カレンダーのlocationが総称(GOAT)しか持たないため起こる。検出して人に聞く。

export type RoomUse = {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  studio_id: number | null;
  studio_name: string | null;
  label: string;
};

export type RoomConflict = {
  date: string;
  studio_id: number;
  studio_name: string | null;
  overlap: string; // 'HH:MM-HH:MM'
  a: { id: number; label: string; time: string };
  b: { id: number; label: string; time: string };
};

const toMin = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const toHHMM = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export function findRoomConflicts(uses: readonly RoomUse[]): RoomConflict[] {
  const out: RoomConflict[] = [];
  const byKey = new Map<string, RoomUse[]>();
  for (const u of uses) {
    if (u.studio_id == null) continue;
    const k = `${u.date}_${u.studio_id}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(u);
  }
  for (const group of byKey.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        // 連名(2人体制)は同一コマが講師ごとに行になる。同じ時間帯+同じクラス名は1コマ。
        if (a.start_time === b.start_time && a.end_time === b.end_time && a.label === b.label) continue;
        const s = Math.max(toMin(a.start_time), toMin(b.start_time));
        const e = Math.min(toMin(a.end_time), toMin(b.end_time));
        if (!Number.isFinite(s) || !Number.isFinite(e) || s >= e) continue;
        out.push({
          date: a.date, studio_id: a.studio_id!, studio_name: a.studio_name,
          overlap: `${toHHMM(s)}-${toHHMM(e)}`,
          a: { id: a.id, label: a.label, time: `${a.start_time}-${a.end_time}` },
          b: { id: b.id, label: b.label, time: `${b.start_time}-${b.end_time}` },
        });
      }
    }
  }
  return out;
}

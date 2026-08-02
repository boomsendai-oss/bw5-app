// ストーリー自動投稿の「その日だけの指示」(TARO 2026-08-03)。
// 目的は2つ:
//   1. 出したくない日をワンボタンで止める(火曜に同じ埋め草が出続けるのを手で止められる)
//   2. その日に出すものをアプリから指定する(登録済み素材から選ぶ / スマホから上げる)
// cron(post-story)とプレビュー(/staff/instagram)の両方がここを最初に見るので、
// 画面に出ている結論と実際の投稿が必ず一致する。

import { execute, getOne } from './db';
import { nowUtcIso } from './dateJst';

export type DayPlanMode = 'skip' | 'pin';

export type DayPlan = {
  date: string;
  mode: DayPlanMode;
  mediaPath: string | null; // サイト相対パス '/stories/extra/xxx.jpg' か '/api/story-media/12'
  mediaType: 'image' | 'video' | null;
  note: string | null;
};

/** その日の指示を読む。テーブル未適用(migration前)でも画面/cronを落とさない。 */
export async function getDayPlan(date: string): Promise<DayPlan | null> {
  try {
    const r = await getOne(
      'SELECT date, mode, media_path, media_type, note FROM story_day_plan WHERE date = ?',
      [date]
    );
    if (!r) return null;
    const mode = String(r.mode) as DayPlanMode;
    if (mode !== 'skip' && mode !== 'pin') return null;
    return {
      date: String(r.date),
      mode,
      mediaPath: r.media_path ? String(r.media_path) : null,
      mediaType: r.media_type === 'video' ? 'video' : r.media_type === 'image' ? 'image' : null,
      note: r.note ? String(r.note) : null,
    };
  } catch {
    return null; // テーブル未作成 = 指示なし扱い(従来どおり動く)
  }
}

/** 複数日ぶんまとめて読む(週間プレビュー用)。キーは日付。 */
export async function getDayPlans(dates: string[]): Promise<Record<string, DayPlan>> {
  const out: Record<string, DayPlan> = {};
  await Promise.all(
    dates.map(async (d) => {
      const p = await getDayPlan(d);
      if (p) out[d] = p;
    })
  );
  return out;
}

export async function setDayPlan(
  date: string,
  mode: DayPlanMode,
  mediaPath: string | null,
  mediaType: 'image' | 'video' | null,
  note: string | null
): Promise<void> {
  const now = nowUtcIso();
  await execute(
    `INSERT INTO story_day_plan (date, mode, media_path, media_type, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       mode = excluded.mode, media_path = excluded.media_path, media_type = excluded.media_type,
       note = excluded.note, updated_at = excluded.updated_at`,
    [date, mode, mediaPath, mediaType, note, now, now]
  );
}

/** 指示を取り消して、通常の自動選択に戻す。 */
export async function clearDayPlan(date: string): Promise<void> {
  await execute('DELETE FROM story_day_plan WHERE date = ?', [date]);
}

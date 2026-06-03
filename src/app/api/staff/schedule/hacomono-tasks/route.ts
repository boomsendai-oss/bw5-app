import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getAll } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/schedule/hacomono-tasks?month=YYYY-MM
// 指定月について、HACOMONO側で手動調整すべき「作業リスト」を返す。
//
// HACOMONOは毎週レッスン枠を自動生成するが、アプリ側の実予定では
//  - removed (5週目・スタジオ全休・過剰生成の間引き 等) → HACOMONOで「枠を削除」すべき
//  - cancelled (休講)                                   → HACOMONOで「枠を削除/非公開」すべき
// これらをそのまま削除リストとして返す。各行に HACOMONO プログラムコード(PG####)を添える。
//
// adds: アプリでは開催予定なのに HACOMONO のマッピングが無いクラス
//       (= HACOMONOが自動生成していない可能性 → 手動追加が要るかも) を参考表示。
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const sp = new URL(req.url).searchParams;
  let month = sp.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    // 既定: 翌月 (TAROは先回りで翌月を整えるため)
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 2; // 翌月 (1-indexed +1, getMonth is 0-indexed so +2)
    const yy = y + Math.floor((m - 1) / 12);
    const mm = ((m - 1) % 12) + 1;
    month = `${yy}-${String(mm).padStart(2, '0')}`;
  }

  const dow = ['日', '月', '火', '水', '木', '金', '土'];

  const deletes = (await getAll(
    `SELECT li.date, li.start_time, li.end_time, li.status,
            lm.class_name,
            (SELECT hacomono_code FROM hacomono_schedule_map WHERE bw5_key = lm.class_name LIMIT 1) AS pg_code,
            (SELECT hacomono_name FROM hacomono_schedule_map WHERE bw5_key = lm.class_name LIMIT 1) AS hacomono_name
     FROM lesson_instances li
     LEFT JOIN lesson_master lm ON lm.id = li.master_id
     WHERE li.date LIKE ? AND li.status IN ('removed', 'cancelled')
     ORDER BY li.date, li.start_time`,
    [`${month}%`]
  )) as Array<{
    date: string; start_time: string | null; end_time: string | null;
    status: string; class_name: string | null; pg_code: string | null; hacomono_name: string | null;
  }>;

  // 既に HACOMONO で削除済みのログを取得 (二重処理防止 / 完了管理)
  const logRows = (await getAll(
    `SELECT instance_date, start_time, class_name, action FROM hacomono_delete_log WHERE instance_date LIKE ?`,
    [`${month}%`]
  )) as Array<{ instance_date: string; start_time: string | null; class_name: string | null; action: string }>;
  const logKey = (d: string, t: string | null, c: string | null) => `${d}|${(t ?? '').slice(0, 5)}|${c ?? ''}`;
  const logMap = new Map(logRows.map((r) => [logKey(r.instance_date, r.start_time, r.class_name), r.action]));

  const deleteList = deletes.map((r) => {
    const d = new Date(r.date + 'T00:00:00');
    const logged = logMap.get(logKey(r.date, r.start_time, r.class_name));
    return {
      date: r.date,
      day_of_week: dow[d.getDay()],
      start_time: (r.start_time ?? '').slice(0, 5),
      end_time: (r.end_time ?? '').slice(0, 5),
      class_name: r.class_name ?? '(不明)',
      hacomono_name: r.hacomono_name,
      pg_code: r.pg_code,
      reason: r.status === 'cancelled' ? '休講' : '削除(全休/間引き/5週目等)',
      status: r.status,
      done: logged === 'deleted',
      log_action: logged ?? null,
    };
  });

  // 未処理分をクラス別にグループ化 (サイドバー実行プラン用)
  const notDone = deleteList.filter((d) => !d.log_action);
  const byClass = new Map<string, { class_name: string; pg_code: string | null; day_of_week: string; items: typeof deleteList }>();
  for (const it of notDone) {
    const key = it.class_name;
    if (!byClass.has(key)) {
      byClass.set(key, { class_name: it.class_name, pg_code: it.pg_code, day_of_week: it.day_of_week, items: [] });
    }
    byClass.get(key)!.items.push(it);
  }
  const planByClass = Array.from(byClass.values());

  // 参考: アプリで開催予定だが HACOMONO マッピングが無いクラス (手動追加が要るかも)
  const adds = (await getAll(
    `SELECT DISTINCT lm.class_name
     FROM lesson_instances li
     LEFT JOIN lesson_master lm ON lm.id = li.master_id
     WHERE li.date LIKE ? AND li.status = 'scheduled'
       AND lm.class_name IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM hacomono_schedule_map m WHERE m.bw5_key = lm.class_name)
     ORDER BY lm.class_name`,
    [`${month}%`]
  )) as Array<{ class_name: string }>;

  // ⚠️ 幻枠リスク: アプリで終了/無効になったのに HACOMONO 側の終了設定が未済のクラス。
  //   HACOMONO は終了月を入れないと枠を無限生成するため、お客さんが誤予約しうる。
  //   hacomono_closed=1 (HACOMONO側も終了設定済み) のものは除外。
  const dowFull = ['日', '月', '火', '水', '木', '金', '土'];
  const phantomRows = (await getAll(
    `SELECT m.bw5_key, m.hacomono_code, m.hacomono_name,
            lm.active, lm.end_date, lm.default_day_of_week AS dow
     FROM hacomono_schedule_map m
     JOIN lesson_master lm ON lm.class_name = m.bw5_key
     WHERE m.entity_type = 'program' AND COALESCE(m.hacomono_closed, 0) = 0
       AND ( lm.active = 0 OR (lm.end_date IS NOT NULL AND lm.end_date < ?) )`,
    [`${month}-01`]
  )) as Array<{
    bw5_key: string; hacomono_code: string | null; hacomono_name: string | null;
    active: number; end_date: string | null; dow: number | null;
  }>;

  const phantomClasses = phantomRows.map((r) => ({
    class_name: r.bw5_key,
    pg_code: r.hacomono_code,
    hacomono_name: r.hacomono_name,
    day_of_week: r.dow != null ? dowFull[r.dow] : null,
    reason: r.active === 0 ? 'クラス無効(終了)' : `${r.end_date} で終了`,
  }));

  return NextResponse.json({
    month,
    delete_count: deleteList.length,
    done_count: deleteList.filter((d) => d.done).length,
    remaining_count: deleteList.filter((d) => !d.log_action).length,
    deletes: deleteList,
    plan_by_class: planByClass,
    unmapped_scheduled: adds.map((a) => a.class_name),
    phantom_classes: phantomClasses,
  });
}

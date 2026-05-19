'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';

type Lesson = {
  source: 'instance' | 'master';
  instance_id?: number;
  master_id?: number;
  class_name: string;
  start_time: string;
  end_time: string;
  studio_name: string | null;
  instructor_name: string | null;
  status?: string;
  notes?: string | null;
  frequency_type?: string | null;
};

type Day = {
  date: string;
  day_of_week: number;
  lessons: Lesson[];
};

type CalendarData = {
  year: number;
  month: number;
  days: Day[];
  masters_count: number;
  instances_count: number;
};

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export default function ScheduleCalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<Day | null>(null);
  const [err, setErr] = useState<string>('');

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/staff/schedule/calendar?year=${y}&month=${m}`, { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/schedule/calendar';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(year, month); }, [year, month, load]);

  // カレンダーグリッド: 月の1日が何曜日かで前空白を作る
  const grid = useMemo(() => {
    if (!data) return [];
    const firstDow = new Date(data.year, data.month - 1, 1).getDay();
    const cells: (Day | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (const d of data.days) cells.push(d);
    // 末尾に空白追加して7の倍数に
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [data]);

  const prevMonth = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };
  const goToday = () => {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth() + 1);
  };

  const todayStr = useMemo(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }, []);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <StaffPageHeader
        title="📅 レッスンカレンダー"
        description="月別のレッスン予定 (lesson_master + instances から自動展開)"
        rightExtra={
          <button onClick={goToday} className="px-3 py-1 rounded text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300">今日</button>
        }
      />

      <div className="max-w-6xl mx-auto p-3 sm:p-4">
        {/* 月切り替えバー */}
        <div className="bg-white rounded-lg border border-neutral-200 p-3 mb-3 flex items-center justify-between">
          <button onClick={prevMonth} className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-sm font-semibold">◀</button>
          <h2 className="text-lg sm:text-xl font-bold text-orange-700">
            {year}年 {month}月
          </h2>
          <button onClick={nextMonth} className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-sm font-semibold">▶</button>
        </div>

        {err && (
          <div className="mb-3 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">読込エラー: {err}</div>
        )}

        {loading && <p className="text-slate-500 text-sm">読込中...</p>}

        {/* カレンダー本体 */}
        {!loading && data && (
          <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
            {/* 曜日ヘッダー */}
            <div className="grid grid-cols-7 bg-slate-50 border-b border-neutral-200">
              {DOW_LABELS.map((d, i) => (
                <div
                  key={d}
                  className={`px-2 py-2 text-center text-xs font-bold ${i === 0 ? 'text-red-600' : i === 6 ? 'text-blue-600' : 'text-slate-700'}`}
                >
                  {d}
                </div>
              ))}
            </div>

            {/* 日付グリッド */}
            <div className="grid grid-cols-7">
              {grid.map((cell, idx) => {
                if (!cell) {
                  return <div key={idx} className="border-r border-b border-neutral-100 min-h-[80px] bg-slate-50/30" />;
                }
                const dow = cell.day_of_week;
                const dateNum = parseInt(cell.date.split('-')[2], 10);
                const isToday = cell.date === todayStr;
                const lessonCount = cell.lessons.length;
                return (
                  <button
                    key={cell.date}
                    onClick={() => setSelectedDay(cell)}
                    className={`border-r border-b border-neutral-100 min-h-[80px] sm:min-h-[100px] p-1 text-left hover:bg-orange-50 transition-colors ${isToday ? 'bg-orange-50/60' : ''}`}
                  >
                    <div className={`text-xs font-bold mb-0.5 ${
                      isToday ? 'text-orange-600' : dow === 0 ? 'text-red-600' : dow === 6 ? 'text-blue-600' : 'text-slate-700'
                    }`}>
                      {dateNum}
                      {isToday && <span className="ml-1 text-[9px] px-1 bg-orange-500 text-white rounded">今日</span>}
                    </div>
                    {/* レッスン省略表示 (最大3件) */}
                    <div className="space-y-0.5">
                      {cell.lessons.slice(0, 3).map((l, i) => (
                        <div
                          key={i}
                          className={`text-[9px] sm:text-[10px] leading-tight px-1 py-0.5 rounded truncate ${
                            l.source === 'instance'
                              ? l.status === 'cancelled' ? 'bg-red-100 text-red-700 line-through' : 'bg-emerald-100 text-emerald-800'
                              : 'bg-blue-50 text-blue-800'
                          }`}
                          title={`${l.start_time ?? '時間未設定'} ${l.class_name} (${l.instructor_name ?? '?'})`}
                        >
                          {l.start_time ? l.start_time.substring(0, 5) : '時間未設定'} {(l.class_name ?? '').replace(/​/g, '').substring(0, 8)}
                        </div>
                      ))}
                      {lessonCount > 3 && (
                        <div className="text-[9px] text-slate-500">+{lessonCount - 3}件</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* メタ情報 */}
        {data && (
          <p className="text-xs text-slate-500 mt-2">
            この月の実開催 {data.instances_count}件 / マスター{data.masters_count}件から展開
          </p>
        )}
      </div>

      {/* 日別詳細パネル */}
      {selectedDay && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50" onClick={() => setSelectedDay(null)}>
          <div
            className="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-2xl p-4 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 pb-2 border-b">
              <h3 className="font-bold text-lg">
                {selectedDay.date} ({DOW_LABELS[selectedDay.day_of_week]})
              </h3>
              <button onClick={() => setSelectedDay(null)} className="text-2xl leading-none text-slate-400 hover:text-slate-700">✕</button>
            </div>
            {selectedDay.lessons.length === 0 ? (
              <p className="text-sm text-slate-500 py-4">この日はレッスン無し</p>
            ) : (
              <div className="space-y-2">
                {selectedDay.lessons.map((l, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg border ${
                      l.source === 'instance'
                        ? l.status === 'cancelled' ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'
                        : 'bg-blue-50 border-blue-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-bold">
                        {l.start_time ? l.start_time.substring(0, 5) : '時間未設定'} - {l.end_time ? l.end_time.substring(0, 5) : ''}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white text-slate-600 border">
                        {l.source === 'instance' ? '実開催' : 'マスター展開'}
                      </span>
                    </div>
                    <div className="font-bold mt-1">{l.class_name}</div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      👤 {l.instructor_name ?? '未設定'} / 📍 {l.studio_name ?? '未設定'}
                    </div>
                    {l.status === 'cancelled' && (
                      <div className="mt-1 inline-block text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">休講</div>
                    )}
                    {l.frequency_type && l.source === 'master' && (
                      <div className="mt-1 text-[10px] text-slate-500">頻度: {l.frequency_type}</div>
                    )}
                    {l.notes && (
                      <div className="mt-1 text-xs text-slate-600">📝 {l.notes}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-slate-400 mt-3">
              ※ 編集機能 (休講/担当変更/特別レッスン追加) は Phase 2 で実装予定
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

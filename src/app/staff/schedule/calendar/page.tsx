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

type MasterOption = { id: number; class_name: string; default_start_time: string; default_end_time: string; default_studio_id: number | null; default_instructor_id: number | null };
type StudioOption = { id: number; name: string };
type InstructorOption = { id: number; name: string };

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

// 編集対象 instance の最新情報
type EditTarget = {
  instance_id: number;
  date: string;
  class_name: string;
  start_time: string;
  end_time: string;
  studio_id: number | null;
  instructor_id: number | null;
  notes: string | null;
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
  const [masters, setMasters] = useState<MasterOption[]>([]);
  const [studios, setStudios] = useState<StudioOption[]>([]);
  const [instructorsOpt, setInstructorsOpt] = useState<InstructorOption[]>([]);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

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

  // マスター/スタジオ/インストラクターを一度だけ取得
  useEffect(() => {
    fetch('/api/staff/master/studios', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(d => { if (d?.studios) setStudios(d.studios); });
    fetch('/api/staff/master/instructors', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(d => { if (d?.instructors) setInstructorsOpt(d.instructors); });
    fetch('/api/staff/schedule/calendar?year=2026&month=1', { credentials: 'include' }).catch(() => {});
    // lesson_master 一覧 (専用APIなければmaster別途取得用)
    fetch('/api/staff/master/lessons', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(d => { if (d?.lessons) setMasters(d.lessons); }).catch(() => {});
  }, []);

  const reloadDay = async (date: string) => {
    await load(year, month);
    // selectedDayを更新
    const fresh = await fetch(`/api/staff/schedule/calendar?year=${year}&month=${month}`, { credentials: 'include' }).then(r => r.json());
    const d = fresh.days?.find((x: Day) => x.date === date);
    if (d) setSelectedDay(d);
  };

  const cancelInstance = async (instanceId: number, date: string) => {
    if (!confirm('このレッスンを休講にしますか?')) return;
    await fetch(`/api/staff/schedule/instances/${instanceId}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    await reloadDay(date);
  };
  const restoreInstance = async (instanceId: number, date: string) => {
    await fetch(`/api/staff/schedule/instances/${instanceId}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'scheduled' }),
    });
    await reloadDay(date);
  };
  const deleteInstance = async (instanceId: number, date: string) => {
    if (!confirm('このレッスンを削除しますか? (元に戻せません)')) return;
    await fetch(`/api/staff/schedule/instances/${instanceId}`, { method: 'DELETE', credentials: 'include' });
    await reloadDay(date);
  };

  // master展開レッスンを instance化 (実体を1件作成して返す)
  // status: 'scheduled' (編集用) または 'cancelled' (休講/この日だけ削除)
  const instantiateMaster = async (date: string, masterId: number, status: 'scheduled' | 'cancelled'): Promise<number | null> => {
    const master = masters.find(m => m.id === masterId);
    if (!master) return null;
    const res = await fetch('/api/staff/schedule/instances', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        start_time: master.default_start_time,
        end_time: master.default_end_time,
        master_id: masterId,
        studio_id: master.default_studio_id,
        instructor_id: master.default_instructor_id,
        status,
      }),
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    return j?.id ?? null;
  };

  // master展開レッスンを「この日だけ編集」: instance化して編集モーダルを開く
  const editMasterLesson = async (date: string, l: Lesson) => {
    if (!l.master_id) return;
    const master = masters.find(m => m.id === l.master_id);
    if (!master) { alert('マスター情報が読み込めませんでした'); return; }
    const newId = await instantiateMaster(date, l.master_id, 'scheduled');
    if (!newId) { alert('実開催の作成に失敗しました'); return; }
    await reloadDay(date);
    setEditTarget({
      instance_id: newId,
      date,
      class_name: l.class_name,
      start_time: master.default_start_time,
      end_time: master.default_end_time,
      studio_id: master.default_studio_id,
      instructor_id: master.default_instructor_id,
      notes: null,
    });
  };

  // master展開レッスンを「この日だけ休講/削除」: instance化 + cancelled
  const cancelMasterLesson = async (date: string, l: Lesson, label: string) => {
    if (!l.master_id) return;
    if (!confirm(`「${l.class_name}」をこの日だけ${label}にしますか?`)) return;
    const newId = await instantiateMaster(date, l.master_id, 'cancelled');
    if (!newId) { alert('処理に失敗しました'); return; }
    await reloadDay(date);
  };

  // master選択 + スタジオ/インストラクター上書きで instance作成
  const createInstanceFromMaster = async (date: string, masterId: number, studioId?: number, instructorId?: number) => {
    const master = masters.find(m => m.id === masterId);
    if (!master) return;
    await fetch('/api/staff/schedule/instances', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        start_time: master.default_start_time,
        end_time: master.default_end_time,
        master_id: masterId,
        studio_id: studioId ?? master.default_studio_id,
        instructor_id: instructorId ?? master.default_instructor_id,
        status: 'scheduled',
      }),
    });
    await reloadDay(date);
  };
  const createCustomInstance = async (date: string, payload: { start_time: string; end_time: string; class_name_override: string; studio_id?: number; instructor_id?: number; notes?: string }) => {
    await fetch('/api/staff/schedule/instances', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, ...payload, status: 'scheduled' }),
    });
    await reloadDay(date);
  };

  // 既存instanceの編集を保存
  const saveInstanceEdit = async (target: EditTarget, payload: { start_time: string; end_time: string; studio_id: number | null; instructor_id: number | null; notes: string | null }) => {
    await fetch(`/api/staff/schedule/instances/${target.instance_id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setEditTarget(null);
    await reloadDay(target.date);
  };

  // instance編集モーダルを開く (既存instance用)
  const openInstanceEdit = (date: string, l: Lesson) => {
    if (!l.instance_id) return;
    const studio = studios.find(s => s.name === l.studio_name);
    const instructor = instructorsOpt.find(i => i.name === l.instructor_name);
    setEditTarget({
      instance_id: l.instance_id,
      date,
      class_name: l.class_name,
      start_time: l.start_time,
      end_time: l.end_time,
      studio_id: studio?.id ?? null,
      instructor_id: instructor?.id ?? null,
      notes: l.notes ?? null,
    });
  };

  // カレンダーグリッド: 前月/翌月の日付も薄く表示
  const grid = useMemo<{ date: string; dateNum: number; dow: number; lessons: Lesson[]; otherMonth: boolean }[]>(() => {
    if (!data) return [];
    const firstDow = new Date(data.year, data.month - 1, 1).getDay();
    const cells: { date: string; dateNum: number; dow: number; lessons: Lesson[]; otherMonth: boolean }[] = [];
    // 前月末日付を埋める
    for (let i = firstDow - 1; i >= 0; i--) {
      const prev = new Date(data.year, data.month - 1, -i);
      const y = prev.getFullYear(), m = prev.getMonth() + 1, d = prev.getDate();
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ date: dateStr, dateNum: d, dow: prev.getDay(), lessons: [], otherMonth: true });
    }
    // 当月日付
    for (const d of data.days) {
      cells.push({ date: d.date, dateNum: parseInt(d.date.split('-')[2], 10), dow: d.day_of_week, lessons: d.lessons, otherMonth: false });
    }
    // 翌月日付で埋める (7の倍数まで)
    let nextDay = 1;
    while (cells.length % 7 !== 0) {
      const next = new Date(data.year, data.month, nextDay);
      const y = next.getFullYear(), m = next.getMonth() + 1, d = next.getDate();
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ date: dateStr, dateNum: d, dow: next.getDay(), lessons: [], otherMonth: true });
      nextDay++;
    }
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
              {grid.map((cell) => {
                const dow = cell.dow;
                const isToday = cell.date === todayStr;
                const lessonCount = cell.lessons.length;
                const otherMonth = cell.otherMonth;
                return (
                  <button
                    key={cell.date}
                    onClick={() => {
                      if (otherMonth) {
                        // 月外日付タップで該当月に切替
                        const [oy, om] = cell.date.split('-').map(Number);
                        setYear(oy); setMonth(om);
                      } else {
                        setSelectedDay({ date: cell.date, day_of_week: cell.dow, lessons: cell.lessons });
                      }
                    }}
                    className={`border-r border-b border-neutral-100 min-h-[80px] sm:min-h-[100px] p-1 text-left hover:bg-orange-50 transition-colors ${isToday ? 'bg-orange-50/60' : otherMonth ? 'bg-slate-50/50' : ''}`}
                  >
                    <div className={`text-xs font-bold mb-0.5 ${
                      otherMonth ? 'text-slate-300' :
                      isToday ? 'text-orange-600' : dow === 0 ? 'text-red-600' : dow === 6 ? 'text-blue-600' : 'text-slate-700'
                    }`}>
                      {cell.dateNum}
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
              <div className="space-y-2 mb-3">
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
                    {l.notes && (
                      <div className="mt-1 text-xs text-slate-600">📝 {l.notes}</div>
                    )}
                    {/* アクション */}
                    <div className="mt-2 flex gap-1 flex-wrap">
                      {l.source === 'instance' && l.instance_id && (
                        <>
                          <button onClick={() => openInstanceEdit(selectedDay.date, l)} className="text-[10px] px-2 py-0.5 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded">編集</button>
                          {l.status === 'cancelled' ? (
                            <button onClick={() => restoreInstance(l.instance_id!, selectedDay.date)} className="text-[10px] px-2 py-0.5 bg-green-100 hover:bg-green-200 text-green-700 rounded">復活</button>
                          ) : (
                            <button onClick={() => cancelInstance(l.instance_id!, selectedDay.date)} className="text-[10px] px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-700 rounded">休講にする</button>
                          )}
                          <button onClick={() => deleteInstance(l.instance_id!, selectedDay.date)} className="text-[10px] px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded">削除</button>
                        </>
                      )}
                      {l.source === 'master' && (
                        <>
                          <button onClick={() => editMasterLesson(selectedDay.date, l)} className="text-[10px] px-2 py-0.5 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded">この日を編集</button>
                          <button onClick={() => cancelMasterLesson(selectedDay.date, l, '休講')} className="text-[10px] px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-700 rounded">この日を休講</button>
                          <button onClick={() => cancelMasterLesson(selectedDay.date, l, '非表示')} className="text-[10px] px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded">この日だけ削除</button>
                        </>
                      )}
                    </div>
                    {l.source === 'master' && (
                      <p className="mt-1.5 text-[10px] text-slate-400 leading-tight">通常パターン (週次自動表示)。編集/休講/削除はこの日だけ反映され、他の週は変わりません。</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            <AddLessonForm
              date={selectedDay.date}
              masters={masters}
              studios={studios}
              instructors={instructorsOpt}
              onAddFromMaster={(masterId, studioId, instructorId) => createInstanceFromMaster(selectedDay.date, masterId, studioId, instructorId)}
              onAddCustom={(payload) => createCustomInstance(selectedDay.date, payload)}
            />
          </div>
        </div>
      )}

      {/* 既存instance / master実体化後の編集モーダル */}
      {editTarget && (
        <EditLessonModal
          target={editTarget}
          studios={studios}
          instructors={instructorsOpt}
          onClose={() => setEditTarget(null)}
          onSave={(payload) => saveInstanceEdit(editTarget, payload)}
        />
      )}
    </main>
  );
}

function AddLessonForm({ date, masters, studios, instructors, onAddFromMaster, onAddCustom }: {
  date: string;
  masters: MasterOption[];
  studios: StudioOption[];
  instructors: InstructorOption[];
  onAddFromMaster: (masterId: number, studioId?: number, instructorId?: number) => Promise<void>;
  onAddCustom: (payload: { start_time: string; end_time: string; class_name_override: string; studio_id?: number; instructor_id?: number; notes?: string }) => Promise<void>;
}) {
  const [mode, setMode] = useState<'master' | 'custom'>('master');
  const [selectedMaster, setSelectedMaster] = useState<number | null>(null);
  // マスター選択時のスタジオ/インストラクター上書き ('' = マスター通り)
  const [masterStudio, setMasterStudio] = useState<string>('');
  const [masterInstructor, setMasterInstructor] = useState<string>('');
  const [custom, setCustom] = useState({ start_time: '', end_time: '', class_name_override: '', studio_id: '', instructor_id: '', notes: '' });
  const [busy, setBusy] = useState(false);

  const selectedMasterObj = masters.find(m => m.id === selectedMaster);

  // master選択を変えたらスタジオ/インストラクターをマスター既定にリセット
  const onSelectMaster = (val: string) => {
    const id = val ? Number(val) : null;
    setSelectedMaster(id);
    const m = masters.find(x => x.id === id);
    setMasterStudio(m?.default_studio_id != null ? String(m.default_studio_id) : '');
    setMasterInstructor(m?.default_instructor_id != null ? String(m.default_instructor_id) : '');
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'master') {
        if (!selectedMaster) { alert('クラスを選択してください'); return; }
        await onAddFromMaster(
          selectedMaster,
          masterStudio ? Number(masterStudio) : undefined,
          masterInstructor ? Number(masterInstructor) : undefined,
        );
      } else {
        if (!custom.class_name_override || !custom.start_time || !custom.end_time) {
          alert('クラス名・開始時刻・終了時刻は必須'); return;
        }
        await onAddCustom({
          start_time: custom.start_time,
          end_time: custom.end_time,
          class_name_override: custom.class_name_override,
          studio_id: custom.studio_id ? Number(custom.studio_id) : undefined,
          instructor_id: custom.instructor_id ? Number(custom.instructor_id) : undefined,
          notes: custom.notes || undefined,
        });
        setCustom({ start_time: '', end_time: '', class_name_override: '', studio_id: '', instructor_id: '', notes: '' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t pt-3">
      <h4 className="text-sm font-bold mb-2">➕ {date} にレッスンを追加</h4>
      <div className="flex gap-1 mb-2">
        <button onClick={() => setMode('master')} className={`px-2 py-1 text-xs rounded ${mode === 'master' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600'}`}>📋 マスターから選ぶ</button>
        <button onClick={() => setMode('custom')} className={`px-2 py-1 text-xs rounded ${mode === 'custom' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600'}`}>✨ 特別レッスン</button>
      </div>
      {mode === 'master' ? (
        <div className="space-y-2">
          <select value={selectedMaster ?? ''} onChange={e => onSelectMaster(e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm bg-white">
            <option value="">-- 通常クラスを選択 --</option>
            {masters.map(m => (
              <option key={m.id} value={m.id}>{m.class_name} ({m.default_start_time?.substring(0, 5)}-)</option>
            ))}
          </select>
          {selectedMasterObj && (
            <div className="grid grid-cols-1 gap-2">
              <label className="text-[11px] text-slate-500">
                スタジオ (マスター通りでよければそのまま)
                <select value={masterStudio} onChange={e => setMasterStudio(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 border rounded text-sm bg-white">
                  <option value="">スタジオ未設定</option>
                  {studios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-slate-500">
                インストラクター (マスター通りでよければそのまま)
                <select value={masterInstructor} onChange={e => setMasterInstructor(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 border rounded text-sm bg-white">
                  <option value="">インストラクター未設定</option>
                  {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </label>
            </div>
          )}
          <button onClick={submit} disabled={busy || !selectedMaster} className="w-full py-2 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold disabled:opacity-50">
            {busy ? '追加中...' : 'この日に追加'}
          </button>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <input placeholder="クラス名 (例: 特別ゲストレッスン)" value={custom.class_name_override} onChange={e => setCustom({ ...custom, class_name_override: e.target.value })} className="w-full px-2 py-1.5 border rounded" />
          <div className="grid grid-cols-2 gap-2">
            <input type="time" value={custom.start_time} onChange={e => setCustom({ ...custom, start_time: e.target.value })} className="px-2 py-1.5 border rounded" />
            <input type="time" value={custom.end_time} onChange={e => setCustom({ ...custom, end_time: e.target.value })} className="px-2 py-1.5 border rounded" />
          </div>
          <select value={custom.studio_id} onChange={e => setCustom({ ...custom, studio_id: e.target.value })} className="w-full px-2 py-1.5 border rounded bg-white">
            <option value="">スタジオ (任意)</option>
            {studios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={custom.instructor_id} onChange={e => setCustom({ ...custom, instructor_id: e.target.value })} className="w-full px-2 py-1.5 border rounded bg-white">
            <option value="">インストラクター (任意)</option>
            {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <input placeholder="メモ (任意)" value={custom.notes} onChange={e => setCustom({ ...custom, notes: e.target.value })} className="w-full px-2 py-1.5 border rounded" />
          <button onClick={submit} disabled={busy} className="w-full py-2 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold disabled:opacity-50">
            {busy ? '追加中...' : 'この日に追加'}
          </button>
        </div>
      )}
    </div>
  );
}

function EditLessonModal({ target, studios, instructors, onClose, onSave }: {
  target: EditTarget;
  studios: StudioOption[];
  instructors: InstructorOption[];
  onClose: () => void;
  onSave: (payload: { start_time: string; end_time: string; studio_id: number | null; instructor_id: number | null; notes: string | null }) => Promise<void>;
}) {
  const [startTime, setStartTime] = useState(target.start_time ? target.start_time.substring(0, 5) : '');
  const [endTime, setEndTime] = useState(target.end_time ? target.end_time.substring(0, 5) : '');
  const [studioId, setStudioId] = useState(target.studio_id != null ? String(target.studio_id) : '');
  const [instructorId, setInstructorId] = useState(target.instructor_id != null ? String(target.instructor_id) : '');
  const [notes, setNotes] = useState(target.notes ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!startTime || !endTime) { alert('開始時刻・終了時刻は必須'); return; }
    setBusy(true);
    try {
      await onSave({
        start_time: startTime,
        end_time: endTime,
        studio_id: studioId ? Number(studioId) : null,
        instructor_id: instructorId ? Number(instructorId) : null,
        notes: notes.trim() ? notes.trim() : null,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 pb-2 border-b">
          <h3 className="font-bold text-base">✏️ レッスン編集 ({target.date})</h3>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="text-sm font-bold mb-3">{target.class_name}</div>
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-[11px] text-slate-500 font-semibold">時間</label>
            <div className="grid grid-cols-2 gap-2 mt-0.5">
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="px-2 py-1.5 border rounded" />
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="px-2 py-1.5 border rounded" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-slate-500 font-semibold">スタジオ</label>
            <select value={studioId} onChange={e => setStudioId(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 border rounded bg-white">
              <option value="">未設定</option>
              {studios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-slate-500 font-semibold">インストラクター</label>
            <select value={instructorId} onChange={e => setInstructorId(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 border rounded bg-white">
              <option value="">未設定</option>
              {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-slate-500 font-semibold">メモ</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="メモ (任意)" className="mt-0.5 w-full px-2 py-1.5 border rounded" />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-sm font-semibold">キャンセル</button>
            <button onClick={submit} disabled={busy} className="flex-1 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold disabled:opacity-50">
              {busy ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

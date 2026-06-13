'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Lock, Plus, Pencil, X, Ban, Undo2, Trash2, Sparkles, ClipboardList, Copy, RefreshCw, AlertTriangle, Info } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

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
  confirmed: boolean;
};

// 編集対象 instance の最新情報
type EditTarget = {
  instance_id: number;
  master_id: number | null;
  date: string;
  class_name: string;
  start_time: string;
  end_time: string;
  studio_id: number | null;
  instructor_id: number | null;
  notes: string | null;
};

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

// HH:MM <-> 分 変換
const toMinutes = (hhmm: string): number | null => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};
const fromMinutes = (mins: number): string => {
  const wrapped = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const shiftEnd = (prevStart: string, prevEnd: string, newStart: string): string => {
  const ps = toMinutes(prevStart);
  const pe = toMinutes(prevEnd);
  const ns = toMinutes(newStart);
  if (ps == null || pe == null || ns == null) return prevEnd;
  const dur = pe - ps;
  if (dur <= 0) return prevEnd;
  return fromMinutes(ns + dur);
};

export default function ScheduleCalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<Day | null>(null);
  const [err, setErr] = useState<string>('');
  const [masters, setMasters] = useState<MasterOption[]>([]);
  const [studios, setStudios] = useState<StudioOption[]>([]);
  const [instructorsOpt, setInstructorsOpt] = useState<InstructorOption[]>([]);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // AlertDialog states for confirm actions
  const [confirmDialog, setConfirmDialog] = useState<{ type: string; message: string; onConfirm: () => void } | null>(null);

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

  useEffect(() => {
    fetch('/api/staff/master/studios', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(d => { if (d?.studios) setStudios(d.studios); });
    fetch('/api/staff/master/instructors', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(d => { if (d?.instructors) setInstructorsOpt(d.instructors); });
    fetch('/api/staff/schedule/calendar?year=2026&month=1', { credentials: 'include' }).catch(() => {});
    fetch('/api/staff/master/lessons', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(d => { if (d?.lessons) setMasters(d.lessons); }).catch(() => {});
  }, []);

  const toggleConfirm = async () => {
    if (!data) return;
    if (data.confirmed) {
      setConfirmDialog({
        type: 'unconfirm',
        message: `${year}年${month}月の確定を解除しますか？\n\nマスターの変更がこの月に再び反映されるようになります（マスターと再同期）。`,
        onConfirm: async () => {
          setConfirmDialog(null);
          setConfirmBusy(true);
          try {
            await fetch(`/api/staff/schedule/confirm?year=${year}&month=${month}`, { method: 'DELETE', credentials: 'include' });
            await load(year, month);
          } finally { setConfirmBusy(false); }
        },
      });
    } else {
      setConfirmDialog({
        type: 'confirm',
        message: `${year}年${month}月を確定(凍結)しますか？\n\n現在のカレンダー内容をスナップショットとして固定します。以降マスターを変更してもこの月には反映されません。\n（個別の編集・休講・削除・追加は確定後も可能です）`,
        onConfirm: async () => {
          setConfirmDialog(null);
          setConfirmBusy(true);
          try {
            const res = await fetch('/api/staff/schedule/confirm', {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ year, month }),
            });
            const j = await res.json().catch(() => ({}));
            await load(year, month);
            if (j?.created != null) alert(`${year}年${month}月を確定しました。\n(${j.created}件のレッスンを実体化)`);
          } finally { setConfirmBusy(false); }
        },
      });
    }
  };

  const reloadDay = async (date: string) => {
    await load(year, month);
    const fresh = await fetch(`/api/staff/schedule/calendar?year=${year}&month=${month}`, { credentials: 'include' }).then(r => r.json());
    const d = fresh.days?.find((x: Day) => x.date === date);
    if (d) setSelectedDay(d);
  };

  const patchLessonStatusLocal = (instanceId: number, date: string, status: string) => {
    setSelectedDay((prev) => {
      if (!prev || prev.date !== date) return prev;
      return {
        ...prev,
        lessons: prev.lessons.map((l) =>
          l.instance_id === instanceId ? { ...l, status } : l,
        ),
      };
    });
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map((d) =>
          d.date === date
            ? {
                ...d,
                lessons: d.lessons.map((l) =>
                  l.instance_id === instanceId ? { ...l, status } : l,
                ),
              }
            : d,
        ),
      };
    });
  };

  const cancelInstance = async (instanceId: number, date: string) => {
    setConfirmDialog({
      type: 'cancel',
      message: 'このレッスンを休講にしますか？',
      onConfirm: async () => {
        setConfirmDialog(null);
        patchLessonStatusLocal(instanceId, date, 'cancelled');
        try {
          const res = await fetch(`/api/staff/schedule/instances/${instanceId}`, {
            method: 'PATCH', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'cancelled' }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          load(year, month);
        } catch (e) {
          setErr(`休講失敗: ${e instanceof Error ? e.message : String(e)}`);
          reloadDay(date);
        }
      },
    });
  };

  const restoreInstance = async (instanceId: number, date: string) => {
    patchLessonStatusLocal(instanceId, date, 'scheduled');
    try {
      const res = await fetch(`/api/staff/schedule/instances/${instanceId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'scheduled' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load(year, month);
    } catch (e) {
      setErr(`復活失敗: ${e instanceof Error ? e.message : String(e)}`);
      reloadDay(date);
    }
  };

  const instantiateMaster = async (date: string, masterId: number, status: 'scheduled' | 'cancelled' | 'removed'): Promise<number | null> => {
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

  const editMasterLesson = async (date: string, l: Lesson) => {
    if (!l.master_id) return;
    const master = masters.find(m => m.id === l.master_id);
    if (!master) { alert('マスター情報が読み込めませんでした'); return; }
    const newId = await instantiateMaster(date, l.master_id, 'scheduled');
    if (!newId) { alert('実開催の作成に失敗しました'); return; }
    await reloadDay(date);
    setEditTarget({
      instance_id: newId,
      master_id: l.master_id ?? null,
      date,
      class_name: l.class_name,
      start_time: master.default_start_time,
      end_time: master.default_end_time,
      studio_id: master.default_studio_id,
      instructor_id: master.default_instructor_id,
      notes: null,
    });
  };

  const cancelMasterLesson = async (date: string, l: Lesson) => {
    if (!l.master_id) return;
    setConfirmDialog({
      type: 'cancel-master',
      message: `「${l.class_name}」をこの日だけ休講(記録に残す)にしますか？`,
      onConfirm: async () => {
        setConfirmDialog(null);
        const newId = await instantiateMaster(date, l.master_id!, 'cancelled');
        if (!newId) { alert('処理に失敗しました'); return; }
        await reloadDay(date);
      },
    });
  };

  const removeInstance = async (instanceId: number, date: string, className: string) => {
    setConfirmDialog({
      type: 'remove',
      message: `「${className}」をこの日からなかったことにして削除しますか？\n（休講と違い、横線でも残りません）`,
      onConfirm: async () => {
        setConfirmDialog(null);
        await fetch(`/api/staff/schedule/instances/${instanceId}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'removed' }),
        });
        await reloadDay(date);
      },
    });
  };

  const removeMasterLesson = async (date: string, l: Lesson) => {
    if (!l.master_id) return;
    setConfirmDialog({
      type: 'remove-master',
      message: `「${l.class_name}」をこの日からなかったことにして削除しますか？\n（休講と違い、横線でも残りません）`,
      onConfirm: async () => {
        setConfirmDialog(null);
        const newId = await instantiateMaster(date, l.master_id!, 'removed');
        if (!newId) { alert('処理に失敗しました'); return; }
        await reloadDay(date);
      },
    });
  };

  const removeAllForDay = async () => {
    if (!selectedDay) return;
    const targets = selectedDay.lessons;
    if (targets.length === 0) return;
    setConfirmDialog({
      type: 'remove-all',
      message: `${selectedDay.date} の${targets.length}レッスンを全て削除（スタジオ全休）にしますか？\n（カレンダーから消えます。給与・スタジオ料金には元々計上されません）`,
      onConfirm: async () => {
        setConfirmDialog(null);
        for (const l of targets) {
          if (l.source === 'instance' && l.instance_id) {
            await fetch(`/api/staff/schedule/instances/${l.instance_id}`, {
              method: 'PATCH', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'removed' }),
            });
          } else if (l.master_id) {
            await instantiateMaster(selectedDay!.date, l.master_id, 'removed');
          }
        }
        await reloadDay(selectedDay!.date);
      },
    });
  };

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

  const saveInstanceEdit = async (target: EditTarget, payload: { date: string; start_time: string; end_time: string; studio_id: number | null; instructor_id: number | null; notes: string | null }) => {
    await fetch(`/api/staff/schedule/instances/${target.instance_id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (payload.date !== target.date && target.master_id) {
      await instantiateMaster(target.date, target.master_id, 'removed');
    }
    setEditTarget(null);
    await reloadDay(target.date);
  };

  const openInstanceEdit = (date: string, l: Lesson) => {
    if (!l.instance_id) return;
    const studio = studios.find(s => s.name === l.studio_name);
    const instructor = instructorsOpt.find(i => i.name === l.instructor_name);
    setEditTarget({
      instance_id: l.instance_id,
      master_id: l.master_id ?? null,
      date,
      class_name: l.class_name,
      start_time: l.start_time,
      end_time: l.end_time,
      studio_id: studio?.id ?? null,
      instructor_id: instructor?.id ?? null,
      notes: l.notes ?? null,
    });
  };

  const grid = useMemo<{ date: string; dateNum: number; dow: number; lessons: Lesson[]; otherMonth: boolean }[]>(() => {
    if (!data) return [];
    const firstDow = new Date(data.year, data.month - 1, 1).getDay();
    const cells: { date: string; dateNum: number; dow: number; lessons: Lesson[]; otherMonth: boolean }[] = [];
    for (let i = firstDow - 1; i >= 0; i--) {
      const prev = new Date(data.year, data.month - 1, -i);
      const y = prev.getFullYear(), m = prev.getMonth() + 1, d = prev.getDate();
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ date: dateStr, dateNum: d, dow: prev.getDay(), lessons: [], otherMonth: true });
    }
    for (const d of data.days) {
      cells.push({ date: d.date, dateNum: parseInt(d.date.split('-')[2], 10), dow: d.day_of_week, lessons: d.lessons, otherMonth: false });
    }
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
    <div className="text-neutral-900">
      <div className="max-w-6xl mx-auto p-3 sm:p-4">
        {/* Header bar with export + today buttons */}
        <div className="flex items-center justify-end gap-1.5 mb-3">
          <Button size="sm" onClick={() => setShowExport(true)}>
            <Download className="size-3.5" />
            エクスポート
          </Button>
          <Button size="sm" variant="outline" onClick={goToday}>
            今日
          </Button>
        </div>

        {/* 月切り替えバー */}
        <div className="bg-white rounded-lg border border-neutral-200 p-3 mb-3 flex items-center justify-between">
          <Button variant="secondary" size="sm" onClick={prevMonth}>
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="text-lg sm:text-xl font-bold text-orange-700 flex items-center gap-2">
            {year}年 {month}月
            {data?.confirmed && (
              <Badge variant="secondary" className="text-[10px]">
                <Lock className="size-3 mr-0.5" />
                確定済
              </Badge>
            )}
          </h2>
          <Button variant="secondary" size="sm" onClick={nextMonth}>
            <ChevronRight className="size-4" />
          </Button>
        </div>

        {/* 月の確定/確定解除バー */}
        {data && (
          <div className={`rounded-lg border p-3 mb-3 flex items-center justify-between gap-2 ${data.confirmed ? 'bg-sky-50 border-sky-200' : 'bg-amber-50 border-amber-200'}`}>
            <p className="text-xs text-slate-600 leading-snug flex items-start gap-1">
              {data.confirmed ? <Lock className="size-3 mt-0.5 shrink-0" /> : <Info className="size-3 mt-0.5 shrink-0" />}
              <span>
                {data.confirmed
                  ? 'この月は確定(凍結)済みです。マスターを変更してもこの月には反映されません。個別の編集・休講・削除・追加は可能です。'
                  : 'この月は未確定です。マスターの変更が自動反映されます。給与/スタジオ料金/明細を確定したら「この月を確定」してください。'}
              </span>
            </p>
            <Button
              onClick={toggleConfirm}
              disabled={confirmBusy}
              size="sm"
              variant={data.confirmed ? 'outline' : 'default'}
              className="shrink-0"
            >
              {confirmBusy ? '処理中...' : data.confirmed ? '確定を解除' : 'この月を確定'}
            </Button>
          </div>
        )}

        {err && (
          <div className="mb-3 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-1">
            <AlertTriangle className="size-4 shrink-0" />
            読込エラー: {err}
          </div>
        )}

        {loading && <p className="text-muted-foreground text-sm">読込中...</p>}

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
                      {isToday && <Badge variant="default" className="ml-1 text-[9px] px-1 py-0 h-auto">今日</Badge>}
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
                          title={`${l.start_time ? l.start_time.substring(0, 5) : '時間未設定'} ${l.class_name}${l.instructor_name ? ` (${l.instructor_name})` : ''}`}
                        >
                          <span className="font-semibold">{(l.class_name ?? '').replace(/​/g, '').substring(0, 10)}</span>
                          {l.start_time && <span className="ml-0.5 opacity-60">{l.start_time.substring(0, 5)}</span>}
                        </div>
                      ))}
                      {lessonCount > 3 && (
                        <div className="text-[9px] text-muted-foreground">+{lessonCount - 3}件</div>
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
          <p className="text-xs text-muted-foreground mt-2">
            この月の実開催 {data.instances_count}件 / マスター{data.masters_count}件から展開
          </p>
        )}
      </div>

      {/* 日別詳細パネル */}
      <Dialog open={!!selectedDay} onOpenChange={(open) => { if (!open) setSelectedDay(null); }}>
        <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
          {selectedDay && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selectedDay.date} ({DOW_LABELS[selectedDay.day_of_week]})
                </DialogTitle>
                <DialogDescription>この日のレッスン一覧</DialogDescription>
              </DialogHeader>
              {selectedDay.lessons.length > 0 && (
                <Button variant="destructive" size="sm" onClick={removeAllForDay} className="w-full">
                  <Ban className="size-3.5" />
                  スタジオ全休（この日の{selectedDay.lessons.length}レッスンを全削除）
                </Button>
              )}
              {selectedDay.lessons.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">この日はレッスン無し</p>
              ) : (
                <div className="space-y-1 mb-3">
                  {selectedDay.lessons.map((l, i) => {
                    const isInst = l.source === 'instance';
                    const cancelled = l.status === 'cancelled';
                    return (
                    <div
                      key={i}
                      className={`px-2 py-1.5 rounded border ${
                        isInst
                          ? cancelled ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'
                          : 'bg-blue-50 border-blue-200'
                      }`}
                    >
                      <div className={`flex items-center gap-2 ${cancelled ? 'text-red-400 line-through' : ''}`}>
                        <span className="font-mono text-xs font-bold whitespace-nowrap">{l.start_time ? l.start_time.substring(0, 5) : '--:--'}</span>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">{l.studio_name ?? '-'}</span>
                        <span className="text-sm font-semibold truncate">{l.class_name}</span>
                        {l.instructor_name && <span className="text-[11px] text-muted-foreground whitespace-nowrap">{l.instructor_name}</span>}
                      </div>
                      {l.notes && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{l.notes}</div>}
                      <div className="mt-1 flex gap-1 flex-wrap">
                        {isInst && l.instance_id && (
                          <>
                            <Button size="xs" variant="ghost" className="text-orange-700 bg-orange-100 hover:bg-orange-200" onClick={() => openInstanceEdit(selectedDay.date, l)}>
                              <Pencil className="size-3" />
                              編集
                            </Button>
                            {cancelled ? (
                              <Button size="xs" variant="ghost" className="text-green-700 bg-green-100 hover:bg-green-200" onClick={() => restoreInstance(l.instance_id!, selectedDay.date)}>
                                <Undo2 className="size-3" />
                                復活
                              </Button>
                            ) : (
                              <Button size="xs" variant="ghost" className="text-red-700 bg-red-100 hover:bg-red-200" onClick={() => cancelInstance(l.instance_id!, selectedDay.date)}>
                                <Ban className="size-3" />
                                休講
                              </Button>
                            )}
                            <Button size="xs" variant="ghost" className="text-slate-700 bg-slate-200 hover:bg-slate-300" onClick={() => removeInstance(l.instance_id!, selectedDay.date, l.class_name)}>
                              <Trash2 className="size-3" />
                              削除
                            </Button>
                          </>
                        )}
                        {!isInst && (
                          <>
                            <Button size="xs" variant="ghost" className="text-orange-700 bg-orange-100 hover:bg-orange-200" onClick={() => editMasterLesson(selectedDay.date, l)}>
                              <Pencil className="size-3" />
                              編集
                            </Button>
                            <Button size="xs" variant="ghost" className="text-red-700 bg-red-100 hover:bg-red-200" onClick={() => cancelMasterLesson(selectedDay.date, l)}>
                              <Ban className="size-3" />
                              休講
                            </Button>
                            <Button size="xs" variant="ghost" className="text-slate-700 bg-slate-200 hover:bg-slate-300" onClick={() => removeMasterLesson(selectedDay.date, l)}>
                              <Trash2 className="size-3" />
                              削除
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    );
                  })}
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
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* エクスポートモーダル */}
      <Dialog open={showExport} onOpenChange={setShowExport}>
        <DialogContent className="sm:max-w-lg max-h-[88vh] overflow-y-auto">
          <ExportModalContent onClose={() => setShowExport(false)} />
        </DialogContent>
      </Dialog>

      {/* 既存instance / master実体化後の編集モーダル */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          {editTarget && (
            <EditLessonContent
              target={editTarget}
              studios={studios}
              instructors={instructorsOpt}
              onClose={() => setEditTarget(null)}
              onSave={(payload) => saveInstanceEdit(editTarget, payload)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Generic AlertDialog for confirmations */}
      <AlertDialog open={!!confirmDialog} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {confirmDialog?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDialog?.onConfirm()}>
              実行する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
  const [mode, setMode] = useState<string>('master');
  const [selectedMaster, setSelectedMaster] = useState<string>('');
  const [masterStudio, setMasterStudio] = useState<string>('');
  const [masterInstructor, setMasterInstructor] = useState<string>('');
  const [custom, setCustom] = useState({ start_time: '', end_time: '', class_name_override: '', studio_id: '', instructor_id: '', notes: '' });
  const [busy, setBusy] = useState(false);

  const selectedMasterObj = masters.find(m => m.id === Number(selectedMaster));

  const onSelectMaster = (val: string) => {
    setSelectedMaster(val);
    const m = masters.find(x => x.id === Number(val));
    setMasterStudio(m?.default_studio_id != null ? String(m.default_studio_id) : '');
    setMasterInstructor(m?.default_instructor_id != null ? String(m.default_instructor_id) : '');
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'master') {
        if (!selectedMaster) { alert('クラスを選択してください'); return; }
        await onAddFromMaster(
          Number(selectedMaster),
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
      <h4 className="text-sm font-bold mb-2 flex items-center gap-1">
        <Plus className="size-4" />
        {date} にレッスンを追加
      </h4>
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList className="mb-2">
          <TabsTrigger value="master">
            <ClipboardList className="size-3" />
            マスターから選ぶ
          </TabsTrigger>
          <TabsTrigger value="custom">
            <Sparkles className="size-3" />
            特別レッスン
          </TabsTrigger>
        </TabsList>
        <TabsContent value="master">
          <div className="space-y-2">
            <Select value={selectedMaster} onValueChange={onSelectMaster}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="-- 通常クラスを選択 --" />
              </SelectTrigger>
              <SelectContent>
                {masters.map(m => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.class_name} ({m.default_start_time?.substring(0, 5)}-)</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedMasterObj && (
              <div className="grid grid-cols-1 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">スタジオ (マスター通りでよければそのまま)</Label>
                  <Select value={masterStudio} onValueChange={setMasterStudio}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="スタジオ未設定" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">スタジオ未設定</SelectItem>
                      {studios.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">インストラクター (マスター通りでよければそのまま)</Label>
                  <Select value={masterInstructor} onValueChange={setMasterInstructor}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="インストラクター未設定" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">インストラクター未設定</SelectItem>
                      {instructors.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <Button onClick={submit} disabled={busy || !selectedMaster} className="w-full">
              {busy ? '追加中...' : 'この日に追加'}
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="custom">
          <div className="space-y-2 text-sm">
            <Input placeholder="クラス名 (例: 特別ゲストレッスン)" value={custom.class_name_override} onChange={e => setCustom({ ...custom, class_name_override: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="time" value={custom.start_time} onChange={e => {
                const newStart = e.target.value;
                const nextEnd = (custom.start_time && custom.end_time && newStart) ? shiftEnd(custom.start_time, custom.end_time, newStart) : custom.end_time;
                setCustom({ ...custom, start_time: newStart, end_time: nextEnd });
              }} />
              <Input type="time" value={custom.end_time} onChange={e => setCustom({ ...custom, end_time: e.target.value })} />
            </div>
            <Select value={custom.studio_id || '__none__'} onValueChange={v => setCustom({ ...custom, studio_id: v === '__none__' ? '' : v })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="スタジオ (任意)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">スタジオ (任意)</SelectItem>
                {studios.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={custom.instructor_id || '__none__'} onValueChange={v => setCustom({ ...custom, instructor_id: v === '__none__' ? '' : v })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="インストラクター (任意)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">インストラクター (任意)</SelectItem>
                {instructors.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="メモ (任意)" value={custom.notes} onChange={e => setCustom({ ...custom, notes: e.target.value })} />
            <Button onClick={submit} disabled={busy} className="w-full">
              {busy ? '追加中...' : 'この日に追加'}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EditLessonContent({ target, studios, instructors, onClose, onSave }: {
  target: EditTarget;
  studios: StudioOption[];
  instructors: InstructorOption[];
  onClose: () => void;
  onSave: (payload: { date: string; start_time: string; end_time: string; studio_id: number | null; instructor_id: number | null; notes: string | null }) => Promise<void>;
}) {
  const [editDate, setEditDate] = useState(target.date);
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
        date: editDate,
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
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-1">
          <Pencil className="size-4" />
          レッスン編集 ({target.date})
        </DialogTitle>
        <DialogDescription>{target.class_name}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        <div className="space-y-1">
          <Label className="text-[11px] font-semibold">スタジオ</Label>
          <Select value={studioId || '__none__'} onValueChange={v => setStudioId(v === '__none__' ? '' : v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="未設定" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">未設定</SelectItem>
              {studios.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] font-semibold">時間</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input type="time" value={startTime} onChange={e => {
              const newStart = e.target.value;
              if (startTime && endTime && newStart) setEndTime(shiftEnd(startTime, endTime, newStart));
              setStartTime(newStart);
            }} />
            <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] font-semibold">インストラクター</Label>
          <Select value={instructorId || '__none__'} onValueChange={v => setInstructorId(v === '__none__' ? '' : v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="未設定" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">未設定</SelectItem>
              {instructors.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] font-semibold">メモ</Label>
          <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="メモ (任意)" />
        </div>
        {/* 日付変更は「別日へ移動」する危険操作なので最下部に分離 */}
        <div className="space-y-1 border-t pt-3 mt-1">
          <Label className="text-[11px] font-semibold text-amber-600">日付（変更すると別日へ移動）</Label>
          <Input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
        </div>
        <DialogFooter className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} className="flex-1">キャンセル</Button>
          <Button onClick={submit} disabled={busy} className="flex-1">
            {busy ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </div>
    </>
  );
}

// エクスポートモーダル内容
function ExportModalContent({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [tokenErr, setTokenErr] = useState<string>('');
  const [months, setMonths] = useState('3');
  const [copied, setCopied] = useState(false);
  const [blockCopied, setBlockCopied] = useState(false);
  type HacoCheck = {
    months: number;
    rowCount: number;
    matchedCount: number;
    unresolvedCount: number;
    unresolvedDetail: { programs: string[]; staff: string[]; spaces: string[] };
  };
  const [hacoCheck, setHacoCheck] = useState<HacoCheck | null>(null);
  const [hacoCheckErr, setHacoCheckErr] = useState('');
  const monthsNum = Number(months);
  const hacoCheckFresh = hacoCheck && hacoCheck.months === monthsNum ? hacoCheck : null;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/staff/schedule/export/token', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => { if (!cancelled) setToken(d.token ?? null); })
      .catch(e => { if (!cancelled) setTokenErr(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/staff/schedule/export/hacomono?months=${monthsNum}&format=json`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => { if (!cancelled) { setHacoCheckErr(''); setHacoCheck({ ...d, months: monthsNum }); } })
      .catch(e => { if (!cancelled) setHacoCheckErr(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [monthsNum]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const icsUrl = token ? `${origin}/api/staff/schedule/export/ics?token=${token}&months=${monthsNum}` : '';
  const blockIcsUrl = token ? `${origin}/api/staff/schedule/export/ics?token=${token}&months=${monthsNum}&mode=block` : '';

  const copyIcs = async () => {
    if (!icsUrl) return;
    try {
      await navigator.clipboard.writeText(icsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('コピーに失敗しました。手動で選択してください。');
    }
  };

  const copyBlockIcs = async () => {
    if (!blockIcsUrl) return;
    try {
      await navigator.clipboard.writeText(blockIcsUrl);
      setBlockCopied(true);
      setTimeout(() => setBlockCopied(false), 2000);
    } catch {
      alert('コピーに失敗しました。手動で選択してください。');
    }
  };

  const downloadCsv = () => {
    window.open(`/api/staff/schedule/export/csv?months=${monthsNum}`, '_blank');
  };

  const downloadHacomono = () => {
    window.open(`/api/staff/schedule/export/hacomono?months=${monthsNum}`, '_blank');
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-1">
          <Download className="size-4" />
          スケジュールをエクスポート
        </DialogTitle>
        <DialogDescription>外部カレンダーへの連携・CSV出力</DialogDescription>
      </DialogHeader>

      {/* 連携ハブ導線 */}
      <Link
        href="/staff/schedule/sync"
        className="block p-2.5 rounded-lg bg-orange-100 border border-orange-200 text-[11px] text-orange-800 hover:bg-orange-200 font-semibold"
      >
        <RefreshCw className="inline size-3 mr-1" />
        カレンダー連携ハブを開く（3カレンダーの設定手順・接続状況をまとめて確認）→
      </Link>

      {/* 期間選択 */}
      <div className="space-y-1">
        <Label className="text-[11px] font-semibold">出力期間 (今月から)</Label>
        <Select value={months} onValueChange={setMonths}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1ヶ月</SelectItem>
            <SelectItem value="2">2ヶ月</SelectItem>
            <SelectItem value="3">3ヶ月</SelectItem>
            <SelectItem value="6">6ヶ月</SelectItem>
            <SelectItem value="12">12ヶ月</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ICS購読 */}
      <div className="p-3 rounded-lg bg-orange-50 border border-orange-200 space-y-2">
        <h4 className="text-sm font-bold text-orange-800 flex items-center gap-1">
          <CalendarDays className="size-4" />
          Googleカレンダーに自動同期 (ICS購読)
        </h4>
        <p className="text-[11px] text-slate-600 leading-snug">
          下のURLをGoogleカレンダーに登録すると、BW5のレッスン予定が自動で反映されます。
          休講にした回は「キャンセル済み」として表示されます。
        </p>
        {tokenErr ? (
          <p className="text-xs text-red-600">トークン取得エラー: {tokenErr}</p>
        ) : !token ? (
          <p className="text-xs text-muted-foreground">トークン取得中...</p>
        ) : (
          <>
            <div className="flex gap-1.5 items-stretch">
              <Input
                readOnly
                value={icsUrl}
                onFocus={e => e.currentTarget.select()}
                className="flex-1 text-[11px] font-mono"
              />
              <Button size="sm" onClick={copyIcs} className="whitespace-nowrap">
                <Copy className="size-3" />
                {copied ? 'コピー済' : 'コピー'}
              </Button>
            </div>
            <ol className="text-[11px] text-slate-600 leading-relaxed list-decimal pl-4 space-y-0.5">
              <li>上のURLをコピー</li>
              <li>Googleカレンダー左の「他のカレンダー」+ → 「URLで追加」</li>
              <li>URLを貼り付けて「カレンダーを追加」</li>
              <li className="text-muted-foreground">※ Google側の更新反映は数時間〜最大1日かかる場合があります</li>
            </ol>
          </>
        )}
      </div>

      {/* Lstep体験ブロック用 ICS購読 */}
      <div className="p-3 rounded-lg bg-orange-50 border border-orange-200 space-y-2">
        <h4 className="text-sm font-bold text-orange-800 flex items-center gap-1">
          <Ban className="size-4" />
          Lstep体験ブロック用 ICS購読
        </h4>
        <p className="text-[11px] text-slate-600 leading-snug">
          このURLを専用Googleカレンダーに購読させ、Lstepの「Gカレ→シフト連携」に紐付けると、
          休講日の体験予約が自動で閉じます。
          <br />
          <span className="text-muted-foreground">
            ※ 休講にした枠の時間だけが「予定あり」として出力されます (通常のレッスン同期URLとは別物)。
          </span>
        </p>
        {tokenErr ? (
          <p className="text-xs text-red-600">トークン取得エラー: {tokenErr}</p>
        ) : !token ? (
          <p className="text-xs text-muted-foreground">トークン取得中...</p>
        ) : (
          <div className="flex gap-1.5 items-stretch">
            <Input
              readOnly
              value={blockIcsUrl}
              onFocus={e => e.currentTarget.select()}
              className="flex-1 text-[11px] font-mono"
            />
            <Button size="sm" onClick={copyBlockIcs} className="whitespace-nowrap">
              <Copy className="size-3" />
              {blockCopied ? 'コピー済' : 'コピー'}
            </Button>
          </div>
        )}
      </div>

      {/* CSV */}
      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
        <h4 className="text-sm font-bold text-slate-700 flex items-center gap-1">
          <Download className="size-4" />
          汎用CSVダウンロード
        </h4>
        <p className="text-[11px] text-slate-600 leading-snug">
          日付・時刻・クラス・インストラクター・スタジオ・ステータスの一覧 (UTF-8 BOM付き)。
          HACOMONO/Lstep向け変換の素材に使えます。
        </p>
        <Button variant="secondary" onClick={downloadCsv} className="w-full">
          CSVをダウンロード ({monthsNum}ヶ月分)
        </Button>
      </div>

      {/* HACOMONO形式CSV */}
      <div className="p-3 rounded-lg bg-orange-50 border border-orange-200 space-y-2">
        <h4 className="text-sm font-bold text-orange-800 flex items-center gap-1">
          <RefreshCw className="size-4" />
          HACOMONO形式CSV (スケジュールインポート用)
        </h4>
        <p className="text-[11px] text-slate-600 leading-snug">
          HACOMONOの「スケジュールインポート」にそのままアップロードできる形式 (UTF-8 BOM付き)。
          開始日時がキーで、既存と一致すれば更新・無ければ新規。休講は「非公開レッスン」として出力します。
        </p>

        {!hacoCheckFresh && hacoCheckErr ? (
          <p className="text-xs text-red-600">マッピング確認エラー: {hacoCheckErr}</p>
        ) : !hacoCheckFresh ? (
          <p className="text-xs text-muted-foreground">マッピング確認中...</p>
        ) : (
          <div className="text-[11px]">
            <p className="text-slate-700">
              {monthsNum}ヶ月分 {hacoCheckFresh.rowCount}件中、
              <span className="font-semibold text-green-700"> {hacoCheckFresh.matchedCount}件マッチ</span>
              {hacoCheckFresh.unresolvedCount > 0 && (
                <span className="font-semibold text-red-600"> / {hacoCheckFresh.unresolvedCount}件 未解決</span>
              )}
            </p>
            {hacoCheckFresh.unresolvedCount > 0 && (
              <div className="mt-1 p-2 rounded bg-red-50 border border-red-200 text-red-700 leading-relaxed">
                <p className="font-semibold mb-0.5 flex items-center gap-1">
                  <AlertTriangle className="size-3" />
                  以下はコードが空欄で出力されます (要マッピング追加):
                </p>
                {hacoCheckFresh.unresolvedDetail.programs.length > 0 && (
                  <p>プログラム: {hacoCheckFresh.unresolvedDetail.programs.join('、')}</p>
                )}
                {hacoCheckFresh.unresolvedDetail.staff.length > 0 && (
                  <p>スタッフ: {hacoCheckFresh.unresolvedDetail.staff.join('、')}</p>
                )}
                {hacoCheckFresh.unresolvedDetail.spaces.length > 0 && (
                  <p>スペース: {hacoCheckFresh.unresolvedDetail.spaces.join('、')}</p>
                )}
              </div>
            )}
          </div>
        )}

        <Button onClick={downloadHacomono} className="w-full">
          HACOMONO形式CSVをダウンロード ({monthsNum}ヶ月分)
        </Button>
      </div>
    </>
  );
}

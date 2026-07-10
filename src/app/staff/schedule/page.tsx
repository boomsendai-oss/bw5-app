'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Plus, Upload } from 'lucide-react';
import StaffPageHeader from '@/components/StaffPageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Schedule = {
  id: number;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  class_name: string;
  target: string | null;
  location: string | null;
  instructor: string | null;
  status: string;
  notes: string | null;
  exception_date: string | null;
  exception_type: string | null;
  override_start_time: string | null;
  override_end_time: string | null;
  override_location: string | null;
  override_instructor: string | null;
  base_schedule_id: number | null;
  created_at: string | null;
  updated_at: string | null;
};

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

type EditForm = Partial<Schedule> & { class_name: string };

const EMPTY_FORM: EditForm = {
  day_of_week: 1,
  start_time: '',
  end_time: '',
  class_name: '',
  target: '',
  location: '',
  instructor: '',
  status: 'active',
  notes: '',
};

export default function SchedulePage() {
  const [regular, setRegular] = useState<Schedule[]>([]);
  const [exceptions, setExceptions] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>('regular');
  const [dayFilter, setDayFilter] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Schedule | null>(null);
  const [cancelDate, setCancelDate] = useState<string>('');
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvMessage, setCsvMessage] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  // AlertDialog state for delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date();
      const from = today.toISOString().slice(0, 10);
      const inAMonth = new Date(today.getTime() + 31 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const url = `/api/staff/schedule?from=${from}&to=${inAMonth}`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/schedule';
        return;
      }
      const data = await res.json();
      setRegular(data.regular ?? []);
      setExceptions(data.exceptions ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRegular = useMemo(() => {
    if (dayFilter === null) return regular;
    return regular.filter((s) => s.day_of_week === dayFilter);
  }, [regular, dayFilter]);

  const grouped = useMemo(() => {
    const g = new Map<number, Schedule[]>();
    for (const s of filteredRegular) {
      const d = s.day_of_week ?? -1;
      const arr = g.get(d) ?? [];
      arr.push(s);
      g.set(d, arr);
    }
    return g;
  }, [filteredRegular]);

  const openNew = () => {
    setEditingId(null);
    setEditing({ ...EMPTY_FORM });
  };
  const openEdit = (s: Schedule) => {
    setEditingId(s.id);
    setEditing({ ...s });
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.class_name || !editing.class_name.trim()) {
      alert('クラス名を入力してください');
      return;
    }
    const snapshot = editing;
    const snapshotId = editingId;
    const method = snapshotId ? 'PATCH' : 'POST';
    const url = snapshotId ? `/api/staff/schedule/${snapshotId}` : '/api/staff/schedule';
    setEditing(null);
    setEditingId(null);
    if (snapshotId) {
      const updater = (list: Schedule[]) =>
        list.map((x) => (x.id === snapshotId ? { ...x, ...snapshot, id: snapshotId } as Schedule : x));
      setRegular((prev) => updater(prev));
      setExceptions((prev) => updater(prev));
    }
    try {
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch (e) {
      alert(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
      load();
    }
  };

  const removeOne = async (id: number) => {
    setEditing(null);
    setEditingId(null);
    setDeleteConfirmId(null);
    setRegular((prev) => prev.filter((x) => x.id !== id));
    setExceptions((prev) => prev.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/staff/schedule/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch (e) {
      alert(`削除失敗: ${e instanceof Error ? e.message : String(e)}`);
      load();
    }
  };

  const submitCancel = async () => {
    if (!cancelTarget || !cancelDate) return;
    const target = cancelTarget;
    const date = cancelDate;
    const body = {
      class_name: target.class_name,
      day_of_week: target.day_of_week,
      start_time: target.start_time,
      end_time: target.end_time,
      target: target.target,
      location: target.location,
      instructor: target.instructor,
      status: '休講',
      exception_date: date,
      exception_type: '休講',
      base_schedule_id: target.id,
    };
    setCancelTarget(null);
    setCancelDate('');
    const optimisticId = -Date.now();
    const optimisticEntry: Schedule = {
      id: optimisticId,
      day_of_week: target.day_of_week,
      start_time: target.start_time,
      end_time: target.end_time,
      class_name: target.class_name,
      target: target.target,
      location: target.location,
      instructor: target.instructor,
      status: '休講',
      notes: null,
      exception_date: date,
      exception_type: '休講',
      override_start_time: null,
      override_end_time: null,
      override_location: null,
      override_instructor: null,
      base_schedule_id: target.id,
      created_at: null,
      updated_at: null,
    };
    setExceptions((prev) => [...prev, optimisticEntry]);
    try {
      const res = await fetch('/api/staff/schedule', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch (e) {
      alert(`登録失敗: ${e instanceof Error ? e.message : String(e)}`);
      load();
    }
  };

  const uploadCsv = async (file: File) => {
    setCsvBusy(true);
    setCsvMessage('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/staff/schedule/upload-csv', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setCsvMessage(`エラー: ${data.error ?? '不明'}`);
      } else {
        const errMsg =
          data.errors && data.errors.length > 0
            ? ` / 失敗 ${data.errors.length}件 (例: ${data.errors[0]?.reason})`
            : '';
        setCsvMessage(`登録 ${data.inserted} 件${errMsg}`);
        await load();
      }
    } finally {
      setCsvBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="pb-20">
      <StaffPageHeader title="スケジュール" />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="bg-white border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <TabsList>
              <TabsTrigger value="regular">通常パターン</TabsTrigger>
              <TabsTrigger value="exception">例外 ({exceptions.length})</TabsTrigger>
            </TabsList>
            <div className="ml-auto flex gap-2">
              <Button size="sm" onClick={openNew}>
                <Plus className="size-3.5" />
                新規追加
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={csvBusy}
              >
                <Upload className="size-3.5" />
                CSV一括投入
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadCsv(f);
                }}
              />
            </div>
          </div>

          {tab === 'regular' && (
            <div className="flex gap-1 mt-2 overflow-x-auto">
              <Button
                size="xs"
                variant={dayFilter === null ? 'default' : 'outline'}
                onClick={() => setDayFilter(null)}
              >
                全部
              </Button>
              {DOW_LABELS.map((label, idx) => (
                <Button
                  key={idx}
                  size="xs"
                  variant={dayFilter === idx ? 'default' : 'outline'}
                  onClick={() => setDayFilter(idx)}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}

          {csvMessage && (
            <p className="text-xs mt-2 text-brand-700">{csvMessage}</p>
          )}
        </div>

        <div className="px-3 py-3 max-w-2xl mx-auto">
          {loading && <p className="text-sm text-muted-foreground text-center py-6">読み込み中...</p>}

          <TabsContent value="regular">
            {!loading && (
              <div className="space-y-4">
                {Array.from(grouped.keys())
                  .sort((a, b) => a - b)
                  .map((dow) => (
                    <section key={dow}>
                      <h2 className="text-sm font-bold text-neutral-700 mb-1">
                        {dow >= 0 ? `${DOW_LABELS[dow]}曜日` : '曜日未設定'}
                      </h2>
                      <div className="space-y-2">
                        {grouped.get(dow)!.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => openEdit(s)}
                            className="w-full text-left bg-white border border-neutral-200 rounded-xl p-3 active:bg-brand-50"
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-semibold text-neutral-800 truncate">
                                {s.start_time || '--:--'}&ndash;{s.end_time || '--:--'} {s.class_name}
                              </span>
                              {s.status !== 'active' && (
                                <Badge variant="secondary">{s.status}</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {[s.location, s.instructor, s.target].filter(Boolean).join(' / ') || '—'}
                            </div>
                            <div className="flex gap-2 mt-2">
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEdit(s);
                                }}
                                className="text-[11px] bg-brand-50 text-brand-700 rounded-full px-2 py-0.5"
                              >
                                編集
                              </span>
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCancelTarget(s);
                                  setCancelDate('');
                                }}
                                className="text-[11px] bg-red-50 text-red-700 rounded-full px-2 py-0.5"
                              >
                                休講登録
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                {grouped.size === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">スケジュールがありません</p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="exception">
            {!loading && (
              <div className="space-y-2">
                {exceptions.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    今後1ヶ月の例外はありません
                  </p>
                )}
                {exceptions.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => openEdit(e)}
                    className="w-full text-left bg-white border border-neutral-200 rounded-xl p-3 active:bg-brand-50"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-neutral-800 truncate">
                        {e.exception_date} {e.class_name}
                      </span>
                      <Badge variant="destructive">
                        {e.exception_type || '例外'}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {[
                        e.override_start_time || e.start_time,
                        e.override_location || e.location,
                        e.override_instructor || e.instructor,
                      ]
                        .filter(Boolean)
                        .join(' / ') || '—'}
                    </div>
                  </button>
                ))}
                <Button
                  variant="outline"
                  className="w-full border-dashed border-brand-300 text-brand-700"
                  onClick={() => {
                    setEditingId(null);
                    setEditing({
                      ...EMPTY_FORM,
                      exception_date: new Date().toISOString().slice(0, 10),
                      exception_type: '振替',
                    });
                  }}
                >
                  <Plus className="size-3.5" />
                  振替レッスン追加
                </Button>
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>

      {/* Edit Dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'スケジュール編集' : '新規追加'}</DialogTitle>
            <DialogDescription>レッスンスケジュールの詳細を入力してください</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 text-sm">
              <div className="space-y-1">
                <Label>曜日</Label>
                <Select
                  value={editing.day_of_week != null ? String(editing.day_of_week) : '__none__'}
                  onValueChange={(v) =>
                    setEditing({
                      ...editing,
                      day_of_week: v === '__none__' ? null : Number(v),
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="未設定" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">未設定</SelectItem>
                    {DOW_LABELS.map((l, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>開始</Label>
                  <Input
                    type="time"
                    value={editing.start_time ?? ''}
                    onChange={(e) => setEditing({ ...editing, start_time: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>終了</Label>
                  <Input
                    type="time"
                    value={editing.end_time ?? ''}
                    onChange={(e) => setEditing({ ...editing, end_time: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>クラス名 *</Label>
                <Input
                  value={editing.class_name ?? ''}
                  onChange={(e) => setEditing({ ...editing, class_name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>対象</Label>
                <Input
                  value={editing.target ?? ''}
                  onChange={(e) => setEditing({ ...editing, target: e.target.value })}
                  placeholder="キッズ / 一般 / ガールズ"
                />
              </div>
              <div className="space-y-1">
                <Label>場所</Label>
                <Input
                  value={editing.location ?? ''}
                  onChange={(e) => setEditing({ ...editing, location: e.target.value })}
                  placeholder="多賀城 / 長町 / 七ヶ浜"
                />
              </div>
              <div className="space-y-1">
                <Label>インストラクター</Label>
                <Input
                  value={editing.instructor ?? ''}
                  onChange={(e) => setEditing({ ...editing, instructor: e.target.value })}
                  placeholder="TARO"
                />
              </div>
              <div className="space-y-1">
                <Label>状態</Label>
                <Select
                  value={editing.status ?? 'active'}
                  onValueChange={(v) => setEditing({ ...editing, status: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">active</SelectItem>
                    <SelectItem value="休講">休講</SelectItem>
                    <SelectItem value="廃止">廃止</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(editing.exception_date || editingId === null) && (
                <div className="space-y-1">
                  <Label>例外日 (空なら通常パターン)</Label>
                  <Input
                    type="date"
                    value={editing.exception_date ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, exception_date: e.target.value || null })
                    }
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label>備考</Label>
                <Textarea
                  value={editing.notes ?? ''}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  rows={2}
                />
              </div>
              <DialogFooter className="flex gap-2 pt-2">
                {editingId !== null && (
                  <Button
                    variant="destructive"
                    onClick={() => setDeleteConfirmId(editingId)}
                  >
                    廃止
                  </Button>
                )}
                <Button onClick={save} className="flex-1">
                  保存
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation AlertDialog */}
      <AlertDialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>スケジュールを廃止しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              このスケジュールを廃止すると、関連する予定が削除されます。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirmId !== null && removeOne(deleteConfirmId)}>
              廃止する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel lesson Dialog */}
      <Dialog open={!!cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>休講登録</DialogTitle>
            <DialogDescription>レッスンを休講にする日付を選択してください</DialogDescription>
          </DialogHeader>
          {cancelTarget && (
            <div className="space-y-3 text-sm">
              <p className="text-neutral-700">
                <span className="font-semibold">{cancelTarget.class_name}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  {cancelTarget.start_time}&ndash;{cancelTarget.end_time}
                </span>
              </p>
              <div className="space-y-1">
                <Label>休講にする日付</Label>
                <Input
                  type="date"
                  value={cancelDate}
                  onChange={(e) => setCancelDate(e.target.value)}
                />
              </div>
              <Button
                variant="destructive"
                onClick={submitCancel}
                disabled={!cancelDate}
                className="w-full"
              >
                この日を休講にする
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

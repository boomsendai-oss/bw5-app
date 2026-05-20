'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import StaffPageHeader from '@/components/StaffPageHeader';

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
  const [tab, setTab] = useState<'regular' | 'exception'>('regular');
  const [dayFilter, setDayFilter] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Schedule | null>(null);
  const [cancelDate, setCancelDate] = useState<string>('');
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvMessage, setCsvMessage] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

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
    const method = editingId ? 'PATCH' : 'POST';
    const url = editingId ? `/api/staff/schedule/${editingId}` : '/api/staff/schedule';
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing),
    });
    if (!res.ok) {
      alert('保存失敗');
      return;
    }
    setEditing(null);
    setEditingId(null);
    await load();
  };

  const removeOne = async (id: number) => {
    if (!confirm('このスケジュールを廃止しますか？')) return;
    const res = await fetch(`/api/staff/schedule/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      setEditing(null);
      setEditingId(null);
      await load();
    }
  };

  const submitCancel = async () => {
    if (!cancelTarget || !cancelDate) return;
    const body = {
      class_name: cancelTarget.class_name,
      day_of_week: cancelTarget.day_of_week,
      start_time: cancelTarget.start_time,
      end_time: cancelTarget.end_time,
      target: cancelTarget.target,
      location: cancelTarget.location,
      instructor: cancelTarget.instructor,
      status: '休講',
      exception_date: cancelDate,
      exception_type: '休講',
      base_schedule_id: cancelTarget.id,
    };
    const res = await fetch('/api/staff/schedule', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setCancelTarget(null);
      setCancelDate('');
      await load();
    } else {
      alert('登録失敗');
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
    <main className="min-h-screen bg-neutral-50 pb-20">
      <StaffPageHeader
        title="📅 レッスンスケジュール"
        description="月別レッスン予定 (通常パターン+例外)"
        rightExtra={
          <Link href="/staff/members" className="text-xs text-orange-600 underline">
            ← 会員管理
          </Link>
        }
      />

      <div className="bg-white border-b border-orange-100 px-4 py-3">
        <div className="flex gap-1 text-xs">
          <button
            onClick={() => setTab('regular')}
            className={`px-3 py-1 rounded-full border ${
              tab === 'regular'
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-white text-neutral-600 border-neutral-300'
            }`}
          >
            通常パターン
          </button>
          <button
            onClick={() => setTab('exception')}
            className={`px-3 py-1 rounded-full border ${
              tab === 'exception'
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-white text-neutral-600 border-neutral-300'
            }`}
          >
            例外 ({exceptions.length})
          </button>
          <div className="ml-auto flex gap-2">
            <button
              onClick={openNew}
              className="text-xs bg-orange-500 text-white rounded-full px-3 py-1"
            >
              + 新規追加
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={csvBusy}
              className="text-xs bg-white border border-orange-300 text-orange-700 rounded-full px-3 py-1 disabled:opacity-50"
            >
              📥 CSV一括投入
            </button>
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
            <button
              onClick={() => setDayFilter(null)}
              className={`text-xs whitespace-nowrap rounded-full px-3 py-1 border ${
                dayFilter === null
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white text-neutral-600 border-neutral-300'
              }`}
            >
              全部
            </button>
            {DOW_LABELS.map((label, idx) => (
              <button
                key={idx}
                onClick={() => setDayFilter(idx)}
                className={`text-xs whitespace-nowrap rounded-full px-3 py-1 border ${
                  dayFilter === idx
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-neutral-600 border-neutral-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {csvMessage && (
          <p className="text-xs mt-2 text-orange-700">{csvMessage}</p>
        )}
      </div>

      <div className="px-3 py-3 max-w-2xl mx-auto">
        {loading && <p className="text-sm text-neutral-500 text-center py-6">読み込み中…</p>}

        {!loading && tab === 'regular' && (
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
                        className="w-full text-left bg-white border border-neutral-200 rounded-xl p-3 active:bg-orange-50"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold text-neutral-800 truncate">
                            {s.start_time || '--:--'}–{s.end_time || '--:--'} {s.class_name}
                          </span>
                          {s.status !== 'active' && (
                            <span className="text-[10px] bg-neutral-200 text-neutral-700 rounded px-1.5 py-0.5">
                              {s.status}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-neutral-500 mt-0.5">
                          {[s.location, s.instructor, s.target].filter(Boolean).join(' / ') || '—'}
                        </div>
                        <div className="flex gap-2 mt-2">
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(s);
                            }}
                            className="text-[11px] bg-orange-50 text-orange-700 rounded-full px-2 py-0.5"
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
              <p className="text-sm text-neutral-500 text-center py-6">スケジュールがありません</p>
            )}
          </div>
        )}

        {!loading && tab === 'exception' && (
          <div className="space-y-2">
            {exceptions.length === 0 && (
              <p className="text-sm text-neutral-500 text-center py-6">
                今後1ヶ月の例外はありません
              </p>
            )}
            {exceptions.map((e) => (
              <button
                key={e.id}
                onClick={() => openEdit(e)}
                className="w-full text-left bg-white border border-neutral-200 rounded-xl p-3 active:bg-orange-50"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-neutral-800 truncate">
                    {e.exception_date} {e.class_name}
                  </span>
                  <span className="text-[10px] bg-red-100 text-red-700 rounded px-1.5 py-0.5">
                    {e.exception_type || '例外'}
                  </span>
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">
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
            <button
              onClick={() => {
                setEditingId(null);
                setEditing({
                  ...EMPTY_FORM,
                  exception_date: new Date().toISOString().slice(0, 10),
                  exception_type: '振替',
                });
              }}
              className="w-full text-sm bg-white border border-dashed border-orange-300 text-orange-700 rounded-xl py-3"
            >
              + 振替レッスン追加
            </button>
          </div>
        )}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <div className="sticky top-0 bg-white border-b border-neutral-100 px-4 py-3 flex items-center justify-between">
            <h2 className="font-bold text-neutral-800">
              {editingId ? 'スケジュール編集' : '新規追加'}
            </h2>
            <button
              onClick={() => setEditing(null)}
              className="text-neutral-500 text-xl leading-none px-2"
            >
              ×
            </button>
          </div>
          <div className="p-4 space-y-3 text-sm">
            <Field label="曜日">
              <select
                value={editing.day_of_week ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    day_of_week: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="">未設定</option>
                {DOW_LABELS.map((l, i) => (
                  <option key={i} value={i}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="開始">
                <input
                  type="time"
                  value={editing.start_time ?? ''}
                  onChange={(e) => setEditing({ ...editing, start_time: e.target.value })}
                  className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 bg-white"
                />
              </Field>
              <Field label="終了">
                <input
                  type="time"
                  value={editing.end_time ?? ''}
                  onChange={(e) => setEditing({ ...editing, end_time: e.target.value })}
                  className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 bg-white"
                />
              </Field>
            </div>
            <Field label="クラス名 *">
              <input
                type="text"
                value={editing.class_name ?? ''}
                onChange={(e) => setEditing({ ...editing, class_name: e.target.value })}
                className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 bg-white"
              />
            </Field>
            <Field label="対象">
              <input
                type="text"
                value={editing.target ?? ''}
                onChange={(e) => setEditing({ ...editing, target: e.target.value })}
                placeholder="キッズ / 一般 / ガールズ"
                className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 bg-white"
              />
            </Field>
            <Field label="場所">
              <input
                type="text"
                value={editing.location ?? ''}
                onChange={(e) => setEditing({ ...editing, location: e.target.value })}
                placeholder="多賀城 / 長町 / 七ヶ浜"
                className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 bg-white"
              />
            </Field>
            <Field label="インストラクター">
              <input
                type="text"
                value={editing.instructor ?? ''}
                onChange={(e) => setEditing({ ...editing, instructor: e.target.value })}
                placeholder="TARO"
                className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 bg-white"
              />
            </Field>
            <Field label="状態">
              <select
                value={editing.status ?? 'active'}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="active">active</option>
                <option value="休講">休講</option>
                <option value="廃止">廃止</option>
              </select>
            </Field>
            {(editing.exception_date || editingId === null) && (
              <Field label="例外日 (空なら通常パターン)">
                <input
                  type="date"
                  value={editing.exception_date ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, exception_date: e.target.value || null })
                  }
                  className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 bg-white"
                />
              </Field>
            )}
            <Field label="備考">
              <textarea
                value={editing.notes ?? ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                rows={2}
                className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 bg-white"
              />
            </Field>
            <div className="flex gap-2 pt-2">
              <button
                onClick={save}
                className="flex-1 bg-orange-500 text-white rounded-lg py-2 font-semibold"
              >
                保存
              </button>
              {editingId !== null && (
                <button
                  onClick={() => removeOne(editingId)}
                  className="bg-white border border-red-300 text-red-700 rounded-lg px-4 py-2"
                >
                  廃止
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {cancelTarget && (
        <Modal onClose={() => setCancelTarget(null)}>
          <div className="sticky top-0 bg-white border-b border-neutral-100 px-4 py-3 flex items-center justify-between">
            <h2 className="font-bold text-neutral-800">休講登録</h2>
            <button
              onClick={() => setCancelTarget(null)}
              className="text-neutral-500 text-xl leading-none px-2"
            >
              ×
            </button>
          </div>
          <div className="p-4 space-y-3 text-sm">
            <p className="text-neutral-700">
              <span className="font-semibold">{cancelTarget.class_name}</span>
              <span className="text-xs text-neutral-500 ml-2">
                {cancelTarget.start_time}–{cancelTarget.end_time}
              </span>
            </p>
            <Field label="休講にする日付">
              <input
                type="date"
                value={cancelDate}
                onChange={(e) => setCancelDate(e.target.value)}
                className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 bg-white"
              />
            </Field>
            <button
              onClick={submitCancel}
              disabled={!cancelDate}
              className="w-full bg-red-500 text-white rounded-lg py-2 font-semibold disabled:opacity-50"
            >
              この日を休講にする
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/40 z-20 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-neutral-500 block mb-0.5">{label}</span>
      {children}
    </label>
  );
}

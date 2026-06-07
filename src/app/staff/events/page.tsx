'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { CalendarDays, Plus, ChevronRight, X } from 'lucide-react';

type EventRow = {
  id: number;
  code: string;
  name: string;
  event_date: string | null;
  status: string;
  created_at: string;
};

export default function EventsListPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', event_date: '', status: 'planning' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff/events', { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/events';
        return;
      }
      const data = await res.json();
      setEvents(data.events ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/staff/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        code: form.code.trim(),
        name: form.name.trim(),
        event_date: form.event_date || null,
        status: form.status,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? '作成失敗');
      return;
    }
    setForm({ code: '', name: '', event_date: '', status: 'planning' });
    setShowForm(false);
    toast.success('イベントを作成しました');
    load();
  }

  return (
    <div>
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-5 text-orange-600" />
            <h1 className="text-lg font-bold text-orange-600">イベント管理</h1>
            <span className="text-xs text-muted-foreground hidden sm:inline">BW5・発表会等のイベント設定・タスク</span>
          </div>
          <Button
            onClick={() => setShowForm((v) => !v)}
            variant={showForm ? 'outline' : 'default'}
            size="sm"
          >
            {showForm ? <><X className="size-3.5 mr-1" />キャンセル</> : <><Plus className="size-3.5 mr-1" />新規イベント</>}
          </Button>
        </div>

        {showForm && (
          <Card>
            <CardContent className="pt-4">
              <form onSubmit={create} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">コード (例: BW6)</Label>
                    <Input
                      required
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">名称</Label>
                    <Input
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">開催日</Label>
                    <Input
                      type="date"
                      value={form.event_date}
                      onChange={(e) => setForm({ ...form, event_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">ステータス</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="planning">planning</SelectItem>
                        <SelectItem value="preparing">preparing</SelectItem>
                        <SelectItem value="live">live</SelectItem>
                        <SelectItem value="closed">closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {error && <div className="text-sm text-destructive">{error}</div>}
                <Button type="submit">作成</Button>
              </form>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="text-muted-foreground">読み込み中...</div>
        ) : events.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              まだイベントがありません。「新規イベント」から作成してください。
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {events.map((ev) => (
              <li key={ev.id}>
                <Link
                  href={`/staff/events/${ev.id}`}
                  className="block"
                >
                  <Card className="hover:shadow-md transition cursor-pointer">
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs text-orange-600 font-mono">{ev.code}</div>
                          <div className="font-semibold">{ev.name}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                            <span>{ev.event_date ?? '日付未定'}</span>
                            <Badge variant="secondary" className="text-[10px]">{ev.status}</Badge>
                          </div>
                        </div>
                        <ChevronRight className="size-4 text-orange-500" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

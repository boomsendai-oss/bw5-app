'use client';

import { useCallback, useEffect, useState, use as usePromise } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';

type Todo = {
  id: number;
  event_id: number;
  category: string | null;
  fact: string | null;
  cause: string | null;
  action: string;
  assignee: string | null;
  priority: string | null;
  due_period: string | null;
  status: string;
  created_at: string;
};

const STATUSES = ['open', 'in_progress', 'done'] as const;
const PRIORITIES = ['高', '中', '低'];
const DUE_PERIODS = ['今月', '3ヶ月以内', '直前'];
const ASSIGNEES = ['TARO', 'KEIKO', 'Claude', '外部'];

export default function TodoPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = usePromise(params);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'in_progress' | 'done'>('all');
  const [form, setForm] = useState({
    category: '',
    fact: '',
    cause: '',
    action: '',
    assignee: '',
    priority: '',
    due_period: '',
  });
  const [deleteTarget, setDeleteTarget] = useState<Todo | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/staff/events/${eventId}/todos`, { credentials: 'include' });
    if (res.status === 401) {
      window.location.href = `/staff/events/login?next=/staff/events/${eventId}/todo`;
      return;
    }
    const data = await res.json();
    setTodos(data.todos ?? []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addTodo(e: React.FormEvent) {
    e.preventDefault();
    if (!form.action.trim()) return;
    const res = await fetch(`/api/staff/events/${eventId}/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({ category: '', fact: '', cause: '', action: '', assignee: '', priority: '', due_period: '' });
      toast.success('ToDo を追加しました');
      load();
    }
  }

  async function patch(todo: Todo, patchBody: Partial<Todo>) {
    await fetch(`/api/staff/events/${eventId}/todos/${todo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(patchBody),
    });
    load();
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    const todo = deleteTarget;
    setDeleteTarget(null);
    await fetch(`/api/staff/events/${eventId}/todos/${todo.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    toast.success('削除しました');
    load();
  }

  const filtered = filter === 'all' ? todos : todos.filter((t) => t.status === filter);

  return (
    <div>
      <header className="bg-card border-b px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <Link href={`/staff/events/${eventId}`} className="text-xs text-orange-600 hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="size-3" />ダッシュボード
          </Link>
          <h1 className="text-xl font-bold text-orange-600 mt-1">ToDo リスト</h1>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-4">
        {/* Add form */}
        <Card>
          <CardContent className="pt-4">
            <form onSubmit={addTodo} className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">カテゴリ</Label>
                  <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="体制/演出/当日オペ" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">担当</Label>
                  <Select value={form.assignee} onValueChange={(v) => setForm({ ...form, assignee: v })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="未定" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">未定</SelectItem>
                      {ASSIGNEES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">優先度</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="未設定" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">未設定</SelectItem>
                      {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">期限</Label>
                  <Select value={form.due_period} onValueChange={(v) => setForm({ ...form, due_period: v })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="未設定" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">未設定</SelectItem>
                      {DUE_PERIODS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">事実 (何が)</Label>
                  <Input value={form.fact} onChange={(e) => setForm({ ...form, fact: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">原因 (なぜ)</Label>
                  <Input value={form.cause} onChange={(e) => setForm({ ...form, cause: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">アクション *必須</Label>
                  <Input required value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} />
                </div>
              </div>
              <Button type="submit"><Plus className="size-3.5 mr-1" />追加</Button>
            </form>
          </CardContent>
        </Card>

        {/* Filter */}
        <div className="flex gap-2 text-sm">
          {(['all', ...STATUSES] as const).map((s) => (
            <Button
              key={s}
              variant={filter === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(s)}
              className={filter === s ? '' : ''}
            >
              {s === 'all' ? 'すべて' : s}
            </Button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="text-muted-foreground">読み込み中...</div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              ToDo がありません。
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {filtered.map((t) => (
              <li key={t.id}>
                <Card>
                  <CardContent className="py-3">
                    <div className="flex items-start gap-3">
                      <Select value={t.status} onValueChange={(v) => patch(t, { status: v })}>
                        <SelectTrigger className="w-[120px]" size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold">{t.action}</div>
                        {(t.fact || t.cause) && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {t.fact && <>事実: {t.fact}  </>}
                            {t.cause && <>原因: {t.cause}</>}
                          </div>
                        )}
                        <div className="text-xs mt-1 flex flex-wrap gap-1.5">
                          {t.category && <Badge variant="secondary" className="bg-orange-50 text-orange-700">{t.category}</Badge>}
                          {t.assignee && <Badge variant="outline">{t.assignee}</Badge>}
                          {t.priority && <Badge variant="destructive">優先度:{t.priority}</Badge>}
                          {t.due_period && <Badge variant="secondary" className="bg-blue-50 text-blue-700">{t.due_period}</Badge>}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon-xs" onClick={() => setDeleteTarget(t)}>
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>削除確認</AlertDialogTitle>
            <AlertDialogDescription>
              このToDoを削除しますか?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={executeDelete} variant="destructive">削除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

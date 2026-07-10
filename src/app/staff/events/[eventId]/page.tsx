'use client';

import { useEffect, useState, use as usePromise } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ListTodo, Users, Clock3, Wallet, CircleDot, CheckCircle2, AlertCircle } from 'lucide-react';

type EventRow = {
  id: number;
  code: string;
  name: string;
  event_date: string | null;
  status: string;
};

type TodoSummary = { total: number; open: number; in_progress: number; done: number };

export default function EventDashboard({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = usePromise(params);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [summary, setSummary] = useState<TodoSummary>({ total: 0, open: 0, in_progress: 0, done: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [evRes, todosRes] = await Promise.all([
          fetch(`/api/staff/events/${eventId}`, { credentials: 'include' }),
          fetch(`/api/staff/events/${eventId}/todos`, { credentials: 'include' }),
        ]);
        if (evRes.status === 401) {
          window.location.href = `/staff/events/login?next=/staff/events/${eventId}`;
          return;
        }
        const evJson = await evRes.json();
        const todosJson = await todosRes.json();
        setEvent(evJson.event);
        const todos = todosJson.todos ?? [];
        const s: TodoSummary = { total: todos.length, open: 0, in_progress: 0, done: 0 };
        for (const t of todos) {
          if (t.status === 'open') s.open++;
          else if (t.status === 'in_progress') s.in_progress++;
          else if (t.status === 'done') s.done++;
        }
        setSummary(s);
      } finally {
        setLoading(false);
      }
    })();
  }, [eventId]);

  if (loading) return <div className="p-8 text-muted-foreground">読み込み中...</div>;
  if (!event) return <div className="p-8 text-destructive">イベントが見つかりません</div>;

  return (
    <div>
      <header className="bg-card border-b px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <Link href="/staff/events" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="size-3" />一覧へ
          </Link>
          <h1 className="text-xl font-bold text-brand-600 mt-1">
            {event.code} <span className="text-foreground">{event.name}</span>
          </h1>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
            <span>{event.event_date ?? '日付未定'}</span>
            <Badge variant="secondary" className="text-[10px]">{event.status}</Badge>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <section className="grid grid-cols-4 gap-3">
          <SummaryCard label="ToDo 合計" value={summary.total} icon={<ListTodo className="size-4 text-muted-foreground" />} />
          <SummaryCard label="未着手" value={summary.open} icon={<AlertCircle className="size-4 text-red-500" />} color="text-red-600" />
          <SummaryCard label="進行中" value={summary.in_progress} icon={<CircleDot className="size-4 text-brand-500" />} color="text-brand-600" />
          <SummaryCard label="完了" value={summary.done} icon={<CheckCircle2 className="size-4 text-emerald-500" />} color="text-emerald-600" />
        </section>

        <nav className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NavCard href={`/staff/events/${eventId}/todo`} title="ToDo リスト" desc="反省/準備 ToDo を管理" icon={<ListTodo className="size-4" />} />
          <NavCard href="#" title="スタッフ管理" desc="(Phase 2 で実装)" icon={<Users className="size-4" />} disabled />
          <NavCard href="#" title="タイムテーブル" desc="(Phase 2 で実装)" icon={<Clock3 className="size-4" />} disabled />
          <NavCard href="#" title="収支" desc="(Phase 2 で実装)" icon={<Wallet className="size-4" />} disabled />
        </nav>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color, icon }: { label: string; value: number; color?: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-3 text-center">
        <div className="flex justify-center mb-1">{icon}</div>
        <div className={`text-2xl font-bold ${color ?? 'text-foreground'}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}

function NavCard({
  href,
  title,
  desc,
  icon,
  disabled,
}: {
  href: string;
  title: string;
  desc: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <Card className="opacity-50 cursor-not-allowed">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">{icon}{title}</CardTitle>
          <CardDescription className="text-xs">{desc}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Link href={href} className="block">
      <Card className="hover:shadow-md transition cursor-pointer">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2 text-brand-600">{icon}{title}</CardTitle>
          <CardDescription className="text-xs">{desc}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

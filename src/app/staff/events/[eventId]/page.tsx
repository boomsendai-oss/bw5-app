'use client';

import { useEffect, useState, use as usePromise } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ListTodo, Users, Clock3, Wallet, CircleDot, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';
import StaffPageHeader from '@/components/StaffPageHeader';

type EventRow = {
  id: number;
  code: string;
  name: string;
  event_date: string | null;
  status: string;
};

type TodoSummary = { total: number; open: number; in_progress: number; done: number };
type SignupSummary = {
  signupCount: number;
  performerCount: number;
  byPart: { key: string; label: string; count: number }[];
} | null;

// パートを色で区別（集計画面と統一）
const PART_PILL: Record<string, string> = {
  girls_hh: 'bg-rose-50 text-rose-700 border-rose-200',
  waack: 'bg-violet-50 text-violet-700 border-violet-200',
  hiphop: 'bg-sky-50 text-sky-700 border-sky-200',
};
const PART_DOT: Record<string, string> = {
  girls_hh: 'bg-rose-400',
  waack: 'bg-violet-400',
  hiphop: 'bg-sky-400',
};
const partPill = (k: string) => PART_PILL[k] ?? 'bg-slate-100 text-slate-600 border-slate-200';
const partDot = (k: string) => PART_DOT[k] ?? 'bg-slate-400';

export default function EventDashboard({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = usePromise(params);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [summary, setSummary] = useState<TodoSummary>({ total: 0, open: 0, in_progress: 0, done: 0 });
  const [signup, setSignup] = useState<SignupSummary>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [evRes, todosRes, signupRes] = await Promise.all([
          fetch(`/api/staff/events/${eventId}`, { credentials: 'include' }),
          fetch(`/api/staff/events/${eventId}/todos`, { credentials: 'include' }),
          fetch(`/api/staff/events/${eventId}/signups`, { credentials: 'include' }),
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
        if (signupRes.ok) {
          const sj = await signupRes.json();
          setSignup(sj.summary ?? null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [eventId]);

  if (loading) return <div className="p-8 text-muted-foreground">読み込み中...</div>;
  if (!event) return <div className="p-8 text-destructive">イベントが見つかりません</div>;

  return (
    <div>
      <StaffPageHeader
        title={`${event.code} ${event.name}`}
        description={event.event_date ?? '日付未定'}
        backHref="/staff/events"
        backLabel="イベント"
        rightExtra={<Badge variant="secondary" className="text-[10px]">{event.status}</Badge>}
      />

      <div className="max-w-3xl mx-auto p-6 space-y-4">
        {/* 出演者募集 サマリー（最優先で表示） */}
        <Link href={`/staff/events/${eventId}/signups`} className="block">
          <section className="rounded-xl border border-teal-200 bg-white p-4 hover:shadow-md transition">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-navy-800 flex items-center gap-1.5">
                <Users className="size-4 text-brand-600" />出演者募集の状況
              </h2>
              <span className="text-xs font-bold text-brand-600 flex items-center">
                名簿・詳細を見る<ChevronRight className="size-4" />
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-end gap-1.5">
                <span className="text-3xl font-bold text-navy-800 tabular-nums leading-none">{signup?.performerCount ?? 0}</span>
                <span className="text-xs text-muted-foreground mb-0.5">名 集まっています</span>
              </div>
              <div className="w-px h-8 bg-sand-200" />
              <div className="text-center">
                <div className="text-xl font-bold text-navy-800 tabular-nums leading-none">{signup?.signupCount ?? 0}</div>
                <div className="text-[11px] text-muted-foreground mt-1">申込数</div>
              </div>
              {(signup?.byPart?.length ?? 0) > 0 && <div className="w-px h-8 bg-sand-200 hidden sm:block" />}
              <div className="flex flex-wrap items-center gap-2">
                {signup?.byPart.map((p) => (
                  <div key={p.key} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${partPill(p.key)}`}>
                    <span className={`size-2 rounded-full ${partDot(p.key)}`} />
                    <span className="text-xs font-bold">{p.label}</span>
                    <span className="text-sm font-bold tabular-nums">{p.count}</span>
                  </div>
                ))}
              </div>
            </div>
            {(signup?.performerCount ?? 0) === 0 && (
              <p className="text-xs text-muted-foreground mt-2">まだ申込がありません。</p>
            )}
          </section>
        </Link>

        {/* メニュー */}
        <nav className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NavCard href={`/staff/events/${eventId}/signups`} title="出演者募集・集計" desc="申込状況・パート別名簿・CSV" icon={<Users className="size-4" />} />
          <NavCard href={`/staff/events/${eventId}/todo`} title="ToDo リスト" desc="反省/準備 ToDo を管理" icon={<ListTodo className="size-4" />} />
          <NavCard href="#" title="タイムテーブル" desc="(Phase 2 で実装)" icon={<Clock3 className="size-4" />} disabled />
          <NavCard href="#" title="収支" desc="(Phase 2 で実装)" icon={<Wallet className="size-4" />} disabled />
        </nav>

        {/* ToDo サマリー（補助・下段） */}
        <section>
          <div className="text-xs font-bold text-muted-foreground mb-2">ToDo</div>
          <div className="grid grid-cols-4 gap-3">
            <SummaryCard label="合計" value={summary.total} icon={<ListTodo className="size-4 text-muted-foreground" />} />
            <SummaryCard label="未着手" value={summary.open} icon={<AlertCircle className="size-4 text-red-500" />} color="text-red-600" />
            <SummaryCard label="進行中" value={summary.in_progress} icon={<CircleDot className="size-4 text-brand-500" />} color="text-brand-600" />
            <SummaryCard label="完了" value={summary.done} icon={<CheckCircle2 className="size-4 text-emerald-500" />} color="text-emerald-600" />
          </div>
        </section>
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

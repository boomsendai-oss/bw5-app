'use client';

import { useCallback, useEffect, useState, use as usePromise } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Download, Trash2 } from 'lucide-react';
import StaffPageHeader from '@/components/StaffPageHeader';

type PartMeta = { key: string; label: string };
type Performer = { id: number; name: string; parts: string[] };
type Signup = { id: number; note: string; createdAt: string; performers: Performer[] };
type Summary = { signupCount: number; performerCount: number; byPart: { key: string; label: string; count: number }[] };

export default function SignupsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = usePromise(params);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [parts, setParts] = useState<PartMeta[]>([]);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/events/${eventId}/signups`, { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = `/staff/events/login?next=/staff/events/${eventId}/signups`;
        return;
      }
      const data = await res.json();
      setSummary(data.summary);
      setParts(data.parts ?? []);
      setSignups(data.signups ?? []);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  async function delSignup(id: number) {
    if (!confirm('この申込（兄弟含む）を削除しますか？')) return;
    const res = await fetch(`/api/staff/events/${eventId}/signups/${id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) { toast.success('削除しました'); load(); } else { toast.error('削除に失敗しました'); }
  }

  const labelOf = (key: string) => parts.find((p) => p.key === key)?.label ?? key;

  if (loading) return <div className="p-8 text-muted-foreground">読み込み中...</div>;

  return (
    <div>
      <StaffPageHeader
        title="出演者募集・集計"
        description="太白区民まつり2026 出演者の申込状況"
        backHref={`/staff/events/${eventId}`}
        backLabel="イベント"
        rightExtra={
          <Button asChild size="sm" variant="outline">
            <a href={`/api/staff/events/${eventId}/signups/export`}>
              <Download className="size-3.5 mr-1" />CSV
            </a>
          </Button>
        }
      />

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* サマリー */}
        <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Card><CardContent className="py-3 text-center">
            <div className="text-2xl font-bold text-navy-700">{summary?.performerCount ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">総出演者</div>
          </CardContent></Card>
          <Card><CardContent className="py-3 text-center">
            <div className="text-2xl font-bold text-navy-700">{summary?.signupCount ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">申込数</div>
          </CardContent></Card>
          {summary?.byPart.map((p) => (
            <Card key={p.key}><CardContent className="py-3 text-center">
              <div className="text-2xl font-bold text-brand-600">{p.count}</div>
              <div className="text-xs text-muted-foreground mt-1">{p.label}</div>
            </CardContent></Card>
          ))}
        </section>

        {/* パート別名簿 */}
        {parts.map((part) => {
          const members = signups.flatMap((s) =>
            s.performers.filter((p) => p.parts.includes(part.key)).map((p) => p.name)
          );
          return (
            <section key={part.key} className="space-y-2">
              <h2 className="text-sm font-bold text-navy-700 flex items-center gap-2">
                {part.label}
                <Badge variant="secondary" className="text-[10px]">{members.length}名</Badge>
              </h2>
              <Card><CardContent className="py-3">
                {members.length === 0 ? (
                  <div className="text-xs text-muted-foreground">まだいません</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((n, i) => (
                      <span key={i} className="text-xs bg-sand-100 rounded-full px-2.5 py-1">{n}</span>
                    ))}
                  </div>
                )}
              </CardContent></Card>
            </section>
          );
        })}

        {/* 全体名簿（申込単位・兄弟グルーピング） */}
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-navy-700">全体名簿（申込ごと）</h2>
          {signups.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">まだ申込がありません</CardContent></Card>
          ) : (
            <ul className="space-y-2">
              {signups.map((s) => (
                <li key={s.id}>
                  <Card><CardContent className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 min-w-0">
                        {s.performers.map((p) => (
                          <div key={p.id} className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-slate-800">{p.name}</span>
                            {p.parts.map((k) => (
                              <Badge key={k} variant="outline" className="text-[10px]">{labelOf(k)}</Badge>
                            ))}
                          </div>
                        ))}
                        {s.note && <div className="text-xs text-muted-foreground mt-1">メモ: {s.note}</div>}
                        <div className="text-[10px] text-muted-foreground">{s.createdAt}</div>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => delSignup(s.id)} className="shrink-0">
                        <Trash2 className="size-4 text-red-500" />
                      </Button>
                    </div>
                  </CardContent></Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

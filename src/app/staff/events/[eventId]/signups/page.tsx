'use client';

import { useCallback, useEffect, useState, use as usePromise } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Download, Trash2, Settings, ScrollText } from 'lucide-react';
import Link from 'next/link';
import StaffPageHeader from '@/components/StaffPageHeader';

type PartMeta = { key: string; label: string };
type Performer = { id: number; name: string; parts: string[] };
type Signup = { id: number; note: string; createdAt: string; performers: Performer[] };
type Summary = { signupCount: number; performerCount: number; byPart: { key: string; label: string; count: number }[] };
type AuditRow = { id: number; signupId: number | null; actor: string; action: string; message: string; createdAt: string };

function fmtJst(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function SignupsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = usePromise(params);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [parts, setParts] = useState<PartMeta[]>([]);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPart, setFilterPart] = useState<string>('all');
  const [showLog, setShowLog] = useState(false);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditLoaded, setAuditLoaded] = useState(false);

  const loadAudit = useCallback(async () => {
    const res = await fetch(`/api/staff/events/${eventId}/signups/audit`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      setAudit(data.entries ?? []);
      setAuditLoaded(true);
    }
  }, [eventId]);

  function toggleLog() {
    setShowLog((v) => {
      const next = !v;
      if (next) loadAudit();
      return next;
    });
  }

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
          <div className="flex items-center gap-2">
            <Button size="sm" variant={showLog ? 'default' : 'outline'} onClick={toggleLog}>
              <ScrollText className="size-3.5 mr-1" />変更ログ
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/staff/events/${eventId}/signups/settings`}>
                <Settings className="size-3.5 mr-1" />設定
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={`/api/staff/events/${eventId}/signups/export`}>
                <Download className="size-3.5 mr-1" />CSV
              </a>
            </Button>
          </div>
        }
      />

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* 変更ログ */}
        {showLog && (
          <section className="rounded-xl border border-sand-300 bg-white p-4 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <ScrollText className="size-4 text-navy-700" />
              <h2 className="text-sm font-bold text-navy-700">変更ログ</h2>
              <span className="text-xs text-muted-foreground">（新しい順・申込/編集/削除の履歴）</span>
            </div>
            {!auditLoaded ? (
              <div className="text-xs text-muted-foreground">読み込み中...</div>
            ) : audit.length === 0 ? (
              <div className="text-xs text-muted-foreground">まだ記録がありません</div>
            ) : (
              <ul className="space-y-1.5 max-h-96 overflow-y-auto">
                {audit.map((a) => (
                  <li key={a.id} className="text-xs border-b border-slate-100 pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground tabular-nums">{fmtJst(a.createdAt)}</span>
                      <Badge variant={a.actor === 'staff' ? 'secondary' : 'outline'} className="text-[9px]">
                        {a.actor === 'staff' ? 'スタッフ' : 'お客様'}
                      </Badge>
                    </div>
                    <div className="whitespace-pre-wrap text-slate-700 mt-0.5">{a.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

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

        {/* 全体名簿（申込単位・兄弟グルーピング）＋ パート絞り込み */}
        {(() => {
          const visibleSignups =
            filterPart === 'all'
              ? signups
              : signups
                  .map((s) => ({ ...s, performers: s.performers.filter((p) => p.parts.includes(filterPart)) }))
                  .filter((s) => s.performers.length > 0);
          return (
        <section className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-bold text-navy-700">全体名簿（申込ごと）</h2>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setFilterPart('all')}
                className={`rounded-full px-3 py-1 text-xs font-bold border ${filterPart === 'all' ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-slate-600 border-slate-300'}`}
              >
                全部
              </button>
              {parts.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setFilterPart(p.key)}
                  className={`rounded-full px-3 py-1 text-xs font-bold border ${filterPart === p.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-300'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {visibleSignups.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">
              {signups.length === 0 ? 'まだ申込がありません' : 'このパートの出演者はいません'}
            </CardContent></Card>
          ) : (
            <ul className="space-y-2">
              {visibleSignups.map((s) => (
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
          );
        })()}
      </div>
    </div>
  );
}

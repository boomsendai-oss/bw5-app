'use client';

import { useCallback, useEffect, useState, use as usePromise } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Download, Trash2, Settings, ScrollText, Users } from 'lucide-react';
import Link from 'next/link';
import StaffPageHeader from '@/components/StaffPageHeader';

type PartMeta = { key: string; label: string };
type Performer = { id: number; name: string; parts: string[] };
type Signup = { id: number; note: string; createdAt: string; performers: Performer[] };
type Summary = { signupCount: number; performerCount: number; byPart: { key: string; label: string; count: number }[] };
type AuditRow = { id: number; signupId: number | null; actor: string; action: string; message: string; createdAt: string };

// パートを色で区別（カテゴリ識別・淡色でブランドと衝突しない配色）
const PART_BADGE: Record<string, string> = {
  girls_hh: 'bg-rose-50 text-rose-700 border-rose-200',
  waack: 'bg-violet-50 text-violet-700 border-violet-200',
  hiphop: 'bg-sky-50 text-sky-700 border-sky-200',
};
const PART_DOT: Record<string, string> = {
  girls_hh: 'bg-rose-400',
  waack: 'bg-violet-400',
  hiphop: 'bg-sky-400',
};
const partBadge = (k: string) => PART_BADGE[k] ?? 'bg-slate-100 text-slate-600 border-slate-200';
const partDot = (k: string) => PART_DOT[k] ?? 'bg-slate-400';

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

  const performerCount = summary?.performerCount ?? 0;
  const signupCount = summary?.signupCount ?? 0;
  const byPart = summary?.byPart ?? [];

  const visibleSignups =
    filterPart === 'all'
      ? signups
      : signups
          .map((s) => ({ ...s, performers: s.performers.filter((p) => p.parts.includes(filterPart)) }))
          .filter((s) => s.performers.length > 0);

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

      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
        {/* 変更ログ */}
        {showLog && (
          <section className="rounded-xl border border-sand-300 bg-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <ScrollText className="size-4 text-navy-700" />
              <h2 className="text-sm font-bold text-navy-800">変更ログ</h2>
              <span className="text-xs text-muted-foreground">（新しい順・申込 / 編集 / 削除の履歴）</span>
            </div>
            {!auditLoaded ? (
              <div className="text-xs text-muted-foreground">読み込み中...</div>
            ) : audit.length === 0 ? (
              <div className="text-xs text-muted-foreground">まだ記録がありません</div>
            ) : (
              <ul className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                {audit.map((a) => (
                  <li key={a.id} className="py-2 text-xs">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-muted-foreground tabular-nums">{fmtJst(a.createdAt)}</span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] ${a.actor === 'staff' ? 'border-amber-300 text-amber-700 bg-amber-50' : 'border-teal-300 text-teal-700 bg-teal-50'}`}
                      >
                        {a.actor === 'staff' ? 'スタッフ' : 'お客様'}
                      </Badge>
                    </div>
                    <div className="whitespace-pre-wrap text-slate-700 leading-relaxed">{a.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* サマリー（統計ストリップ） */}
        <section className="rounded-xl border border-sand-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-navy-800 tabular-nums leading-none">{performerCount}</div>
                <div className="text-[11px] text-muted-foreground mt-1">総出演者</div>
              </div>
              <div className="w-px h-9 bg-sand-200" />
              <div className="text-center">
                <div className="text-2xl font-bold text-navy-800 tabular-nums leading-none">{signupCount}</div>
                <div className="text-[11px] text-muted-foreground mt-1">申込数</div>
              </div>
            </div>
            <div className="w-px h-9 bg-sand-200 hidden sm:block" />
            <div className="flex flex-wrap items-center gap-2">
              {byPart.map((p) => (
                <div key={p.key} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${partBadge(p.key)}`}>
                  <span className={`size-2 rounded-full ${partDot(p.key)}`} />
                  <span className="text-xs font-bold">{p.label}</span>
                  <span className="text-sm font-bold tabular-nums">{p.count}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 名簿 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-bold text-navy-800 flex items-center gap-1.5">
              <Users className="size-4 text-brand-600" />出演者名簿
            </h2>
            {/* パート絞り込み（セグメント） */}
            <div className="inline-flex rounded-lg border border-sand-200 bg-sand-50 p-0.5">
              <button
                onClick={() => setFilterPart('all')}
                className={`rounded-md px-3 py-1 text-xs font-bold transition ${filterPart === 'all' ? 'bg-white text-navy-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                全部 <span className="tabular-nums text-slate-400">{performerCount}</span>
              </button>
              {parts.map((p) => {
                const c = byPart.find((b) => b.key === p.key)?.count ?? 0;
                return (
                  <button
                    key={p.key}
                    onClick={() => setFilterPart(p.key)}
                    className={`rounded-md px-3 py-1 text-xs font-bold transition ${filterPart === p.key ? 'bg-white text-navy-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {p.label} <span className="tabular-nums text-slate-400">{c}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-sand-200 bg-white overflow-hidden">
            {/* 見出し行 */}
            <div className="hidden sm:grid grid-cols-[1fr_auto] gap-3 px-4 py-2 bg-sand-50 border-b border-sand-200 text-[11px] font-bold text-muted-foreground tracking-wide">
              <div>出演者 ／ 希望パート</div>
              <div className="text-right">申込日時・操作</div>
            </div>

            {visibleSignups.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {signups.length === 0 ? 'まだ申込がありません' : 'このパートの出演者はいません'}
              </div>
            ) : (
              visibleSignups.map((s, idx) => (
                <div
                  key={s.id}
                  className={`grid grid-cols-[1fr_auto] gap-3 px-4 py-2.5 items-center ${idx > 0 ? 'border-t border-slate-100' : ''}`}
                >
                  <div className="min-w-0 space-y-1">
                    {s.performers.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-1.5 flex-wrap">
                        {i > 0 && (
                          <span className="text-[9px] text-slate-400 border border-slate-200 rounded px-1 py-px shrink-0">兄弟</span>
                        )}
                        <span className="text-sm font-semibold text-slate-800">{p.name}</span>
                        {p.parts.map((k) => (
                          <span key={k} className={`text-[10px] font-bold rounded-full border px-2 py-0.5 ${partBadge(k)}`}>
                            {labelOf(k)}
                          </span>
                        ))}
                      </div>
                    ))}
                    {s.note && <div className="text-[11px] text-muted-foreground">メモ: {s.note}</div>}
                  </div>
                  <div className="flex items-center gap-1.5 justify-end shrink-0">
                    <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{fmtJst(s.createdAt)}</span>
                    <Button size="icon" variant="ghost" onClick={() => delSignup(s.id)} className="size-8 shrink-0">
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

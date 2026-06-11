'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search, Users, Calendar, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';

type LstepLink = {
  member_id: number;
  lstep_id: string;
  relation: string;
  confidence: string | null;
  display_name: string | null;
  system_display_name: string | null;
  line_register_name: string | null;
  real_name: string | null;
  role: string | null;
  blocked: number;
};

type Member = {
  id: number;
  hacomono_member_id: string;
  hacomono_kaiin_no: string | null;
  full_name: string;
  full_name_kana: string;
  birthday: string | null;
  email: string | null;
  phone: string | null;
  enrolled_at: string | null;
  withdrew_at: string | null;
  status: string;
  plan_code: string | null;
  plan_name: string | null;
  plan_started_at: string | null;
  plan_continued_months: string | null;
  lstep_links: LstepLink[];
};

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [q, setQ] = useState('');
  const [planFilter, setPlanFilter] = useState<'' | 'ticket' | 'monthly' | 'kyukai'>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);

  const load = useCallback(async (query: string, plan: string) => {
    setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (plan) params.set('plan', plan);
      const url = '/api/staff/members' + (params.toString() ? `?${params.toString()}` : '');
      const res = await fetch(url, { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/members';
        return;
      }
      // 取得失敗を「該当なし」と誤認させない(T-172)。500等は明示的にエラー表示。
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const data = await res.json();
      setMembers(data.members ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load('', '');
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(q, planFilter), 250);
    return () => clearTimeout(t);
  }, [q, planFilter, load]);

  return (
    <main className="text-neutral-900">
      <div className="border-b bg-white px-4 py-3">
        <div className="max-w-2xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-neutral-800 flex items-center gap-1.5">
              <Users className="h-5 w-5 text-orange-500" />
              会員管理
            </h1>
            <p className="text-xs text-neutral-500">HACOMONO会員の検索 / プラン / Lstep紐付け</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="link" size="sm" className="text-xs text-orange-600" asChild>
              <a href="/staff/schedule"><Calendar className="h-3 w-3 mr-1" />スケジュール</a>
            </Button>
            <Button variant="link" size="sm" className="text-xs text-orange-600" asChild>
              <a href="/staff/operations"><ExternalLink className="h-3 w-3 mr-1" />運営オペレーション</a>
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-white border-b px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="氏名 / カナ / ひらがな / 会員番号で検索"
              className="pl-9"
            />
          </div>
          <div className="flex gap-2 mt-2 overflow-x-auto">
            {[
              { value: '', label: '全部' },
              { value: 'ticket', label: 'チケット' },
              { value: 'monthly', label: 'マンスリー' },
              { value: 'kyukai', label: '休会' },
            ].map((opt) => (
              <Button
                key={opt.value}
                variant={planFilter === opt.value ? 'default' : 'outline'}
                size="sm"
                className={`text-xs rounded-full ${planFilter === opt.value ? 'bg-orange-500 hover:bg-orange-600' : ''}`}
                onClick={() => setPlanFilter(opt.value as '' | 'ticket' | 'monthly' | 'kyukai')}
              >
                {opt.label}
              </Button>
            ))}
            <span className="text-xs text-neutral-500 self-center ml-auto">{members.length}件</span>
          </div>
        </div>
      </div>

      <div className="px-3 py-3 space-y-2 max-w-2xl mx-auto">
        {loading && <p className="text-sm text-neutral-500 text-center py-6">読み込み中...</p>}
        {!loading && loadError && (
          <div className="text-center py-6">
            <p className="text-sm text-red-600 mb-2">読み込みに失敗しました</p>
            <button
              onClick={() => load(q, planFilter)}
              className="text-sm px-4 py-2 bg-orange-500 text-white rounded-lg font-semibold"
            >
              再試行
            </button>
          </div>
        )}
        {!loading && !loadError && members.length === 0 && (
          <p className="text-sm text-neutral-500 text-center py-6">該当する会員がいません</p>
        )}
        {members.map((m) => {
          const hasLink = m.lstep_links.length > 0;
          return (
            <button
              key={m.id}
              onClick={() => setSelected(m)}
              className="w-full text-left"
            >
              <Card className="hover:border-orange-200 active:bg-orange-50 transition-colors">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-neutral-800 truncate">{m.full_name}</span>
                        {m.status === 'withdrew' && (
                          <Badge variant="secondary" className="text-[10px]">退会</Badge>
                        )}
                      </div>
                      <div className="text-xs text-neutral-500 truncate">{m.full_name_kana}</div>
                      <div className="text-xs text-neutral-500 mt-1">
                        会員No: {m.hacomono_kaiin_no || '—'} / 入会: {m.enrolled_at?.slice(0, 10) || '—'}
                      </div>
                      {m.plan_name && (
                        <div className="text-[11px] mt-1">
                          <Badge variant="outline" className="text-orange-700 bg-orange-50">{m.plan_name}</Badge>
                        </div>
                      )}
                    </div>
                    <div className="shrink-0">
                      {hasLink ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                          LINE {m.lstep_links.length}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">未紐付け</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.full_name}</DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 text-sm">
              <section>
                <h3 className="text-xs font-semibold text-neutral-500 mb-1">基本情報</h3>
                <dl className="grid grid-cols-3 gap-y-1 text-xs">
                  <dt className="text-neutral-500">カナ</dt>
                  <dd className="col-span-2 text-neutral-800">{selected.full_name_kana}</dd>
                  <dt className="text-neutral-500">会員No</dt>
                  <dd className="col-span-2 text-neutral-800">{selected.hacomono_kaiin_no || '—'}</dd>
                  <dt className="text-neutral-500">生年月日</dt>
                  <dd className="col-span-2 text-neutral-800">{selected.birthday || '—'}</dd>
                  <dt className="text-neutral-500">Email</dt>
                  <dd className="col-span-2 text-neutral-800 break-all">{selected.email || '—'}</dd>
                  <dt className="text-neutral-500">電話</dt>
                  <dd className="col-span-2 text-neutral-800">{selected.phone || '—'}</dd>
                  <dt className="text-neutral-500">入会</dt>
                  <dd className="col-span-2 text-neutral-800">{selected.enrolled_at?.slice(0, 10) || '—'}</dd>
                  <dt className="text-neutral-500">退会</dt>
                  <dd className="col-span-2 text-neutral-800">{selected.withdrew_at?.slice(0, 10) || '—'}</dd>
                  <dt className="text-neutral-500">状態</dt>
                  <dd className="col-span-2 text-neutral-800">{selected.status}</dd>
                </dl>
              </section>

              {selected.plan_name && (
                <section>
                  <h3 className="text-xs font-semibold text-neutral-500 mb-1">契約プラン</h3>
                  <dl className="grid grid-cols-3 gap-y-1 text-xs">
                    <dt className="text-neutral-500">プラン</dt>
                    <dd className="col-span-2 text-neutral-800">{selected.plan_name}</dd>
                    <dt className="text-neutral-500">コード</dt>
                    <dd className="col-span-2 text-neutral-800">{selected.plan_code || '—'}</dd>
                    <dt className="text-neutral-500">適用開始</dt>
                    <dd className="col-span-2 text-neutral-800">{selected.plan_started_at || '—'}</dd>
                    <dt className="text-neutral-500">継続</dt>
                    <dd className="col-span-2 text-neutral-800">{selected.plan_continued_months || '—'}</dd>
                  </dl>
                </section>
              )}

              <section>
                <h3 className="text-xs font-semibold text-neutral-500 mb-1">
                  Lstep紐付け ({selected.lstep_links.length})
                </h3>
                {selected.lstep_links.length === 0 ? (
                  <p className="text-xs text-neutral-500">紐付いているLINE友だちはいません</p>
                ) : (
                  <ul className="space-y-2">
                    {selected.lstep_links.map((l) => (
                      <li key={l.lstep_id}>
                        <Card>
                          <CardContent className="p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-neutral-800 truncate text-xs">
                                {(l.system_display_name || l.display_name || l.line_register_name || l.lstep_id)
                                  .replace(/^【[^】]+】\s*/, '')}
                              </span>
                              <Badge variant="outline" className="text-orange-700 bg-orange-50 text-[10px]">
                                {l.relation}
                              </Badge>
                            </div>
                            <div className="text-[11px] text-neutral-500 mt-0.5">
                              {l.confidence && <span className="mr-2">確度: {l.confidence}</span>}
                              {l.blocked === 1 && <Badge variant="destructive" className="text-[10px]">ブロック中</Badge>}
                            </div>
                            <div className="text-[10px] text-neutral-400 mt-0.5">ID: {l.lstep_id}</div>
                          </CardContent>
                        </Card>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

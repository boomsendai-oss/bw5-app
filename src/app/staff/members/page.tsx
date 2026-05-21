'use client';

import { useCallback, useEffect, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';

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
  const [selected, setSelected] = useState<Member | null>(null);

  const load = useCallback(async (query: string, plan: string) => {
    setLoading(true);
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
      const data = await res.json();
      setMembers(data.members ?? []);
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
    <main className="min-h-screen bg-neutral-50">
      <StaffPageHeader
        title="👥 会員管理"
        description="HACOMONO会員の検索・プラン・Lstep紐付け"
        rightExtra={
          <>
            <a href="/staff/schedule" className="text-xs text-orange-600 underline">スケジュール →</a>
            <a href="/staff/operations" className="text-xs text-orange-600 underline">運営オペレーション →</a>
          </>
        }
      />

      <div className="bg-white border-b border-orange-100 px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="氏名・カナ・ひらがな・会員番号で検索"
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-900 bg-white placeholder:text-neutral-400"
          />
          <div className="flex gap-2 mt-2 overflow-x-auto">
            {[
              { value: '', label: '全部' },
              { value: 'ticket', label: '🎟️ チケット' },
              { value: 'monthly', label: '📅 マンスリー' },
              { value: 'kyukai', label: '💤 休会' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPlanFilter(opt.value as '' | 'ticket' | 'monthly' | 'kyukai')}
                className={`text-xs whitespace-nowrap rounded-full px-3 py-1 border ${
                  planFilter === opt.value
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-neutral-600 border-neutral-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <span className="text-xs text-neutral-500 self-center ml-auto">{members.length}件</span>
          </div>
        </div>
      </div>

      <div className="px-3 py-3 space-y-2 max-w-2xl mx-auto">
        {loading && <p className="text-sm text-neutral-500 text-center py-6">読み込み中…</p>}
        {!loading && members.length === 0 && (
          <p className="text-sm text-neutral-500 text-center py-6">該当する会員がいません</p>
        )}
        {members.map((m) => {
          const hasLink = m.lstep_links.length > 0;
          return (
            <button
              key={m.id}
              onClick={() => setSelected(m)}
              className="w-full text-left bg-white border border-neutral-200 rounded-xl p-3 active:bg-orange-50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-neutral-800 truncate">{m.full_name}</span>
                    {m.status === 'withdrew' && (
                      <span className="text-[10px] bg-neutral-200 text-neutral-700 rounded px-1.5 py-0.5">退会</span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500 truncate">{m.full_name_kana}</div>
                  <div className="text-xs text-neutral-500 mt-1">
                    会員No: {m.hacomono_kaiin_no || '—'} / 入会: {m.enrolled_at?.slice(0, 10) || '—'}
                  </div>
                  {m.plan_name && (
                    <div className="text-[11px] mt-1 text-neutral-700 truncate">
                      <span className="bg-orange-50 text-orange-700 rounded px-1.5 py-0.5">{m.plan_name}</span>
                    </div>
                  )}
                </div>
                <div className="shrink-0">
                  {hasLink ? (
                    <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">
                      LINE {m.lstep_links.length}
                    </span>
                  ) : (
                    <span className="text-xs bg-neutral-100 text-neutral-500 rounded-full px-2 py-0.5">
                      未紐付け
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div
          className="fixed inset-0 bg-black/40 z-20 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-neutral-100 px-4 py-3 flex items-center justify-between">
              <h2 className="font-bold text-neutral-800 truncate">{selected.full_name}</h2>
              <button
                onClick={() => setSelected(null)}
                className="text-neutral-500 text-xl leading-none px-2"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-4 text-sm">
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
                      <li key={l.lstep_id} className="border border-neutral-200 rounded-lg p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-neutral-800 truncate">
                            {(l.system_display_name || l.display_name || l.line_register_name || l.lstep_id)
                              .replace(/^【[^】]+】\s*/, '')}
                          </span>
                          <span className="text-[10px] bg-orange-100 text-orange-700 rounded px-1.5 py-0.5">
                            {l.relation}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">
                          {l.confidence && <span className="mr-2">確度: {l.confidence}</span>}
                          {l.blocked === 1 && <span className="text-red-500">ブロック中</span>}
                        </div>
                        <div className="text-[10px] text-neutral-400 mt-0.5">ID: {l.lstep_id}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';

type Studio = {
  id: number;
  name: string;
  address: string | null;
  google_map_url: string | null;
  pricing_model: string;
  hourly_rate: number;
  block_pricing: string | null;
  daily_buffer_minutes: number;
  notes: string | null;
  active: number;
};

type Instructor = {
  id: number;
  name: string;
  name_kana: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  instagram_handle: string | null;
  profile_text: string | null;
  profile_photo_url: string | null;
  shared_folder_url: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account_type: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  notes: string | null;
  active: number;
  salary_type: string | null;
  monthly_fixed_amount: number | null;
  // HP公開情報
  slug: string | null;
  genre: string | null;
  crews: string | null;
  career_text: string | null;
  public_display_order: number | null;
};

type Rate = { id: number; instructor_id: number; duration_minutes: number; rate: number };
type TransitFee = { id: number; instructor_id: number; studio_id: number; amount: number };
type PhotoCount = { instructor_id: number; count: number };

type Lesson = {
  id: number;
  class_name: string;
  target: string | null;
  level: string | null;
  default_studio_id: number | null;
  default_instructor_id: number | null;
  default_day_of_week: number | null;
  default_start_time: string | null;
  default_end_time: string | null;
  duration_minutes: number | null;
  frequency_type: string | null;
  override_rate: number | null;
  active: number;
  notes: string | null;
  start_date: string | null;
  end_date: string | null;
  // HP公開用 (boom-hp.pages.dev/classes に表示)
  description_text: string | null;
  studio_name: string | null;
  instructor_name: string | null;
};

// スタジオの区分料金1行
type PriceBlock = { label: string; start: string; end: string; price: number };

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const dayLabel = (d: number | null | undefined) => (d == null ? '—' : DAY_NAMES[d] ?? String(d));

// block_pricing(JSON文字列 or 配列)を PriceBlock[] にパース。失敗時は空配列
function parseBlocks(raw: unknown): PriceBlock[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    return {
      label: typeof o.label === 'string' ? o.label : '',
      start: typeof o.start === 'string' ? o.start : '',
      end: typeof o.end === 'string' ? o.end : '',
      price: Number(o.price) || 0,
    };
  });
}

export default function MastersPage() {
  const [tab, setTab] = useState<'studios' | 'instructors' | 'lessons'>('studios');
  const [studios, setStudios] = useState<Studio[]>([]);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [fees, setFees] = useState<TransitFee[]>([]);
  const [photoCounts, setPhotoCounts] = useState<PhotoCount[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ kind: 'studio'; data: Partial<Studio> } | { kind: 'instructor'; data: Partial<Instructor> } | { kind: 'lesson'; data: Partial<Lesson> } | null>(null);
  const [detail, setDetail] = useState<{ kind: 'studio'; data: Studio } | { kind: 'instructor'; data: Instructor } | { kind: 'lesson'; data: Lesson } | null>(null);
  const [editRates, setEditRates] = useState<{ duration: number; rate: number }[]>([]);
  const [editFees, setEditFees] = useState<{ studio_id: number; amount: number }[]>([]);
  const [editBlocks, setEditBlocks] = useState<PriceBlock[]>([]);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, i, l] = await Promise.all([
        fetch('/api/staff/master/studios', { credentials: 'include' }),
        fetch('/api/staff/master/instructors', { credentials: 'include' }),
        fetch('/api/staff/master/lessons?all=1', { credentials: 'include' }),
      ]);
      if (s.status === 401 || i.status === 401 || l.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/masters';
        return;
      }
      const sData = await s.json();
      const iData = await i.json();
      const lData = await l.json();
      setStudios(sData.studios || []);
      setInstructors(iData.instructors || []);
      setRates(iData.rates || []);
      setFees(iData.transit_fees || []);
      setPhotoCounts(iData.photo_counts || []);
      setLessons(lData.lessons || []);
    } catch (e) {
      setMsg(`読込失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveStudio = async (data: Partial<Studio>) => {
    try {
      // 区分制のときは編集中の区分行を block_pricing として送る (JSON化はAPI側)。
      // 時間単価のときは block_pricing に触らない (既存挙動を維持)。
      const payload: Record<string, unknown> = { ...data };
      if (data.pricing_model === 'block') {
        payload.block_pricing = editBlocks.filter(b => b.start || b.end || b.label || b.price);
      }
      if (data.id) {
        await fetch(`/api/staff/master/studios/${data.id}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`/api/staff/master/studios`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      setEditing(null);
      setEditBlocks([]);
      await load();
    } catch (e) {
      setMsg(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const startEditStudio = (s: Partial<Studio>) => {
    setEditing({ kind: 'studio', data: s });
    setEditBlocks(parseBlocks(s.block_pricing));
  };

  const saveInstructor = async (data: Partial<Instructor>) => {
    try {
      let id = data.id;
      if (id) {
        await fetch(`/api/staff/master/instructors/${id}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else {
        const r = await fetch(`/api/staff/master/instructors`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const j = await r.json();
        id = j.id;
      }
      // rates / transit_fees 一括保存
      await fetch(`/api/staff/master/instructors/${id}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rates: editRates.map(r => ({ duration_minutes: r.duration, rate: r.rate })),
          transit_fees: editFees,
        }),
      });
      setEditing(null);
      setEditRates([]);
      setEditFees([]);
      await load();
    } catch (e) {
      setMsg(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const remove = async (kind: 'studios' | 'instructors', id: number) => {
    if (!window.confirm('削除してよろしいですか?')) return;
    await fetch(`/api/staff/master/${kind}/${id}`, { method: 'DELETE', credentials: 'include' });
    await load();
  };

  const saveLesson = async (data: Partial<Lesson>) => {
    try {
      const payload = {
        class_name: data.class_name,
        target: data.target ?? null,
        level: data.level ?? null,
        default_studio_id: data.default_studio_id ?? null,
        default_instructor_id: data.default_instructor_id ?? null,
        default_day_of_week: data.default_day_of_week ?? null,
        default_start_time: data.default_start_time ?? null,
        default_end_time: data.default_end_time ?? null,
        duration_minutes: data.duration_minutes ?? null,
        frequency_type: data.frequency_type ?? null,
        override_rate: data.override_rate ?? null,
        active: data.active ?? 1,
        notes: data.notes ?? null,
        start_date: data.start_date ?? null,
        end_date: data.end_date ?? null,
      };
      if (data.id) {
        await fetch(`/api/staff/master/lessons/${data.id}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`/api/staff/master/lessons`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      setEditing(null);
      await load();
    } catch (e) {
      setMsg(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const removeLesson = async (id: number) => {
    if (!window.confirm('このレッスンを無効化 (active=0) しますか?')) return;
    await fetch(`/api/staff/master/lessons/${id}`, { method: 'DELETE', credentials: 'include' });
    await load();
  };

  const startEditInstructor = (i: Partial<Instructor>) => {
    setEditing({ kind: 'instructor', data: i });
    if (i.id) {
      const myRates = rates.filter(r => r.instructor_id === i.id).map(r => ({ duration: r.duration_minutes, rate: r.rate }));
      const myFees = fees.filter(f => f.instructor_id === i.id).map(f => ({ studio_id: f.studio_id, amount: f.amount }));
      setEditRates(myRates.length ? myRates : [{ duration: 60, rate: 0 }]);
      setEditFees(myFees);
    } else {
      setEditRates([{ duration: 60, rate: 0 }]);
      setEditFees([]);
    }
  };

  // ============ HP再デプロイ ============
  const [hpDeploying, setHpDeploying] = useState(false);
  const [hpDeployMsg, setHpDeployMsg] = useState<string | null>(null);
  const triggerHpDeploy = async () => {
    if (hpDeploying) return;
    if (!confirm('HPに最新データを反映します。\n（DBの内容を取得して boom-hp.pages.dev を再ビルド。3〜5分で完了）\n\n続行しますか?')) return;
    setHpDeploying(true);
    setHpDeployMsg(null);
    try {
      const r = await fetch('/api/staff/hp-deploy', {
        method: 'POST',
        credentials: 'include',
      });
      const j = await r.json();
      if (r.ok) {
        setHpDeployMsg(`✅ ${j.message ?? 'デプロイ開始'}`);
      } else {
        setHpDeployMsg(`❌ ${j.error ?? '不明なエラー'}`);
      }
    } catch (e) {
      setHpDeployMsg(`❌ 通信エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setHpDeploying(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <StaffPageHeader title="🗂️ マスターデータ管理" description="スタジオ・インストラクター・レッスン定義" />

      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        {msg && <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-sm">{msg}</div>}

        {/* HPに反映ボタン */}
        <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-slate-700">
            <span className="font-semibold">🌐 BOOM HP</span>
            <span className="text-slate-500 ml-2">編集内容はHPに自動反映されません。「反映」を押すと再ビルドが走ります。</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://boom-hp.pages.dev"
              target="_blank"
              rel="noreferrer"
              className="text-xs px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded text-slate-700"
            >
              HPを開く ↗
            </a>
            <button
              onClick={triggerHpDeploy}
              disabled={hpDeploying}
              className="text-sm px-4 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white rounded font-semibold"
            >
              {hpDeploying ? '⏳ デプロイ中...' : '🔄 HPに反映'}
            </button>
          </div>
          {hpDeployMsg && (
            <div className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded p-2 mt-1">
              {hpDeployMsg}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('studios')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium ${tab === 'studios' ? 'bg-orange-500 text-white' : 'bg-white border border-slate-300 text-slate-700'}`}
          >📍 スタジオ ({studios.length})</button>
          <button
            onClick={() => setTab('instructors')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium ${tab === 'instructors' ? 'bg-orange-500 text-white' : 'bg-white border border-slate-300 text-slate-700'}`}
          >👤 インストラクター ({instructors.length})</button>
          <button
            onClick={() => setTab('lessons')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium ${tab === 'lessons' ? 'bg-orange-500 text-white' : 'bg-white border border-slate-300 text-slate-700'}`}
          >📋 レッスン ({lessons.length})</button>
        </div>

        {loading && <p className="text-slate-500 text-sm">読込中...</p>}

        {/* STUDIOS LIST */}
        {!loading && tab === 'studios' && (
          <>
            <button
              onClick={() => startEditStudio({ pricing_model: 'hourly', daily_buffer_minutes: 0, active: 1 })}
              className="mb-3 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold"
            >+ スタジオ追加</button>
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-2 py-2 text-left">名称</th>
                    <th className="px-2 py-2 text-right">料金</th>
                    <th className="px-2 py-2 text-right">バッファ</th>
                    <th className="px-2 py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {studios.map(s => (
                    <tr key={s.id} className="border-t border-slate-100 hover:bg-orange-50/40 cursor-pointer" onClick={() => setDetail({ kind: 'studio', data: s })}>
                      <td className="px-2 py-2 font-medium">{s.name}{!s.active && <span className="text-xs text-slate-400 ml-1">(非active)</span>}</td>
                      <td className="px-2 py-2 text-xs text-right font-mono">
                        {s.pricing_model === 'hourly' ? `¥${s.hourly_rate.toLocaleString()}/h` : `区分制`}
                      </td>
                      <td className="px-2 py-2 text-xs text-right">{s.daily_buffer_minutes ? `+${s.daily_buffer_minutes}分` : '-'}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">詳細 →</span>
                      </td>
                    </tr>
                  ))}
                  {studios.length === 0 && <tr><td colSpan={4} className="px-2 py-6 text-center text-slate-400">登録なし</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* INSTRUCTORS LIST */}
        {!loading && tab === 'instructors' && (
          <>
            <button
              onClick={() => startEditInstructor({ active: 1 })}
              className="mb-3 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold"
            >+ インストラクター追加</button>
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-2 py-2 text-left">名前</th>
                    <th className="px-2 py-2 text-left">単価</th>
                    <th className="px-2 py-2 text-center">IG</th>
                    <th className="px-2 py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {[...instructors].sort((a, b) => b.active - a.active).map(i => {
                    const myRates = rates.filter(r => r.instructor_id === i.id);
                    return (
                      <tr key={i.id} className="border-t border-slate-100 hover:bg-orange-50/40 cursor-pointer" onClick={() => setDetail({ kind: 'instructor', data: i })}>
                        <td className="px-2 py-2 font-medium">{i.name}</td>
                        <td className="px-2 py-2 text-xs">
                          {myRates.map(r => <span key={r.id} className="mr-2">{r.duration_minutes}分 ¥{r.rate.toLocaleString()}</span>)}
                          {myRates.length === 0 && <span className="text-slate-300">-</span>}
                        </td>
                        <td className="px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
                          {i.instagram_handle
                            ? <a href={`https://www.instagram.com/${i.instagram_handle}/`} target="_blank" rel="noreferrer" className="inline-block px-2 py-0.5 bg-pink-100 hover:bg-pink-200 text-pink-700 rounded text-xs font-semibold" title={`@${i.instagram_handle}`}>📷 開く</a>
                            : <span className="text-slate-300 text-xs">-</span>}
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">詳細 →</span>
                        </td>
                      </tr>
                    );
                  })}
                  {instructors.length === 0 && <tr><td colSpan={4} className="px-2 py-6 text-center text-slate-400">登録なし</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* LESSONS LIST */}
        {!loading && tab === 'lessons' && (
          <>
            <button
              onClick={() => setEditing({ kind: 'lesson', data: { active: 1, frequency_type: 'weekly', default_day_of_week: 0 } })}
              className="mb-3 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold"
            >+ レッスン追加</button>
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-2 py-2 text-center">曜日</th>
                    <th className="px-2 py-2 text-left">時刻</th>
                    <th className="px-2 py-2 text-left">クラス名</th>
                    <th className="px-2 py-2 text-left">インストラクター</th>
                    <th className="px-2 py-2 text-left">スタジオ</th>
                    <th className="px-2 py-2 text-center">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {[...lessons].sort((a, b) => b.active - a.active).map(l => (
                    <tr key={l.id} className={`border-t border-slate-100 hover:bg-orange-50/40 cursor-pointer ${l.active === 0 ? 'opacity-50' : ''}`} onClick={() => setDetail({ kind: 'lesson', data: l })}>
                      <td className="px-2 py-2 text-center font-medium">{dayLabel(l.default_day_of_week)}</td>
                      <td className="px-2 py-2 text-xs font-mono whitespace-nowrap">{l.default_start_time ?? '—'}{l.default_end_time ? `〜${l.default_end_time}` : ''}</td>
                      <td className="px-2 py-2 font-medium">{l.class_name}</td>
                      <td className="px-2 py-2 text-xs">{l.instructor_name ?? <span className="text-slate-300">—</span>}</td>
                      <td className="px-2 py-2 text-xs">{l.studio_name ?? <span className="text-slate-300">—</span>}</td>
                      <td className="px-2 py-2 text-center">
                        {l.active
                          ? <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded">有効</span>
                          : <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded">無効</span>}
                      </td>
                    </tr>
                  ))}
                  {lessons.length === 0 && <tr><td colSpan={6} className="px-2 py-6 text-center text-slate-400">登録なし</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* STUDIO DETAIL MODAL */}
      {detail?.kind === 'studio' && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 z-40 overflow-y-auto" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-lg w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-white">
              <h2 className="font-bold">📍 {detail.data.name}{!detail.data.active && <span className="text-xs text-slate-400 ml-1">(非active)</span>}</h2>
              <button onClick={() => setDetail(null)} className="text-2xl leading-none text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <DetailRow label="料金">{detail.data.pricing_model === 'hourly' ? `¥${detail.data.hourly_rate.toLocaleString()}/h` : `区分制`}</DetailRow>
              <DetailRow label="バッファ">{detail.data.daily_buffer_minutes ? `+${detail.data.daily_buffer_minutes}分/日` : 'なし'}</DetailRow>
              <DetailRow label="住所">{detail.data.address || '—'}</DetailRow>
              <DetailRow label="Google Map">{detail.data.google_map_url ? <a href={detail.data.google_map_url} target="_blank" rel="noreferrer" className="text-blue-600 underline">{detail.data.google_map_url}</a> : '—'}</DetailRow>
              {detail.data.pricing_model === 'block' && (() => {
                const blocks = parseBlocks(detail.data.block_pricing);
                return (
                  <DetailRow label="区分料金">
                    {blocks.length === 0 ? '未設定' : (
                      <div className="space-y-0.5">
                        {blocks.map((b, i) => (
                          <div key={i} className="text-sm">
                            {b.label ? `${b.label}: ` : ''}{b.start || '—'}〜{b.end || '—'} ¥{b.price.toLocaleString()}
                          </div>
                        ))}
                      </div>
                    )}
                  </DetailRow>
                );
              })()}
              <DetailRow label="メモ">{detail.data.notes || '—'}</DetailRow>
            </div>
            <div className="flex gap-2 px-4 py-3 border-t bg-slate-50">
              <button onClick={() => { const d = detail.data; setDetail(null); startEditStudio(d); }} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold">✏️ 編集する</button>
              <button onClick={() => { const id = detail.data.id; setDetail(null); remove('studios', id); }} className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm">削除</button>
              <button onClick={() => setDetail(null)} className="ml-auto px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded text-sm">閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* INSTRUCTOR DETAIL MODAL */}
      {detail?.kind === 'instructor' && (() => {
        const myRates = rates.filter(r => r.instructor_id === detail.data.id);
        const myFees = fees.filter(f => f.instructor_id === detail.data.id);
        const photoCount = photoCounts.find(p => p.instructor_id === detail.data.id)?.count ?? 0;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 z-40 overflow-y-auto" onClick={() => setDetail(null)}>
            <div className="bg-white rounded-lg w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-white">
                <h2 className="font-bold">👤 {detail.data.name}</h2>
                <button onClick={() => setDetail(null)} className="text-2xl leading-none text-slate-400 hover:text-slate-700">✕</button>
              </div>
              <div className="p-4 space-y-3 text-sm">
                <div className="flex gap-2 flex-wrap">
                  {detail.data.instagram_handle && <a href={`https://www.instagram.com/${detail.data.instagram_handle}/`} target="_blank" rel="noreferrer" className="px-3 py-1 bg-pink-100 hover:bg-pink-200 text-pink-700 rounded text-xs font-semibold">📷 @{detail.data.instagram_handle}</a>}
                  {detail.data.shared_folder_url && <a href={detail.data.shared_folder_url} target="_blank" rel="noreferrer" className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs font-semibold">📁 Driveフォルダ</a>}
                  {photoCount > 0 && <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">📸 写真 {photoCount}枚</span>}
                </div>
                <DetailRow label="フリガナ">{detail.data.name_kana || '—'}</DetailRow>
                <DetailRow label="メール">{detail.data.contact_email || '—'}</DetailRow>
                <DetailRow label="電話">{detail.data.contact_phone || '—'}</DetailRow>
                <DetailRow label="単価">
                  {myRates.length > 0 ? myRates.map(r => <div key={r.id}>{r.duration_minutes}分: ¥{r.rate.toLocaleString()}</div>) : '—'}
                </DetailRow>
                <DetailRow label="交通費">
                  {myFees.length > 0 ? myFees.map(f => {
                    const studio = studios.find(s => s.id === f.studio_id);
                    return <div key={f.id}>{studio?.name ?? `(ID:${f.studio_id})`}: ¥{f.amount.toLocaleString()}</div>;
                  }) : '—'}
                </DetailRow>
                <DetailRow label="プロフィール">{detail.data.profile_text || '—'}</DetailRow>
                <DetailRow label="給与体系">{detail.data.salary_type === 'monthly_fixed' ? `固定給 ¥${(detail.data.monthly_fixed_amount ?? 0).toLocaleString()}/月` : '時給制 (レッスン単価)'}</DetailRow>
                <DetailRow label="銀行">{detail.data.bank_name || '—'} {detail.data.bank_branch || ''} / {detail.data.bank_account_type || ''} {detail.data.bank_account_number || ''} / {detail.data.bank_account_holder || ''}</DetailRow>
                <DetailRow label="メモ">{detail.data.notes || '—'}</DetailRow>
              </div>
              <div className="flex gap-2 px-4 py-3 border-t bg-slate-50">
                <button onClick={() => { const d = detail.data; setDetail(null); startEditInstructor(d); }} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold">✏️ 編集する</button>
                <button onClick={() => { const id = detail.data.id; setDetail(null); remove('instructors', id); }} className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm">削除</button>
                <button onClick={() => setDetail(null)} className="ml-auto px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded text-sm">閉じる</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* LESSON DETAIL MODAL */}
      {detail?.kind === 'lesson' && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 z-40 overflow-y-auto" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-lg w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-white">
              <h2 className="font-bold">📋 {detail.data.class_name}{!detail.data.active && <span className="text-xs text-slate-400 ml-1">(無効)</span>}</h2>
              <button onClick={() => setDetail(null)} className="text-2xl leading-none text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <DetailRow label="曜日">{dayLabel(detail.data.default_day_of_week)}曜</DetailRow>
              <DetailRow label="時刻">{detail.data.default_start_time ?? '—'} 〜 {detail.data.default_end_time ?? '—'}</DetailRow>
              <DetailRow label="所要分">{detail.data.duration_minutes != null ? `${detail.data.duration_minutes}分` : '—'}</DetailRow>
              <DetailRow label="スタジオ">{detail.data.studio_name ?? '—'}</DetailRow>
              <DetailRow label="インストラクター">{detail.data.instructor_name ?? '—'}</DetailRow>
              <DetailRow label="対象">{detail.data.target || '—'}</DetailRow>
              <DetailRow label="レベル">{detail.data.level || '—'}</DetailRow>
              <DetailRow label="頻度">{detail.data.frequency_type || '—'}</DetailRow>
              <DetailRow label="開始日">{detail.data.start_date || '—'}</DetailRow>
              <DetailRow label="終了日">{detail.data.end_date ? `${detail.data.end_date} (この日がラスト)` : '—'}</DetailRow>
              <DetailRow label="単価上書き">{detail.data.override_rate != null ? `¥${detail.data.override_rate.toLocaleString()}` : '—'}</DetailRow>
              <DetailRow label="状態">{detail.data.active ? '有効' : '無効'}</DetailRow>
              <DetailRow label="メモ">{detail.data.notes || '—'}</DetailRow>
            </div>
            <div className="flex gap-2 px-4 py-3 border-t bg-slate-50">
              <button onClick={() => { const d = detail.data; setDetail(null); setEditing({ kind: 'lesson', data: d }); }} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold">✏️ 編集する</button>
              <button onClick={() => { const id = detail.data.id; setDetail(null); removeLesson(id); }} className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm">削除 (無効化)</button>
              <button onClick={() => setDetail(null)} className="ml-auto px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded text-sm">閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* STUDIO EDIT MODAL */}
      {editing?.kind === 'studio' && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-lg p-4 w-full max-w-2xl my-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold">{editing.data.id ? 'スタジオ編集' : 'スタジオ追加'}</h2>
              <button onClick={() => { setEditing(null); setEditBlocks([]); }} className="text-2xl leading-none px-2 py-0 text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="space-y-2 text-sm">
              <Field label="名称*" value={editing.data.name ?? ''} onChange={v => setEditing({ kind: 'studio', data: { ...editing.data, name: v } })} />
              <Field label="住所" value={editing.data.address ?? ''} onChange={v => setEditing({ kind: 'studio', data: { ...editing.data, address: v } })} />
              <Field label="Google Map URL" value={editing.data.google_map_url ?? ''} onChange={v => setEditing({ kind: 'studio', data: { ...editing.data, google_map_url: v } })} />
              <div>
                <label className="text-xs text-slate-600">料金モデル</label>
                <select
                  value={editing.data.pricing_model ?? 'hourly'}
                  onChange={e => setEditing({ kind: 'studio', data: { ...editing.data, pricing_model: e.target.value } })}
                  className="w-full border rounded px-2 py-1 text-sm bg-white"
                >
                  <option value="hourly">時間単価 (¥/h)</option>
                  <option value="block">ブロック (時間帯固定)</option>
                </select>
              </div>
              {editing.data.pricing_model !== 'block' && (
                <Field label="1時間あたり単価 (¥)" type="number" value={String(editing.data.hourly_rate ?? 0)} onChange={v => setEditing({ kind: 'studio', data: { ...editing.data, hourly_rate: Number(v) || 0 } })} />
              )}
              {editing.data.pricing_model === 'block' && (
                <div>
                  <label className="text-xs text-slate-600">区分料金 (時間帯ごとの料金)</label>
                  <div className="mt-1 space-y-2">
                    {editBlocks.length === 0 && <p className="text-xs text-slate-400">区分がありません。「+ 区分追加」で追加してください。</p>}
                    {editBlocks.map((b, i) => (
                      <div key={i} className="flex flex-wrap gap-2 items-center">
                        <input
                          type="text"
                          value={b.label}
                          onChange={e => { const nb = [...editBlocks]; nb[i] = { ...nb[i], label: e.target.value }; setEditBlocks(nb); }}
                          className="border rounded px-2 py-1 text-sm w-28 bg-white text-neutral-900"
                          placeholder="ラベル(夜間等)"
                        />
                        <input
                          type="time"
                          value={b.start}
                          onChange={e => { const nb = [...editBlocks]; nb[i] = { ...nb[i], start: e.target.value }; setEditBlocks(nb); }}
                          className="border rounded px-2 py-1 text-sm bg-white text-neutral-900"
                        />
                        <span className="text-xs">〜</span>
                        <input
                          type="time"
                          value={b.end}
                          onChange={e => { const nb = [...editBlocks]; nb[i] = { ...nb[i], end: e.target.value }; setEditBlocks(nb); }}
                          className="border rounded px-2 py-1 text-sm bg-white text-neutral-900"
                        />
                        <input
                          type="number"
                          value={b.price}
                          onChange={e => { const nb = [...editBlocks]; nb[i] = { ...nb[i], price: Number(e.target.value) || 0 }; setEditBlocks(nb); }}
                          className="border rounded px-2 py-1 text-sm w-24 bg-white text-neutral-900"
                          placeholder="料金"
                        />
                        <span className="text-xs">¥</span>
                        <button onClick={() => setEditBlocks(editBlocks.filter((_, j) => j !== i))} className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">×</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setEditBlocks([...editBlocks, { label: '', start: '', end: '', price: 0 }])} className="mt-2 text-xs px-2 py-1 bg-slate-200 rounded">+ 区分追加</button>
                </div>
              )}
              <Field label="1日あたりバッファ分数 (例: 30)" type="number" value={String(editing.data.daily_buffer_minutes ?? 0)} onChange={v => setEditing({ kind: 'studio', data: { ...editing.data, daily_buffer_minutes: Number(v) || 0 } })} />
              <Field label="メモ" value={editing.data.notes ?? ''} onChange={v => setEditing({ kind: 'studio', data: { ...editing.data, notes: v } })} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => saveStudio(editing.data)} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold">保存</button>
              <button onClick={() => { setEditing(null); setEditBlocks([]); }} className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded text-sm">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* INSTRUCTOR EDIT MODAL */}
      {editing?.kind === 'instructor' && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-lg p-4 w-full max-w-3xl my-8">
            <div className="flex items-center justify-between mb-3 sticky top-0 bg-white py-1 z-10">
              <h2 className="font-bold">{editing.data.id ? 'インストラクター編集' : 'インストラクター追加'}</h2>
              <button onClick={() => { setEditing(null); setEditRates([]); setEditFees([]); }} className="text-2xl leading-none px-2 py-0 text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <Field label="名前*" value={editing.data.name ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, name: v } })} />
              <Field label="フリガナ" value={editing.data.name_kana ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, name_kana: v } })} />
              <Field label="メール" value={editing.data.contact_email ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, contact_email: v } })} />
              <Field label="電話" value={editing.data.contact_phone ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, contact_phone: v } })} />
              <Field label="Instagram (@なし)" value={editing.data.instagram_handle ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, instagram_handle: v } })} />
              <Field label="共有Driveフォルダ URL" value={editing.data.shared_folder_url ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, shared_folder_url: v } })} />
              <Field label="プロフィール写真 URL" value={editing.data.profile_photo_url ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, profile_photo_url: v } })} />
              <Field label="銀行名" value={editing.data.bank_name ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, bank_name: v } })} />
              <Field label="支店" value={editing.data.bank_branch ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, bank_branch: v } })} />
              <Field label="口座種別 (普通/当座)" value={editing.data.bank_account_type ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, bank_account_type: v } })} />
              <Field label="口座番号" value={editing.data.bank_account_number ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, bank_account_number: v } })} />
              <Field label="口座名義" value={editing.data.bank_account_holder ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, bank_account_holder: v } })} />
              <Field label="メモ" value={editing.data.notes ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, notes: v } })} />

              <label className="block">
                <span className="text-xs text-slate-500">給与体系</span>
                <select
                  value={editing.data.salary_type ?? 'per_lesson'}
                  onChange={e => setEditing({ kind: 'instructor', data: { ...editing.data, salary_type: e.target.value } })}
                  className="w-full border rounded px-2 py-1 text-sm bg-white"
                >
                  <option value="per_lesson">時給制 (レッスン単価)</option>
                  <option value="monthly_fixed">固定給 (月額固定)</option>
                </select>
              </label>
              {editing.data.salary_type === 'monthly_fixed' && (
                <label className="block">
                  <span className="text-xs text-slate-500">固定給額 (月額 ¥)</span>
                  <input
                    type="number"
                    value={editing.data.monthly_fixed_amount ?? ''}
                    onChange={e => setEditing({ kind: 'instructor', data: { ...editing.data, monthly_fixed_amount: e.target.value === '' ? null : Number(e.target.value) } })}
                    className="w-full border rounded px-2 py-1 text-sm bg-white"
                    placeholder="例: 70000"
                  />
                </label>
              )}
            </div>

            {/* ============ HP公開情報 ============ */}
            <div className="mt-6 border-t-2 border-orange-200 pt-4">
              <h3 className="font-bold text-sm mb-3 text-orange-700 flex items-center gap-2">
                🌐 HP公開情報
                <span className="text-xs font-normal text-slate-500">
                  boom-hp.pages.dev で表示される内容
                </span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <Field
                  label="slug (URL用 / 半角英数。例: taro)"
                  value={editing.data.slug ?? ''}
                  onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, slug: v } })}
                />
                <Field
                  label="ジャンル (例: HIPHOP)"
                  value={editing.data.genre ?? ''}
                  onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, genre: v } })}
                />
                <Field
                  label="クルー (複数なら / で区切り)"
                  value={editing.data.crews ?? ''}
                  onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, crews: v } })}
                />
                <label className="block">
                  <span className="text-xs text-slate-500">HP表示順 (小さい順)</span>
                  <input
                    type="number"
                    value={editing.data.public_display_order ?? ''}
                    onChange={e => setEditing({ kind: 'instructor', data: { ...editing.data, public_display_order: e.target.value === '' ? null : Number(e.target.value) } })}
                    className="w-full border rounded px-2 py-1 text-sm bg-white"
                    placeholder="例: 1"
                  />
                </label>
              </div>
              <div className="mt-3 space-y-2">
                <label className="block">
                  <span className="text-xs text-slate-500">プロフィール (自己紹介・スタンス。改行OK)</span>
                  <textarea
                    value={editing.data.profile_text ?? ''}
                    onChange={e => setEditing({ kind: 'instructor', data: { ...editing.data, profile_text: e.target.value } })}
                    className="w-full border rounded px-2 py-1 text-sm bg-white"
                    rows={4}
                    placeholder="例: HIPHOPダンサー。エネルギッシュなダンスと明るいキャラクターで…"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">経歴 (受賞歴・出演イベント等。改行OK)</span>
                  <textarea
                    value={editing.data.career_text ?? ''}
                    onChange={e => setEditing({ kind: 'instructor', data: { ...editing.data, career_text: e.target.value } })}
                    className="w-full border rounded px-2 py-1 text-sm bg-white"
                    rows={5}
                    placeholder="例:&#10;2018 JDD vol.19 FINALIST&#10;2020 全国大会優勝&#10;2022〜 BOOM 講師"
                  />
                </label>
              </div>
              <p className="mt-3 text-xs text-slate-500 leading-relaxed">
                💡 編集後、HPに反映するには <code className="bg-slate-100 px-1 rounded">boom-hp</code> プロジェクトでデプロイが必要 (TARO に依頼 or 自分でビルド)
                <br />
                ※ slug は変更しないことを推奨（URL が変わる）
              </p>
            </div>

            <div className="mt-4">
              <h3 className="font-semibold text-sm mb-2">単価設定</h3>
              {editRates.map((r, i) => (
                <div key={i} className="flex gap-2 mb-1 items-center">
                  <input type="number" value={r.duration} onChange={e => {
                    const nr = [...editRates]; nr[i].duration = Number(e.target.value) || 0; setEditRates(nr);
                  }} className="border rounded px-2 py-1 text-sm w-20 bg-white" placeholder="分" />
                  <span className="text-xs">分</span>
                  <input type="number" value={r.rate} onChange={e => {
                    const nr = [...editRates]; nr[i].rate = Number(e.target.value) || 0; setEditRates(nr);
                  }} className="border rounded px-2 py-1 text-sm w-28 bg-white" placeholder="単価" />
                  <span className="text-xs">¥</span>
                  <button onClick={() => setEditRates(editRates.filter((_, j) => j !== i))} className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">×</button>
                </div>
              ))}
              <button onClick={() => setEditRates([...editRates, { duration: 90, rate: 0 }])} className="text-xs px-2 py-1 bg-slate-200 rounded">+ 単価追加</button>
            </div>

            <div className="mt-4">
              <h3 className="font-semibold text-sm mb-2">交通費設定 (スタジオ別)</h3>
              {editFees.map((f, i) => (
                <div key={i} className="flex gap-2 mb-1 items-center">
                  <select value={f.studio_id} onChange={e => {
                    const nf = [...editFees]; nf[i].studio_id = Number(e.target.value); setEditFees(nf);
                  }} className="border rounded px-2 py-1 text-sm bg-white">
                    <option value="">スタジオ選択</option>
                    {studios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <input type="number" value={f.amount} onChange={e => {
                    const nf = [...editFees]; nf[i].amount = Number(e.target.value) || 0; setEditFees(nf);
                  }} className="border rounded px-2 py-1 text-sm w-28 bg-white" placeholder="¥" />
                  <button onClick={() => setEditFees(editFees.filter((_, j) => j !== i))} className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">×</button>
                </div>
              ))}
              <button onClick={() => setEditFees([...editFees, { studio_id: 0, amount: 0 }])} className="text-xs px-2 py-1 bg-slate-200 rounded">+ 交通費追加</button>
            </div>

            <div className="flex gap-2 mt-4">
              <button onClick={() => saveInstructor(editing.data)} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold">保存</button>
              <button onClick={() => { setEditing(null); setEditRates([]); setEditFees([]); }} className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded text-sm">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* LESSON EDIT MODAL */}
      {editing?.kind === 'lesson' && (() => {
        const d = editing.data;
        const set = (patch: Partial<Lesson>) => setEditing({ kind: 'lesson', data: { ...d, ...patch } });
        // 開始/終了から所要分を計算 (HH:MM)
        const calcDuration = (start?: string | null, end?: string | null): number | null => {
          if (!start || !end) return null;
          const [sh, sm] = start.split(':').map(Number);
          const [eh, em] = end.split(':').map(Number);
          if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return null;
          const diff = (eh * 60 + em) - (sh * 60 + sm);
          return diff > 0 ? diff : null;
        };
        // 分 → HH:MM (0-1439 にクランプ)
        const fromMinutes = (mins: number): string => {
          const w = ((mins % 1440) + 1440) % 1440;
          return `${String(Math.floor(w / 60)).padStart(2, '0')}:${String(w % 60).padStart(2, '0')}`;
        };
        // 開始変更時: 保ちたい所要分 (旧開始終了の差、無ければ duration_minutes、無ければ60分) を保って新終了を返す
        const shiftEnd = (newStart: string): string | null => {
          const [sh, sm] = newStart.split(':').map(Number);
          if (Number.isNaN(sh) || Number.isNaN(sm)) return d.default_end_time ?? null;
          const keepDur = calcDuration(d.default_start_time, d.default_end_time) ?? d.duration_minutes ?? 60;
          return fromMinutes(sh * 60 + sm + keepDur);
        };
        return (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-white rounded-lg p-4 w-full max-w-2xl my-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold">{d.id ? 'レッスン編集' : 'レッスン追加'}</h2>
                <button onClick={() => setEditing(null)} className="text-2xl leading-none px-2 py-0 text-slate-400 hover:text-slate-700">✕</button>
              </div>
              <div className="space-y-2 text-sm">
                <Field label="クラス名*" value={d.class_name ?? ''} onChange={v => set({ class_name: v })} />
                <div>
                  <label className="text-xs text-slate-600">曜日</label>
                  <select
                    value={d.default_day_of_week ?? 0}
                    onChange={e => set({ default_day_of_week: Number(e.target.value) })}
                    className="w-full border rounded px-2 py-1 text-sm bg-white"
                  >
                    {DAY_NAMES.map((name, i) => <option key={i} value={i}>{name}曜</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-600">開始時刻</label>
                    <input type="time" value={d.default_start_time ?? ''} onChange={e => {
                      const start = e.target.value;
                      // 開始変更時は所要時間を保って終了を自動追従
                      const newEnd = start ? shiftEnd(start) : d.default_end_time;
                      set({ default_start_time: start, default_end_time: newEnd, duration_minutes: calcDuration(start, newEnd) ?? d.duration_minutes });
                    }} className="w-full border rounded px-2 py-1 text-sm bg-white text-neutral-900" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600">終了時刻</label>
                    <input type="time" value={d.default_end_time ?? ''} onChange={e => {
                      const end = e.target.value;
                      set({ default_end_time: end, duration_minutes: calcDuration(d.default_start_time, end) ?? d.duration_minutes });
                    }} className="w-full border rounded px-2 py-1 text-sm bg-white text-neutral-900" />
                  </div>
                </div>
                <Field label="所要分 (開始終了から自動計算)" type="number" value={String(d.duration_minutes ?? '')} onChange={v => set({ duration_minutes: v === '' ? null : (Number(v) || 0) })} />
                <div>
                  <label className="text-xs text-slate-600">スタジオ</label>
                  <select
                    value={d.default_studio_id ?? ''}
                    onChange={e => set({ default_studio_id: e.target.value === '' ? null : Number(e.target.value) })}
                    className="w-full border rounded px-2 py-1 text-sm bg-white"
                  >
                    <option value="">(未設定)</option>
                    {studios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-600">インストラクター</label>
                  <select
                    value={d.default_instructor_id ?? ''}
                    onChange={e => set({ default_instructor_id: e.target.value === '' ? null : Number(e.target.value) })}
                    className="w-full border rounded px-2 py-1 text-sm bg-white"
                  >
                    <option value="">(未設定)</option>
                    {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
                <Field label="頻度 (例: weekly)" value={d.frequency_type ?? ''} onChange={v => set({ frequency_type: v })} />
                <Field label="単価上書き (¥・空欄でインストラクター標準単価)" type="number" value={d.override_rate == null ? '' : String(d.override_rate)} onChange={v => set({ override_rate: v === '' ? null : (Number(v) || 0) })} />
                <Field label="社内メモ" value={d.notes ?? ''} onChange={v => set({ notes: v })} />
                <Field label="開始日 (この日から開講・空欄=制限なし)" type="date" value={d.start_date ?? ''} onChange={v => set({ start_date: v === '' ? null : v })} />
                <Field label="終了日 (この日がラスト・翌日以降は二度と生成しない・空欄=制限なし)" type="date" value={d.end_date ?? ''} onChange={v => set({ end_date: v === '' ? null : v })} />
                <label className="flex items-center gap-2 pt-1">
                  <input type="checkbox" checked={!!d.active} onChange={e => set({ active: e.target.checked ? 1 : 0 })} />
                  <span className="text-sm">有効</span>
                </label>
              </div>

              {/* ============ HP公開情報 ============ */}
              <div className="mt-6 border-t-2 border-orange-200 pt-4">
                <h3 className="font-bold text-sm mb-3 text-orange-700 flex items-center gap-2">
                  🌐 HP公開情報
                  <span className="text-xs font-normal text-slate-500">
                    boom-hp.pages.dev/classes に表示される
                  </span>
                </h3>
                <div className="space-y-2 text-sm">
                  <Field
                    label="対象 (例: 4歳〜12歳 / 中学生〜大人)"
                    value={d.target ?? ''}
                    onChange={v => set({ target: v })}
                  />
                  <Field
                    label="レベル (例: 初心者 / 初級〜中級)"
                    value={d.level ?? ''}
                    onChange={v => set({ level: v })}
                  />
                  <label className="block">
                    <span className="text-xs text-slate-500">クラス説明 (HPの体験予約導線。改行OK)</span>
                    <textarea
                      value={d.description_text ?? ''}
                      onChange={e => set({ description_text: e.target.value })}
                      className="w-full border rounded px-2 py-1 text-sm bg-white"
                      rows={4}
                      placeholder="例: 腕を大きく振るダイナミックなダンス。表現力を磨きたい方にオススメです。"
                    />
                  </label>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => saveLesson(d)} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold">保存</button>
                <button onClick={() => setEditing(null)} className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded text-sm">キャンセル</button>
              </div>
            </div>
          </div>
        );
      })()}
    </main>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="text-xs text-slate-600">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-white text-neutral-900" />
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2 py-1 border-b border-slate-100 last:border-0">
      <div className="text-xs text-slate-500 font-semibold">{label}</div>
      <div className="text-sm text-slate-800 break-words">{children}</div>
    </div>
  );
}

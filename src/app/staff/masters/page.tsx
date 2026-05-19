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
};

type Rate = { id: number; instructor_id: number; duration_minutes: number; rate: number };
type TransitFee = { id: number; instructor_id: number; studio_id: number; amount: number };

export default function MastersPage() {
  const [tab, setTab] = useState<'studios' | 'instructors'>('studios');
  const [studios, setStudios] = useState<Studio[]>([]);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [fees, setFees] = useState<TransitFee[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ kind: 'studio'; data: Partial<Studio> } | { kind: 'instructor'; data: Partial<Instructor> } | null>(null);
  const [editRates, setEditRates] = useState<{ duration: number; rate: number }[]>([]);
  const [editFees, setEditFees] = useState<{ studio_id: number; amount: number }[]>([]);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, i] = await Promise.all([
        fetch('/api/staff/master/studios', { credentials: 'include' }),
        fetch('/api/staff/master/instructors', { credentials: 'include' }),
      ]);
      if (s.status === 401 || i.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/masters';
        return;
      }
      const sData = await s.json();
      const iData = await i.json();
      setStudios(sData.studios || []);
      setInstructors(iData.instructors || []);
      setRates(iData.rates || []);
      setFees(iData.transit_fees || []);
    } catch (e) {
      setMsg(`読込失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveStudio = async (data: Partial<Studio>) => {
    try {
      if (data.id) {
        await fetch(`/api/staff/master/studios/${data.id}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else {
        await fetch(`/api/staff/master/studios`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      }
      setEditing(null);
      await load();
    } catch (e) {
      setMsg(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
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

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <StaffPageHeader title="🗂️ マスターデータ管理" description="スタジオ・インストラクター・レッスン定義" />

      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        {msg && <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-sm">{msg}</div>}

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
        </div>

        {loading && <p className="text-slate-500 text-sm">読込中...</p>}

        {/* STUDIOS LIST */}
        {!loading && tab === 'studios' && (
          <>
            <button
              onClick={() => setEditing({ kind: 'studio', data: { pricing_model: 'hourly', daily_buffer_minutes: 0, active: 1 } })}
              className="mb-3 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold"
            >+ スタジオ追加</button>
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-2 py-2 text-left">名称</th>
                    <th className="px-2 py-2 text-left">料金</th>
                    <th className="px-2 py-2 text-left">バッファ</th>
                    <th className="px-2 py-2 text-left">住所/Map</th>
                    <th className="px-2 py-2 text-left"></th>
                  </tr>
                </thead>
                <tbody>
                  {studios.map(s => (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="px-2 py-2 font-medium">{s.name}{!s.active && <span className="text-xs text-slate-400 ml-1">(非active)</span>}</td>
                      <td className="px-2 py-2 text-xs">
                        {s.pricing_model === 'hourly' ? `時間: ¥${s.hourly_rate.toLocaleString()}/h` : `ブロック`}
                      </td>
                      <td className="px-2 py-2 text-xs">{s.daily_buffer_minutes ? `+${s.daily_buffer_minutes}分/日` : '-'}</td>
                      <td className="px-2 py-2 text-xs text-slate-600">
                        {s.google_map_url ? <a href={s.google_map_url} target="_blank" rel="noreferrer" className="text-blue-600 underline">Map</a> : ''} {s.address || ''}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <button onClick={() => setEditing({ kind: 'studio', data: s })} className="text-xs px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded">編集</button>
                        <button onClick={() => remove('studios', s.id)} className="ml-1 text-xs px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-700 rounded">削除</button>
                      </td>
                    </tr>
                  ))}
                  {studios.length === 0 && <tr><td colSpan={5} className="px-2 py-6 text-center text-slate-400">登録なし</td></tr>}
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
                    <th className="px-2 py-2 text-left">連絡</th>
                    <th className="px-2 py-2 text-left">単価</th>
                    <th className="px-2 py-2 text-left">IG</th>
                    <th className="px-2 py-2 text-left">Drive</th>
                    <th className="px-2 py-2 text-left"></th>
                  </tr>
                </thead>
                <tbody>
                  {instructors.map(i => {
                    const myRates = rates.filter(r => r.instructor_id === i.id);
                    return (
                      <tr key={i.id} className="border-t border-slate-100">
                        <td className="px-2 py-2 font-medium">{i.name}{i.name_kana ? <span className="text-xs text-slate-400 ml-1">({i.name_kana})</span> : ''}</td>
                        <td className="px-2 py-2 text-xs text-slate-600">{i.contact_email || ''}<br />{i.contact_phone || ''}</td>
                        <td className="px-2 py-2 text-xs">
                          {myRates.map(r => <div key={r.id}>{r.duration_minutes}分: ¥{r.rate.toLocaleString()}</div>)}
                          {myRates.length === 0 && '-'}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {i.instagram_handle
                            ? <a href={`https://www.instagram.com/${i.instagram_handle}/`} target="_blank" rel="noreferrer" className="text-pink-600 hover:underline" title={`@${i.instagram_handle}`}>📷</a>
                            : <span className="text-slate-300">-</span>}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {i.shared_folder_url
                            ? <a href={i.shared_folder_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline" title="Driveフォルダ">📁</a>
                            : <span className="text-slate-300">-</span>}
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <button onClick={() => startEditInstructor(i)} className="text-xs px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded">編集</button>
                          <button onClick={() => remove('instructors', i.id)} className="ml-1 text-xs px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-700 rounded">削除</button>
                        </td>
                      </tr>
                    );
                  })}
                  {instructors.length === 0 && <tr><td colSpan={6} className="px-2 py-6 text-center text-slate-400">登録なし</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* STUDIO EDIT MODAL */}
      {editing?.kind === 'studio' && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-lg p-4 w-full max-w-2xl my-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold">{editing.data.id ? 'スタジオ編集' : 'スタジオ追加'}</h2>
              <button onClick={() => setEditing(null)} className="text-2xl leading-none px-2 py-0 text-slate-400 hover:text-slate-700">✕</button>
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
                <Field label="ブロック料金 (JSON 例: [{&quot;start&quot;:&quot;17:00&quot;,&quot;end&quot;:&quot;22:00&quot;,&quot;price&quot;:1100}])" value={typeof editing.data.block_pricing === 'string' ? editing.data.block_pricing : JSON.stringify(editing.data.block_pricing ?? [])} onChange={v => setEditing({ kind: 'studio', data: { ...editing.data, block_pricing: v } })} />
              )}
              <Field label="1日あたりバッファ分数 (例: 30)" type="number" value={String(editing.data.daily_buffer_minutes ?? 0)} onChange={v => setEditing({ kind: 'studio', data: { ...editing.data, daily_buffer_minutes: Number(v) || 0 } })} />
              <Field label="メモ" value={editing.data.notes ?? ''} onChange={v => setEditing({ kind: 'studio', data: { ...editing.data, notes: v } })} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => saveStudio(editing.data)} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold">保存</button>
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded text-sm">キャンセル</button>
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
              <Field label="プロフィール文" value={editing.data.profile_text ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, profile_text: v } })} />
              <Field label="銀行名" value={editing.data.bank_name ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, bank_name: v } })} />
              <Field label="支店" value={editing.data.bank_branch ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, bank_branch: v } })} />
              <Field label="口座種別 (普通/当座)" value={editing.data.bank_account_type ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, bank_account_type: v } })} />
              <Field label="口座番号" value={editing.data.bank_account_number ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, bank_account_number: v } })} />
              <Field label="口座名義" value={editing.data.bank_account_holder ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, bank_account_holder: v } })} />
              <Field label="メモ" value={editing.data.notes ?? ''} onChange={v => setEditing({ kind: 'instructor', data: { ...editing.data, notes: v } })} />
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

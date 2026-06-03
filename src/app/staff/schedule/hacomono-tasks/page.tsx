'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import StaffPageHeader from '@/components/StaffPageHeader';

type DeleteItem = {
  date: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  class_name: string;
  hacomono_name: string | null;
  pg_code: string | null;
  reason: string;
  status: string;
  done: boolean;
  log_action: string | null;
};

type PlanClass = {
  class_name: string;
  pg_code: string | null;
  day_of_week: string;
  items: DeleteItem[];
};

type PhantomClass = {
  class_name: string;
  pg_code: string | null;
  hacomono_name: string | null;
  day_of_week: string | null;
  reason: string;
};

type TasksResp = {
  month: string;
  delete_count: number;
  done_count: number;
  remaining_count: number;
  deletes: DeleteItem[];
  plan_by_class: PlanClass[];
  unmapped_scheduled: string[];
  phantom_classes: PhantomClass[];
};

// 月候補: 今月-1 〜 今月+3 (翌月既定)
function monthOptions(): { value: string; label: string }[] {
  const now = new Date();
  const out: { value: string; label: string }[] = [];
  for (let i = -1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value: v, label: `${d.getFullYear()}年${d.getMonth() + 1}月` });
  }
  return out;
}

function groupByClass(items: DeleteItem[]): { class_name: string; pg_code: string | null; items: DeleteItem[] }[] {
  const m = new Map<string, { class_name: string; pg_code: string | null; items: DeleteItem[] }>();
  for (const it of items) {
    if (!m.has(it.class_name)) m.set(it.class_name, { class_name: it.class_name, pg_code: it.pg_code, items: [] });
    m.get(it.class_name)!.items.push(it);
  }
  return Array.from(m.values());
}

export default function HacomonoTasksPage() {
  const opts = monthOptions();
  const [month, setMonth] = useState<string>(opts[2].value); // 翌月
  const [data, setData] = useState<TasksResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch(`/api/staff/schedule/hacomono-tasks?month=${m}`, { credentials: 'include' });
      if (r.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/schedule/hacomono-tasks';
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(month);
  }, [month, load]);

  // 未処理分をクラス別にまとめた「サイドバー実行プラン」をコピー
  const copyText = async () => {
    if (!data) return;
    const lines = [`■ HACOMONO削除プラン ${data.month}（残${data.remaining_count}件）`];
    for (const cls of data.plan_by_class) {
      lines.push('', `【${cls.class_name}】${cls.day_of_week}曜${cls.pg_code ? ` ${cls.pg_code}` : ''}`);
      for (const it of cls.items) {
        lines.push(`  ${it.date}(${it.day_of_week}) ${it.start_time} … ${it.reason}`);
      }
    }
    if (data.plan_by_class.length === 0) lines.push('（残り無し・全て処理済み）');
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('コピーに失敗しました');
    }
  };

  // 削除済み(または取消)を記録
  const markDone = async (items: DeleteItem[], done: boolean) => {
    try {
      if (done) {
        await fetch('/api/staff/schedule/hacomono-delete-log', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: items.map((i) => ({ date: i.date, start_time: i.start_time, class_name: i.class_name, pg_code: i.pg_code, action: 'deleted' })),
          }),
        });
      } else {
        for (const i of items) {
          const q = new URLSearchParams({ date: i.date, start_time: i.start_time, class_name: i.class_name });
          await fetch(`/api/staff/schedule/hacomono-delete-log?${q.toString()}`, { method: 'DELETE', credentials: 'include' });
        }
      }
      await load(month);
    } catch {
      alert('記録に失敗しました');
    }
  };

  return (
    <main className="min-h-screen bg-neutral-50 pb-20">
      <StaffPageHeader
        title="🏢 HACOMONO 調整リスト"
        description="毎週自動生成されるHACOMONOの枠から、今月「消すべき枠」を自動抽出"
        rightExtra={
          <Link href="/staff/schedule/sync" className="text-xs text-orange-600 underline">
            ← 連携ハブ
          </Link>
        }
      />

      <div className="max-w-3xl mx-auto px-3 py-4 space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-800 leading-relaxed">
          HACOMONOは毎週レッスン枠を自動で作ります。下の「削除する枠」は、アプリの実予定では
          <b>開催しない枠</b>（5週目・スタジオ全休・休講・月1/2回クラスの非開催週 等）です。
          HACOMONOの予約カレンダーで該当枠を見つけて<b>削除/非公開</b>にしてください。
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-neutral-600">対象月</label>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-2 py-1.5 border rounded text-sm bg-white"
          >
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => load(month)}
            className="px-3 py-1.5 bg-neutral-200 hover:bg-neutral-300 rounded text-xs font-semibold"
          >
            再読込
          </button>
          {data && (
            <button
              onClick={copyText}
              className="ml-auto px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-xs font-semibold"
            >
              {copied ? '✓ コピー済' : '📋 リストをコピー'}
            </button>
          )}
        </div>

        {err && <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-xs">{err}</div>}
        {loading && <div className="text-sm text-neutral-500 py-8 text-center">読込中…</div>}

        {data && !loading && data.phantom_classes.length > 0 && (
          <section className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
            <h2 className="text-sm font-bold text-red-700 mb-1">⚠️ HACOMONOで「終了設定」が必要なクラス</h2>
            <p className="text-[11px] text-red-700/80 leading-relaxed mb-2">
              アプリでは終了/無効なのに、HACOMONO側の終了月が未設定の可能性があります。このままだとHACOMONOが枠を作り続け、
              <b>お客さんが誤って予約できてしまいます</b>。HACOMONOのクラス設定で「適用終了年月」を入れ、期間外の枠を削除してください。
            </p>
            <ul className="space-y-1">
              {data.phantom_classes.map((p, i) => (
                <li key={i} className="text-xs text-neutral-800 bg-white/70 rounded px-2 py-1.5 flex items-center gap-2">
                  <span className="font-semibold">{p.class_name}</span>
                  {p.day_of_week && <span className="text-[10px] text-neutral-500">{p.day_of_week}曜</span>}
                  {p.pg_code && <span className="font-mono text-[10px] bg-neutral-100 rounded px-1">{p.pg_code}</span>}
                  <span className="ml-auto text-[10px] text-red-600">{p.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data && !loading && (
          <>
            <section className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-neutral-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-rose-700">🗑 削除する枠（クラス別）</h2>
                <span className="text-xs font-semibold text-neutral-500">残 {data.remaining_count} / 全 {data.delete_count}件</span>
              </div>
              {data.deletes.length === 0 ? (
                <p className="p-4 text-xs text-neutral-500">この月は削除対象なし（HACOMONOの自動枠そのままでOK）。</p>
              ) : (
                <>
                  <p className="px-4 pt-2 text-[10px] text-neutral-400">
                    各枠をタップで「削除済み」⇄「未処理」を切替。HACOMONOで消したら印を付けると、来月以降の重複処理を防げます（🟥未処理・🟧休講・✅済）。
                  </p>
                  <div className="divide-y divide-neutral-100">
                    {groupByClass(data.deletes).map((g) => {
                      const remaining = g.items.filter((i) => !i.done);
                      const doneN = g.items.length - remaining.length;
                      return (
                        <div key={g.class_name} className="p-3">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span className="text-xs font-bold text-neutral-800">{g.class_name}</span>
                            <span className="text-[10px] text-neutral-500">{g.items[0].day_of_week}曜</span>
                            {g.pg_code ? (
                              <span className="font-mono text-[10px] bg-neutral-100 rounded px-1">{g.pg_code}</span>
                            ) : (
                              <span className="text-amber-600 text-[10px]">マップ無</span>
                            )}
                            <span className="ml-auto text-[10px] text-neutral-400">{doneN}/{g.items.length} 済</span>
                            {remaining.length > 0 && (
                              <button
                                onClick={() => markDone(remaining, true)}
                                className="text-[10px] px-2 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded font-semibold whitespace-nowrap"
                              >
                                残{remaining.length}件 削除済みに
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {g.items.map((it, i) => (
                              <button
                                key={i}
                                onClick={() => markDone([it], !it.done)}
                                title={it.reason}
                                className={`text-[10px] px-1.5 py-1 rounded border whitespace-nowrap font-mono ${
                                  it.done
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-600 line-through'
                                    : it.status === 'cancelled'
                                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                                      : 'bg-rose-50 border-rose-200 text-rose-700'
                                }`}
                              >
                                {it.done ? '✓ ' : ''}
                                {it.date.slice(5)} {it.start_time}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>

            {data.unmapped_scheduled.length > 0 && (
              <section className="bg-white border border-amber-200 rounded-xl p-4">
                <h2 className="text-sm font-bold text-amber-700 mb-1">➕ HACOMONO未登録クラス（要確認）</h2>
                <p className="text-[11px] text-neutral-600 mb-2">
                  アプリで開催予定だが、HACOMONO対応表に無いクラスです。HACOMONOが自動生成していなければ手動追加が要るかも。
                </p>
                <ul className="text-xs text-neutral-700 list-disc pl-5 space-y-0.5">
                  {data.unmapped_scheduled.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

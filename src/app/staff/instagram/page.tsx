'use client';

import { useCallback, useEffect, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';

type LogRow = {
  date: string;
  weekday: number;
  video_path: string | null;
  status: string;
  ig_media_id: string | null;
  error: string | null;
  created_at: string;
};

type QueueRow = {
  id: number;
  media_path: string;
  media_type: 'video' | 'image';
  kind: string;
  title: string | null;
  valid_from: string | null;
  valid_until: string | null;
  status: 'pending' | 'approved';
  last_posted_at: string | null;
  times_posted: number;
};

type StatusResp = {
  envConfigured: boolean;
  connected: boolean;
  igUserId?: string;
  tokenIssuedAt?: string;
  tokenAgeDays?: number;
  logs: LogRow[];
  queue: QueueRow[];
};

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  posted: { label: '投稿済み', cls: 'bg-green-100 text-green-700' },
  posted_queue: { label: '埋め草を投稿', cls: 'bg-green-100 text-green-700' },
  skipped_no_video: { label: '素材なしでスキップ', cls: 'bg-gray-100 text-gray-500' },
  skipped_not_configured: { label: '未連携でスキップ', cls: 'bg-gray-100 text-gray-500' },
  error: { label: 'エラー', cls: 'bg-red-100 text-red-700' },
};

const KIND_JA: Record<string, string> = {
  event: 'イベント告知',
  promo: '体験・入会',
  highlight: '過去ハイライト',
  progress: 'プロジェクト進捗',
};

export default function InstagramStoryPage() {
  const [data, setData] = useState<StatusResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff/instagram/status', { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/instagram';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [busyId, setBusyId] = useState<number | null>(null);
  const act = useCallback(
    async (id: number, action: 'approve' | 'reject') => {
      setBusyId(id);
      try {
        const res = await fetch('/api/staff/instagram/queue', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id, action }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  return (
    <div>
      <StaffPageHeader
        title="インスタストーリーズ自動投稿"
        description="毎朝8:00に今日の素材（日付指定 YYYY-MM-DD.mp4 優先→曜日デフォルト）をストーリーズへ自動投稿。素材が無い日は投稿しません"
        backHref="/staff"
      />
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {loading && <p className="text-sm text-neutral-500">読み込み中...</p>}
        {err && <p className="text-sm text-red-600">エラー: {err}</p>}

        {data && !data.envConfigured && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
            ⚠️ Meta App の環境変数(META_APP_ID / META_APP_SECRET)が未設定です。Vercelに設定してから連携してください。
          </div>
        )}

        {data && (
          <div className="rounded-xl bg-white border border-sand-200 shadow-sm p-4">
            <h2 className="font-bold text-navy-800 mb-2">連携状況</h2>
            {data.connected ? (
              <div className="text-sm space-y-1">
                <p className="text-green-700 font-semibold">✅ 連携済み</p>
                <p className="text-neutral-500">IGアカウントID: {data.igUserId}</p>
                <p className="text-neutral-500">
                  トークン取得日: {data.tokenIssuedAt?.slice(0, 10)}（{data.tokenAgeDays}日経過・自動更新は45日で発火）
                </p>
              </div>
            ) : (
              <div className="text-sm space-y-3">
                <p className="text-neutral-500">未連携です</p>
                <a
                  href="/api/staff/instagram/connect"
                  className="inline-block rounded-lg bg-brand-600 text-white font-semibold px-4 py-2"
                >
                  連携する
                </a>
              </div>
            )}
          </div>
        )}

        {data && (
          <div className="rounded-xl bg-white border border-sand-200 shadow-sm p-4">
            <h2 className="font-bold text-navy-800 mb-2">埋め草キュー</h2>
            <p className="text-xs text-neutral-400 mb-3">
              レッスン告知素材が無い日に、ここで承認済みの素材から1本自動投稿されます（承認するまで投稿されません）
            </p>
            {(() => {
              const pending = data.queue?.filter((q) => q.status === 'pending') ?? [];
              const approved = data.queue?.filter((q) => q.status === 'approved') ?? [];
              return (
                <div className="space-y-3">
                  {approved.length === 0 && (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      ⚠️ 承認済みの埋め草がありません。レッスンが無い日は投稿されません
                    </p>
                  )}
                  {pending.length === 0 && approved.length === 0 && (
                    <p className="text-sm text-neutral-400">キューは空です</p>
                  )}
                  {[...pending, ...approved].map((q) => (
                    <div key={q.id} className="flex items-center gap-3 border-t border-sand-100 pt-3 first:border-t-0 first:pt-0">
                      <a href={q.media_path} target="_blank" rel="noreferrer" className="shrink-0">
                        {q.media_type === 'image' ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={q.media_path} alt="" className="w-12 h-20 object-cover rounded-md bg-neutral-100" />
                        ) : (
                          <video src={q.media_path} muted className="w-12 h-20 object-cover rounded-md bg-neutral-100" />
                        )}
                      </a>
                      <div className="flex-1 min-w-0 text-sm">
                        <p className="font-semibold text-navy-800 truncate">{q.title ?? q.media_path}</p>
                        <p className="text-xs text-neutral-400">
                          {KIND_JA[q.kind] ?? q.kind}
                          {q.valid_until ? ` ・〜${q.valid_until}` : ' ・エバーグリーン'}
                          {q.times_posted > 0 && ` ・${q.times_posted}回投稿済`}
                        </p>
                      </div>
                      {q.status === 'pending' ? (
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => act(q.id, 'approve')}
                            disabled={busyId === q.id}
                            className="rounded-lg bg-brand-600 text-white text-xs font-semibold px-3 py-1.5 disabled:opacity-50"
                          >
                            承認
                          </button>
                          <button
                            onClick={() => act(q.id, 'reject')}
                            disabled={busyId === q.id}
                            className="rounded-lg bg-neutral-100 text-neutral-600 text-xs font-semibold px-3 py-1.5 disabled:opacity-50"
                          >
                            却下
                          </button>
                        </div>
                      ) : (
                        <span className="shrink-0 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-semibold">
                          承認済み
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {data && (
          <div className="rounded-xl bg-white border border-sand-200 shadow-sm p-4">
            <h2 className="font-bold text-navy-800 mb-2">直近の投稿ログ</h2>
            {data.logs.length === 0 ? (
              <p className="text-sm text-neutral-400">まだ投稿履歴がありません</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {data.logs.map((l, i) => {
                    const s = STATUS_LABEL[l.status] ?? { label: l.status, cls: 'bg-gray-100 text-gray-500' };
                    return (
                      <tr key={i} className="border-t border-sand-100">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {l.date}({WEEKDAY_JA[l.weekday]})
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>
                        </td>
                        <td className="py-2 text-neutral-400 text-xs">{l.error ?? ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

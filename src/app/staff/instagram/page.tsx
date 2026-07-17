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

type PlanItem = {
  base: string;
  mediaPath: string;
  mediaType: 'video' | 'image';
  mentions: string[];
  queueTitle?: string | null;
  scheduleCheck?:
    | { result: 'no-declaration' | 'match' | 'check-error'; actual?: string[]; error?: string }
    | { result: 'mismatch'; actual: string[]; declared: string[]; problems: string[] }
    | null;
};

type Plan = {
  date: string;
  weekday: number;
  source: 'date-file' | 'weekday-file' | 'queue' | 'none';
  items: PlanItem[];
};

function PlanDayRow({ plan, isToday, logs }: { plan: Plan; isToday: boolean; logs: LogRow[] }) {
  const postedFor = (mediaPath: string) =>
    logs.some((l) => l.date === plan.date && l.status.startsWith('posted') && l.video_path?.endsWith(mediaPath));
  return (
    <div className="border-t border-sand-100 pt-3 first:border-t-0 first:pt-0">
      <p className="text-sm font-semibold text-navy-800 mb-1.5">
        {plan.date.slice(5).replace('-', '/')}（{WEEKDAY_JA[plan.weekday]}）
        {isToday && (
          <span className="ml-1.5 rounded-full bg-brand-100 text-brand-700 px-2 py-0.5 text-[11px] font-semibold">本日</span>
        )}
        {plan.items.length > 1 && (
          <span className="ml-2 text-xs font-normal text-neutral-400">{plan.items.length}本連続投稿</span>
        )}
      </p>
      {plan.source === 'none' ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
          ⚠️ 素材なし — このままだと投稿されません
        </p>
      ) : (
        <div className="space-y-2">
          {plan.items.map((item) => (
            <div key={item.base} className="flex items-center gap-3">
              <a href={item.mediaPath} target="_blank" rel="noreferrer" className="shrink-0">
                {item.mediaType === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.mediaPath} alt="" className="w-11 h-[70px] object-cover rounded-md bg-neutral-100 border border-sand-200" />
                ) : (
                  <video src={item.mediaPath} muted className="w-11 h-[70px] object-cover rounded-md bg-neutral-100 border border-sand-200" />
                )}
              </a>
              <div className="text-xs space-y-0.5 min-w-0">
                <p className="text-navy-800 font-medium">
                  {PLAN_SOURCE_JA[plan.source]}
                  {item.queueTitle ? `「${item.queueTitle}」` : ''}・{item.mediaType === 'image' ? '画像' : '動画'}
                </p>
                <p className="text-neutral-500 truncate">
                  {item.mentions.length > 0 ? item.mentions.map((m) => `@${m}`).join(' ') : 'メンションなし'}
                </p>
                {postedFor(item.mediaPath) && <p className="text-green-700 font-semibold">✅ 投稿済み</p>}
                {item.scheduleCheck?.result === 'match' && <p className="text-green-700">✓ カレンダーと一致</p>}
                {item.scheduleCheck?.result === 'no-declaration' && (
                  <p className="text-neutral-400">カレンダー照合なし</p>
                )}
                {item.scheduleCheck?.result === 'check-error' && (
                  <p className="text-amber-700">⚠️ カレンダーが読めず照合不可（投稿は行われます）</p>
                )}
                {item.scheduleCheck?.result === 'mismatch' && (
                  <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-1">
                    <p className="font-semibold">⚠️ カレンダーと不一致 — 投稿されません</p>
                    {item.scheduleCheck.problems.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                    <p>
                      正しい素材を <code className="bg-amber-100 px-1 rounded">{plan.date}.jpg</code> で置くと差し替え
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type StatusResp = {
  envConfigured: boolean;
  connected: boolean;
  igUserId?: string;
  tokenIssuedAt?: string;
  tokenAgeDays?: number;
  logs: LogRow[];
  queue: QueueRow[];
  plans?: Plan[];
};

type ReelRow = {
  id: number;
  title: string;
  video_path: string;
  cover_path: string | null;
  caption: string;
  scheduled_at: string;
  status: 'scheduled' | 'posting' | 'posted' | 'failed' | 'canceled';
  ig_media_id: string | null;
  permalink: string | null;
  error: string | null;
  posted_at: string | null;
};

const REEL_STATUS: Record<ReelRow['status'], { label: string; cls: string }> = {
  scheduled: { label: '予約中', cls: 'bg-brand-100 text-brand-700' },
  posting: { label: '投稿処理中', cls: 'bg-amber-100 text-amber-700' },
  posted: { label: '公開済み', cls: 'bg-green-100 text-green-700' },
  failed: { label: '失敗', cls: 'bg-red-100 text-red-700' },
  canceled: { label: 'キャンセル', cls: 'bg-gray-100 text-gray-500' },
};

function jstLabel(utcIso: string): string {
  const d = new Date(utcIso.endsWith('Z') || utcIso.includes('+') ? utcIso : `${utcIso}Z`);
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PLAN_SOURCE_JA: Record<Plan['source'], string> = {
  'date-file': '日付指定の素材',
  'weekday-file': '曜日の素材',
  queue: '埋め草キュー',
  none: '',
};

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  posted: { label: '投稿済み', cls: 'bg-green-100 text-green-700' },
  posted_queue: { label: '埋め草を投稿', cls: 'bg-green-100 text-green-700' },
  skipped_no_video: { label: '素材なしでスキップ', cls: 'bg-gray-100 text-gray-500' },
  skipped_schedule_mismatch: { label: 'スケジュール不一致でスキップ', cls: 'bg-amber-100 text-amber-700' },
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
  const [reels, setReels] = useState<ReelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, reelRes] = await Promise.all([
        fetch('/api/staff/instagram/status', { credentials: 'include' }),
        fetch('/api/staff/instagram/reels', { credentials: 'include' }),
      ]);
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/instagram';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      if (reelRes.ok) {
        const rj = await reelRes.json();
        setReels(rj.reels ?? []);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [busyReelId, setBusyReelId] = useState<number | null>(null);
  const cancelReel = useCallback(
    async (id: number) => {
      if (!window.confirm('このリールの予約をキャンセルしますか？')) return;
      setBusyReelId(id);
      try {
        const res = await fetch('/api/staff/instagram/reels', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id, action: 'cancel' }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyReelId(null);
      }
    },
    [load]
  );

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
        title="インスタ自動投稿"
        description="ストーリーズ=毎朝8:00に今日の素材を自動投稿。リール=予約日時（基本 毎日19:00枠）にサーバー側cronが自動公開"
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
            <h2 className="font-bold text-navy-800 mb-1">リール投稿予定</h2>
            <p className="text-xs text-neutral-400 mb-3">
              予約日時になるとサーバー側で自動公開されます（毎日19:00 JSTに実行・Macの起動状態に無関係）
            </p>
            {reels.length === 0 ? (
              <p className="text-sm text-neutral-400">リールの予定・履歴はまだありません</p>
            ) : (
              <div className="space-y-3">
                {reels.map((r) => {
                  const s = REEL_STATUS[r.status] ?? { label: r.status, cls: 'bg-gray-100 text-gray-500' };
                  return (
                    <div key={r.id} className="flex items-center gap-3 border-t border-sand-100 pt-3 first:border-t-0 first:pt-0">
                      <a href={r.permalink ?? r.video_path} target="_blank" rel="noreferrer" className="shrink-0">
                        {r.cover_path ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.cover_path} alt="" className="w-12 h-20 object-cover rounded-md bg-neutral-100 border border-sand-200" />
                        ) : (
                          <video src={r.video_path} muted className="w-12 h-20 object-cover rounded-md bg-neutral-100 border border-sand-200" />
                        )}
                      </a>
                      <div className="flex-1 min-w-0 text-sm">
                        <p className="font-semibold text-navy-800 truncate">{r.title}</p>
                        <p className="text-xs text-neutral-500">
                          {r.status === 'posted' && r.posted_at ? `${jstLabel(r.posted_at)} 公開` : `${jstLabel(r.scheduled_at)} 予定`}
                        </p>
                        {r.error && <p className="text-xs text-red-600 truncate">{r.error}</p>}
                        {r.permalink && (
                          <a href={r.permalink} target="_blank" rel="noreferrer" className="text-xs text-brand-700 underline">
                            投稿を見る
                          </a>
                        )}
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>
                      {r.status === 'scheduled' && (
                        <button
                          onClick={() => cancelReel(r.id)}
                          disabled={busyReelId === r.id}
                          className="shrink-0 rounded-lg bg-neutral-100 text-neutral-600 text-xs font-semibold px-3 py-1.5 disabled:opacity-50"
                        >
                          キャンセル
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {data?.plans && (
          <div className="rounded-xl bg-white border border-sand-200 shadow-sm p-4">
            <h2 className="font-bold text-navy-800 mb-1">向こう1週間のストーリー予定</h2>
            <p className="text-xs text-neutral-400 mb-3">毎朝8:00に自動投稿。素材の配置状況とGoogleカレンダー照合の結果です</p>
            <div className="space-y-3">
              {data.plans.map((p, i) => (
                <PlanDayRow key={p.date} plan={p} isToday={i === 0} logs={data.logs} />
              ))}
            </div>
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

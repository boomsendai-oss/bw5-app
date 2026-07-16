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

type StatusResp = {
  envConfigured: boolean;
  connected: boolean;
  igUserId?: string;
  tokenIssuedAt?: string;
  tokenAgeDays?: number;
  logs: LogRow[];
};

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  posted: { label: '投稿済み', cls: 'bg-green-100 text-green-700' },
  skipped_no_video: { label: '動画未生成でスキップ', cls: 'bg-gray-100 text-gray-500' },
  skipped_not_configured: { label: '未連携でスキップ', cls: 'bg-gray-100 text-gray-500' },
  error: { label: 'エラー', cls: 'bg-red-100 text-red-700' },
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

  return (
    <div>
      <StaffPageHeader
        title="インスタストーリーズ自動投稿"
        description="曜日別レッスン告知動画を毎朝8:00にストーリーズへ自動投稿します（動画のある曜日のみ）"
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

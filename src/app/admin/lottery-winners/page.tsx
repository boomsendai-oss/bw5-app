'use client';

import { useEffect, useState } from 'react';
import { Trophy, RefreshCw } from 'lucide-react';

interface Winner {
  id: number;
  fingerprint: string;
  ip: string;
  prize_name: string;
  winner_name?: string;
  created_at: string;
}

interface WinnersResponse {
  winners_count: number;
  total_entries: number;
  winners: Winner[];
}

export default function LotteryWinnersPage() {
  const [data, setData] = useState<WinnersResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/lottery/winners');
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 8000); // auto refresh every 8s
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen p-4 sm:p-6" style={{ background: 'linear-gradient(135deg, #f27a1a 0%, #e85d04 100%)' }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Trophy size={28} className="text-white" />
          <h1 className="text-2xl font-black text-white">くじ引き当選者</h1>
          <button
            onClick={load}
            className="ml-auto p-2 rounded-full"
            style={{ background: 'rgba(255,255,255,0.2)' }}
            disabled={loading}
          >
            <RefreshCw size={16} className={`text-white ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="rounded-2xl p-4 mb-4" style={{ background: 'rgba(255,255,255,0.95)' }}>
          <div className="flex items-center justify-around">
            <div className="text-center">
              <div className="text-3xl font-black text-orange-600">{data?.winners_count ?? '-'}</div>
              <div className="text-xs text-gray-600">当選</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-black text-gray-700">{data?.total_entries ?? '-'}</div>
              <div className="text-xs text-gray-600">参加総数</div>
            </div>
          </div>
          <p className="text-[11px] text-center text-gray-500 mt-3">
            8秒ごとに自動更新
          </p>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.95)' }}>
          {data && data.winners.length > 0 ? (
            <table className="w-full text-sm">
              <thead style={{ background: '#f5f5f5' }}>
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">#</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">お名前</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">景品</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">時刻</th>
                </tr>
              </thead>
              <tbody>
                {data.winners.map((w, i) => (
                  <tr key={w.id} style={{ borderTop: '1px solid #eee' }}>
                    <td className="px-3 py-2 font-bold text-orange-600">#{i + 1}</td>
                    <td className="px-3 py-2 font-bold text-gray-900">
                      {w.winner_name ? (
                        w.winner_name
                      ) : (
                        <span className="text-[10px] text-gray-400 font-normal">未入力（ID: {w.fingerprint.slice(0, 8)}…）</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-800">{w.prize_name}</td>
                    <td className="px-3 py-2 text-gray-500 text-[11px]">{w.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Trophy size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">まだ当選者はいません</p>
            </div>
          )}
        </div>

        <div className="mt-6 rounded-xl p-3" style={{ background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(8px)' }}>
          <p className="text-[11px] text-white/90 leading-relaxed">
            🏪 当選者がブースに来たら、画面上で当選表示を確認してから景品をお渡しください。<br />
            このページをブックマーク → iPadのホーム画面に追加すると便利です。
          </p>
        </div>
      </div>
    </div>
  );
}

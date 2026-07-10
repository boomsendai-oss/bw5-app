'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserX, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

type Candidate = {
  trial_id: number;
  lstep_id: string | null;
  member_id: number | null;
  reserved_at: string;
  lesson_name: string | null;
  status: string;
  full_name: string | null;
  full_name_kana: string | null;
  lstep_display_name: string | null;
};

type Resp = {
  hours_threshold: number;
  count: number;
  candidates: Candidate[];
};

const HOUR_OPTIONS = [6, 12, 24, 48];

export default function NoshowCandidatesPage() {
  const [hours, setHours] = useState(12);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async (h: number) => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch(`/api/staff/operations/noshow-candidates?hours=${h}`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(hours);
  }, [hours, load]);

  const displayName = (c: Candidate) =>
    c.full_name || c.lstep_display_name || '(氏名未取得)';

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <UserX className="size-5 text-brand-500" />
        <h1 className="text-lg font-bold">体験ノーショー候補</h1>
      </div>

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900 flex gap-2">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        <div>
          体験予約が<strong>予約時刻から{hours}時間以上経過しても「予約済」のまま</strong>の人＝ノーショー疑い。
          LSTEPに自動キャンセル機能が無いため、ここで確認して<strong>LSTEPのフェーズタグを手動で「体験キャンセル」へ</strong>切り替えてください。
          （アプリはLSTEPに書き込みません）
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] text-muted-foreground">経過時間の閾値:</span>
        {HOUR_OPTIONS.map((h) => (
          <Button key={h} size="xs" variant={hours === h ? 'default' : 'outline'} onClick={() => setHours(h)}>
            {h}時間
          </Button>
        ))}
      </div>

      {loading && <p className="text-sm text-muted-foreground">読込中...</p>}
      {err && <p className="text-sm text-red-600">読込エラー: {err}</p>}

      {data && (
        <>
          <div className="rounded-lg border bg-amber-50 p-3 text-center w-32">
            <div className="text-2xl font-bold text-amber-600">{data.count}</div>
            <div className="text-[11px] text-muted-foreground">ノーショー候補</div>
          </div>

          <section className="space-y-2">
            {data.candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">該当なし（直近の予約放置はありません）</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {data.candidates.map((c) => (
                  <Card key={c.trial_id} className="overflow-hidden">
                    <CardContent className="p-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">{displayName(c)}</div>
                          {c.full_name_kana && (
                            <div className="text-[11px] text-muted-foreground truncate">{c.full_name_kana}</div>
                          )}
                        </div>
                        <Badge className="shrink-0 text-[10px] bg-amber-100 text-amber-700">{c.status}</Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground space-y-0.5">
                        <div className="flex items-center gap-1">
                          <Clock className="inline size-3" />
                          予約: <span className="font-mono">{String(c.reserved_at).replace('T', ' ').slice(0, 16)}</span>
                        </div>
                        {c.lesson_name && <div>クラス: {c.lesson_name}</div>}
                        {!c.member_id && <div className="text-amber-600">※会員未紐付け</div>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

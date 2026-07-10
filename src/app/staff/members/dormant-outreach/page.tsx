'use client';

import { useCallback, useEffect, useState } from 'react';
import { HeartHandshake, Mail, MessageCircle, Download, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

type Member = {
  member_id: number;
  full_name: string;
  full_name_kana: string | null;
  has_email: boolean;
  has_line: boolean;
  lstep_id: string | null;
  last_checkin: string | null;
  checkin_count: number;
  days_since_checkin: number | null;
};

type Resp = {
  ok: boolean;
  threshold_days: number;
  total: number;
  coverage: { email: number; line: number };
  members: Member[];
};

const DAY_OPTIONS = [60, 90, 120, 180];

export default function DormantOutreachPage() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch(`/api/staff/members/dormant-outreach?days=${d}`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  const downloadCsv = () => {
    if (!data) return;
    const header = ['会員ID', '氏名', 'カナ', 'LINE(lstep_id)', 'メール有', '最終受講', '受講回数', '経過日数'];
    const rows = data.members.map((m) => [
      m.member_id,
      m.full_name,
      m.full_name_kana ?? '',
      m.lstep_id ?? '',
      m.has_email ? '有' : '',
      m.last_checkin ?? '受講なし',
      m.checkin_count,
      m.days_since_checkin ?? '',
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `おかえり配信リスト_${days}日休眠_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <HeartHandshake className="size-5 text-brand-500" />
        <h1 className="text-lg font-bold">休眠チケット会員 おかえりリスト</h1>
      </div>

      <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-[12px] text-brand-900 flex gap-2">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        <div>
          チケット会員で<strong>最終受講から{days}日以上</strong>（または1度も受講なし）の人の一覧です。
          「おかえり配信」の対象抽出用。<strong>配信はここからは行いません</strong>——
          LINEはLSTEPでセグメント配信（lstep_id をCSVで書き出して使用）、メールは別途。文面はTAROが用意。
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] text-muted-foreground">休眠の閾値:</span>
        {DAY_OPTIONS.map((d) => (
          <Button key={d} size="xs" variant={days === d ? 'default' : 'outline'} onClick={() => setDays(d)}>
            {d}日
          </Button>
        ))}
        <div className="ml-auto">
          <Button size="xs" variant="outline" onClick={downloadCsv} disabled={!data || data.total === 0}>
            <Download className="size-3" /> CSV書き出し
          </Button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">読込中...</p>}
      {err && <p className="text-sm text-red-600">読込エラー: {err}</p>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border bg-brand-50 p-3">
              <div className="text-2xl font-bold text-brand-600">{data.total}</div>
              <div className="text-[11px] text-muted-foreground">休眠 ({days}日+)</div>
            </div>
            <div className="rounded-lg border bg-green-50 p-3">
              <div className="text-2xl font-bold text-green-600">{data.coverage.line}</div>
              <div className="text-[11px] text-muted-foreground">LINE到達可</div>
            </div>
            <div className="rounded-lg border bg-blue-50 p-3">
              <div className="text-2xl font-bold text-blue-600">{data.coverage.email}</div>
              <div className="text-[11px] text-muted-foreground">メール到達可</div>
            </div>
          </div>

          <section className="space-y-2">
            {data.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">該当なし</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {data.members.map((m) => (
                  <Card key={m.member_id} className="overflow-hidden">
                    <CardContent className="p-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">{m.full_name}</div>
                          {m.full_name_kana && (
                            <div className="text-[11px] text-muted-foreground truncate">{m.full_name_kana}</div>
                          )}
                        </div>
                        <Badge className="shrink-0 text-[10px] bg-brand-100 text-brand-700">
                          {m.days_since_checkin !== null ? `${m.days_since_checkin}日` : '受講なし'}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        最終受講: <span className="font-mono">{m.last_checkin ?? '(なし)'}</span>（{m.checkin_count}回）
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className={m.has_line ? 'text-green-600' : 'text-neutral-400'}>
                          <MessageCircle className="inline size-3" /> LINE
                        </span>
                        <span className={m.has_email ? 'text-green-600' : 'text-neutral-400'}>
                          <Mail className="inline size-3" /> メール
                        </span>
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

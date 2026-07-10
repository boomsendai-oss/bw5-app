'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserMinus, AlertTriangle, Mail, MessageCircle, Clock, Check, RotateCcw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

type Candidate = {
  member_id: number;
  full_name: string;
  full_name_kana: string | null;
  enrolled_at: string | null;
  enrolled_reliable: boolean;
  last_checkin: string | null;
  checkin_count: number;
  reason: 'inactive_6mo' | 'never_attended_3mo' | 'long_dormant_nodata';
  reason_label: string;
  has_email: boolean;
  has_line: boolean;
  family_active_link: string | null;
  notice_status: string | null;
  notified_at: string | null;
  extended_until: string | null;
};

type Assessment = {
  ok: boolean;
  params: {
    today: string;
    normal_months: number;
    exception_months: number;
    reliable_enroll_cutoff: string;
    data_floor: string | null;
    notice_window_days: number;
  };
  candidates: Candidate[];
  pre_notice: Candidate[];
  family_review: Candidate[];
  candidate_count: number;
  pre_notice_count: number;
  family_review_count: number;
};

const REASON_STYLE: Record<string, string> = {
  inactive_6mo: 'bg-red-100 text-red-700',
  never_attended_3mo: 'bg-amber-100 text-amber-700',
  long_dormant_nodata: 'bg-slate-200 text-slate-700',
};

export default function WithdrawalCandidatesPage() {
  const [data, setData] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/staff/members/withdrawal-candidates', { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = async () => {
    if (!data || data.candidates.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const withdrawal_date =
      prompt('退会手続き日(終了日)を YYYY-MM-DD で。OKで今日にします。', today) || today;
    const res = await fetch('/api/staff/members/withdrawal-export', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        member_ids: data.candidates.map((c) => c.member_id),
        withdrawal_date,
      }),
    });
    if (!res.ok) {
      alert(`CSV書き出し失敗: HTTP ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `契約プラン_退会_${withdrawal_date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const act = async (c: Candidate, action: string, extra?: Record<string, unknown>) => {
    setBusyId(c.member_id);
    try {
      await fetch('/api/staff/members/withdrawal-candidates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: c.member_id,
          action,
          reason: c.reason,
          last_checkin: c.last_checkin,
          checkin_count: c.checkin_count,
          ...extra,
        }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const renderCard = (c: Candidate, isPreNotice = false) => (
    <Card key={c.member_id} className="overflow-hidden">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{c.full_name}</div>
            {c.full_name_kana && <div className="text-[11px] text-muted-foreground truncate">{c.full_name_kana}</div>}
          </div>
          <Badge className={`shrink-0 text-[10px] ${REASON_STYLE[c.reason] || ''}`}>{c.reason_label}</Badge>
        </div>

        <div className="text-[11px] text-muted-foreground space-y-0.5">
          <div>最終受講: <span className="font-mono">{c.last_checkin ?? '(受講なし)'}</span>（{c.checkin_count}回）</div>
          <div className="flex items-center gap-2">
            入会: <span className="font-mono">{c.enrolled_at?.slice(0, 10) ?? '不明'}</span>
            {!c.enrolled_reliable && (
              <span className="text-amber-600 text-[10px]">※移行日(実入会日不明)</span>
            )}
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <span className={c.has_line ? 'text-green-600' : 'text-neutral-400'}><MessageCircle className="inline size-3" /> LINE</span>
            <span className={c.has_email ? 'text-green-600' : 'text-neutral-400'}><Mail className="inline size-3" /> メール</span>
            {c.notice_status && c.notice_status !== 'candidate' && (
              <Badge variant="secondary" className="text-[10px]">{c.notice_status}</Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 pt-1">
          {isPreNotice ? (
            <Button size="xs" variant="secondary" disabled={busyId === c.member_id}
              className="text-amber-700 bg-amber-100 hover:bg-amber-200"
              onClick={() => act(c, 'notified', { channel: 'both' })}>
              <Clock className="size-3" /> 事前通知を送った
            </Button>
          ) : (
            <>
              <Button size="xs" variant="secondary" disabled={busyId === c.member_id}
                className="text-amber-700 bg-amber-100 hover:bg-amber-200"
                onClick={() => act(c, 'notified', { channel: 'both' })}>
                <Clock className="size-3" /> 通知済み
              </Button>
              <Button size="xs" variant="secondary" disabled={busyId === c.member_id}
                className="text-blue-700 bg-blue-100 hover:bg-blue-200"
                onClick={() => {
                  const until = prompt('延長(再判定日) を YYYY-MM-DD で入力', '');
                  if (until) act(c, 'extended', { extended_until: until });
                }}>
                <RotateCcw className="size-3" /> 延長
              </Button>
              <Button size="xs" variant="secondary" disabled={busyId === c.member_id}
                className="text-red-700 bg-red-100 hover:bg-red-200"
                onClick={() => {
                  if (confirm(`${c.full_name} をHACOMONOで退会処理済みとして記録しますか？\n(アプリはHACOMONOに書き込みません。退会処理はHACOMONOで実施してください)`)) {
                    act(c, 'withdrawn', { channel: 'both' });
                  }
                }}>
                <Check className="size-3" /> 退会処理済み
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <UserMinus className="size-5 text-brand-500" />
        <h1 className="text-lg font-bold">チケット会員 退会候補</h1>
      </div>

      {/* 重要バナー: 不可逆操作の人手処理を明示 */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900 flex gap-2">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        <div>
          このリストは<strong>判定のみ</strong>です。実際の退会処理は<strong>HACOMONOで手動</strong>で行ってください（アプリはHACOMONOに書き込みません）。
          各ボタンはアプリ内の進行記録だけを更新します。<br />
          <span className="text-amber-700">※既存の塩漬け会員は、いきなり退会させない。「おかえり配信」→<strong>2ヶ月の猶予</strong>→反応がなければ対象化（2026-06-14 確定）。</span>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">読込中...</p>}
      {err && <p className="text-sm text-red-600">読込エラー: {err}</p>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border bg-red-50 p-3">
              <div className="text-2xl font-bold text-red-600">{data.candidate_count}</div>
              <div className="text-[11px] text-muted-foreground">退会条件を満たす</div>
            </div>
            <div className="rounded-lg border bg-amber-50 p-3">
              <div className="text-2xl font-bold text-amber-600">{data.pre_notice_count}</div>
              <div className="text-[11px] text-muted-foreground">あと{data.params.notice_window_days}日で到達<br />(事前通知)</div>
            </div>
            <div className="rounded-lg border bg-purple-50 p-3">
              <div className="text-2xl font-bold text-purple-600">{data.family_review_count}</div>
              <div className="text-[11px] text-muted-foreground">家族要確認<br />(自動退会から除外)</div>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            基準日 {data.params.today}／通常 {data.params.normal_months}ヶ月・例外 {data.params.exception_months}ヶ月／
            受講データ最古 {data.params.data_floor ?? '不明'}（これ以前の受講は不明なため、移行組の0回受講は「全期間未受講」として判定）
          </p>

          {data.pre_notice.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-amber-700">事前通知の対象（あと{data.params.notice_window_days}日）</h2>
              <div className="grid sm:grid-cols-2 gap-2">{data.pre_notice.map((c) => renderCard(c, true))}</div>
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">退会候補（{data.candidate_count}名）</h2>
              <Button size="xs" variant="outline" onClick={exportCsv} disabled={data.candidate_count === 0}>
                <Download className="size-3" /> 契約プランCSV書き出し
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              HACOMONO「契約プラン」importに投入する退会CSV（退会手続き日時入り）。契約番号はDBに無いため空欄＝
              <strong>まずインポート検証でメアド/会員番号キーが通るか確認</strong>してから本インポート（人手・不可逆）。
            </p>
            {data.candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">該当なし</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">{data.candidates.map((c) => renderCard(c))}</div>
            )}
          </section>

          {data.family_review.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-purple-700">家族要確認（自動退会から除外）</h2>
              <p className="text-[11px] text-muted-foreground">
                本人は未受講だが、<strong>現役で通っている家族</strong>とアカウントが繋がっている人。代表者を退会させると家族の運用に影響する恐れがあるため、自動退会の対象から外しています。退会させるかは手動で判断してください。
              </p>
              <div className="grid sm:grid-cols-2 gap-2">
                {data.family_review.map((c) => (
                  <div key={c.member_id} className="rounded-lg border border-purple-200 bg-purple-50 p-3 space-y-1">
                    <div className="font-semibold text-sm">{c.full_name}</div>
                    {c.full_name_kana && <div className="text-[11px] text-muted-foreground">{c.full_name_kana}</div>}
                    <div className="text-[11px] text-purple-700">現役の家族リンク: <strong>{c.family_active_link}</strong></div>
                    <div className="text-[11px] text-muted-foreground">最終受講: {c.last_checkin ?? '(受講なし)'}（{c.checkin_count}回）／{c.reason_label}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

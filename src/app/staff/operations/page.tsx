'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { RefreshCw, Link2, Download, Check, X, Users, HelpCircle, Calendar, Video } from 'lucide-react';

type SyncSummary = {
  new_members: number;
  withdrew_members: number;
  plan_changes: number;
  lstep_new_total: number;
  lstep_new_unmatched: number;
  hacomono_active_total: number;
  hacomono_withdrew_total: number;
  lstep_total: number;
};

type PlanChange = {
  hacomono_member_id: string;
  full_name: string;
  from: { code: string | null; name: string | null };
  to: { code: string | null; name: string | null };
};

type SyncDetails = {
  new_members: { hacomono_member_id: string; full_name: string; plan_name: string | null; enrolled_at: string | null }[];
  withdrew_members: { hacomono_member_id: string; full_name: string; withdrew_at: string | null }[];
  plan_changes: PlanChange[];
  lstep_new_unmatched: { lstep_id: string; display_name: string; system_display_name: string; real_name: string }[];
};

type LineType = '本人LINE' | '保護者LINE' | '要確認';

type LinkCandidate = {
  lstep_id: string;
  system_display_name: string;
  line_register_name: string;
  score: number;
  confidence: '高' | '中';
  reasons: string[];
  relation_suggestion: '本人' | '保護者' | '講師';
  line_type?: LineType;
  source?: '体験予約' | 'Lstep表示名';
};

type LinkSuggestion = {
  member_id: number;
  hacomono_member_id: string;
  full_name: string;
  full_name_kana: string;
  candidates: LinkCandidate[];
};

type SyncResponse = {
  ok: boolean;
  summary: SyncSummary;
  details: SyncDetails;
  link_suggestions?: LinkSuggestion[];
};

export default function OperationsPage() {
  const [active, setActive] = useState<File | null>(null);
  const [withdrew, setWithdrew] = useState<File | null>(null);
  const [lstep, setLstep] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncResponse | null>(null);
  const [error, setError] = useState<string>('');
  const [linkState, setLinkState] = useState<Record<number, { done?: { lstep: string; relation: string }; rejected: Set<string> }>>({});
  const [backfill, setBackfill] = useState<LinkSuggestion[] | null>(null);
  const [backfillSummary, setBackfillSummary] = useState<{ unlinked_members: number; with_candidates: number; without_candidates: number } | null>(null);
  const [backfillLoading, setBackfillLoading] = useState(false);

  const runBackfill = async () => {
    setBackfillLoading(true);
    setBackfill(null);
    setBackfillSummary(null);
    try {
      const res = await fetch('/api/staff/operations/link-suggest', { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/operations';
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        toast.error(`候補計算に失敗: ${data.error ?? res.status}`);
        return;
      }
      setBackfill(data.link_suggestions ?? []);
      setBackfillSummary(data.summary ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '通信エラー');
    } finally {
      setBackfillLoading(false);
    }
  };

  const approveLink = async (memberId: number, cand: LinkCandidate) => {
    try {
      const res = await fetch('/api/staff/operations/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          member_id: memberId,
          lstep_id: cand.lstep_id,
          relation: cand.relation_suggestion,
          confidence: cand.confidence === '高' ? '確実' : '推定',
        }),
      });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/operations';
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        toast.error(`紐付け失敗: ${data.error ?? res.status}`);
        return;
      }
      setLinkState((prev) => ({
        ...prev,
        [memberId]: {
          ...(prev[memberId] ?? { rejected: new Set<string>() }),
          done: { lstep: cand.lstep_id, relation: cand.relation_suggestion },
        },
      }));
      toast.success('紐付け完了');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '通信エラー');
    }
  };

  const rejectCandidate = (memberId: number, lstepId: string) => {
    setLinkState((prev) => {
      const cur = prev[memberId] ?? { rejected: new Set<string>() };
      const next = new Set(cur.rejected);
      next.add(lstepId);
      return { ...prev, [memberId]: { ...cur, rejected: next } };
    });
  };

  const runSync = async () => {
    setError('');
    setResult(null);
    if (!active || !withdrew || !lstep) {
      setError('3つのCSVを全て選択してください');
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('hacomono_active', active);
      fd.append('hacomono_withdrew', withdrew);
      fd.append('lstep', lstep);
      const res = await fetch('/api/staff/operations/sync', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/operations';
        return;
      }
      const rawText = await res.text();
      let data: { error?: string; [k: string]: unknown };
      try {
        data = JSON.parse(rawText);
      } catch {
        setError(`サーバ応答エラー (status=${res.status}): ${rawText.slice(0, 500)}`);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `同期に失敗しました (status=${res.status})`);
        return;
      }
      setResult(data as unknown as SyncResponse);
      toast.success('突合が完了しました');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '通信エラー');
    } finally {
      setLoading(false);
    }
  };

  const downloadUrl = (type: string) => `/api/staff/operations/download?type=${type}`;

  const renderSuggestionList = (suggestions: LinkSuggestion[]) => (
    <ul className="space-y-3">
      {suggestions.map((s) => {
        const state = linkState[s.member_id];
        const done = state?.done;
        const rejected = state?.rejected ?? new Set<string>();
        const visible = s.candidates.filter((c) => !rejected.has(c.lstep_id));
        const topConf = visible[0]?.confidence;
        return (
          <li key={s.member_id}>
            <Card>
              <CardContent className="pt-3 space-y-2">
                <div className="text-sm font-bold">
                  {s.full_name} <span className="text-[11px] font-normal text-muted-foreground">({s.full_name_kana})</span>
                </div>
                {done ? (
                  <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1.5 flex items-center gap-1">
                    <Check className="size-3.5" /> 紐付け完了 ({done.relation}) / Lstep: {done.lstep}
                  </div>
                ) : visible.length === 0 ? (
                  <div className="text-xs text-muted-foreground bg-muted rounded px-2 py-1.5">
                    候補なし / 手動紐付け必要
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {visible.map((c) => {
                      const isHi = c.confidence === '高';
                      return (
                        <li key={c.lstep_id} className="border rounded p-2 space-y-1 bg-muted/50">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="font-medium">{c.system_display_name || c.line_register_name || '(名前なし)'}</span>
                            {c.line_type && <LineTypeBadge type={c.line_type} />}
                            {c.source === '体験予約' && (
                              <Badge variant="secondary" className="bg-brand-100 text-brand-700 text-[10px]">体験予約一致</Badge>
                            )}
                            <Badge variant={isHi ? 'outline' : 'secondary'} className={isHi ? 'bg-green-100 text-green-700 text-[10px]' : 'bg-yellow-100 text-yellow-800 text-[10px]'}>
                              {isHi ? '高信頼' : '中信頼'} / スコア:{c.score}
                            </Badge>
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            根拠: {c.reasons.join(' / ')} / 推測役割: <span className="font-medium">{c.relation_suggestion}</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground">Lstep ID: {c.lstep_id}</div>
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            <Button
                              size="xs"
                              onClick={() => approveLink(s.member_id, c)}
                              className={isHi ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-yellow-500 hover:bg-yellow-600 text-white'}
                            >
                              <Check className="size-3 mr-0.5" />承認 ({c.relation_suggestion})
                            </Button>
                            <Button
                              size="xs"
                              variant="secondary"
                              onClick={() => rejectCandidate(s.member_id, c.lstep_id)}
                            >
                              <X className="size-3 mr-0.5" />別人
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!done && visible.length > 0 && topConf && (
                  <div className="text-[10px] text-muted-foreground">
                    {topConf === '高' ? '推奨: トップ候補で承認してOKそう' : '要注意: 中信頼/要確認のみ -- TARO目視確認推奨'}
                  </div>
                )}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div>
      <div className="max-w-2xl mx-auto p-3 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <RefreshCw className="size-5 text-brand-600" />
            <h1 className="text-lg font-bold text-brand-600">運営オペレーション</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="link" size="xs" asChild><Link href="/staff/schedule"><Calendar className="size-3 mr-0.5" />スケジュール</Link></Button>
            <Button variant="link" size="xs" asChild><Link href="/staff/members"><Users className="size-3 mr-0.5" />会員管理</Link></Button>
            <Button variant="link" size="xs" asChild><Link href="/staff/video-preorders"><Video className="size-3 mr-0.5" />映像予約</Link></Button>
            <Button variant="link" size="xs" asChild><Link href="/staff/operations/lstep-update"><Link2 className="size-3 mr-0.5" />LSTEP表示名更新</Link></Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">月次CSV突合・紐付け推測・月次レポート生成</p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">最新データ突合実行</CardTitle>
            <CardDescription>
              HACOMONO の最新CSV と Lstep の全件CSV をアップロードして、新規/退会/プラン変更を検出します。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <FileField label="HACOMONO 契約中 CSV (UTF-8)" file={active} onChange={setActive} />
              <FileField label="HACOMONO 退会 CSV (UTF-8)" file={withdrew} onChange={setWithdrew} />
              <FileField label="Lstep 全件 CSV (Shift-JIS)" file={lstep} onChange={setLstep} />
            </div>
            <Button
              onClick={runSync}
              disabled={loading}
              className="w-full"
            >
              {loading ? '実行中...' : '突合実行'}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </CardContent>
        </Card>

        {/* Backfill section */}
        <Card className="border-brand-200">
          <CardHeader>
            <CardTitle className="text-base text-brand-700 flex items-center gap-2">
              <Link2 className="size-4" />未紐付け会員の LINE 候補
            </CardTitle>
            <CardDescription>
              まだ LINE と紐付いていない在籍会員すべてについて、体験予約データ(友だちID + カナ名)から候補を一括計算します。
              LINE種別(本人/保護者/要確認)も自動判定します。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              onClick={runBackfill}
              disabled={backfillLoading}
              className="w-full"
            >
              {backfillLoading ? '計算中...' : '未紐付け会員の候補を計算'}
            </Button>
            {backfillSummary && (
              <p className="text-[11px] text-muted-foreground">
                未紐付け {backfillSummary.unlinked_members}人中 / 候補あり {backfillSummary.with_candidates}人 / 候補なし(手動) {backfillSummary.without_candidates}人
              </p>
            )}
            {backfill && backfill.length > 0 && renderSuggestionList(backfill)}
            {backfill && backfill.length === 0 && backfillSummary && (
              <p className="text-xs text-muted-foreground">自動候補が見つかった会員はいませんでした。</p>
            )}
          </CardContent>
        </Card>

        {result && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">結果サマリ</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-1">
                  <SummaryRow label="新規入会" value={result.summary.new_members} highlight />
                  <SummaryRow label="退会" value={result.summary.withdrew_members} highlight />
                  <SummaryRow label="プラン変更" value={result.summary.plan_changes} highlight />
                  <SummaryRow label="Lstep新規 (全体)" value={result.summary.lstep_new_total} />
                  <SummaryRow label="Lstep新規 (未紐付け)" value={result.summary.lstep_new_unmatched} />
                  <li className="border-t my-2" />
                  <SummaryRow label="HACOMONO 契約中 (合計)" value={result.summary.hacomono_active_total} muted />
                  <SummaryRow label="HACOMONO 退会 (合計)" value={result.summary.hacomono_withdrew_total} muted />
                  <SummaryRow label="Lstep 全件 (合計)" value={result.summary.lstep_total} muted />
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">ダウンロード</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-2">
                  <DownloadBtn href={downloadUrl('lstep_import')} label="Lstepインポート用CSV (Shift-JIS)" />
                  <DownloadBtn href={downloadUrl('ticket')} label="チケット会員リスト (UTF-8)" />
                  <DownloadBtn href={downloadUrl('monthly')} label="マンスリー会員リスト (UTF-8)" />
                  <DownloadBtn href={downloadUrl('unmatched')} label="Lstep未紐付け会員リスト (UTF-8)" />
                </div>
              </CardContent>
            </Card>

            {result.details.new_members.length > 0 && (
              <DetailSection title={`新規入会 (${result.details.new_members.length})`}>
                {result.details.new_members.map((m) => (
                  <li key={m.hacomono_member_id} className="text-xs py-1 border-b">
                    <span className="font-medium">{m.full_name}</span>
                    <span className="text-muted-foreground"> / {m.plan_name ?? '--'} / {m.enrolled_at?.slice(0, 10) ?? '--'}</span>
                  </li>
                ))}
              </DetailSection>
            )}

            {result.details.withdrew_members.length > 0 && (
              <DetailSection title={`退会 (${result.details.withdrew_members.length})`}>
                {result.details.withdrew_members.map((m) => (
                  <li key={m.hacomono_member_id} className="text-xs py-1 border-b">
                    <span className="font-medium">{m.full_name}</span>
                    <span className="text-muted-foreground"> / 退会: {m.withdrew_at?.slice(0, 10) ?? '--'}</span>
                  </li>
                ))}
              </DetailSection>
            )}

            {result.link_suggestions && result.link_suggestions.length > 0 && (
              <Card className="border-brand-200">
                <CardHeader>
                  <CardTitle className="text-base text-brand-700 flex items-center gap-2">
                    <Link2 className="size-4" />紐付け候補 (新規入会者)
                  </CardTitle>
                  <CardDescription className="text-[11px]">体験予約のカナ名で会員と突合し、LINE種別(本人/保護者/要確認)を自動判定しました。承認で紐付け確定します。</CardDescription>
                </CardHeader>
                <CardContent>
                  {renderSuggestionList(result.link_suggestions)}
                </CardContent>
              </Card>
            )}

            {result.details.plan_changes.length > 0 && (
              <DetailSection title={`プラン変更 (${result.details.plan_changes.length})`}>
                {result.details.plan_changes.map((p) => (
                  <li key={p.hacomono_member_id} className="text-xs py-1 border-b">
                    <div className="font-medium">{p.full_name}</div>
                    <div className="text-muted-foreground">
                      {p.from.name ?? '--'} → {p.to.name ?? '--'}
                    </div>
                  </li>
                ))}
              </DetailSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FileField({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <input
        type="file"
        accept=".csv"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="block w-full text-xs text-foreground file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:bg-brand-50 file:text-brand-700"
      />
      {file && <span className="block text-[10px] text-muted-foreground truncate">{file.name}</span>}
    </div>
  );
}

function SummaryRow({ label, value, highlight, muted }: { label: string; value: number; highlight?: boolean; muted?: boolean }) {
  return (
    <li className="flex justify-between">
      <span className={muted ? 'text-muted-foreground' : ''}>{label}</span>
      <span className={`font-bold ${highlight ? 'text-brand-600' : muted ? 'text-muted-foreground' : ''}`}>{value}</span>
    </li>
  );
}

function DownloadBtn({ href, label }: { href: string; label: string }) {
  return (
    <Button variant="outline" asChild className="w-full justify-center">
      <a href={href}><Download className="size-3.5 mr-1.5" />{label}</a>
    </Button>
  );
}

function LineTypeBadge({ type }: { type: '本人LINE' | '保護者LINE' | '要確認' }) {
  const cls =
    type === '保護者LINE'
      ? 'bg-purple-100 text-purple-700'
      : type === '本人LINE'
        ? 'bg-blue-100 text-blue-700'
        : 'bg-amber-100 text-amber-800';
  const Icon = type === '保護者LINE' ? Users : type === '本人LINE' ? Check : HelpCircle;
  return <Badge variant="outline" className={`text-[10px] ${cls}`}><Icon className="size-2.5 mr-0.5" />{type}</Badge>;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul>{children}</ul>
      </CardContent>
    </Card>
  );
}

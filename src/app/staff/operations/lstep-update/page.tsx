'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Check, X, CloudUpload, History, RefreshCw, ChevronDown } from 'lucide-react';
import StaffPageHeader from '@/components/StaffPageHeader';

type Change = {
  id: number;
  lstep_id: string;
  line_name: string | null;
  role: string;
  member_label: string;
  current_display: string;
  new_display: string;
  status: 'pending' | 'approved' | 'rejected' | 'uploaded';
};

type Batch = {
  id: number;
  total_rows: number;
  target_rows: number;
  changed_rows: number;
  status: string;
  created_at: string;
};

type Counts = { pending: number; approved: number; rejected: number; uploaded: number };

type LogRow = {
  id: number;
  action: string;
  target_rows: number;
  updated_rows: number;
  created_at: string;
};

type LinkCandidate = {
  lstep_id: string;
  system_display_name: string;
  line_register_name: string;
  customer_kana?: string;
  confidence: '高' | '中';
  reasons: string[];
  relation_suggestion: '本人' | '保護者' | '講師';
  line_type?: string;
  source?: string;
};

type LinkSuggestion = {
  member_id: number;
  full_name: string;
  full_name_kana: string;
  candidates: LinkCandidate[];
};

type NoCandidate = { member_id: number; full_name: string; full_name_kana: string };

type RecentLink = {
  id: number;
  member_id: number;
  lstep_id: string;
  relation: string;
  confirmed_at: string;
  full_name: string;
  full_name_kana: string;
  line_register_name: string | null;
  display_name: string | null;
};

const BATCH_URL = '/api/staff/operations/lstep-batch';
const APPROVE_URL = '/api/staff/operations/lstep-approve';
const LOG_URL = '/api/staff/operations/lstep-transform';
const SUGGEST_URL = '/api/staff/operations/link-suggest';
const LINK_URL = '/api/staff/operations/link';

export default function LstepUpdatePage() {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [pendingUploadTotal, setPendingUploadTotal] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [log, setLog] = useState<LogRow[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  const [noCandidates, setNoCandidates] = useState<NoCandidate[]>([]);
  const [linkLoading, setLinkLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState<string | null>(null); // 承認処理中のカード(他は操作可)
  const [parentNames, setParentNames] = useState<Record<string, string>>({}); // 親名入力 (key: member:lstep)
  const [recentLinks, setRecentLinks] = useState<RecentLink[]>([]);
  const [showRecent, setShowRecent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(BATCH_URL);
      const data = await res.json();
      setBatch(data.batch ?? null);
      const ch: Change[] = data.changes ?? [];
      setChanges(ch);
      setCounts(data.counts ?? null);
      setPendingUploadTotal(data.pending_upload_total ?? data.counts?.approved ?? 0);
      // 未判断(pending)を既定で全選択
      setSelected(new Set(ch.filter((c) => c.status === 'pending').map((c) => c.id)));
    } catch (e) {
      toast.error(`読み込み失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLog = useCallback(async () => {
    try {
      const res = await fetch(LOG_URL);
      if (res.ok) setLog((await res.json()).log ?? []);
    } catch { /* noop */ }
  }, []);

  const loadSuggestions = useCallback(async () => {
    setLinkLoading(true);
    try {
      const res = await fetch(SUGGEST_URL);
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.link_suggestions ?? []);
        setNoCandidates(data.no_candidates ?? []);
      }
      const r2 = await fetch(`${LINK_URL}?limit=20`);
      if (r2.ok) setRecentLinks((await r2.json()).links ?? []);
    } catch { /* noop */ } finally {
      setLinkLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadLog();
    loadSuggestions();
  }, [load, loadLog, loadSuggestions]);

  // 紐付け承認: link確定 → 表示名候補を自動更新 → 両セクション再読込
  // relationOverride: 要確認(13〜17歳等)のとき、TAROが本人/保護者を選んで承認する
  const approveLink = async (s: LinkSuggestion, c: LinkCandidate, relationOverride?: '本人' | '保護者') => {
    const key = `${s.member_id}:${c.lstep_id}`;
    setWorkingKey(key);
    try {
      const res = await fetch(LINK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: s.member_id,
          lstep_id: c.lstep_id,
          relation: relationOverride ?? c.relation_suggestion,
          confidence: c.confidence === '高' ? '確実' : '推定',
          parent_name:
            parentNames[key] ??
            `${s.full_name_kana.split(/[\s　]+/)[0] ?? ''} ???`.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? '紐付けに失敗しました');
        return;
      }
      toast.success(`${s.full_name_kana} を紐付けました`);
      // サクサク動作: カードを即座に消し、②の更新は裏で走らせる(他のカードは待たせない)
      setSuggestions((prev) => prev.filter((x) => x.member_id !== s.member_id));
      fetch(`${BATCH_URL}?mode=refresh`, { method: 'POST' })
        .then(() => load())
        .catch(() => {/* 裏更新の失敗は次回リロードで回復 */});
    } catch (e) {
      toast.error(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorkingKey(null);
    }
  };

  // 紐付けの取り消し: ①の承認待ちに戻る(未反映の表示名候補も消える)
  const unlink = async (l: RecentLink) => {
    if (!confirm(`${l.full_name_kana} と LINE「${l.line_register_name || l.display_name || l.lstep_id}」の紐付けを取り消しますか?`)) return;
    try {
      const res = await fetch(LINK_URL, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: l.member_id, lstep_id: l.lstep_id }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? '取り消しに失敗しました'); return; }
      toast.success(`${l.full_name_kana} の紐付けを取り消しました(①に戻ります)`);
      fetch(`${BATCH_URL}?mode=refresh`, { method: 'POST' }).then(() => load()).catch(() => {});
      await loadSuggestions();
    } catch (e) {
      toast.error(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pendingChanges = changes.filter((c) => c.status === 'pending');
  const allPendingSelected = pendingChanges.length > 0 && pendingChanges.every((c) => selected.has(c.id));

  const toggleAll = () => {
    if (allPendingSelected) setSelected(new Set());
    else setSelected(new Set(pendingChanges.map((c) => c.id)));
  };

  const decide = async (action: 'approve' | 'reject') => {
    const ids = [...selected];
    if (ids.length === 0) {
      toast.error('対象を選択してください');
      return;
    }
    setWorking(true);
    try {
      const res = await fetch(APPROVE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? '更新に失敗しました');
        return;
      }
      toast.success(action === 'approve' ? `${data.updated}件を承認しました` : `${data.updated}件を却下しました`);
      await load();
    } catch (e) {
      toast.error(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorking(false);
    }
  };

  const roleBadge = (role: string) => {
    const cls =
      role === '本人' ? 'bg-blue-100 text-blue-700' : role === '保護者' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700';
    return <span className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-xs ${cls}`}>{role}</span>;
  };

  const onManualUpload = async (file: File) => {
    setWorking(true);
    try {
      const fd = new FormData();
      fd.append('lstep', file);
      const res = await fetch(`${BATCH_URL}`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'バッチ作成に失敗しました');
        return;
      }
      if (!data.batch_id) toast.info(data.message ?? '変更はありませんでした');
      else toast.success(`承認待ちバッチを作成 (${data.summary.changed}件)`);
      await load();
    } catch (e) {
      toast.error(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      <StaffPageHeader
        title="LINE連携"
        backHref="/staff/operations"
        backLabel="オペレーション"
        rightExtra={
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { load(); loadLog(); loadSuggestions(); }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        }
      />
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">

      {/* ① LINE紐付けの承認待ち */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            ① LINE紐付けの承認待ち
            {!linkLoading && suggestions.length > 0 && (
              <Badge className="bg-brand-100 text-brand-700">{suggestions.length}人</Badge>
            )}
          </CardTitle>
          <p className="text-xs text-gray-500">
            まだLINEと紐付いていない会員と、そのLINEアカウント候補です。正しければ「このLINEで承認」。
            承認すると下の「② 表示名の承認待ち」に変更候補が自動で追加されます。
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {linkLoading ? (
            <p className="py-4 text-center text-sm text-gray-400">候補を計算中...</p>
          ) : suggestions.length === 0 && noCandidates.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">未紐付けの会員はいません 🎉</p>
          ) : (
            <>
              {suggestions.map((s) => (
                <div key={s.member_id} className="rounded-md border p-3">
                  <div className="mb-2 text-sm font-bold">
                    {s.full_name}（{s.full_name_kana}）
                  </div>
                  <div className="space-y-2">
                    {s.candidates.slice(0, 2).map((c) => (
                      <div key={c.lstep_id} className="flex flex-wrap items-center gap-2 rounded bg-gray-50 p-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">
                            LINE: {c.line_register_name || c.system_display_name || '(名前なし)'}
                            <Badge className={`ml-2 ${c.confidence === '高' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                              信頼度{c.confidence}
                            </Badge>
                            {c.line_type && <span className="ml-2 text-xs text-gray-500">{c.line_type}</span>}
                          </div>
                          {c.system_display_name && (
                            <div className="truncate text-xs text-gray-500">現在: {c.system_display_name}</div>
                          )}
                          <div className="text-xs text-gray-400">{c.reasons.slice(0, 2).join('、')}</div>
                        </div>
                        {(() => {
                          const key = `${s.member_id}:${c.lstep_id}`;
                          // 親名のデフォルト: 子の姓 + ??? (苗字はHACOMONOから分かる。名が不明でも承認可)
                          const surname = s.full_name_kana.split(/[\s　]+/)[0] ?? '';
                          const parentVal = parentNames[key] ?? (surname ? `${surname} ???` : '');
                          const busy = workingKey === key;
                          const rec = c.line_type === '要確認' ? null : c.relation_suggestion; // システムのおすすめ
                          const previewParent = `【保護者】${parentVal || '(親名を入力)'} / 子:${s.full_name_kana}`;
                          const previewSelf = `【本人】${s.full_name_kana}`;
                          return (
                            <div className="w-full space-y-1.5 border-t pt-1.5">
                              {/* 最終的にLINEに付く表示名のプレビュー(本人/保護者の両方) */}
                              <div className="space-y-0.5 text-xs">
                                <div>
                                  <span className="text-gray-400">本人なら: </span>
                                  <span className="font-semibold text-blue-700">{previewSelf}</span>
                                </div>
                                <div>
                                  <span className="text-gray-400">保護者なら: </span>
                                  <span className="font-semibold text-green-700">{previewParent}</span>
                                </div>
                              </div>
                              <input
                                type="text"
                                value={parentVal}
                                placeholder="親の名前 (不明なら 姓 ??? のままでOK)"
                                onChange={(e) => setParentNames((prev) => ({ ...prev, [key]: e.target.value }))}
                                className="w-full rounded border px-2 py-1 text-sm"
                              />
                              <div className="flex flex-wrap items-center gap-1">
                                <Button size="sm" disabled={busy} onClick={() => approveLink(s, c, '本人')}
                                  className={rec === '本人' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-400 hover:bg-blue-500'}>
                                  {busy ? '処理中...' : `本人として承認${rec === '本人' ? '★' : ''}`}
                                </Button>
                                <Button size="sm" disabled={busy} onClick={() => approveLink(s, c, '保護者')}
                                  className={rec === '保護者' ? 'bg-green-600 hover:bg-green-700' : 'bg-green-500 hover:bg-green-600'}>
                                  {busy ? '処理中...' : `保護者として承認${rec === '保護者' ? '★' : ''}`}
                                </Button>
                                {rec && <span className="text-[10px] text-gray-400">★=おすすめ</span>}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {noCandidates.length > 0 && (
                <div className="rounded-md border border-dashed p-3 text-sm">
                  <div className="mb-1 font-semibold text-gray-600">
                    候補が見つからない会員（{noCandidates.length}人）
                  </div>
                  <p className="mb-2 text-xs text-gray-400">
                    体験予約データに一致がない会員です。「手動で探す」から検索して紐付けてください。
                  </p>
                  <div className="space-y-1">
                    {noCandidates.map((m) => (
                      <div key={m.member_id} className="flex items-center justify-between">
                        <span>{m.full_name}（{m.full_name_kana}）</span>
                        <Link
                          href={`/staff/notifications/link?member_id=${m.member_id}`}
                          className="text-xs text-brand-600 underline"
                        >
                          手動で探す
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* アップロード待ち通知 */}
      {pendingUploadTotal > 0 && (
        <Card className="border-brand-300 bg-brand-50">
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <CloudUpload className="h-5 w-5 shrink-0 text-brand-600" />
            <div>
              <b className="text-brand-700">承認済み {pendingUploadTotal}件</b> がアップロード待ちです。
              <span className="text-gray-600">
                <b>Claudeに「承認した」と一言伝えてください。</b>ClaudeがLSTEPに反映するとこの表示は消えます。
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="py-10 text-center text-gray-400">読み込み中...</p>
      ) : !batch ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-gray-500">
            ② 表示名の承認待ちはありません。<br />
            上で紐付けを承認すると、ここに表示名の変更候補が出ます。
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              ② 表示名の承認待ち
              {counts && <Badge className="bg-brand-100 text-brand-700">{counts.pending}件</Badge>}
            </CardTitle>
            <p className="text-xs text-gray-500">
              バッチ#{batch.id}・{batch.created_at}（対象{batch.target_rows}件中 変更{batch.changed_rows}件）。
              内容を確認して、問題なければ承認してください。
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingChanges.length > 0 && (
              <label className="flex cursor-pointer items-center gap-2 border-b pb-2 text-sm font-medium">
                <input type="checkbox" checked={allPendingSelected} onChange={toggleAll} className="h-4 w-4 accent-brand-500" />
                すべて選択（{selected.size}/{pendingChanges.length}）
              </label>
            )}

            <div className="space-y-1.5">
              {changes.map((c) => {
                const decided = c.status !== 'pending';
                return (
                  <div
                    key={c.id}
                    className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
                      c.status === 'approved' ? 'border-green-200 bg-green-50' : c.status === 'rejected' ? 'border-gray-200 bg-gray-50 opacity-60' : c.status === 'uploaded' ? 'border-blue-200 bg-blue-50' : ''
                    }`}
                  >
                    {!decided && (
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        className="mt-1 h-4 w-4 shrink-0 accent-brand-500"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center gap-1.5">
                        {roleBadge(c.role)}
                        <span className="truncate text-xs font-semibold text-gray-700">
                          LINE: {c.line_name || '(名前なし)'}
                        </span>
                        {c.status === 'approved' && <Badge className="bg-green-100 text-green-700">承認済</Badge>}
                        {c.status === 'rejected' && <Badge className="bg-gray-200 text-gray-600">却下</Badge>}
                        {c.status === 'uploaded' && <Badge className="bg-blue-100 text-blue-700">反映済</Badge>}
                      </div>
                      <div className="text-gray-400 line-through">{c.current_display || '(空)'}</div>
                      <div className="font-medium text-gray-900">{c.new_display}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {pendingChanges.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button onClick={() => decide('approve')} disabled={working || selected.size === 0} className="bg-brand-500 hover:bg-brand-600">
                  <Check className="mr-1 h-4 w-4" />
                  選択した{selected.size}件を承認
                </Button>
                <Button onClick={() => decide('reject')} disabled={working || selected.size === 0} variant="outline">
                  <X className="mr-1 h-4 w-4" />却下
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 紐付け済み(最近) — 間違えたときに取り消して①に戻せる */}
      <div>
        <button onClick={() => setShowRecent((v) => !v)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ChevronDown className={`h-3 w-3 transition-transform ${showRecent ? 'rotate-180' : ''}`} />
          最近の紐付け（間違えたらここから取り消し）
        </button>
        {showRecent && (
          <Card className="mt-2">
            <CardContent className="space-y-1 py-4 text-sm">
              {recentLinks.length === 0 ? (
                <p className="text-gray-500">紐付けはまだありません。</p>
              ) : (
                recentLinks.map((l) => (
                  <div key={l.id} className="flex items-center justify-between border-b py-1.5">
                    <div className="min-w-0">
                      <span className="font-medium">{l.full_name_kana}</span>
                      <span className="mx-1 text-gray-400">↔</span>
                      <span>LINE「{l.line_register_name || l.display_name || l.lstep_id}」</span>
                      <span className="ml-1 text-xs text-gray-400">({l.relation} / {l.confirmed_at?.slice(0, 16)})</span>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => unlink(l)} className="shrink-0 text-red-600 hover:bg-red-50">
                      取り消す
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* 手動でエクスポートから作成（フォールバック/テスト用） */}
      <div>
        <button onClick={() => setShowManual((v) => !v)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ChevronDown className={`h-3 w-3 transition-transform ${showManual ? 'rotate-180' : ''}`} />
          手動でエクスポートCSVから承認待ちを作る（通常はClaudeが自動作成）
        </button>
        {showManual && (
          <Card className="mt-2">
            <CardContent className="space-y-2 py-4 text-sm">
              <p className="text-xs text-gray-500">LstepフルエクスポートCSV(cp932)をアップロードすると、変更点を計算して承認待ちにします。</p>
              <input
                type="file"
                accept=".csv"
                disabled={working}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onManualUpload(f); }}
                className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-gray-200 file:px-3 file:py-1.5 hover:file:bg-gray-300"
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* 履歴 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" />反映履歴</CardTitle>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="text-sm text-gray-500">まだ履歴がありません。</p>
          ) : (
            <div className="space-y-1 text-sm">
              {log.map((r) => (
                <div key={r.id} className="flex items-center justify-between border-b py-1">
                  <span className="text-gray-500">{r.created_at}</span>
                  <span>{r.action === 'upload_confirmed' ? 'LSTEP反映' : r.action === 'generate_csv' ? 'CSV生成' : r.action}</span>
                  <span className="font-medium text-brand-600">{r.updated_rows}件</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

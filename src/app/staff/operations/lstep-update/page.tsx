'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { ArrowLeft, Check, X, CloudUpload, History, RefreshCw, ChevronDown } from 'lucide-react';

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

const BATCH_URL = '/api/staff/operations/lstep-batch';
const APPROVE_URL = '/api/staff/operations/lstep-approve';
const LOG_URL = '/api/staff/operations/lstep-transform';

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

  useEffect(() => {
    load();
    loadLog();
  }, [load, loadLog]);

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
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Link href="/staff/operations">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />運用
          </Button>
        </Link>
        <h1 className="text-xl font-bold">LSTEP表示名 更新</h1>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { load(); loadLog(); }}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* アップロード待ち通知 */}
      {pendingUploadTotal > 0 && (
        <Card className="border-orange-300 bg-orange-50">
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <CloudUpload className="h-5 w-5 shrink-0 text-orange-600" />
            <div>
              <b className="text-orange-700">承認済み {pendingUploadTotal}件</b> がアップロード待ちです。
              <span className="text-gray-600">次回Claudeがまとめて LSTEP に反映します（TAROさんの操作は不要）。</span>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="py-10 text-center text-gray-400">読み込み中...</p>
      ) : !batch ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-500">
            承認待ちの変更はありません。<br />
            新しい紐付けがあると、Claudeがここに「承認待ち」を用意します。
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              承認待ちの変更
              {counts && <Badge className="bg-orange-100 text-orange-700">{counts.pending}件</Badge>}
            </CardTitle>
            <p className="text-xs text-gray-500">
              バッチ#{batch.id}・{batch.created_at}（対象{batch.target_rows}件中 変更{batch.changed_rows}件）。
              内容を確認して、問題なければ承認してください。
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingChanges.length > 0 && (
              <label className="flex cursor-pointer items-center gap-2 border-b pb-2 text-sm font-medium">
                <input type="checkbox" checked={allPendingSelected} onChange={toggleAll} className="h-4 w-4 accent-orange-500" />
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
                        className="mt-1 h-4 w-4 shrink-0 accent-orange-500"
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
                <Button onClick={() => decide('approve')} disabled={working || selected.size === 0} className="bg-orange-500 hover:bg-orange-600">
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
                  <span className="font-medium text-orange-600">{r.updated_rows}件</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

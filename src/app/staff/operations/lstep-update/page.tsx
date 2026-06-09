'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { Upload, Download, ArrowLeft, AlertTriangle, History } from 'lucide-react';

type Change = {
  lstep_id: string;
  role: string;
  member_label: string;
  current_display: string;
  new_display: string;
  changed: boolean;
};

type PreviewResponse = {
  ok: boolean;
  summary: {
    total_rows: number;
    target_rows: number;
    updated_rows: number;
    unchanged_rows: number;
  };
  warnings: string[];
  changes: Change[];
};

type LogRow = {
  id: number;
  action: string;
  target_rows: number;
  updated_rows: number;
  total_rows: number;
  created_at: string;
};

const TRANSFORM_URL = '/api/staff/operations/lstep-transform';

export default function LstepUpdatePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [log, setLog] = useState<LogRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadLog = async () => {
    try {
      const res = await fetch(TRANSFORM_URL);
      if (res.ok) {
        const data = await res.json();
        setLog(data.log ?? []);
      }
    } catch {
      /* noop */
    }
  };

  useEffect(() => {
    loadLog();
  }, []);

  const runPreview = async () => {
    if (!file) {
      toast.error('LstepのフルエクスポートCSVを選択してください');
      return;
    }
    setLoading(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append('lstep', file);
      const res = await fetch(`${TRANSFORM_URL}?mode=preview`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'プレビュー生成に失敗しました');
        if (data.warnings) setPreview({ ok: false, summary: { total_rows: 0, target_rows: 0, updated_rows: 0, unchanged_rows: 0 }, warnings: data.warnings, changes: [] });
        return;
      }
      setPreview(data);
      toast.success(`${data.summary.updated_rows}件の表示名が更新されます`);
    } catch (e) {
      toast.error(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const generateCsv = async () => {
    if (!file) return;
    setGenerating(true);
    try {
      const fd = new FormData();
      fd.append('lstep', file);
      const res = await fetch(`${TRANSFORM_URL}?mode=csv`, { method: 'POST', body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'CSV生成に失敗しました');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lstep_import_ready.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('インポート用CSVをダウンロードしました');
      loadLog();
    } catch (e) {
      toast.error(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  };

  const roleBadge = (role: string) => {
    const color =
      role === '本人' ? 'bg-blue-100 text-blue-700' : role === '保護者' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700';
    return <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${color}`}>{role}</span>;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link href="/staff/operations">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            運用
          </Button>
        </Link>
        <h1 className="text-xl font-bold sm:text-2xl">LSTEP表示名 一括更新</h1>
      </div>

      <Card className="border-orange-200 bg-orange-50/50">
        <CardContent className="pt-6 text-sm text-gray-700">
          <p className="mb-2 font-semibold text-orange-700">この画面の使い方</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Lstep管理画面「友だちリスト → CSV操作 → <b>CSVエクスポート</b>」でフルCSVを取得</li>
            <li>そのCSVをここにアップロードして <b>変更プレビュー</b> を確認</li>
            <li>内容が正しければ「インポート用CSVを生成」→ Lstepの「<b>CSVインポート</b>」に流す</li>
          </ol>
          <p className="mt-2 text-xs text-gray-500">
            ※ 紐付け(member_lstep_links)を元にシステム表示名【本人】/【保護者】/【講師】を自動生成します。
            元CSVの列構成・タグID行・左1列・上2行は変更しません(Lstep制約準拠)。
          </p>
        </CardContent>
      </Card>

      {/* Step 1: アップロード */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. LstepフルエクスポートCSVをアップロード</CardTitle>
          <CardDescription>cp932(Shift-JIS)・2行ヘッダー・56列のフルCSV</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
            className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-orange-500 file:px-3 file:py-1.5 file:text-white hover:file:bg-orange-600"
          />
          <Button onClick={runPreview} disabled={!file || loading} className="bg-orange-500 hover:bg-orange-600">
            <Upload className="mr-1 h-4 w-4" />
            {loading ? 'プレビュー生成中...' : '変更プレビューを表示'}
          </Button>
        </CardContent>
      </Card>

      {/* warnings */}
      {preview && preview.warnings.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <ul className="space-y-1">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: プレビュー */}
      {preview && preview.ok && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. 変更プレビュー</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="データ行" value={preview.summary.total_rows} />
              <Stat label="紐付けあり" value={preview.summary.target_rows} />
              <Stat label="表示名が変わる" value={preview.summary.updated_rows} highlight />
              <Stat label="変更なし" value={preview.summary.unchanged_rows} />
            </div>

            {preview.changes.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2 pr-2">役割</th>
                      <th className="py-2 pr-2">現在の表示名</th>
                      <th className="py-2 pr-2">→ 新しい表示名</th>
                      <th className="py-2 pr-2">状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.changes.map((c) => (
                      <tr key={c.lstep_id} className={`border-b ${c.changed ? '' : 'text-gray-400'}`}>
                        <td className="py-1.5 pr-2">{roleBadge(c.role)}</td>
                        <td className="py-1.5 pr-2 text-gray-500">{c.current_display || '(空)'}</td>
                        <td className="py-1.5 pr-2 font-medium">{c.new_display}</td>
                        <td className="py-1.5 pr-2">
                          {c.changed ? (
                            <Badge className="bg-orange-100 text-orange-700">変更</Badge>
                          ) : (
                            <span className="text-xs text-gray-400">同じ</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-500">変更対象の友だちがありません。</p>
            )}

            <div className="flex items-center gap-2 border-t pt-4">
              <Button onClick={generateCsv} disabled={generating} className="bg-orange-500 hover:bg-orange-600">
                <Download className="mr-1 h-4 w-4" />
                {generating ? '生成中...' : 'インポート用CSVを生成'}
              </Button>
              <span className="text-xs text-gray-500">→ Lstep「CSVインポート」にアップロードして反映</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 履歴 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            更新履歴
          </CardTitle>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="text-sm text-gray-500">まだ履歴がありません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="py-2 pr-2">日時</th>
                    <th className="py-2 pr-2">アクション</th>
                    <th className="py-2 pr-2">対象</th>
                    <th className="py-2 pr-2">変更</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-1.5 pr-2">{r.created_at}</td>
                      <td className="py-1.5 pr-2">
                        {r.action === 'generate_csv' ? 'CSV生成' : r.action === 'upload_confirmed' ? 'アップロード反映' : r.action}
                      </td>
                      <td className="py-1.5 pr-2">{r.target_rows}</td>
                      <td className="py-1.5 pr-2 font-medium text-orange-600">{r.updated_rows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 text-center ${highlight ? 'border-orange-300 bg-orange-50' : 'bg-gray-50'}`}>
      <div className={`text-2xl font-bold ${highlight ? 'text-orange-600' : 'text-gray-700'}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

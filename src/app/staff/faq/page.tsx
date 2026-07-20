'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import StaffPageHeader from '@/components/StaffPageHeader';

// WS O: FAQ AIチャットボット「BOOMくんに質問」の正本データをスタッフが管理するCRUD画面。
// カテゴリは /api/staff/faq (= faq_entries テーブル) と揃える。公開ONの行だけが
// /api/public/knowledge 経由でBOOMくんチャット・HPに出る (buildKnowledge 参照)。
const CATEGORIES = ['体験', '入会', '料金・支払い', 'BOOMポータル', 'レッスン', 'その他'];

type Entry = {
  id: number;
  category: string;
  question: string;
  answer: string;
  is_public: number;
  sort_order: number;
  updated_at: string;
};

type FormState = {
  category: string;
  question: string;
  answer: string;
  is_public: boolean;
  sort_order: number;
};

const emptyForm: FormState = {
  category: CATEGORIES[0],
  question: '',
  answer: '',
  is_public: false,
  sort_order: 0,
};

export default function FaqAdminPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/staff/faq', { credentials: 'include' });
      if (r.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/faq';
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setEntries(d.entries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setError('');
  };

  const startEdit = (entry: Entry) => {
    setForm({
      category: CATEGORIES.includes(entry.category) ? entry.category : CATEGORIES[0],
      question: entry.question,
      answer: entry.answer,
      is_public: Number(entry.is_public) === 1,
      sort_order: Number(entry.sort_order) || 0,
    });
    setEditingId(entry.id);
    setError('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const save = async () => {
    setError('');
    if (!form.question.trim() || !form.answer.trim()) {
      setError('質問と回答は必須です');
      return;
    }
    const payload = {
      category: form.category,
      question: form.question.trim(),
      answer: form.answer.trim(),
      is_public: form.is_public ? 1 : 0,
      sort_order: form.sort_order,
    };
    setBusy(true);
    try {
      const r = editingId
        ? await fetch('/api/staff/faq', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ id: editingId, ...payload }),
          })
        : await fetch('/api/staff/faq', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
          });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      toast.success(editingId ? '更新しました' : '追加しました');
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const togglePublic = async (entry: Entry) => {
    setError('');
    const nextPublic = Number(entry.is_public) === 1 ? 0 : 1;
    try {
      const r = await fetch('/api/staff/faq', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: entry.id, is_public: nextPublic }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      toast.success(nextPublic ? '公開にしました' : '非公開にしました');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (entry: Entry) => {
    if (!window.confirm(`「${entry.question}」を削除しますか？`)) return;
    setError('');
    try {
      const r = await fetch(`/api/staff/faq?id=${entry.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      toast.success('削除しました');
      if (editingId === entry.id) resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // 固定カテゴリを常に先頭に、既存データにだけ残る未知カテゴリ(過去データ等)は末尾に表示し
  // どのカテゴリの項目も一覧から漏れないようにする。
  const extraCategories = Array.from(
    new Set(entries.map((e) => e.category).filter((c) => !CATEGORIES.includes(c)))
  );
  const allCategories = [...CATEGORIES, ...extraCategories];

  return (
    <div>
      <StaffPageHeader
        title="FAQ管理"
        description="AIチャット(BOOMに質問)とHPに公開するよくある質問。公開ONの項目だけが外に出ます（反映まで最大20分ほど）"
        rightExtra={
          <div className="flex gap-2">
            <a
              href="/staff/faq/reports"
              className="rounded-lg border border-sand-200 bg-white px-3 py-1.5 text-sm text-navy-800 hover:bg-sand-50"
            >
              🔧 エラー報告
            </a>
            <a
              href="/staff/faq/stats"
              className="rounded-lg border border-sand-200 bg-white px-3 py-1.5 text-sm text-navy-800 hover:bg-sand-50"
            >
              📊 質問ログ集計
            </a>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        {/* 新規追加 / 編集フォーム */}
        <div ref={formRef} className="rounded-xl border border-sand-200 bg-white p-4 sm:p-5 space-y-3">
          <h2 className="text-sm font-bold text-navy-800">
            {editingId ? '編集中' : '新規追加'}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1">
              <Label className="text-xs">カテゴリ</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">表示順</Label>
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setForm((f) => ({ ...f, sort_order: Number.isFinite(n) ? n : 0 }));
                }}
                className="sm:w-24"
              />
            </div>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_public}
              onChange={(e) => setForm((f) => ({ ...f, is_public: e.target.checked }))}
              className="size-4 accent-brand-500"
            />
            <span className="text-sm">公開する</span>
          </label>

          <div className="space-y-1">
            <Label className="text-xs">質問</Label>
            <Input
              value={form.question}
              onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
              placeholder="例: 体験レッスンは無料ですか？"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">回答</Label>
            <Textarea
              value={form.answer}
              onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
              rows={4}
              placeholder="回答本文"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <Button onClick={save} disabled={busy}>
              {editingId ? '更新する' : '追加する'}
            </Button>
            {editingId && (
              <Button variant="outline" onClick={resetForm} disabled={busy}>
                キャンセル
              </Button>
            )}
          </div>
        </div>

        {/* カテゴリ別一覧 */}
        {loading ? (
          <p className="text-sm text-muted-foreground">読込中...</p>
        ) : (
          <div className="space-y-5">
            {allCategories.map((cat) => {
              const items = entries.filter((e) => e.category === cat);
              return (
                <section key={cat}>
                  <h3 className="text-xs font-bold text-navy-700 mb-2">
                    {cat}
                    <span className="text-neutral-400 font-normal ml-1">({items.length}件)</span>
                  </h3>
                  {items.length === 0 ? (
                    <p className="text-xs text-neutral-400">まだありません。</p>
                  ) : (
                    <div className="space-y-2">
                      {items.map((entry) => (
                        <div
                          key={entry.id}
                          className="rounded-xl border border-sand-200 bg-white p-3"
                        >
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                {Number(entry.is_public) === 1 ? (
                                  <Badge variant="outline" className="bg-brand-100 text-brand-700 border-brand-200">
                                    公開中
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="bg-sand-100 text-sand-700 border-sand-300">
                                    非公開
                                  </Badge>
                                )}
                                <span className="text-[11px] text-neutral-400">順 {entry.sort_order}</span>
                              </div>
                              <p className="text-sm font-medium text-navy-800 break-words">
                                {entry.question}
                              </p>
                              <p className="text-xs text-neutral-500 mt-1 whitespace-pre-wrap break-words">
                                {entry.answer}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                              <Button size="xs" variant="outline" onClick={() => togglePublic(entry)}>
                                {Number(entry.is_public) === 1 ? (
                                  <><EyeOff className="size-3 mr-0.5" />非公開にする</>
                                ) : (
                                  <><Eye className="size-3 mr-0.5" />公開する</>
                                )}
                              </Button>
                              <Button size="xs" variant="outline" onClick={() => startEdit(entry)}>
                                <Pencil className="size-3 mr-0.5" />編集
                              </Button>
                              <Button size="xs" variant="destructive" onClick={() => remove(entry)}>
                                <Trash2 className="size-3 mr-0.5" />削除
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

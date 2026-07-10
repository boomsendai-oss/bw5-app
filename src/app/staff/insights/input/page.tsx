'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Calculator } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type FormState = {
  snapshot_date: string; // YYYY-MM
  line_friends: string;
  hacomono_members_active: string;
  hacomono_members_retired: string;
  monthly_revenue: string;
  monthly_expense: string;
  monthly_profit: string;
  trial_count: string;
  new_signup_count: string;
  retention_count: string;
  churn_count: string;
  notes: string;
};

const EMPTY: FormState = {
  snapshot_date: '',
  line_friends: '',
  hacomono_members_active: '',
  hacomono_members_retired: '',
  monthly_revenue: '',
  monthly_expense: '',
  monthly_profit: '',
  trial_count: '',
  new_signup_count: '',
  retention_count: '',
  churn_count: '',
  notes: '',
};

function defaultMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function InputForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const editId = sp.get('id');
  const isEdit = !!editId;

  const [form, setForm] = useState<FormState>({ ...EMPTY, snapshot_date: defaultMonth() });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [initialLoading, setInitialLoading] = useState(isEdit);

  const loadExisting = useCallback(async () => {
    if (!editId) return;
    try {
      const res = await fetch('/api/staff/kpi/snapshots', { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/insights/input';
        return;
      }
      const data = await res.json();
      const target = (data.snapshots ?? []).find((s: { id: number }) => String(s.id) === editId);
      if (target) {
        setForm({
          snapshot_date: (target.snapshot_date ?? '').slice(0, 7),
          line_friends: String(target.line_friends ?? ''),
          hacomono_members_active: String(target.hacomono_members_active ?? ''),
          hacomono_members_retired: String(target.hacomono_members_retired ?? ''),
          monthly_revenue: String(target.monthly_revenue ?? ''),
          monthly_expense: String(target.monthly_expense ?? ''),
          monthly_profit: String(target.monthly_profit ?? ''),
          trial_count: String(target.trial_count ?? ''),
          new_signup_count: String(target.new_signup_count ?? ''),
          retention_count: String(target.retention_count ?? ''),
          churn_count: String(target.churn_count ?? ''),
          notes: target.notes ?? '',
        });
      }
    } finally {
      setInitialLoading(false);
    }
  }, [editId]);

  useEffect(() => {
    loadExisting();
  }, [loadExisting]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = {
        snapshot_date: form.snapshot_date,
        line_friends: Number(form.line_friends) || 0,
        hacomono_members_active: Number(form.hacomono_members_active) || 0,
        hacomono_members_retired: Number(form.hacomono_members_retired) || 0,
        monthly_revenue: Number(form.monthly_revenue) || 0,
        monthly_expense: Number(form.monthly_expense) || 0,
        monthly_profit: Number(form.monthly_profit) || 0,
        trial_count: Number(form.trial_count) || 0,
        new_signup_count: Number(form.new_signup_count) || 0,
        retention_count: Number(form.retention_count) || 0,
        churn_count: Number(form.churn_count) || 0,
        notes: form.notes,
      };
      const url = isEdit
        ? `/api/staff/kpi/snapshots/${editId}`
        : '/api/staff/kpi/snapshots';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/insights/input';
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? '保存失敗');
        return;
      }
      router.replace('/staff/insights');
    } catch {
      setError('通信エラー');
    } finally {
      setLoading(false);
    }
  }

  function update<K extends keyof FormState>(k: K, v: string) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  // 自動計算: 利益 = 売上 - 支出 (空のときだけ補助)
  function recalcProfit() {
    const rev = Number(form.monthly_revenue) || 0;
    const exp = Number(form.monthly_expense) || 0;
    update('monthly_profit', String(rev - exp));
  }

  if (initialLoading) {
    return <div className="p-8 text-neutral-500">読み込み中...</div>;
  }

  return (
    <main className="text-neutral-900">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-brand-600">
          {isEdit ? '月次データ編集' : '月次データ追加'}
        </h1>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/staff/insights">
            <ArrowLeft className="h-4 w-4 mr-1" />
            KPI・分析へ戻る
          </Link>
        </Button>
      </header>

      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        <Card>
          <CardContent className="p-5">
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="snapshot_date">対象月 (YYYY-MM)</Label>
                <Input
                  id="snapshot_date"
                  type="month"
                  required
                  value={form.snapshot_date}
                  onChange={(e) => update('snapshot_date', e.target.value)}
                  disabled={isEdit}
                />
                {isEdit && (
                  <p className="text-xs text-neutral-500 mt-1">
                    対象月は編集できません。変更したい場合は削除して再作成してください。
                  </p>
                )}
              </div>

              <fieldset className="border-t border-neutral-200 pt-4">
                <legend className="text-xs font-bold text-neutral-700 mb-2">集客 / 会員</legend>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="LINE友達数" value={form.line_friends} onChange={(v) => update('line_friends', v)} />
                  <NumField label="体験参加数" value={form.trial_count} onChange={(v) => update('trial_count', v)} />
                  <NumField label="新規入会数" value={form.new_signup_count} onChange={(v) => update('new_signup_count', v)} />
                  <NumField label="継続会員数" value={form.retention_count} onChange={(v) => update('retention_count', v)} />
                  <NumField label="在籍会員数 (hacomono)" value={form.hacomono_members_active} onChange={(v) => update('hacomono_members_active', v)} />
                  <NumField label="退会会員数 (今月)" value={form.churn_count} onChange={(v) => update('churn_count', v)} />
                  <NumField label="累計退会者 (hacomono)" value={form.hacomono_members_retired} onChange={(v) => update('hacomono_members_retired', v)} />
                </div>
              </fieldset>

              <fieldset className="border-t border-neutral-200 pt-4">
                <legend className="text-xs font-bold text-neutral-700 mb-2">売上 / 利益 (円)</legend>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="月間売上" value={form.monthly_revenue} onChange={(v) => update('monthly_revenue', v)} />
                  <NumField label="月間支出" value={form.monthly_expense} onChange={(v) => update('monthly_expense', v)} />
                  <NumField label="月間利益" value={form.monthly_profit} onChange={(v) => update('monthly_profit', v)} />
                </div>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={recalcProfit}
                  className="mt-2 text-xs text-brand-600 px-0"
                >
                  <Calculator className="h-3 w-3 mr-1" />
                  利益 = 売上 - 支出 で再計算
                </Button>
              </fieldset>

              <fieldset className="border-t border-neutral-200 pt-4">
                <legend className="text-xs font-bold text-neutral-700 mb-2">メモ</legend>
                <Textarea
                  value={form.notes}
                  onChange={(e) => update('notes', e.target.value)}
                  rows={3}
                  placeholder="特記事項 / イベント / 気づき等"
                />
              </fieldset>

              {error && <div className="text-sm text-red-600">{error}</div>}

              <div className="flex gap-2 pt-2">
                <Button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-brand-500 hover:bg-brand-600"
                >
                  {loading ? '保存中...' : isEdit ? '更新' : '追加'}
                </Button>
                <Button variant="outline" className="flex-1" asChild>
                  <Link href="/staff/insights">
                    キャンセル
                  </Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function InputPage() {
  return (
    <Suspense fallback={<div className="p-8 text-neutral-500">Loading...</div>}>
      <InputForm />
    </Suspense>
  );
}

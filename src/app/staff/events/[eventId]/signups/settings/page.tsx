'use client';

import { useCallback, useEffect, useState, use as usePromise } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import StaffPageHeader from '@/components/StaffPageHeader';

type PartDef = { key: string; label: string; note?: string };
type Settings = {
  parts: PartDef[];
  feeText: string;
  deadline: string;
  introMd: string;
  calendarUrl: string;
  isOpen: boolean;
};

export default function SignupSettingsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = usePromise(params);
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/events/${eventId}/signups/settings`, { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = `/staff/events/login?next=/staff/events/${eventId}/signups/settings`;
        return;
      }
      const data = await res.json();
      setS(data.settings);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/staff/events/${eventId}/signups/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(s),
      });
      if (res.ok) toast.success('設定を保存しました');
      else toast.error('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !s) return <div className="p-8 text-muted-foreground">読み込み中...</div>;

  return (
    <div>
      <StaffPageHeader
        title="募集フォーム設定"
        description="公開フォームの表示内容・受付状態"
        backHref={`/staff/events/${eventId}/signups`}
        backLabel="集計"
      />

      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <Card><CardContent className="pt-4 space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-sand-200 p-3">
            <div>
              <div className="text-sm font-semibold text-navy-700">受付</div>
              <div className="text-xs text-muted-foreground">オフにすると公開フォームで送信できなくなります</div>
            </div>
            <Switch checked={s.isOpen} onCheckedChange={(v) => setS({ ...s, isOpen: v })} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">参加費テキスト</Label>
            <Input value={s.feeText} onChange={(e) => setS({ ...s, feeText: e.target.value })} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">締切</Label>
            <Input type="date" value={s.deadline} onChange={(e) => setS({ ...s, deadline: e.target.value })} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Googleカレンダー公開URL（全体リハ・HIPHOP日程）</Label>
            <Input
              placeholder="https://calendar.google.com/..."
              value={s.calendarUrl}
              onChange={(e) => setS({ ...s, calendarUrl: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground">空にすると公開フォームのカレンダーボタンは非表示になります</p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">説明文（入力した改行はそのまま表示されます）</Label>
            <Textarea
              rows={10}
              value={s.introMd}
              onChange={(e) => setS({ ...s, introMd: e.target.value })}
              className="font-mono text-xs"
            />
          </div>

          <div className="rounded-lg bg-sand-50 p-3 text-xs text-muted-foreground">
            パート: {s.parts.map((p) => p.label).join(' / ')}
          </div>

          <Button onClick={save} disabled={saving} className="w-full">
            {saving ? '保存中…' : '設定を保存'}
          </Button>
        </CardContent></Card>
      </div>
    </div>
  );
}

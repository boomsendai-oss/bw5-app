'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// 来店訂正 (WS AA / 2026-07-27)。
// 来店判定は「キャンセル以外は来店みなし」の自動判定にしたため、本当に来なかった
// ケースだけをここで直す。使わなくても集計は壊れない。

export type PastTrial = {
  id: number;
  reservedLabel: string;   // '7/20(月) 19:00'
  name: string;
  lessonName: string;
  attendanceOverride: string | null;
};

export default function NoshowCorrections({ trials }: { trials: PastTrial[] }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [state, setState] = useState<Record<number, string | null>>(
    Object.fromEntries(trials.map((t) => [t.id, t.attendanceOverride]))
  );

  if (trials.length === 0) return null;

  const toggle = async (id: number, makeNoshow: boolean) => {
    setBusy(id);
    try {
      const res = await fetch('/api/staff/trials/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trial_id: id, override: makeNoshow ? 'noshow' : null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState((s) => ({ ...s, [id]: makeNoshow ? 'noshow' : null }));
      toast.success(makeNoshow ? 'ノーショーにしました' : '来店に戻しました');
    } catch {
      toast.error('更新に失敗しました');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardContent className="pt-3 pb-3 space-y-2">
        <div className="text-xs text-muted-foreground">
          直近2週間の体験（来店として集計中）。実際に来なかった方だけ「ノーショー」に直してください。
        </div>
        {trials.map((t) => {
          const isNoshow = state[t.id] === 'noshow';
          return (
            <div key={t.id} className="flex items-center justify-between gap-2 border-t border-sand-100 pt-2">
              <div className="min-w-0 text-sm">
                <span className="text-muted-foreground mr-2">{t.reservedLabel}</span>
                <span className={isNoshow ? 'line-through text-muted-foreground' : 'font-medium text-navy-800'}>
                  {t.name}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">{t.lessonName}</span>
              </div>
              <Button
                size="sm"
                variant={isNoshow ? 'secondary' : 'outline'}
                disabled={busy === t.id}
                onClick={() => toggle(t.id, !isNoshow)}
              >
                {isNoshow ? '来店に戻す' : 'ノーショー'}
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

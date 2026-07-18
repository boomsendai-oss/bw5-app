'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Copy, Check, CalendarClock } from 'lucide-react';
import type { TrialGroup } from '@/lib/trialNotify';

type Props = {
  groups: TrialGroup[];
  todayLabel: string; // 'YYYY-MM-DD' (JST今日)
};

export default function TrialCopyList({ groups, todayLabel }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success('コピーしました。LINEで貼り付けて送信してください');
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    } catch {
      toast.error('コピーに失敗しました。テキストを長押しで選択してください');
    }
  };

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          今日以降の体験予約はありません
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const key = `${g.date}|${g.lessonName}`;
        const isToday = g.date === todayLabel;
        const copied = copiedKey === key;
        return (
          <Card key={key} className={isToday ? 'border-brand-400' : ''}>
            <CardContent className="pt-3 pb-3 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {isToday && (
                      <Badge className="bg-brand-100 text-brand-700 border-brand-200" variant="outline">
                        <CalendarClock className="size-3 mr-0.5" />本日
                      </Badge>
                    )}
                    <span className="font-bold text-navy-800">
                      {g.dateLabel} {g.time}〜
                    </span>
                  </div>
                  <div className="text-sm text-neutral-700 mt-0.5">{g.lessonName}</div>
                </div>
                <Button
                  size="sm"
                  onClick={() => copy(key, g.copyText)}
                  className={copied ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-brand-500 hover:bg-brand-600 text-white'}
                >
                  {copied ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}
                  {copied ? 'コピー済' : 'コピー'}
                </Button>
              </div>
              <ul className="text-sm bg-muted rounded p-2 space-y-2">
                {g.visitors.map((v, i) => {
                  const detail = [
                    v.experience && `経験: ${v.experience}`,
                    v.referral && `きっかけ: ${v.referral}`,
                  ].filter(Boolean).join(' ／ ');
                  return (
                    <li key={i}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-navy-800">{v.name}</span>
                        {v.age != null && <span className="text-muted-foreground text-xs">{v.age}歳</span>}
                        {v.isObservation && (
                          <Badge className="bg-amber-100 text-amber-700 border-amber-200" variant="outline">見学</Badge>
                        )}
                      </div>
                      {detail && <div className="text-xs text-muted-foreground mt-0.5">{detail}</div>}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

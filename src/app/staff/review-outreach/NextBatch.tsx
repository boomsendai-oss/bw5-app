'use client';

// 「次にお願いする5家族」(選び方は src/lib/reviewOutreachPick.ts)。
// 送るのは M5 セッション(TAROが M5 のチャットで「送って」)。ここは確認と手動コピー用。
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';

export type NextFamily = {
  familyKey: number;
  greeting: string;
  lineNames: string[];
  memberNames: string[];
  checkins: number;
  lastCheckin: string | null;
  message: string;
};

export default function NextBatch({ families }: { families: NextFamily[] }) {
  const [copied, setCopied] = useState<number | null>(null);

  const copy = async (f: NextFamily) => {
    try {
      await navigator.clipboard.writeText(f.message);
      setCopied(f.familyKey);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      alert('コピーできませんでした');
    }
  };

  return (
    <section className="rounded-lg border border-sand-300 bg-sand-50 p-3 space-y-2">
      <div>
        <h2 className="text-sm font-bold text-navy-800">次にお願いする{families.length}家族</h2>
        <p className="text-[11px] text-muted-foreground">
          入会30日以上・来館2回以上・まだお願いしていない家族を、最近来た順に自動で選んでいます。
          M5のチャットで「送って」と言えば、M5がTAROさんの個人LINEから送ります。
        </p>
      </div>
      {families.length === 0 && <p className="text-sm text-muted-foreground">いま対象の家族はいません。</p>}
      <ul className="space-y-2">
        {families.map((f) => (
          <li key={f.familyKey} className="rounded-md border bg-white p-2 text-slate-900">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">{f.greeting}</div>
                <div className="text-[11px] text-slate-600 break-words">
                  {f.memberNames.join('、')} ・ LINE: {f.lineNames.join(' / ') || '名前未取込'} ・ 来館{f.checkins}回
                  {f.lastCheckin ? `(最終 ${f.lastCheckin})` : ''}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => copy(f)} className="shrink-0">
                {copied === f.familyKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1">文面</span>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

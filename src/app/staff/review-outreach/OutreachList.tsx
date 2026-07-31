'use client';

import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageCircle, Check, Star, Undo2 } from 'lucide-react';
import { setAsked, setPosted } from './actions';

export type Family = {
  key: number;
  name: string; // 保護者名(大人会員は本人名)
  members: { name: string; type: string }[];
  hasLine: boolean;
  asked: string | null;
  posted: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  regular: '月謝',
  college: '学割',
  ticket: 'チケット',
  休会: '休会',
};

type Tab = 'todo' | 'asked' | 'posted';

export default function OutreachList({
  families,
  reviewTotal,
  reviewGoal,
}: {
  families: Family[];
  reviewTotal: number;
  reviewGoal: number;
}) {
  const [tab, setTab] = useState<Tab>('todo');
  const [pendingKey, setPendingKey] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const buckets = useMemo(() => {
    const todo = families.filter((f) => !f.asked && !f.posted);
    const asked = families.filter((f) => f.asked && !f.posted);
    const posted = families.filter((f) => !!f.posted);
    return { todo, asked, posted };
  }, [families]);

  const askedTodayCount = useMemo(() => {
    const today = new Date().toDateString();
    // 投稿済みは除外: 既存投稿者のバックフィル(声がけした→投稿あり)が1日5件ペースを汚さないように
    return families.filter(
      (f) => f.asked && !f.posted && new Date(f.asked).toDateString() === today
    ).length;
  }, [families]);

  const run = (key: number, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setPendingKey(key);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) alert(`更新に失敗しました: ${r.error ?? ''}`);
      setPendingKey(null);
    });
  };

  const list = buckets[tab];

  return (
    <>
      {/* 進捗サマリ */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border bg-brand-50 p-3">
          <div className="text-2xl font-bold text-brand-600">
            {reviewTotal}
            <span className="text-sm font-normal text-muted-foreground"> / {reviewGoal}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">Googleクチコミ(目標=宮城のストリート1位)</div>
        </div>
        <div className="rounded-lg border bg-sand-50 p-3">
          <div className="text-2xl font-bold text-navy-700">{buckets.asked.length}</div>
          <div className="text-[11px] text-muted-foreground">声がけ済み・投稿待ち</div>
        </div>
        <div className="rounded-lg border bg-sand-50 p-3">
          <div className="text-2xl font-bold text-navy-700">{buckets.posted.length}</div>
          <div className="text-[11px] text-muted-foreground">投稿してくれた</div>
        </div>
      </div>

      {/* 今日のペース警告 */}
      <div
        className={`rounded-lg border p-2.5 text-[12px] ${
          askedTodayCount >= 5
            ? 'border-red-300 bg-red-50 text-red-800'
            : 'border-brand-200 bg-brand-50 text-brand-900'
        }`}
      >
        今日の声がけ: <strong>{askedTodayCount} / 5人</strong>
        {askedTodayCount >= 5
          ? ' — 本日分は上限です。続きは明日に(スパムフィルタ対策)'
          : ' — 「お時間あるときでOKです」を添えて送る'}
      </div>

      {/* タブ */}
      <div className="flex gap-1.5">
        {(
          [
            ['todo', `未声がけ (${buckets.todo.length})`],
            ['asked', `投稿待ち (${buckets.asked.length})`],
            ['posted', `投稿済み (${buckets.posted.length})`],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <Button
            key={t}
            size="sm"
            variant={tab === t ? 'default' : 'outline'}
            onClick={() => setTab(t)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* リスト */}
      <div className="space-y-2">
        {list.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {tab === 'todo' ? '全員に声がけ済みです🎉' : 'まだいません'}
          </p>
        )}
        {list.map((f) => {
          const kids = f.members.filter((m) => m.name !== f.name);
          const rowPending = isPending && pendingKey === f.key;
          return (
            <div
              key={f.key}
              className="rounded-lg border bg-white p-3 flex items-center gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium text-navy-800 text-[14px]">{f.name}</span>
                  {f.hasLine && (
                    <MessageCircle className="size-3.5 text-brand-500" aria-label="LINEあり" />
                  )}
                  {[...new Set(f.members.map((m) => m.type))].map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px] px-1 py-0">
                      {TYPE_LABEL[t] ?? t}
                    </Badge>
                  ))}
                </div>
                {kids.length > 0 && (
                  <div className="text-[11px] text-muted-foreground truncate">
                    {kids.map((k) => k.name).join('・')}
                  </div>
                )}
                {tab === 'asked' && f.asked && (
                  <div className="text-[10px] text-muted-foreground">
                    声がけ: {new Date(f.asked).toLocaleDateString('ja-JP')}
                  </div>
                )}
              </div>
              <div className="flex gap-1.5 shrink-0">
                {tab === 'todo' && (
                  <>
                    <Button
                      size="sm"
                      disabled={rowPending}
                      onClick={() => run(f.key, () => setAsked(f.key, true))}
                    >
                      <Check className="size-3.5" /> 声がけした
                    </Button>
                    {/* 既に投稿済みの人のバックフィル用。声がけカウント(1日5件)には乗らない */}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rowPending}
                      onClick={() => run(f.key, () => setPosted(f.key, true))}
                    >
                      <Star className="size-3.5" /> 投稿あり
                    </Button>
                  </>
                )}
                {tab === 'asked' && (
                  <>
                    <Button
                      size="sm"
                      disabled={rowPending}
                      onClick={() => run(f.key, () => setPosted(f.key, true))}
                    >
                      <Star className="size-3.5" /> 投稿あり
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rowPending}
                      onClick={() => run(f.key, () => setAsked(f.key, false))}
                      aria-label="声がけを取り消す"
                    >
                      <Undo2 className="size-3.5" />
                    </Button>
                  </>
                )}
                {tab === 'posted' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={rowPending}
                    onClick={() => run(f.key, () => setPosted(f.key, false))}
                    aria-label="投稿済みを取り消す"
                  >
                    <Undo2 className="size-3.5" /> 取消
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

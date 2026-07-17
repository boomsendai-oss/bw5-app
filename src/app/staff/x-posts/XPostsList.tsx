'use client';

// X投稿 承認キューの操作UI。スマホ片手操作前提(TAROが月2回まとめてタップする)。
// 色はBOOMブランド(brand=ティール操作色 / navy=見出し / sand=淡い背景)。
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Check, X, Undo2, Plus, ExternalLink, Clock } from 'lucide-react';
import {
  splitThreadText,
  joinThreadParts,
  utcIsoToJstInput,
  formatJst,
  tweetWeightedLength,
  TWEET_MAX_WEIGHTED,
  type XPostStatus,
} from '@/lib/xPosts';
import { approvePost, createDraft, rejectPost, revertToDraft, updateDraft } from './actions';

export type XPostView = {
  id: number;
  account: string;
  parts: string[];
  scheduledAt: string | null;
  status: XPostStatus;
  postedTweetIds: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type Tab = 'draft' | 'approved' | 'posted' | 'failed' | 'rejected';

const TABS: { key: Tab; label: string }[] = [
  { key: 'draft', label: '下書き' },
  { key: 'approved', label: '予約中' },
  { key: 'posted', label: '投稿済み' },
  { key: 'failed', label: '失敗' },
  { key: 'rejected', label: 'ボツ' },
];

type ActionResult = { ok: boolean; error?: string };

function scheduleLabel(iso: string | null): string {
  return iso ? `${formatJst(iso)} に自動投稿` : '予約なし(手動トリガー待ち)';
}

/** ツリー本文の読み取り専用プレビュー(連番付き) */
function PartsPreview({ parts }: { parts: string[] }) {
  return (
    <div className="space-y-1.5">
      {parts.map((p, i) => (
        <div key={i} className="rounded-md bg-sand-50 border border-sand-100 px-3 py-2">
          {parts.length > 1 && (
            <div className="text-[10px] font-semibold text-neutral-400 mb-0.5">
              {i + 1}/{parts.length}
            </div>
          )}
          <p className="text-sm whitespace-pre-wrap break-words">{p}</p>
        </div>
      ))}
    </div>
  );
}

/** 下書きカード: 本文インライン編集 + 予約日時編集 + 承認/ボツ */
function DraftCard({ post, run, busy }: { post: XPostView; run: Runner; busy: boolean }) {
  const [text, setText] = useState(() => joinThreadParts(post.parts));
  const [sched, setSched] = useState(() => (post.scheduledAt ? utcIsoToJstInput(post.scheduledAt) : ''));
  const dirty =
    text !== joinThreadParts(post.parts) ||
    sched !== (post.scheduledAt ? utcIsoToJstInput(post.scheduledAt) : '');
  const parts = useMemo(() => splitThreadText(text), [text]);

  // 承認: 編集中なら保存してから承認する(片手操作でタップ数を減らす)
  const approve = () =>
    run(post.id, async () => {
      if (dirty) {
        const r = await updateDraft(post.id, text, sched);
        if (!r.ok) return r;
      }
      return approvePost(post.id);
    });

  return (
    <div className="rounded-lg border bg-white p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-400">#{post.id}</span>
        {parts.length > 1 && <Badge variant="secondary">ツリー {parts.length}本</Badge>}
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(14, Math.max(4, text.split('\n').length + 1))}
        className="text-sm"
        placeholder="本文(空行2つでツリー分割)"
      />
      {/* 分割プレビュー + 文字数目安 */}
      <div className="flex flex-wrap gap-1.5">
        {parts.map((p, i) => {
          const w = tweetWeightedLength(p);
          const over = w > TWEET_MAX_WEIGHTED;
          return (
            <span
              key={i}
              className={`text-[11px] rounded-full px-2 py-0.5 border ${
                over ? 'bg-red-50 border-red-200 text-red-600 font-semibold' : 'bg-sand-50 border-sand-200 text-neutral-500'
              }`}
            >
              {parts.length > 1 ? `${i + 1}本目 ` : ''}
              {w}/{TWEET_MAX_WEIGHTED}
              {over && ' 超過'}
            </span>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Clock className="size-4 shrink-0 text-neutral-400" />
        <Input
          type="datetime-local"
          value={sched}
          onChange={(e) => setSched(e.target.value)}
          className="h-10 text-sm"
          aria-label="予約日時(JST)"
        />
        {sched && (
          <Button type="button" variant="ghost" size="sm" className="shrink-0 text-neutral-400" onClick={() => setSched('')}>
            クリア
          </Button>
        )}
      </div>
      <p className="text-[11px] text-neutral-400">予約なしのまま承認すると自動投稿されません(手動トリガー待ち)</p>
      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          className="h-11 flex-1 bg-brand-600 hover:bg-brand-700 text-white"
          disabled={busy || parts.length === 0}
          onClick={approve}
        >
          <Check className="size-4" />
          {dirty ? '保存して承認' : '承認'}
        </Button>
        {dirty && (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={() => run(post.id, () => updateDraft(post.id, text, sched))}
          >
            保存
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-11 text-neutral-500"
          disabled={busy}
          onClick={() => run(post.id, () => rejectPost(post.id))}
        >
          <X className="size-4" />
          ボツ
        </Button>
      </div>
    </div>
  );
}

type Runner = (id: number, fn: () => Promise<ActionResult>) => void;

export default function XPostsList({ posts }: { posts: XPostView[] }) {
  const [tab, setTab] = useState<Tab>('draft');
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [newText, setNewText] = useState('');
  const [newSched, setNewSched] = useState('');

  const buckets = useMemo(() => {
    const b: Record<Tab, XPostView[]> = { draft: [], approved: [], posted: [], failed: [], rejected: [] };
    for (const p of posts) {
      // 'posting' はcron処理中(通常は数秒)。残骸=途中クラッシュの可能性があるため失敗タブに出す
      const key: Tab = p.status === 'posting' ? 'failed' : (p.status as Tab);
      b[key].push(p);
    }
    // 予約中は投稿が近い順(予約なしは後ろ)
    b.approved.sort((a, z) => (a.scheduledAt ?? '9999') < (z.scheduledAt ?? '9999') ? -1 : 1);
    return b;
  }, [posts]);

  const run: Runner = (id, fn) => {
    setPendingId(id);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) toast.error(`更新に失敗: ${r.error ?? ''}`);
      setPendingId(null);
    });
  };

  const submitNew = () => {
    setPendingId(-1);
    startTransition(async () => {
      const r = await createDraft(newText, newSched);
      if (r.ok) {
        toast.success('下書きを追加しました');
        setNewText('');
        setNewSched('');
        setFormOpen(false);
      } else {
        toast.error(`追加に失敗: ${r.error ?? ''}`);
      }
      setPendingId(null);
    });
  };

  const list = buckets[tab];

  return (
    <>
      {/* 新規下書きの手動追加 */}
      <div className="rounded-lg border bg-white">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-brand-700"
          onClick={() => setFormOpen((v) => !v)}
        >
          <Plus className="size-4" />
          下書きを手動追加
        </button>
        {formOpen && (
          <div className="px-3 pb-3 space-y-2">
            <Textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              rows={5}
              className="text-sm"
              placeholder={'本文を入力。空行2つ(Enter 3回)でツリー分割\n\n\n2本目のツイート…'}
            />
            <div className="flex items-center gap-2">
              <Clock className="size-4 shrink-0 text-neutral-400" />
              <Input
                type="datetime-local"
                value={newSched}
                onChange={(e) => setNewSched(e.target.value)}
                className="h-10 text-sm"
                aria-label="予約日時(JST)"
              />
            </div>
            <Button
              type="button"
              className="h-11 w-full bg-brand-600 hover:bg-brand-700 text-white"
              disabled={pendingId !== null || splitThreadText(newText).length === 0}
              onClick={submitNew}
            >
              下書きに追加
            </Button>
          </div>
        )}
      </div>

      {/* ステータスタブ */}
      <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium border transition-colors ${
              tab === t.key
                ? 'bg-navy-700 border-navy-700 text-white'
                : 'bg-white border-sand-200 text-neutral-600'
            }`}
          >
            {t.label}
            <span className={`ml-1 text-xs ${tab === t.key ? 'text-white/70' : 'text-neutral-400'}`}>
              {buckets[t.key].length}
            </span>
          </button>
        ))}
      </div>

      {list.length === 0 && (
        <p className="text-sm text-neutral-400 text-center py-8">
          {tab === 'draft' ? '承認待ちの下書きはありません' : 'このステータスの投稿はありません'}
        </p>
      )}

      <div className="space-y-3">
        {list.map((post) => {
          const busy = pendingId !== null;
          if (post.status === 'draft') {
            return <DraftCard key={`${post.id}-${post.updatedAt}`} post={post} run={run} busy={busy} />;
          }
          return (
            <div key={post.id} className="rounded-lg border bg-white p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-400">#{post.id}</span>
                <div className="flex items-center gap-1.5">
                  {post.parts.length > 1 && <Badge variant="secondary">ツリー {post.parts.length}本</Badge>}
                  {post.status === 'posting' && <Badge className="bg-amber-100 text-amber-700">処理中/中断?</Badge>}
                </div>
              </div>

              <PartsPreview parts={post.parts} />

              {(post.status === 'approved' || post.status === 'posting') && (
                <p className="text-xs font-medium text-brand-700 flex items-center gap-1">
                  <Clock className="size-3.5" />
                  {scheduleLabel(post.scheduledAt)}
                </p>
              )}

              {post.status === 'posted' && post.postedTweetIds.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {post.postedTweetIds.map((tid, i) => (
                    <a
                      key={tid}
                      href={`https://x.com/i/web/status/${tid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-brand-600 underline"
                    >
                      <ExternalLink className="size-3" />
                      {post.postedTweetIds.length > 1 ? `${i + 1}本目を開く` : 'ポストを開く'}
                    </a>
                  ))}
                </div>
              )}

              {post.status === 'failed' && post.error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-2.5 py-1.5 break-words">
                  {post.error}
                  {post.postedTweetIds.length > 0 && (
                    <span className="block mt-1 text-red-500">
                      ※ ツリーの{post.postedTweetIds.length}本目までは投稿済み。差し戻し前にX側を確認
                    </span>
                  )}
                </p>
              )}

              {(post.status === 'approved' || post.status === 'failed' || post.status === 'rejected' || post.status === 'posting') && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full text-neutral-600"
                  disabled={pendingId !== null}
                  onClick={() => run(post.id, () => revertToDraft(post.id))}
                >
                  <Undo2 className="size-4" />
                  {post.status === 'approved' ? '差し戻し(下書きへ)' : '下書きに戻す'}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

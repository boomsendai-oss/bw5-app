'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { extractOriginalComment } from '@/lib/gbpText';

type Review = {
  review_id: string;
  reviewer_name: string | null;
  star_rating: number | null;
  comment: string | null;
  create_time: string | null;
  reply_comment: string | null;
  reply_time: string | null;
  status: 'new' | 'draft_ready' | 'posted' | 'skipped';
  draft: string | null;
  drafted_at: string | null;
  posted_at: string | null;
};

const STATUS_LABEL: Record<Review['status'], { label: string; cls: string }> = {
  draft_ready: { label: '承認待ち', cls: 'bg-brand-100 text-brand-700' },
  new: { label: 'ドラフト生成待ち', cls: 'bg-yellow-100 text-yellow-700' },
  posted: { label: '返信済み', cls: 'bg-green-100 text-green-700' },
  skipped: { label: 'スキップ', cls: 'bg-gray-100 text-gray-500' },
};

function Stars({ n }: { n: number | null }) {
  const v = n ?? 0;
  return (
    <span className={v <= 2 ? 'text-red-500' : 'text-amber-500'}>
      {'★'.repeat(v)}
      <span className="text-gray-300">{'★'.repeat(Math.max(0, 5 - v))}</span>
    </span>
  );
}

export default function GbpReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; ok: boolean; msg: string } | null>(null);
  const [gbpConfigured, setGbpConfigured] = useState(true);
  const [draftConfigured, setDraftConfigured] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff/gbp-reviews', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setReviews(json.reviews ?? []);
      setGbpConfigured(!!json.gbp_configured);
      setDraftConfigured(!!json.draft_configured);
    } catch {
      setFeedback({ id: '', ok: false, msg: '一覧の取得に失敗しました' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (r: Review) => {
    const comment = (edits[r.review_id] ?? r.draft ?? '').trim();
    if (!comment) {
      setFeedback({ id: r.review_id, ok: false, msg: '返信本文が空です' });
      return;
    }
    if (!window.confirm('この内容でGoogleに公開返信を投稿します。よろしいですか？')) return;
    setBusy(r.review_id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/staff/gbp-reviews/${encodeURIComponent(r.review_id)}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setFeedback({ id: r.review_id, ok: true, msg: '✅ 投稿しました' });
      await load();
    } catch (e) {
      setFeedback({ id: r.review_id, ok: false, msg: `投稿失敗: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const skip = async (r: Review) => {
    setBusy(r.review_id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/staff/gbp-reviews/${encodeURIComponent(r.review_id)}/skip`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setFeedback({ id: r.review_id, ok: false, msg: `スキップ失敗: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const pendingCount = reviews.filter((r) => r.status === 'draft_ready' || r.status === 'new').length;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">クチコミ返信</h1>
          <p className="text-sm text-gray-500">Googleクチコミの承認キュー — 未対応 {pendingCount} 件</p>
        </div>
        <Link href="/staff" className="rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          ホーム
        </Link>
      </div>

      {!gbpConfigured && (
        <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          ⏳ GBP APIのアクセス承認待ちです。承認が下りるまで取込・投稿は動きません(画面と仕組みは準備済み)。
        </div>
      )}
      {gbpConfigured && !draftConfigured && (
        <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          ANTHROPIC_API_KEY が未設定のため、ドラフト自動生成は動きません。
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-gray-400">読み込み中...</p>
      ) : reviews.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">クチコミはまだ取り込まれていません</p>
      ) : (
        <div className="space-y-4">
          {reviews.map((r) => {
            const st = STATUS_LABEL[r.status];
            const editable = r.status === 'draft_ready' || r.status === 'new';
            const lowRating = (r.star_rating ?? 5) <= 2;
            return (
              <div
                key={r.review_id}
                className={`rounded-xl border bg-white p-4 shadow-sm ${lowRating && editable ? 'border-red-300' : 'border-gray-200'}`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Stars n={r.star_rating} />
                  <span className="text-sm font-medium text-gray-800">{r.reviewer_name || '(匿名)'}</span>
                  <span className="text-xs text-gray-400">{(r.create_time ?? '').slice(0, 10)}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                  {lowRating && editable && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">
                      ⚠️ 低評価 — スタッフ確認必須
                    </span>
                  )}
                </div>

                <p className="mb-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                  {extractOriginalComment(r.comment) || '(本文なし・星評価のみ)'}
                </p>

                {editable ? (
                  <>
                    <label className="mb-1 block text-xs font-medium text-gray-500">
                      返信ドラフト{r.status === 'new' ? ' (自動生成待ち — 手書きでも投稿できます)' : ' (編集できます)'}
                    </label>
                    <textarea
                      className="w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-brand-500 focus:outline-none"
                      rows={5}
                      value={edits[r.review_id] ?? r.draft ?? ''}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [r.review_id]: e.target.value }))}
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => approve(r)}
                        disabled={busy === r.review_id || !gbpConfigured}
                        className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
                      >
                        {busy === r.review_id ? '投稿中...' : '承認して投稿'}
                      </button>
                      <button
                        onClick={() => skip(r)}
                        disabled={busy === r.review_id}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                      >
                        スキップ
                      </button>
                      {feedback && feedback.id === r.review_id && (
                        <span className={`text-sm ${feedback.ok ? 'text-green-600' : 'text-red-600'}`}>{feedback.msg}</span>
                      )}
                    </div>
                  </>
                ) : (
                  r.reply_comment && (
                    <div className="rounded-lg border border-green-100 bg-green-50 p-3">
                      <p className="mb-1 text-xs font-medium text-green-700">返信済み {(r.posted_at ?? r.reply_time ?? '').slice(0, 10)}</p>
                      <p className="whitespace-pre-wrap text-sm text-gray-700">{r.reply_comment}</p>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      {feedback && feedback.id === '' && (
        <p className="mt-4 text-center text-sm text-red-600">{feedback.msg}</p>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type BlogPost = {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content_markdown?: string | null;
  keywords: string | null;
  cover_image_url: string | null;
  author: string | null;
  category: string | null;
  is_published: number;
  auto_generated: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type EditState = Partial<BlogPost> & { content_markdown?: string | null };

function toDatetimeLocal(v: string | null | undefined): string {
  if (!v) return '';
  // 期待: 'YYYY-MM-DD HH:MM:SS' or ISO
  const d = new Date(v.replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(v: string): string | null {
  if (!v) return null;
  // 'YYYY-MM-DDTHH:MM' → 'YYYY-MM-DD HH:MM:00'
  return v.replace('T', ' ') + ':00';
}

export default function StaffBlogPage() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<EditState | null>(null);
  const [slugLocked, setSlugLocked] = useState(true);
  const [originalSlug, setOriginalSlug] = useState<string | null>(null);
  const [hpDeploying, setHpDeploying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/staff/blog', { credentials: 'include' });
      if (r.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/blog';
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setPosts(d.posts || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openNew = () => {
    setEditing({
      slug: '',
      title: '',
      excerpt: '',
      content_markdown: '',
      keywords: '',
      cover_image_url: '',
      author: '',
      category: '',
      is_published: 0,
      published_at: null,
    });
    setSlugLocked(false);
    setOriginalSlug(null);
  };

  const openEdit = async (id: number) => {
    const r = await fetch(`/api/staff/blog/${id}`, { credentials: 'include' });
    if (!r.ok) { setMsg('読み込み失敗'); return; }
    const d = await r.json();
    setEditing(d.post);
    setSlugLocked(true);
    setOriginalSlug(d.post.slug ?? null);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.slug || !editing.title) {
      setMsg('slug と title は必須です');
      return;
    }
    if (editing.id && originalSlug && editing.slug !== originalSlug) {
      const ok = confirm(
        `slug を変更しようとしています\n\n` +
          `旧: ${originalSlug}\n新: ${editing.slug}\n\n` +
          `変更すると現在のURLが 404 になります。よろしいですか？`
      );
      if (!ok) return;
    }
    const payload = {
      slug: editing.slug,
      title: editing.title,
      excerpt: editing.excerpt ?? null,
      content_markdown: editing.content_markdown ?? null,
      keywords: editing.keywords ?? null,
      cover_image_url: editing.cover_image_url ?? null,
      author: editing.author ?? null,
      category: editing.category ?? null,
      is_published: editing.is_published ? 1 : 0,
      published_at: editing.published_at ?? null,
    };

    // 楽観的更新
    const snapshot = posts;
    try {
      if (editing.id) {
        setPosts(posts.map(p => (p.id === editing.id ? { ...p, ...payload } as BlogPost : p)));
        const r = await fetch(`/api/staff/blog/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setMsg('保存しました');
      } else {
        const r = await fetch('/api/staff/blog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        setMsg('作成しました');
        await load();
      }
      setEditing(null);
    } catch (e) {
      setPosts(snapshot);
      setMsg('保存失敗: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const remove = async (p: BlogPost) => {
    if (!confirm(`「${p.title}」を削除しますか？\nslug: ${p.slug}`)) return;
    const snapshot = posts;
    setPosts(posts.filter(x => x.id !== p.id));
    try {
      const r = await fetch(`/api/staff/blog/${p.id}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMsg('削除しました');
    } catch (e) {
      setPosts(snapshot);
      setMsg('削除失敗: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const deployHp = async () => {
    setHpDeploying(true);
    setMsg('');
    try {
      const r = await fetch('/api/staff/hp-deploy', {
        method: 'POST',
        credentials: 'include',
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setMsg(d.message || 'HP再デプロイを開始しました');
    } catch (e) {
      setMsg('HP反映失敗: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setHpDeploying(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="bg-white border-b border-orange-100 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-3">
            <Link href="/staff" className="text-xs text-orange-600 hover:underline">← スタッフ</Link>
            <h1 className="text-lg sm:text-xl font-bold text-orange-600">📝 ブログ記事管理</h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={deployHp}
              disabled={hpDeploying}
              className="px-3 py-1.5 text-xs sm:text-sm rounded bg-white border border-orange-300 text-orange-700 hover:bg-orange-50 disabled:opacity-50"
            >
              {hpDeploying ? '反映中...' : '🚀 HPに反映'}
            </button>
            <button
              onClick={openNew}
              className="px-3 py-1.5 text-xs sm:text-sm rounded bg-orange-500 text-white hover:bg-orange-600"
            >
              ＋ 新規作成
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        {err && (
          <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
            読込エラー: {err}
          </div>
        )}
        {msg && (
          <div className="mb-4 p-3 rounded bg-orange-50 border border-orange-200 text-orange-800 text-sm">
            {msg}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-neutral-500">読込中...</p>
        ) : posts.length === 0 ? (
          <p className="text-sm text-neutral-500">記事がありません。</p>
        ) : (
          <div className="bg-white rounded-xl border border-neutral-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-orange-50 text-orange-800 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">タイトル / slug</th>
                  <th className="px-3 py-2 text-left">カテゴリ</th>
                  <th className="px-3 py-2 text-left">公開</th>
                  <th className="px-3 py-2 text-left">自動</th>
                  <th className="px-3 py-2 text-left">公開日</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {posts.map(p => (
                  <tr key={p.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2">
                      <div className="font-medium text-neutral-900">{p.title}</div>
                      <div className="text-xs text-neutral-500 font-mono">/{p.slug}</div>
                    </td>
                    <td className="px-3 py-2 text-neutral-700">{p.category || '-'}</td>
                    <td className="px-3 py-2">
                      {p.is_published ? (
                        <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs">公開</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 text-xs">下書き</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {p.auto_generated ? (
                        <span className="text-xs text-purple-700">🤖 自動</span>
                      ) : (
                        <span className="text-xs text-neutral-400">手動</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-600">
                      {p.published_at ? new Date(p.published_at.replace(' ', 'T')).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => openEdit(p.id)}
                        className="px-2 py-1 text-xs rounded bg-white border border-orange-300 text-orange-700 hover:bg-orange-50 mr-1"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => remove(p)}
                        className="px-2 py-1 text-xs rounded bg-white border border-red-300 text-red-700 hover:bg-red-50"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 編集モーダル */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-20 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-3xl my-4 max-h-[95vh] flex flex-col">
            <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
              <h2 className="font-bold text-orange-700">
                {editing.id ? `編集: ${editing.title || ''}` : '新規記事'}
              </h2>
              <button
                onClick={() => setEditing(null)}
                className="text-neutral-500 hover:text-neutral-800 text-xl leading-none"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-3">
              {/* slug */}
              <div>
                {slugLocked ? (
                  <div>
                    <span className="text-xs text-neutral-600">slug (URL用。基本変更不要)</span>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        readOnly
                        value={editing.slug ?? ''}
                        className="flex-1 px-2 py-1.5 text-sm border border-neutral-200 rounded bg-neutral-50 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const ok = confirm(
                            `⚠️ slug を変更しようとしています\n\n` +
                              `現在: ${originalSlug ?? ''}\n\n` +
                              `slug を変更すると現在のURLが 404 になります。本当に変更しますか？`
                          );
                          if (ok) setSlugLocked(false);
                        }}
                        className="px-2 py-1 text-xs rounded bg-white border border-amber-300 text-amber-700 hover:bg-amber-50"
                      >
                        🔓 変更
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="block">
                    <span className="text-xs text-neutral-600">
                      slug (URL用。半角英数推奨。スペース・/・?・# は避ける)
                    </span>
                    <input
                      value={editing.slug ?? ''}
                      onChange={e => setEditing({ ...editing, slug: e.target.value })}
                      className="w-full mt-1 px-2 py-1.5 text-sm border border-neutral-300 rounded font-mono"
                      placeholder="my-blog-post"
                    />
                  </label>
                )}
              </div>

              {/* title */}
              <label className="block">
                <span className="text-xs text-neutral-600">タイトル</span>
                <input
                  value={editing.title ?? ''}
                  onChange={e => setEditing({ ...editing, title: e.target.value })}
                  className="w-full mt-1 px-2 py-1.5 text-sm border border-neutral-300 rounded"
                />
              </label>

              {/* excerpt */}
              <label className="block">
                <span className="text-xs text-neutral-600">抜粋 (excerpt)</span>
                <textarea
                  value={editing.excerpt ?? ''}
                  onChange={e => setEditing({ ...editing, excerpt: e.target.value })}
                  rows={2}
                  className="w-full mt-1 px-2 py-1.5 text-sm border border-neutral-300 rounded"
                />
              </label>

              {/* content_markdown */}
              <label className="block">
                <span className="text-xs text-neutral-600">本文 (Markdown)</span>
                <textarea
                  value={editing.content_markdown ?? ''}
                  onChange={e => setEditing({ ...editing, content_markdown: e.target.value })}
                  rows={18}
                  className="w-full mt-1 px-2 py-1.5 text-sm border border-neutral-300 rounded"
                  style={{ fontFamily: 'monospace' }}
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-neutral-600">キーワード (カンマ区切り)</span>
                  <input
                    value={editing.keywords ?? ''}
                    onChange={e => setEditing({ ...editing, keywords: e.target.value })}
                    className="w-full mt-1 px-2 py-1.5 text-sm border border-neutral-300 rounded"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-neutral-600">カテゴリ</span>
                  <input
                    value={editing.category ?? ''}
                    onChange={e => setEditing({ ...editing, category: e.target.value })}
                    className="w-full mt-1 px-2 py-1.5 text-sm border border-neutral-300 rounded"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs text-neutral-600">カバー画像 URL</span>
                  <input
                    value={editing.cover_image_url ?? ''}
                    onChange={e => setEditing({ ...editing, cover_image_url: e.target.value })}
                    className="w-full mt-1 px-2 py-1.5 text-sm border border-neutral-300 rounded font-mono"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-neutral-600">著者</span>
                  <input
                    value={editing.author ?? ''}
                    onChange={e => setEditing({ ...editing, author: e.target.value })}
                    className="w-full mt-1 px-2 py-1.5 text-sm border border-neutral-300 rounded"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-neutral-600">公開日時</span>
                  <input
                    type="datetime-local"
                    value={toDatetimeLocal(editing.published_at)}
                    onChange={e => setEditing({ ...editing, published_at: fromDatetimeLocal(e.target.value) })}
                    className="w-full mt-1 px-2 py-1.5 text-sm border border-neutral-300 rounded"
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 mt-2">
                <input
                  type="checkbox"
                  checked={!!editing.is_published}
                  onChange={e => setEditing({ ...editing, is_published: e.target.checked ? 1 : 0 })}
                />
                <span className="text-sm">公開する (is_published)</span>
              </label>
            </div>

            <div className="px-4 py-3 border-t border-neutral-200 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-1.5 text-sm rounded bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
              >
                キャンセル
              </button>
              <button
                onClick={save}
                className="px-4 py-1.5 text-sm rounded bg-orange-500 text-white hover:bg-orange-600"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

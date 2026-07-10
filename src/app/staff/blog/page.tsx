'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { FileText, Plus, Rocket, Pencil, Trash2, Lock, Bot, ArrowLeft } from 'lucide-react';

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
  const d = new Date(v.replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(v: string): string | null {
  if (!v) return null;
  return v.replace('T', ' ') + ':00';
}

type DeleteTarget = BlogPost | null;
type SlugChangeConfirm = { editing: EditState; payload: Record<string, unknown> } | null;

export default function StaffBlogPage() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [slugLocked, setSlugLocked] = useState(true);
  const [originalSlug, setOriginalSlug] = useState<string | null>(null);
  const [hpDeploying, setHpDeploying] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [slugConfirm, setSlugConfirm] = useState<SlugChangeConfirm>(null);
  const [slugUnlockConfirm, setSlugUnlockConfirm] = useState(false);

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
      toast.error(e instanceof Error ? e.message : String(e));
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
    if (!r.ok) { toast.error('読み込み失敗'); return; }
    const d = await r.json();
    setEditing(d.post);
    setSlugLocked(true);
    setOriginalSlug(d.post.slug ?? null);
  };

  const buildPayload = () => {
    if (!editing) return null;
    return {
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
  };

  const save = async (payload?: Record<string, unknown>) => {
    if (!editing) return;
    if (!editing.slug || !editing.title) {
      toast.error('slug と title は必須です');
      return;
    }
    const finalPayload = payload ?? buildPayload();
    if (!finalPayload) return;

    // Check slug change confirmation
    if (!payload && editing.id && originalSlug && editing.slug !== originalSlug) {
      setSlugConfirm({ editing, payload: finalPayload });
      return;
    }

    const snapshot = posts;
    try {
      if (editing.id) {
        setPosts(posts.map(p => (p.id === editing.id ? { ...p, ...finalPayload } as BlogPost : p)));
        const r = await fetch(`/api/staff/blog/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(finalPayload),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        toast.success('保存しました');
      } else {
        const r = await fetch('/api/staff/blog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(finalPayload),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        toast.success('作成しました');
        await load();
      }
      setEditing(null);
    } catch (e) {
      setPosts(snapshot);
      toast.error('保存失敗: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    const p = deleteTarget;
    setDeleteTarget(null);
    const snapshot = posts;
    setPosts(posts.filter(x => x.id !== p.id));
    try {
      const r = await fetch(`/api/staff/blog/${p.id}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success('削除しました');
    } catch (e) {
      setPosts(snapshot);
      toast.error('削除失敗: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const deployHp = async () => {
    setHpDeploying(true);
    try {
      const r = await fetch('/api/staff/hp-deploy', {
        method: 'POST',
        credentials: 'include',
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      toast.success(d.message || 'HP再デプロイを開始しました');
    } catch (e) {
      toast.error('HP反映失敗: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setHpDeploying(false);
    }
  };

  return (
    <div>
      <header className="bg-card border-b px-4 py-3 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-3">
            <Link href="/staff" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
              <ArrowLeft className="size-3" />スタッフ
            </Link>
            <h1 className="text-lg sm:text-xl font-bold text-brand-600 flex items-center gap-2">
              <FileText className="size-5" />ブログ記事管理
            </h1>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={deployHp}
              disabled={hpDeploying}
            >
              <Rocket className="size-3.5 mr-1" />
              {hpDeploying ? '反映中...' : 'HPに反映'}
            </Button>
            <Button size="sm" onClick={openNew}>
              <Plus className="size-3.5 mr-1" />新規作成
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">読込中...</p>
        ) : posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">記事がありません。</p>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>タイトル / slug</TableHead>
                  <TableHead>カテゴリ</TableHead>
                  <TableHead>公開</TableHead>
                  <TableHead>自動</TableHead>
                  <TableHead>公開日</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {posts.map(p => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">{p.title}</div>
                      <div className="text-xs text-muted-foreground font-mono">/{p.slug}</div>
                    </TableCell>
                    <TableCell>{p.category || '-'}</TableCell>
                    <TableCell>
                      {p.is_published ? (
                        <Badge className="bg-green-100 text-green-800" variant="outline">公開</Badge>
                      ) : (
                        <Badge variant="secondary">下書き</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.auto_generated ? (
                        <Badge variant="secondary" className="bg-purple-50 text-purple-700"><Bot className="size-3 mr-0.5" />自動</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">手動</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.published_at ? new Date(p.published_at.replace(' ', 'T')).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '-'}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="outline" size="xs" onClick={() => openEdit(p.id)} className="mr-1">
                        <Pencil className="size-3 mr-0.5" />編集
                      </Button>
                      <Button variant="destructive" size="xs" onClick={() => setDeleteTarget(p)}>
                        <Trash2 className="size-3 mr-0.5" />削除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-3xl max-h-[95vh] flex flex-col" showCloseButton>
          <DialogHeader>
            <DialogTitle className="text-brand-700">
              {editing?.id ? `編集: ${editing.title || ''}` : '新規記事'}
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 space-y-3 pr-1">
            {/* slug */}
            <div>
              {slugLocked ? (
                <div className="space-y-1">
                  <Label className="text-xs">slug (URL用。基本変更不要)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={editing?.slug ?? ''}
                      className="flex-1 bg-muted font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => setSlugUnlockConfirm(true)}
                      className="border-amber-300 text-amber-700 hover:bg-amber-50"
                    >
                      <Lock className="size-3 mr-0.5" />変更
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs">
                    slug (URL用。半角英数推奨。スペース・/・?・# は避ける)
                  </Label>
                  <Input
                    value={editing?.slug ?? ''}
                    onChange={e => setEditing(prev => prev ? { ...prev, slug: e.target.value } : prev)}
                    className="font-mono"
                    placeholder="my-blog-post"
                  />
                </div>
              )}
            </div>

            {/* title */}
            <div className="space-y-1">
              <Label className="text-xs">タイトル</Label>
              <Input
                value={editing?.title ?? ''}
                onChange={e => setEditing(prev => prev ? { ...prev, title: e.target.value } : prev)}
              />
            </div>

            {/* excerpt */}
            <div className="space-y-1">
              <Label className="text-xs">抜粋 (excerpt)</Label>
              <Textarea
                value={editing?.excerpt ?? ''}
                onChange={e => setEditing(prev => prev ? { ...prev, excerpt: e.target.value } : prev)}
                rows={2}
              />
            </div>

            {/* content_markdown */}
            <div className="space-y-1">
              <Label className="text-xs">本文 (Markdown)</Label>
              <Textarea
                value={editing?.content_markdown ?? ''}
                onChange={e => setEditing(prev => prev ? { ...prev, content_markdown: e.target.value } : prev)}
                rows={18}
                className="font-mono"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">キーワード (カンマ区切り)</Label>
                <Input
                  value={editing?.keywords ?? ''}
                  onChange={e => setEditing(prev => prev ? { ...prev, keywords: e.target.value } : prev)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">カテゴリ</Label>
                <Input
                  value={editing?.category ?? ''}
                  onChange={e => setEditing(prev => prev ? { ...prev, category: e.target.value } : prev)}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">カバー画像 URL</Label>
                <Input
                  value={editing?.cover_image_url ?? ''}
                  onChange={e => setEditing(prev => prev ? { ...prev, cover_image_url: e.target.value } : prev)}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">著者</Label>
                <Input
                  value={editing?.author ?? ''}
                  onChange={e => setEditing(prev => prev ? { ...prev, author: e.target.value } : prev)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">公開日時</Label>
                <Input
                  type="datetime-local"
                  value={toDatetimeLocal(editing?.published_at)}
                  onChange={e => setEditing(prev => prev ? { ...prev, published_at: fromDatetimeLocal(e.target.value) } : prev)}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={!!editing?.is_published}
                onChange={e => setEditing(prev => prev ? { ...prev, is_published: e.target.checked ? 1 : 0 } : prev)}
              />
              <span className="text-sm">公開する (is_published)</span>
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>キャンセル</Button>
            <Button onClick={() => save()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>削除確認</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && <>「{deleteTarget.title}」を削除しますか?<br />slug: {deleteTarget.slug}</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={executeDelete} variant="destructive">削除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Slug change confirmation */}
      <AlertDialog open={!!slugConfirm} onOpenChange={(open) => { if (!open) setSlugConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>slug 変更確認</AlertDialogTitle>
            <AlertDialogDescription>
              slug を変更しようとしています<br /><br />
              旧: {originalSlug}<br />
              新: {slugConfirm?.editing.slug}<br /><br />
              変更すると現在のURLが 404 になります。よろしいですか?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const p = slugConfirm?.payload; setSlugConfirm(null); if (p) save(p); }}>
              変更して保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Slug unlock confirmation */}
      <AlertDialog open={slugUnlockConfirm} onOpenChange={setSlugUnlockConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>slug 変更の警告</AlertDialogTitle>
            <AlertDialogDescription>
              slug を変更すると現在のURLが 404 になります。<br />
              現在: {originalSlug ?? ''}<br /><br />
              本当に変更しますか?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setSlugUnlockConfirm(false); setSlugLocked(false); }}>
              変更する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';

// プレビュー画面から「この内容で公開する」を押せるボタン (2026-09-02)。
// TARO「チェックしたあと投稿するボタンは無いの？」→ 一覧の編集モーダルまで戻らずに公開できるように。
// やること: ①既存API PATCH /api/staff/blog/[id] で is_published=1(公開日時は空なら自動で今)
//          ②既存API POST /api/staff/hp-deploy でHPを再ビルド(数分で本番に出る。押さなくても6時間毎の自動ビルドで出る)
// 何もしなければ下書きのまま。勝手に公開されることはない。
export default function PublishButton({ id, slug, title }: { id: number; slug: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const publish = async () => {
    if (!window.confirm(`この記事を公開します。\n\n「${title}」\n\n公開後は boom-sendai.com/blog/${slug}/ に出ます。よろしいですか？`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/staff/blog/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_published: 1 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);

      // HPの再ビルドを蹴る(失敗しても公開自体は済んでいる=6時間毎の自動ビルドで出る)
      let deployNote = '';
      try {
        const dr = await fetch('/api/staff/hp-deploy', { method: 'POST', credentials: 'include' });
        deployNote = dr.ok ? '3〜5分ほどでHPに反映されます。' : 'HPには次の自動ビルド(最大6時間)で反映されます。';
      } catch {
        deployNote = 'HPには次の自動ビルド(最大6時間)で反映されます。';
      }
      toast.success(`公開にしました。${deployNote}`);
      router.refresh();
    } catch (e) {
      toast.error('公開に失敗しました: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button onClick={publish} disabled={busy} className="bg-brand-600 hover:bg-brand-700 text-white font-bold">
      <Rocket className="size-4 mr-1" />
      {busy ? '公開しています…' : 'この内容で公開する'}
    </Button>
  );
}

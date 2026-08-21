'use client';

// Tシャツ注文の設定画面。受付ON/OFF・受付期間・価格・文言・商品画像の差し替え。
import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import StaffPageHeader from '@/components/StaffPageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { getTshirtSettings, putTshirtSettings } from '../actions';
import type { TshirtSettings } from '@/lib/tshirtOrder';

export default function TshirtSettingsPage() {
  const [s, setS] = useState<TshirtSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setS(await getTshirtSettings());
    } catch {
      window.location.href = '/staff/events/login?next=/staff/merch/tshirt/settings';
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      const res = await putTshirtSettings(s);
      if (res.ok) toast.success('保存しました');
      else toast.error(res.error);
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof TshirtSettings>(k: K, v: TshirtSettings[K]) =>
    setS((p) => (p ? { ...p, [k]: v } : p));

  if (loading) return <p className="p-8 text-sm text-slate-500">読み込み中…</p>;
  if (!s) return null;

  return (
    <div className="min-h-screen bg-sand-50">
      <StaffPageHeader
        title="⚙️ Tシャツ注文の設定"
        description="受付の開閉・価格・文言・商品画像"
        backHref="/staff/merch/tshirt"
        backLabel="注文一覧へ戻る"
        rightExtra={<Button size="sm" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>}
      />

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <Section title="受付">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-navy-900">注文を受け付ける</p>
              <p className="text-[11px] text-slate-500">OFFにすると、受付期間内でも公開ページで注文できなくなります</p>
            </div>
            <Switch checked={s.isOpen} onCheckedChange={(v) => set('isOpen', v)} />
          </div>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div>
              <Label className="text-xs">受付開始日</Label>
              <Input type="date" value={s.openAt} onChange={(e) => set('openAt', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">締切日（この日まで受付）</Label>
              <Input type="date" value={s.closeAt} onChange={(e) => set('closeAt', e.target.value)} />
            </div>
          </div>
        </Section>

        <Section title="商品・価格">
          <div>
            <Label className="text-xs">商品名</Label>
            <Input value={s.productName} onChange={(e) => set('productName', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">価格（税込・円）</Label>
              <Input type="number" value={s.unitPrice} onChange={(e) => set('unitPrice', Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">郵送料（円）</Label>
              <Input type="number" value={s.shippingFee} onChange={(e) => set('shippingFee', Number(e.target.value))} />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            価格を変えても、すでに入っている注文の金額は変わりません（注文時の価格で確定します）。
          </p>
        </Section>

        <Section title="商品画像">
          <div className="flex gap-4 items-start">
            <div className="relative w-28 h-28 shrink-0 rounded-md bg-[#0b0b0c] overflow-hidden">
              {s.imageUrl && (
                <Image src={s.imageUrl} alt="商品画像プレビュー" fill className="object-contain p-2" sizes="112px" />
              )}
            </div>
            <div className="flex-1">
              <Label className="text-xs">画像のパス</Label>
              <Input value={s.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="/merch/tshirt_black_black.png" />
              <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
                別カットに差し替えるときは、画像ファイルを <code className="bg-sand-100 px-1 rounded">public/merch/</code> に置いて、
                そのパス（例 <code className="bg-sand-100 px-1 rounded">/merch/tshirt_v2.png</code>）をここに入れてください。
                公開ページは黒背景なので、<strong>背景を透過したPNG</strong>が最もきれいに見えます。
              </p>
            </div>
          </div>
        </Section>

        <Section title="文言">
          <div>
            <Label className="text-xs">商品説明（公開ページの本文・改行可）</Label>
            <Textarea rows={5} value={s.introMd} onChange={(e) => set('introMd', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">お渡しについて</Label>
            <Input value={s.pickupNote} onChange={(e) => set('pickupNote', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">お支払いについて</Label>
            <Input value={s.thanksNote} onChange={(e) => set('thanksNote', e.target.value)} />
          </div>
        </Section>

        <div className="flex justify-end pb-10">
          <Button onClick={save} disabled={saving}>{saving ? '保存中…' : '保存する'}</Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-sand-200 rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-bold text-navy-900">{title}</h2>
      {children}
    </section>
  );
}

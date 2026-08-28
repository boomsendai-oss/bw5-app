'use client';

// 無人物販kiosk スタッフ画面: 販売会の作成/切替・商品/在庫の管理・売上・注文取消・CSV。
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import StaffPageHeader from '@/components/StaffPageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getKioskStaffView,
  staffActivateSale,
  staffApplyBaseSync,
  staffImportBaseItem,
  staffListBaseItems,
  staffPreviewBaseSync,
  type BaseSyncPreview,
  type StaffBaseItem,
  staffAddProduct,
  staffAddVariant,
  staffCreateSale,
  staffDeleteVariant,
  staffOrdersCsv,
  staffSetProductStock,
  staffSetVariantStock,
  staffUpdateProduct,
  staffUpdateSale,
  staffVoidOrder,
  type KioskStaffView,
} from './actions';

const yen = (n: number) => '¥' + n.toLocaleString('ja-JP');

function fmtJst(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

async function uploadImageFile(file: File): Promise<{ url: string } | { error: string }> {
  if (file.size > 5 * 1024 * 1024) return { error: `5MBを超えています: ${file.name}` };
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok || !json?.url) return { error: json?.error ?? `アップロード失敗 (HTTP ${res.status})` };
    return { url: json.url };
  } catch {
    return { error: '通信エラーでアップロードに失敗しました' };
  }
}

type Tab = 'report' | 'products' | 'sales';

export default function KioskStaffPage() {
  const [view, setView] = useState<KioskStaffView | null>(null);
  const [saleId, setSaleId] = useState<number | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('report');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (sid?: number) => {
    try {
      const v = await getKioskStaffView(sid);
      setView(v);
      setSaleId(v.selectedSaleId ?? undefined);
    } catch {
      window.location.href = '/staff/events/login?next=/staff/kiosk';
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      toast.success(okMsg);
      await load(saleId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'エラーが発生しました');
    }
  };

  if (loading) return <p className="p-8 text-sm text-slate-500">読み込み中…</p>;
  if (!view) return null;

  const selected = view.sales.find((s) => s.id === view.selectedSaleId);

  return (
    <>
      <StaffPageHeader
        title="無人物販kiosk"
        description="イベント会場のセルフレジ(iPad)の販売会・商品・売上を管理"
        rightExtra={
          <a href="/kiosk" target="_blank" rel="noreferrer" className="text-sm font-bold text-brand-700 underline">
            iPad画面を開く ↗
          </a>
        }
      />
      <div className="mx-auto max-w-4xl space-y-6 p-4">
        {/* 販売会セレクタ */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="rounded-md border border-sand-300 bg-white px-3 py-2 text-sm"
            value={view.selectedSaleId ?? ''}
            onChange={(e) => load(Number(e.target.value))}
          >
            {view.sales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.eventDate ? ` (${s.eventDate})` : ''}
                {s.active ? ' ●iPad表示中' : ''}
              </option>
            ))}
            {view.sales.length === 0 && <option value="">販売会がまだありません</option>}
          </select>
          {selected && !selected.active && (
            <Button
              size="sm"
              onClick={() =>
                confirm(`「${selected.name}」をiPadに表示する販売会にしますか？(今の表示中は下ります)`) &&
                run(() => staffActivateSale(selected.id), 'iPadの表示をこの販売会に切り替えました')
              }
            >
              この販売会をiPadに表示
            </Button>
          )}
          <div className="ml-auto flex gap-1 rounded-lg bg-sand-100 p-1">
            {(
              [
                ['report', '売上'],
                ['products', '商品・在庫'],
                ['sales', '販売会'],
              ] as Array<[Tab, string]>
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-md px-4 py-1.5 text-sm font-bold ${tab === t ? 'bg-white text-navy-900 shadow' : 'text-navy-500'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'sales' && <SalesTab view={view} run={run} onCreate={(name, date) => run(() => staffCreateSale(name, date), '販売会を作成しました')} />}
        {tab === 'products' && view.selectedSaleId != null && (
          <ProductsTab view={view} saleId={view.selectedSaleId} run={run} />
        )}
        {tab === 'report' && view.report && view.selectedSaleId != null && (
          <ReportTab view={view} saleId={view.selectedSaleId} saleName={selected?.name ?? 'kiosk'} run={run} />
        )}
        {view.selectedSaleId == null && tab !== 'sales' && (
          <p className="rounded-lg bg-sand-50 p-6 text-sm text-navy-600">まず「販売会」タブから販売会を作成してください。</p>
        )}
      </div>
    </>
  );
}

function SalesTab({
  view,
  onCreate,
  run,
}: {
  view: KioskStaffView;
  onCreate: (name: string, date: string) => void;
  run: (fn: () => Promise<unknown>, okMsg: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sand-200 bg-white p-4">
        <h3 className="font-bold text-navy-900">新しい販売会</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            名前
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: BF6 会場グッズ販売" className="mt-1 w-64" />
          </label>
          <label className="text-sm">
            開催日
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-44" />
          </label>
          <Button onClick={() => onCreate(name, date)} disabled={!name.trim()}>
            作成
          </Button>
        </div>
        <p className="mt-2 text-xs text-navy-500">
          作成しただけではiPadに出ません。上の「この販売会をiPadに表示」で切り替えたものだけが表示されます。
          名前はiPadトップのタイトルとしてそのまま出ます。
        </p>
      </div>
      <ul className="space-y-2">
        {view.sales.map((s) => (
          <SaleRow key={s.id} s={s} run={run} />
        ))}
      </ul>
    </div>
  );
}

function SaleRow({
  s,
  run,
}: {
  s: KioskStaffView['sales'][number];
  run: (fn: () => Promise<unknown>, okMsg: string) => Promise<void>;
}) {
  const [name, setName] = useState(s.name);
  const [date, setDate] = useState(s.eventDate);
  const dirty = name !== s.name || date !== s.eventDate;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-sand-200 bg-white px-4 py-2 text-sm">
      <Input value={name} onChange={(e) => setName(e.target.value)} className="w-72" />
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
      {s.active && <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">iPad表示中</span>}
      {dirty && (
        <Button size="sm" onClick={() => run(() => staffUpdateSale(s.id, name, date), '販売会を更新しました(iPadのタイトルにも反映)')}>
          保存
        </Button>
      )}
    </li>
  );
}

function BaseImportPanel({
  saleId,
  run,
}: {
  saleId: number;
  run: (fn: () => Promise<unknown>, okMsg: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StaffBaseItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await staffListBaseItems(saleId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'BASEの商品一覧を取得できませんでした');
      setItems(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-sand-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-navy-900">BASEのネットショップから取り込み</h3>
          <p className="mt-1 text-xs text-navy-500">
            写真・価格・サイズ展開・在庫をそのままコピーします。取り込み後の在庫は独立管理
            (kioskで売れてもBASE側の在庫は減りません)。取り込み済みの商品はBASEの現在在庫で上書き更新できます。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen((o) => !o);
            if (!open && items == null) load();
          }}
        >
          {open ? '閉じる' : 'BASEの商品を見る'}
        </Button>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          {loading && <p className="py-4 text-sm text-navy-500">BASEから読み込み中…</p>}
          {!loading && items?.length === 0 && <p className="py-4 text-sm text-navy-500">公開中の商品がありません</p>}
          {!loading &&
            items?.map((it) => (
              <div key={it.itemId} className="flex items-center gap-3 rounded-lg border border-sand-100 p-2">
                {it.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- BASEの商品写真 */
                  <img src={it.imageUrl} alt={it.name} className="h-14 w-14 rounded object-cover" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded bg-sand-100">🛍️</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{it.name}</p>
                  <p className="text-xs text-navy-500">
                    ¥{it.price.toLocaleString('ja-JP')}・在庫{it.stock}
                    {it.variationSummary && <span className="ml-1">({it.variationSummary})</span>}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={it.alreadyImported ? 'outline' : 'default'}
                  disabled={it.stock <= 0 && !it.alreadyImported}
                  onClick={() =>
                    run(
                      () => staffImportBaseItem(saleId, it.itemId),
                      it.alreadyImported ? 'BASEの現在在庫で更新しました' : '取り込みました'
                    ).then(load)
                  }
                >
                  {it.alreadyImported ? 'BASE在庫で更新' : '取り込む'}
                </Button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function ProductsTab({
  view,
  saleId,
  run,
}: {
  view: KioskStaffView;
  saleId: number;
  run: (fn: () => Promise<unknown>, okMsg: string) => Promise<void>;
}) {
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newStock, setNewStock] = useState('0');

  return (
    <div className="space-y-4">
      <BaseImportPanel saleId={saleId} run={run} />
      <div className="rounded-xl border border-sand-200 bg-white p-4">
        <h3 className="font-bold text-navy-900">商品を追加</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            商品名
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例: 黒×黒Tシャツ" className="mt-1 w-56" />
          </label>
          <label className="text-sm">
            価格(税込)
            <Input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className="mt-1 w-28" />
          </label>
          <label className="text-sm">
            在庫
            <Input type="number" value={newStock} onChange={(e) => setNewStock(e.target.value)} className="mt-1 w-24" />
          </label>
          <Button
            onClick={() =>
              run(
                () => staffAddProduct(saleId, { name: newName, price: Number(newPrice), stock: Number(newStock) || 0, imageUrl: '', description: '' }),
                '商品を追加しました'
              ).then(() => {
                setNewName('');
                setNewPrice('');
                setNewStock('0');
              })
            }
            disabled={!newName.trim() || !newPrice}
          >
            追加
          </Button>
        </div>
        <p className="mt-2 text-xs text-navy-500">サイズ展開する商品は、追加後にカードの「サイズを追加」で。サイズがある場合は在庫はサイズ側で管理します。</p>
      </div>

      {view.products.map((p) => (
        <ProductCard key={p.id} p={p} run={run} />
      ))}
    </div>
  );
}

function ProductCard({
  p,
  run,
}: {
  p: KioskStaffView['products'][number];
  run: (fn: () => Promise<unknown>, okMsg: string) => Promise<void>;
}) {
  const [name, setName] = useState(p.name);
  const [price, setPrice] = useState(String(p.price));
  const [stock, setStock] = useState(String(p.stock));
  const [vColor, setVColor] = useState('');
  const [vSize, setVSize] = useState('');
  const [vStock, setVStock] = useState('0');
  const [uploading, setUploading] = useState(false);

  const save = () =>
    run(
      () => staffUpdateProduct(p.id, { name, price: Number(price), imageUrl: p.imageUrl, description: p.description, sortOrder: p.sortOrder, active: p.active }),
      '保存しました'
    );

  return (
    <div className={`rounded-xl border bg-white p-4 ${p.active ? 'border-sand-200' : 'border-red-200 opacity-70'}`}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="relative">
          {p.imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- 動的な商品写真 */
            <img src={p.imageUrl} alt={p.name} className="h-24 w-24 rounded-lg object-cover" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-sand-100 text-3xl">🛍️</div>
          )}
          <label className="mt-1 block cursor-pointer text-center text-xs font-bold text-brand-700 underline">
            {uploading ? '送信中…' : '写真を変更'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                const r = await uploadImageFile(f);
                setUploading(false);
                if ('error' in r) return void toast.error(r.error);
                run(
                  () => staffUpdateProduct(p.id, { name, price: Number(price), imageUrl: r.url, description: p.description, sortOrder: p.sortOrder, active: p.active }),
                  '写真を更新しました'
                );
              }}
            />
          </label>
        </div>
        <div className="flex flex-1 flex-wrap items-end gap-3">
          <label className="text-sm">
            商品名
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-52" />
          </label>
          <label className="text-sm">
            価格
            <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1 w-28" />
          </label>
          {p.variants.length === 0 && (
            <label className="text-sm">
              在庫(補正)
              <div className="mt-1 flex gap-2">
                <Input type="number" value={stock} onChange={(e) => setStock(e.target.value)} className="w-24" />
                <Button variant="outline" size="sm" onClick={() => run(() => staffSetProductStock(p.id, Number(stock)), '在庫を補正しました')}>
                  補正
                </Button>
              </div>
            </label>
          )}
          <Button size="sm" onClick={save}>
            保存
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              run(
                () => staffUpdateProduct(p.id, { name, price: Number(price), imageUrl: p.imageUrl, description: p.description, sortOrder: p.sortOrder, active: !p.active }),
                p.active ? 'iPadから隠しました' : 'iPadに表示します'
              )
            }
          >
            {p.active ? 'iPadから隠す' : '表示に戻す'}
          </Button>
        </div>
      </div>

      {/* サイズ(バリエーション) */}
      <div className="mt-3 border-t border-sand-100 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {p.variants.map((v) => (
            <VariantChip key={v.id} v={v} run={run} />
          ))}
          <div className="flex items-center gap-1">
            <Input value={vColor} onChange={(e) => setVColor(e.target.value)} placeholder="カラー(任意)" className="h-8 w-28 text-sm" />
            <Input value={vSize} onChange={(e) => setVSize(e.target.value)} placeholder="サイズ" className="h-8 w-20 text-sm" />
            <Input type="number" value={vStock} onChange={(e) => setVStock(e.target.value)} placeholder="在庫" className="h-8 w-20 text-sm" />
            <Button
              variant="outline"
              size="sm"
              disabled={!vSize.trim()}
              onClick={() =>
                run(() => staffAddVariant(p.id, vColor, vSize, Number(vStock) || 0), 'サイズを追加しました').then(() => {
                  setVSize('');
                  setVStock('0');
                })
              }
            >
              サイズを追加
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VariantChip({
  v,
  run,
}: {
  v: { id: number; label: string; stock: number; available: number };
  run: (fn: () => Promise<unknown>, okMsg: string) => Promise<void>;
}) {
  const [stock, setStock] = useState(String(v.stock));
  return (
    <span className="flex items-center gap-1 rounded-full bg-sand-50 py-1 pl-3 pr-1 text-sm">
      <b>{v.label}</b>
      <Input type="number" value={stock} onChange={(e) => setStock(e.target.value)} className="h-7 w-16 text-sm" />
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => run(() => staffSetVariantStock(v.id, Number(stock)), `${v.label}の在庫を補正しました`)}>
        補正
      </Button>
      <button
        type="button"
        className="px-1 text-navy-400"
        onClick={() => confirm(`サイズ「${v.label}」を削除しますか？`) && run(() => staffDeleteVariant(v.id), '削除しました')}
      >
        ✕
      </button>
    </span>
  );
}

/** イベント後にkioskの売上をBASE在庫へ反映する(プレビュー→確認→反映)。 */
function BaseSyncPanel({ saleId, onDone }: { saleId: number; onDone: () => void }) {
  const [preview, setPreview] = useState<BaseSyncPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPreview = async () => {
    setBusy(true);
    try {
      setPreview(await staffPreviewBaseSync(saleId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'プレビューの取得に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!confirm('BASEのネットショップ在庫を上の内容で減らします。よろしいですか？')) return;
    setBusy(true);
    try {
      const res = await staffApplyBaseSync(saleId);
      res.warnings.forEach((w) => toast.warning(w));
      toast.success(`${res.appliedOrders}件の注文をBASE在庫に反映しました`);
      setPreview(null);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '反映に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-sand-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-navy-900">売上をBASE在庫に反映</h3>
          <p className="mt-1 text-xs text-navy-500">
            イベント終了後に1回押すと、ここで売れた分(BASEから取り込んだ商品のみ)をBASEのネットショップ在庫から差し引きます。
            反映済みの注文は二重に引かれません。反映後に注文を取消した場合はBASE側で手で戻してください。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadPreview} disabled={busy}>
          {busy ? '確認中…' : '反映内容を確認'}
        </Button>
      </div>
      {preview && (
        <div className="mt-3">
          {preview.rows.length === 0 ? (
            <p className="py-2 text-sm text-navy-500">反映する売上はありません(すべて反映済みか、BASE由来の商品の売上がまだありません)</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={`${r.itemName}:${r.variantLabel}`} className="border-t border-sand-100">
                      <td className="py-1.5">
                        {r.itemName}
                        {r.variantLabel && <span className="ml-1 text-navy-500">({r.variantLabel})</span>}
                      </td>
                      <td className="text-right">{r.soldQty}点 売れた</td>
                      <td className="w-40 text-right">
                        BASE在庫 {r.baseStockNow} → <b>{r.baseStockAfter}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.warnings.map((w) => (
                <p key={w} className="mt-2 text-xs font-bold text-amber-700">
                  ⚠️ {w}
                </p>
              ))}
              <div className="mt-3 text-right">
                <Button onClick={apply} disabled={busy}>
                  {busy ? '反映中…' : `この内容でBASEに反映する(${preview.orderCount}件の注文)`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ReportTab({
  view,
  saleId,
  saleName,
  run,
}: {
  view: KioskStaffView;
  saleId: number;
  saleName: string;
  run: (fn: () => Promise<unknown>, okMsg: string) => Promise<void>;
}) {
  const report = view.report!;
  const downloadCsv = async () => {
    try {
      const csv = await staffOrdersCsv(saleId);
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kiosk_${saleName}_注文明細.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error('CSVの作成に失敗しました');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            ['売上合計', yen(report.totals.total)],
            ['オンライン', yen(report.totals.stripe)],
            ['現金(貯金箱)', yen(report.totals.cash)],
            ['注文数', `${report.totals.orderCount}件`],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-xl border border-sand-200 bg-white p-4">
            <p className="text-xs text-navy-500">{label}</p>
            <p className="mt-1 text-2xl font-extrabold text-navy-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-sand-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-navy-900">商品別</h3>
          <Button variant="outline" size="sm" onClick={downloadCsv}>
            CSVダウンロード
          </Button>
        </div>
        <table className="mt-2 w-full text-sm">
          <tbody>
            {report.byProduct.map((r) => (
              <tr key={`${r.productName}:${r.variantLabel}`} className="border-t border-sand-100">
                <td className="py-1.5">
                  {r.productName}
                  {r.variantLabel && <span className="ml-1 text-navy-500">({r.variantLabel})</span>}
                </td>
                <td className="text-right">{r.qty}点</td>
                <td className="w-28 text-right font-bold">{yen(r.amount)}</td>
              </tr>
            ))}
            {report.byProduct.length === 0 && (
              <tr>
                <td className="py-3 text-navy-500">まだ売上がありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <BaseSyncPanel saleId={saleId} onDone={() => run(async () => undefined, '反映が完了しました')} />

      <div className="rounded-xl border border-sand-200 bg-white p-4">
        <h3 className="font-bold text-navy-900">注文一覧</h3>
        <ul className="mt-2 divide-y divide-sand-100 text-sm">
          {report.orders.map((o) => (
            <li key={o.orderId} className="flex flex-wrap items-center gap-2 py-2">
              <span className="text-navy-400">#{o.orderId}</span>
              <span>{fmtJst(o.createdAt)}</span>
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${o.paymentMethod === 'cash' ? 'bg-sand-100 text-navy-700' : 'bg-brand-50 text-brand-700'}`}>
                {o.paymentMethod === 'cash' ? '現金' : 'オンライン'}
              </span>
              <span className="flex-1 truncate text-navy-600">
                {o.items.map((it) => `${it.productName}${it.variantLabel ? `(${it.variantLabel})` : ''}×${it.qty}`).join('、')}
              </span>
              <b>{yen(o.amountTotal)}</b>
              {o.status === 'voided' && <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">取消済み</span>}
              {o.status === 'pending' && <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">支払い待ち</span>}
              {o.amountMismatch && <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">⚠️金額ズレ</span>}
              {o.paidAfterExpired && <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">⚠️期限切れ後入金</span>}
              {o.status === 'paid' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-red-600"
                  onClick={() => {
                    const reason = prompt(`注文#${o.orderId} (${yen(o.amountTotal)}) を取り消しますか？\n理由をメモできます(在庫は元に戻ります):`);
                    if (reason !== null) run(() => staffVoidOrder(o.orderId, reason), '取り消しました(在庫を戻しました)');
                  }}
                >
                  取消
                </Button>
              )}
            </li>
          ))}
          {report.orders.length === 0 && <li className="py-3 text-navy-500">注文はまだありません</li>}
        </ul>
      </div>
    </div>
  );
}

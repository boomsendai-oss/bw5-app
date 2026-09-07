'use client';

// Tシャツ注文のスタッフ集計画面。発注に必要なサイズ別枚数を最上段に置く。
// 住所・電話はこの画面にだけ出す(公開側は自分の1件しか読めない)。
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Download, Settings, Trash2, ExternalLink, Truck } from 'lucide-react';
import StaffPageHeader from '@/components/StaffPageHeader';
import { Button } from '@/components/ui/button';
import {
  getStaffOrders,
  markOrder,
  removeOrder,
  exportOrdersCsv,
  type StaffOrdersView,
} from './actions';

const yen = (n: number) => '¥' + n.toLocaleString('ja-JP');

function fmtJst(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const STATE_LABEL = {
  before: { text: '受付開始前', cls: 'bg-amber-50 text-amber-700 border-amber-300' },
  open: { text: '受付中', cls: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
  closed: { text: '締切済み', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  suspended: { text: '停止中', cls: 'bg-rose-50 text-rose-700 border-rose-300' },
} as const;

export default function StaffTshirtPage() {
  const [v, setV] = useState<StaffOrdersView | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setV(await getStaffOrders());
    } catch {
      window.location.href = '/staff/events/login?next=/staff/merch/tshirt';
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(id: number, flags: { handedOver?: boolean; paid?: boolean }) {
    await markOrder(id, flags);
    await load();
  }

  async function remove(id: number) {
    if (!confirm('この注文を削除します。よろしいですか？')) return;
    await removeOrder(id);
    toast.success('削除しました');
    await load();
  }

  async function downloadCsv() {
    const csv = await exportOrdersCsv();
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tshirt_orders_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <p className="p-8 text-sm text-slate-500">読み込み中…</p>;
  if (!v) return null;

  const st = STATE_LABEL[v.state];
  const shipped = v.orders.filter((o) => o.wantsShipping);

  return (
    <div className="min-h-screen bg-sand-50">
      <StaffPageHeader
        title="👕 Tシャツ注文"
        description={`${v.settings.productName}／${v.settings.openAt} 〜 ${v.settings.closeAt}`}
        rightExtra={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadCsv}>
              <Download className="size-4 mr-1" />CSV
            </Button>
            <Link href="/staff/merch/tshirt/settings">
              <Button variant="outline" size="sm"><Settings className="size-4 mr-1" />設定</Button>
            </Link>
            <Link href="/merch/tshirt" target="_blank">
              <Button variant="outline" size="sm"><ExternalLink className="size-4 mr-1" />公開ページ</Button>
            </Link>
          </div>
        }
      />

      <div className="max-w-6xl mx-auto p-4 space-y-6">
        {/* 発注用: サイズ別枚数 */}
        <section className="bg-white border border-sand-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-navy-900">サイズ別 枚数（発注用）</h2>
            <span className={`text-[11px] font-bold rounded-full border px-2.5 py-0.5 ${st.cls}`}>{st.text}</span>
          </div>
          <div className="grid grid-cols-5 gap-3">
            {v.sizes.map((s) => (
              <div key={s} className="text-center border border-sand-200 rounded-md py-4 bg-sand-50">
                <p className="text-[11px] tracking-widest text-slate-500">{s}</p>
                <p className="mt-1 text-2xl font-bold text-navy-900 tabular-nums">{v.bySize[s]}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <Stat label="注文数" value={`${v.orders.length}件`} />
            <Stat label="合計枚数" value={`${v.totalQty}枚`} />
            <Stat label="郵送希望" value={`${v.shippingCount}件`} />
            <Stat label="合計金額" value={yen(v.totalAmount)} accent />
          </div>
        </section>

        {/* 概算利益 */}
        <section className="bg-white border border-sand-200 rounded-lg p-5">
          <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-navy-900">概算利益</h2>
            <span className="text-[11px] text-slate-500">
              原価 1枚 {yen(v.unitCost)} で計算（発注枚数で変動するため概算）
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <Stat label="売上（送料除く）" value={yen(v.profit.revenue)} />
            <Stat label={`原価 ${v.profit.qty}枚分`} value={'\u2212' + yen(v.profit.cost)} />
            <Stat label="預かり送料" value={yen(v.profit.shipping)} />
            <Stat label="概算利益" value={yen(v.profit.profit)} accent />
          </div>
          <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
            送料は業者へ払う実費の預かりなので、売上からも利益からも除いています。
            一般価格(¥3,500)は1枚あたり{yen(3500 - v.unitCost)}の利益、
            インストラクター価格(¥1,500)は実原価{yen(v.unitCost)}を下回るので1枚{yen(v.unitCost - 1500)}の持ち出し、
            無料配布は原価分だけ差し引かれます。
          </p>
        </section>

        {/* 郵送希望者 */}
        {shipped.length > 0 && (
          <section className="bg-white border border-sand-200 rounded-lg p-5">
            <h2 className="text-sm font-bold text-navy-900 mb-3 flex items-center gap-2">
              <Truck className="size-4 text-brand-600" />
              郵送希望（{shipped.length}件）
            </h2>
            <p className="text-[11px] text-slate-500 mb-3">
              住所・電話はこの画面にのみ表示されます。印刷・共有時は取り扱いにご注意ください。
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-sand-200">
                    <th className="py-2 pr-3 font-medium">お名前</th>
                    <th className="py-2 pr-3 font-medium">サイズ</th>
                    <th className="py-2 pr-3 font-medium">枚数</th>
                    <th className="py-2 pr-3 font-medium">住所</th>
                    <th className="py-2 pr-3 font-medium">電話</th>
                    <th className="py-2 font-medium">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {shipped.map((o) => (
                    <tr key={o.id} className="border-b border-sand-100">
                      <td className="py-2.5 pr-3 font-medium text-navy-900">{o.name}</td>
                      <td className="py-2.5 pr-3">{o.size}</td>
                      <td className="py-2.5 pr-3 tabular-nums">{o.qty}</td>
                      <td className="py-2.5 pr-3 text-slate-600">{o.address}</td>
                      <td className="py-2.5 pr-3 text-slate-600 whitespace-nowrap">{o.phone}</td>
                      <td className="py-2.5 tabular-nums">{yen(o.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 全注文 */}
        <section className="bg-white border border-sand-200 rounded-lg p-5">
          <h2 className="text-sm font-bold text-navy-900 mb-3">注文一覧（{v.orders.length}件）</h2>
          {v.orders.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">まだ注文はありません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-sand-200">
                    <th className="py-2 pr-3 font-medium">お名前</th>
                    <th className="py-2 pr-3 font-medium">サイズ</th>
                    <th className="py-2 pr-3 font-medium">枚数</th>
                    <th className="py-2 pr-3 font-medium">受取</th>
                    <th className="py-2 pr-3 font-medium">金額</th>
                    <th className="py-2 pr-3 font-medium">支払い</th>
                    <th className="py-2 pr-3 font-medium">お渡し</th>
                    <th className="py-2 pr-3 font-medium">入金</th>
                    <th className="py-2 pr-3 font-medium">注文日時</th>
                    <th className="py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {v.orders.map((o) => (
                    <tr key={o.id} className="border-b border-sand-100">
                      <td className="py-2.5 pr-3 font-medium text-navy-900">{o.name}</td>
                      <td className="py-2.5 pr-3">{o.size}</td>
                      <td className="py-2.5 pr-3 tabular-nums">{o.qty}</td>
                      <td className="py-2.5 pr-3">
                        {o.wantsShipping ? (
                          <span className="text-[11px] rounded-full border border-brand-300 bg-brand-50 text-brand-700 px-2 py-0.5">郵送</span>
                        ) : (
                          <span className="text-[11px] text-slate-500">レッスン</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums">{yen(o.totalAmount)}</td>
                      <td className="py-2.5 pr-3">
                        {o.paymentMethod === 'stripe' ? (
                          <span className={`text-[11px] rounded-full border px-2 py-0.5 ${
                            o.paid
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              : 'border-amber-300 bg-amber-50 text-amber-700'
                          }`}>
                            {o.paid ? 'カード済' : 'カード未'}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-500">現金</span>
                        )}
                        {o.amountMismatch && (
                          <span className="ml-1 text-[11px] rounded-full border border-rose-300 bg-rose-50 text-rose-700 px-2 py-0.5">金額差異</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <input type="checkbox" checked={o.handedOver} className="size-4 accent-teal-600"
                          onChange={(e) => toggle(o.id, { handedOver: e.target.checked })} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <input type="checkbox" checked={o.paid} className="size-4 accent-teal-600"
                          onChange={(e) => toggle(o.id, { paid: e.target.checked })} />
                      </td>
                      <td className="py-2.5 pr-3 text-slate-500 whitespace-nowrap">{fmtJst(o.createdAt)}</td>
                      <td className="py-2.5">
                        <button onClick={() => remove(o.id)} className="text-slate-400 hover:text-rose-600" aria-label="削除">
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-md border py-3 ${accent ? 'border-brand-300 bg-brand-50' : 'border-sand-200 bg-sand-50'}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${accent ? 'text-brand-700' : 'text-navy-900'}`}>{value}</p>
    </div>
  );
}

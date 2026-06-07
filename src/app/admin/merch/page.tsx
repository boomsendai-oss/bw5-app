'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Edit3, X, Trash2, Plus } from 'lucide-react';
import { Toast, useToast, TabHeader } from '../_components/AdminShared';
import type { MerchItem, MerchOrder, MerchVariant } from '../_components/types';

function AddVariantRow({ merchId: _merchId, onAdd }: { merchId: number; onAdd: (color: string, size: string, stock: number) => void }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState('');
  const [size, setSize] = useState('');
  const [stock, setStock] = useState('0');
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 w-full text-xs px-3 py-2 rounded-lg flex items-center justify-center gap-1 transition-colors"
        style={{ background: 'var(--bg-hover)', color: 'var(--accent-primary)', border: '1px dashed var(--accent-primary)' }}
      >
        <Plus className="w-3 h-3" /> バリアント追加
      </button>
    );
  }
  const submit = () => {
    if (!color && !size) { return; }
    onAdd(color.trim(), size.trim(), Number(stock) || 0);
    setColor(''); setSize(''); setStock('0'); setOpen(false);
  };
  return (
    <div className="mt-3 rounded-lg p-2.5 space-y-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}>
      <div className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>新しいバリアント</div>
      <div className="grid grid-cols-3 gap-1.5">
        <input className="admin-input text-xs" placeholder="色 (任意)" value={color} onChange={e => setColor(e.target.value)} />
        <input className="admin-input text-xs" placeholder="サイズ (任意)" value={size} onChange={e => setSize(e.target.value)} />
        <input className="admin-input text-xs" type="number" inputMode="numeric" placeholder="在庫" value={stock} onChange={e => setStock(e.target.value)} />
      </div>
      <div className="flex gap-1.5">
        <button onClick={submit} className="flex-1 btn-primary text-xs px-3 py-1.5">追加</button>
        <button onClick={() => { setOpen(false); setColor(''); setSize(''); setStock('0'); }} className="btn-secondary text-xs px-3 py-1.5">キャンセル</button>
      </div>
    </div>
  );
}

export default function MerchPage() {
  const { toast, notify, clearToast } = useToast();
  const [items, setItems] = useState<MerchItem[]>([]);
  const [orders, setOrders] = useState<MerchOrder[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', price: '', stock: '', image_url: '', description: '' });
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/merchandise');
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (item?: MerchItem) => {
    const body = item
      ? { action: 'update', id: item.id, name: form.name, price: Number(form.price), stock: Number(form.stock), image_url: form.image_url, description: form.description }
      : { action: 'add', name: form.name, price: Number(form.price), stock: Number(form.stock), image_url: form.image_url, description: form.description };
    const res = await fetch('/api/merchandise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
    setEditId(null);
    setAdding(false);
    setForm({ name: '', price: '', stock: '', image_url: '', description: '' });
    notify(item ? '更新しました' : '追加しました');
  };

  const remove = async (id: number) => {
    if (!confirm('削除しますか？（非表示になります）')) return;
    const res = await fetch('/api/merchandise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
    notify('削除しました');
  };

  const setStockExact = async (id: number, stock: number) => {
    const res = await fetch('/api/merchandise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_stock', id, stock: Math.max(0, stock) }),
    });
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
  };

  const updateVariantStock = async (variantId: number, stock: number) => {
    const res = await fetch('/api/merchandise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_variant_stock', id: variantId, stock: Math.max(0, stock) }),
    });
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
    notify('バリアント在庫を更新しました');
  };

  const addVariant = async (merchId: number, color: string, size: string, stock: number) => {
    const res = await fetch('/api/merchandise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_variant', merch_id: merchId, color, size, stock }),
    });
    if (!res.ok) { notify('追加に失敗しました'); return; }
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
    notify('バリアント追加しました');
  };

  const deleteVariant = async (variantId: number, label: string) => {
    if (!confirm(`バリアント「${label}」を削除しますか？(注文があると整合性が崩れる場合があります)`)) return;
    const res = await fetch('/api/merchandise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_variant', id: variantId }),
    });
    if (!res.ok) { notify('削除に失敗しました'); return; }
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
    notify('バリアントを削除しました');
  };

  const startEdit = (item: MerchItem) => {
    setEditId(item.id);
    setForm({ name: item.name, price: String(item.price), stock: String(item.stock), image_url: item.image_url, description: item.description });
  };

  const soldCount = (merchId: number) => orders.filter(o => o.merch_id === merchId).length;

  const COLOR_HEX_ADMIN: Record<string, string> = {
    'フェードグレー': '#8c8c86', 'フェードレッド': '#c96a5a', 'フェードブルー': '#6a8bb3',
    'ホワイト': '#f5f5f5', 'ブラック': '#1b1b1b', 'ブルー': '#2f5fb0',
    'ライトグレー': '#cfcfc8', 'グリーン': '#6b8f6b',
  };

  return (
    <div>
      {toast && <Toast message={toast} onClose={clearToast} />}
      <TabHeader title="グッズ管理" onAdd={() => { setAdding(true); setForm({ name: '', price: '', stock: '', image_url: '', description: '' }); }} />

      {adding && (
        <div className="card p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input className="admin-input" placeholder="商品名" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className="admin-input" placeholder="価格" type="number" inputMode="numeric" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
            <input className="admin-input" placeholder="在庫数" type="number" inputMode="numeric" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <input className="admin-input" placeholder="画像URL" value={form.image_url} onChange={e => setForm({ ...form, image_url: e.target.value })} />
            <input className="admin-input" placeholder="説明" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => save()} className="btn-primary text-sm px-4 py-2 flex items-center gap-1"><Save className="w-3 h-3" /> 保存</button>
            <button onClick={() => setAdding(false)} className="btn-secondary text-sm px-4 py-2"><X className="w-3 h-3" /></button>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="card p-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          <p className="text-sm mb-2">商品データを読み込み中、または0件です。</p>
          <button onClick={load} className="btn-secondary text-xs px-4 py-2">再読み込み</button>
        </div>
      )}

      <div className="space-y-2">
        {items.map(item => {
          const variantTotalStock = (item.variants ?? []).reduce((sum, v) => sum + (v.stock ?? 0), 0);
          const hasVariants = (item.variants ?? []).length > 0;
          const totalStock = hasVariants ? variantTotalStock : item.stock;
          const isExpanded = expandedId === item.id;
          const isEditing = editId === item.id;
          return (
            <div key={item.id} className="card overflow-hidden" style={{ padding: 0 }}>
              {/* Compact header */}
              <button
                onClick={() => { if (!isEditing) setExpandedId(isExpanded ? null : item.id); }}
                className="w-full flex items-center gap-3 p-3 text-left transition-colors"
                style={{ background: isExpanded ? 'var(--bg-hover)' : 'transparent' }}
              >
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image_url} alt="" className="w-12 h-12 rounded-lg object-cover bg-white/5 shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center text-[10px] shrink-0" style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>NO IMG</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm leading-tight truncate">{item.name}</div>
                  <div className="text-[11px] mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <span>&yen;{item.price.toLocaleString()}</span>
                    <span style={{ color: 'var(--text-muted)' }}>&bull;</span>
                    <span className={totalStock <= 0 ? 'text-red-400 font-bold' : ''}>
                      在庫 {totalStock}
                    </span>
                    {soldCount(item.id) > 0 && (
                      <>
                        <span style={{ color: 'var(--text-muted)' }}>&bull;</span>
                        <span>販売 {soldCount(item.id)}</span>
                      </>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-lg" style={{ color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                  &#x25BE;
                </span>
              </button>

              {/* Expanded body */}
              {isExpanded && (
                <div className="border-t p-3 space-y-3" style={{ borderColor: 'var(--border-color)' }}>
                  {isEditing ? (
                    <div className="space-y-2">
                      <input className="admin-input w-full" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="商品名" />
                      <div className="grid grid-cols-2 gap-2">
                        <input className="admin-input" type="number" inputMode="numeric" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="価格" />
                        <input className="admin-input" value={form.image_url} onChange={e => setForm({ ...form, image_url: e.target.value })} placeholder="画像URL" />
                      </div>
                      <textarea className="admin-input w-full" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="説明文" />
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => save(item)} className="btn-primary text-sm px-4 py-2 flex items-center gap-1"><Save className="w-3 h-3" /> 保存</button>
                        <button onClick={() => setEditId(null)} className="btn-secondary text-sm px-4 py-2"><X className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => startEdit(item)} className="text-xs flex items-center gap-1 px-3 py-1.5 rounded" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
                        <Edit3 className="w-3 h-3" /> 商品情報を編集
                      </button>
                      <button onClick={() => remove(item.id)} className="text-xs flex items-center gap-1 px-3 py-1.5 rounded" style={{ color: 'var(--accent-primary)' }}>
                        <Trash2 className="w-3 h-3" /> 削除
                      </button>
                    </div>
                  )}

                  {/* Stock editor */}
                  {!isEditing && (
                    <>
                      {hasVariants ? (
                        <div>
                          <div className="text-[11px] font-bold mb-2" style={{ color: 'var(--text-secondary)' }}>
                            バリアント別在庫 (合計 {variantTotalStock})
                          </div>
                          {(() => {
                            const variants = item.variants ?? [];
                            const byColor = new Map<string, MerchVariant[]>();
                            for (const v of variants) {
                              const key = v.color || '—';
                              if (!byColor.has(key)) byColor.set(key, []);
                              byColor.get(key)!.push(v);
                            }
                            return (
                              <div className="space-y-2.5">
                                {Array.from(byColor.entries()).map(([color, vs]) => {
                                  const total = vs.reduce((s, v) => s + (v.stock ?? 0), 0);
                                  const swatch = COLOR_HEX_ADMIN[color];
                                  return (
                                    <div key={color} className="rounded-lg p-2" style={{ background: 'var(--bg-hover)' }}>
                                      <div className="flex items-center gap-2 mb-1.5">
                                        {swatch && (
                                          <span className="w-3.5 h-3.5 rounded-full border border-white/40 shrink-0" style={{ background: swatch }} />
                                        )}
                                        <span className="text-xs font-bold flex-1">{color}</span>
                                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>合計 {total}</span>
                                      </div>
                                      <div className="grid grid-cols-4 gap-1.5">
                                        {vs.map(v => (
                                          <div key={v.id} className="relative flex flex-col items-stretch text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                                            <span className="text-center font-bold mb-0.5">{v.size || '単一'}</span>
                                            <input
                                              type="number"
                                              inputMode="numeric"
                                              min={0}
                                              defaultValue={v.stock}
                                              onBlur={e => {
                                                const newStock = Number(e.target.value);
                                                if (!Number.isNaN(newStock) && newStock !== v.stock) updateVariantStock(v.id, newStock);
                                              }}
                                              className="admin-input text-xs text-center w-full"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => deleteVariant(v.id, `${color} / ${v.size || '単一'}`)}
                                              className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] leading-none"
                                              style={{ background: 'rgba(239,68,68,0.85)', color: '#fff' }}
                                              title="このバリアントを削除"
                                              aria-label="削除"
                                            >
                                              &times;
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                          <AddVariantRow merchId={item.id} onAdd={(c, s, st) => addVariant(item.id, c, s, st)} />
                          <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
                            数字を変えて指を離すと自動保存。&times; で削除、+追加 で新しいサイズ/色を追加。
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>マスター在庫</div>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            defaultValue={item.stock}
                            onBlur={e => {
                              const v = Number(e.target.value);
                              if (!Number.isNaN(v) && v !== item.stock) setStockExact(item.id, v);
                            }}
                            className="admin-input w-24 text-sm"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

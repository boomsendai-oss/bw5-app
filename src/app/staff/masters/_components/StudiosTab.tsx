'use client';

import { useState } from 'react';
import { MapPin, Pencil, Plus, Trash2, ExternalLink, Globe, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableHeader, TableHead, TableBody, TableRow, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Studio, PriceBlock } from './types';
import { parseBlocks } from './types';

type Props = {
  studios: Studio[];
  setStudios: React.Dispatch<React.SetStateAction<Studio[]>>;
  reload: () => void;
  setMsg: (m: string) => void;
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2 py-1 border-b border-slate-100 last:border-0">
      <div className="text-xs text-muted-foreground font-semibold">{label}</div>
      <div className="text-sm break-words">{children}</div>
    </div>
  );
}

export default function StudiosTab({ studios, setStudios, reload, setMsg }: Props) {
  const [editing, setEditing] = useState<Partial<Studio> | null>(null);
  const [detail, setDetail] = useState<Studio | null>(null);
  const [editBlocks, setEditBlocks] = useState<PriceBlock[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const startEdit = (s: Partial<Studio>) => {
    setEditing(s);
    setEditBlocks(parseBlocks(s.block_pricing));
  };

  const save = async (data: Partial<Studio>) => {
    const payload: Record<string, unknown> = { ...data };
    if (data.pricing_model === 'block') {
      payload.block_pricing = editBlocks.filter(b => b.start || b.end || b.label || b.price);
    }
    setEditing(null);
    setEditBlocks([]);
    if (data.id) {
      setStudios(prev => prev.map(s => s.id === data.id ? { ...s, ...(payload as Partial<Studio>) } as Studio : s));
    }
    try {
      if (data.id) {
        await fetch(`/api/staff/master/studios/${data.id}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`/api/staff/master/studios`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      reload();
    } catch (e) {
      setMsg(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
      reload();
    }
  };

  const remove = async (id: number) => {
    setDeleteTarget(null);
    setStudios(prev => prev.filter(s => s.id !== id));
    try {
      await fetch(`/api/staff/master/studios/${id}`, { method: 'DELETE', credentials: 'include' });
      reload();
    } catch (e) {
      setMsg(`削除失敗: ${e instanceof Error ? e.message : String(e)}`);
      reload();
    }
  };

  const updateField = (patch: Partial<Studio>) => {
    if (editing) setEditing({ ...editing, ...patch });
  };

  return (
    <>
      <Button
        onClick={() => startEdit({ pricing_model: 'hourly', daily_buffer_minutes: 0, active: 1 })}
        className="mb-3"
        size="sm"
      >
        <Plus className="size-4" />
        スタジオ追加
      </Button>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead className="text-right">料金</TableHead>
              <TableHead className="text-right">バッファ</TableHead>
              <TableHead className="text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {studios.map(s => (
              <TableRow key={s.id} className="cursor-pointer" onClick={() => setDetail(s)}>
                <TableCell className="font-medium">
                  {s.name}
                  {!s.active && <Badge variant="secondary" className="ml-1">非active</Badge>}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {s.pricing_model === 'hourly' ? `¥${s.hourly_rate.toLocaleString()}/h` : '区分制'}
                </TableCell>
                <TableCell className="text-right text-xs">
                  {s.daily_buffer_minutes ? `+${s.daily_buffer_minutes}分` : '-'}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline">詳細</Badge>
                </TableCell>
              </TableRow>
            ))}
            {studios.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-6">登録なし</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="size-4" />
              {detail?.name}
              {detail && !detail.active && <Badge variant="secondary">非active</Badge>}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <DetailRow label="料金">{detail.pricing_model === 'hourly' ? `¥${detail.hourly_rate.toLocaleString()}/h` : '区分制'}</DetailRow>
              <DetailRow label="バッファ">{detail.daily_buffer_minutes ? `+${detail.daily_buffer_minutes}分/日` : 'なし'}</DetailRow>
              <DetailRow label="住所">{detail.address || '—'}</DetailRow>
              <DetailRow label="Google Map">
                {detail.google_map_url
                  ? <a href={detail.google_map_url} target="_blank" rel="noreferrer" className="text-blue-600 underline break-all">{detail.google_map_url}</a>
                  : '—'}
              </DetailRow>
              {detail.pricing_model === 'block' && (() => {
                const blocks = parseBlocks(detail.block_pricing);
                return (
                  <DetailRow label="区分料金">
                    {blocks.length === 0 ? '未設定' : (
                      <div className="space-y-0.5">
                        {blocks.map((b, i) => (
                          <div key={i} className="text-sm">
                            {b.label ? `${b.label}: ` : ''}{b.start || '—'}〜{b.end || '—'} ¥{b.price.toLocaleString()}
                          </div>
                        ))}
                      </div>
                    )}
                  </DetailRow>
                );
              })()}
              <DetailRow label="メモ">{detail.notes || '—'}</DetailRow>
            </div>
          )}
          <DialogFooter>
            <Button variant="destructive" size="sm" onClick={() => { if (detail) { const id = detail.id; setDetail(null); setDeleteTarget(id); } }}>
              <Trash2 className="size-3.5" />
              削除
            </Button>
            <Button size="sm" onClick={() => { if (detail) { const d = detail; setDetail(null); startEdit(d); } }}>
              <Pencil className="size-3.5" />
              編集する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editing} onOpenChange={open => { if (!open) { setEditing(null); setEditBlocks([]); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'スタジオ編集' : 'スタジオ追加'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 text-sm">
              <div>
                <Label className="text-xs">名称*</Label>
                <Input value={editing.name ?? ''} onChange={e => updateField({ name: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">住所</Label>
                <Input value={editing.address ?? ''} onChange={e => updateField({ address: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Google Map URL</Label>
                <Input value={editing.google_map_url ?? ''} onChange={e => updateField({ google_map_url: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">料金モデル</Label>
                <Select
                  value={editing.pricing_model ?? 'hourly'}
                  onValueChange={v => updateField({ pricing_model: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">時間単価 (¥/h)</SelectItem>
                    <SelectItem value="block">ブロック (時間帯固定)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editing.pricing_model !== 'block' && (
                <div>
                  <Label className="text-xs">1時間あたり単価 (¥)</Label>
                  <Input type="number" value={String(editing.hourly_rate ?? 0)} onChange={e => updateField({ hourly_rate: Number(e.target.value) || 0 })} />
                </div>
              )}
              {editing.pricing_model === 'block' && (
                <div>
                  <Label className="text-xs">区分料金 (時間帯ごとの料金)</Label>
                  <div className="mt-1 space-y-2">
                    {editBlocks.length === 0 && <p className="text-xs text-muted-foreground">区分がありません。「+ 区分追加」で追加してください。</p>}
                    {editBlocks.map((b, i) => (
                      <div key={i} className="flex flex-wrap gap-2 items-center">
                        <Input
                          value={b.label}
                          onChange={e => { const nb = [...editBlocks]; nb[i] = { ...nb[i], label: e.target.value }; setEditBlocks(nb); }}
                          className="w-28"
                          placeholder="ラベル(夜間等)"
                        />
                        <Input
                          type="time"
                          value={b.start}
                          onChange={e => { const nb = [...editBlocks]; nb[i] = { ...nb[i], start: e.target.value }; setEditBlocks(nb); }}
                          className="w-auto"
                        />
                        <span className="text-xs">〜</span>
                        <Input
                          type="time"
                          value={b.end}
                          onChange={e => { const nb = [...editBlocks]; nb[i] = { ...nb[i], end: e.target.value }; setEditBlocks(nb); }}
                          className="w-auto"
                        />
                        <Input
                          type="number"
                          value={b.price}
                          onChange={e => { const nb = [...editBlocks]; nb[i] = { ...nb[i], price: Number(e.target.value) || 0 }; setEditBlocks(nb); }}
                          className="w-24"
                          placeholder="料金"
                        />
                        <span className="text-xs">¥</span>
                        <Button variant="destructive" size="xs" onClick={() => setEditBlocks(editBlocks.filter((_, j) => j !== i))}>
                          <X className="size-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button variant="secondary" size="xs" className="mt-2" onClick={() => setEditBlocks([...editBlocks, { label: '', start: '', end: '', price: 0 }])}>
                    <Plus className="size-3" />
                    区分追加
                  </Button>
                </div>
              )}
              <div>
                <Label className="text-xs">1日あたりバッファ分数 (例: 30)</Label>
                <Input type="number" value={String(editing.daily_buffer_minutes ?? 0)} onChange={e => updateField({ daily_buffer_minutes: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <Label className="text-xs">メモ</Label>
                <Input value={editing.notes ?? ''} onChange={e => updateField({ notes: e.target.value })} />
              </div>

              {/* HP公開情報 */}
              <div className="border-t-2 border-orange-200 pt-4 mt-4">
                <h3 className="font-bold text-sm mb-3 text-orange-700 flex items-center gap-2">
                  <Globe className="size-4" />
                  HP公開情報
                  <span className="text-xs font-normal text-muted-foreground">
                    boom-hp.pages.dev で表示される内容
                  </span>
                </h3>
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!editing.is_public}
                      onChange={e => updateField({ is_public: e.target.checked ? 1 : 0 })}
                    />
                    <span className="text-sm">HPに表示</span>
                  </label>
                  <div>
                    <Label className="text-xs text-muted-foreground">Google Maps 埋め込みURL</Label>
                    <Input
                      value={editing.map_embed_url ?? ''}
                      onChange={e => updateField({ map_embed_url: e.target.value })}
                      placeholder="https://www.google.com/maps/embed?..."
                    />
                    <span className="text-[11px] text-muted-foreground mt-0.5 block">
                      Google Maps の「共有」→「地図を埋め込む」で取得した https://www.google.com/maps/embed?... のURL
                    </span>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">アクセス説明文 (改行OK)</Label>
                    <Textarea
                      value={editing.access_text ?? ''}
                      onChange={e => updateField({ access_text: e.target.value })}
                      rows={4}
                      placeholder="例: 仙台駅西口より徒歩5分。1階にコンビニがあるビルの3階。"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); setEditBlocks([]); }}>キャンセル</Button>
            <Button onClick={() => editing && save(editing)}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>削除してよろしいですか?</AlertDialogTitle>
            <AlertDialogDescription>
              このスタジオを削除します。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteTarget !== null && remove(deleteTarget)}>
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

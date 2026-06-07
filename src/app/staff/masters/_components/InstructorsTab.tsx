'use client';

import { useState } from 'react';
import { User, Pencil, Plus, Trash2, Camera, FolderOpen, Image, Globe, X, Lock, Unlock } from 'lucide-react';
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
import type { Instructor, Rate, TransitFee, PhotoCount, Studio } from './types';

type Props = {
  instructors: Instructor[];
  setInstructors: React.Dispatch<React.SetStateAction<Instructor[]>>;
  rates: Rate[];
  fees: TransitFee[];
  photoCounts: PhotoCount[];
  studios: Studio[];
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

export default function InstructorsTab({
  instructors, setInstructors, rates, fees, photoCounts, studios, reload, setMsg,
}: Props) {
  const [editing, setEditing] = useState<Partial<Instructor> | null>(null);
  const [detail, setDetail] = useState<Instructor | null>(null);
  const [editRates, setEditRates] = useState<{ duration: number; rate: number }[]>([]);
  const [editFees, setEditFees] = useState<{ studio_id: number; amount: number }[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [slugLocked, setSlugLocked] = useState(true);
  const [originalSlug, setOriginalSlug] = useState<string | null>(null);
  const [slugConfirmOpen, setSlugConfirmOpen] = useState(false);

  const startEdit = (i: Partial<Instructor>) => {
    setEditing(i);
    setSlugLocked(!!i.id && !!i.slug);
    setOriginalSlug(i.slug ?? null);
    if (i.id) {
      const myRates = rates.filter(r => r.instructor_id === i.id).map(r => ({ duration: r.duration_minutes, rate: r.rate }));
      const myFees = fees.filter(f => f.instructor_id === i.id).map(f => ({ studio_id: f.studio_id, amount: f.amount }));
      setEditRates(myRates.length ? myRates : [{ duration: 60, rate: 0 }]);
      setEditFees(myFees);
    } else {
      setEditRates([{ duration: 60, rate: 0 }]);
      setEditFees([]);
    }
  };

  const save = async (data: Partial<Instructor>) => {
    const ratesSnapshot = editRates;
    const feesSnapshot = editFees;
    setEditing(null);
    setEditRates([]);
    setEditFees([]);
    if (data.id) {
      setInstructors(prev => prev.map(i => i.id === data.id ? { ...i, ...data } as Instructor : i));
    }
    try {
      let id = data.id;
      if (id) {
        await fetch(`/api/staff/master/instructors/${id}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else {
        const r = await fetch(`/api/staff/master/instructors`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const j = await r.json();
        id = j.id;
      }
      await fetch(`/api/staff/master/instructors/${id}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rates: ratesSnapshot.map(r => ({ duration_minutes: r.duration, rate: r.rate })),
          transit_fees: feesSnapshot,
        }),
      });
      reload();
    } catch (e) {
      setMsg(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
      reload();
    }
  };

  const remove = async (id: number) => {
    setDeleteTarget(null);
    setInstructors(prev => prev.filter(i => i.id !== id));
    try {
      await fetch(`/api/staff/master/instructors/${id}`, { method: 'DELETE', credentials: 'include' });
      reload();
    } catch (e) {
      setMsg(`削除失敗: ${e instanceof Error ? e.message : String(e)}`);
      reload();
    }
  };

  const updateField = (patch: Partial<Instructor>) => {
    if (editing) setEditing({ ...editing, ...patch });
  };

  return (
    <>
      <Button
        onClick={() => startEdit({ active: 1 })}
        className="mb-3"
        size="sm"
      >
        <Plus className="size-4" />
        インストラクター追加
      </Button>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名前</TableHead>
              <TableHead>単価</TableHead>
              <TableHead className="text-center">IG</TableHead>
              <TableHead className="text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...instructors].sort((a, b) => b.active - a.active).map(i => {
              const myRates = rates.filter(r => r.instructor_id === i.id);
              return (
                <TableRow key={i.id} className="cursor-pointer" onClick={() => setDetail(i)}>
                  <TableCell className="font-medium">{i.name}</TableCell>
                  <TableCell className="text-xs">
                    {myRates.map(r => <span key={r.id} className="mr-2">{r.duration_minutes}分 ¥{r.rate.toLocaleString()}</span>)}
                    {myRates.length === 0 && <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                    {i.instagram_handle
                      ? <a href={`https://www.instagram.com/${i.instagram_handle}/`} target="_blank" rel="noreferrer">
                          <Badge className="bg-pink-100 text-pink-700 hover:bg-pink-200 border-transparent">
                            <Camera className="size-3" />
                            開く
                          </Badge>
                        </a>
                      : <span className="text-muted-foreground text-xs">-</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline">詳細</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
            {instructors.length === 0 && (
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
              <User className="size-4" />
              {detail?.name}
            </DialogTitle>
          </DialogHeader>
          {detail && (() => {
            const myRates = rates.filter(r => r.instructor_id === detail.id);
            const myFees = fees.filter(f => f.instructor_id === detail.id);
            const photoCount = photoCounts.find(p => p.instructor_id === detail.id)?.count ?? 0;
            return (
              <div className="space-y-3 text-sm">
                <div className="flex gap-2 flex-wrap">
                  {detail.instagram_handle && (
                    <a href={`https://www.instagram.com/${detail.instagram_handle}/`} target="_blank" rel="noreferrer">
                      <Badge className="bg-pink-100 text-pink-700 hover:bg-pink-200 border-transparent">
                        <Camera className="size-3" />
                        @{detail.instagram_handle}
                      </Badge>
                    </a>
                  )}
                  {detail.shared_folder_url && (
                    <a href={detail.shared_folder_url} target="_blank" rel="noreferrer">
                      <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-transparent">
                        <FolderOpen className="size-3" />
                        Driveフォルダ
                      </Badge>
                    </a>
                  )}
                  {photoCount > 0 && (
                    <Badge className="bg-emerald-100 text-emerald-700 border-transparent">
                      <Image className="size-3" />
                      写真 {photoCount}枚
                    </Badge>
                  )}
                </div>
                <DetailRow label="フリガナ">{detail.name_kana || '—'}</DetailRow>
                <DetailRow label="メール">{detail.contact_email || '—'}</DetailRow>
                <DetailRow label="電話">{detail.contact_phone || '—'}</DetailRow>
                <DetailRow label="単価">
                  {myRates.length > 0 ? myRates.map(r => <div key={r.id}>{r.duration_minutes}分: ¥{r.rate.toLocaleString()}</div>) : '—'}
                </DetailRow>
                <DetailRow label="交通費">
                  {myFees.length > 0 ? myFees.map(f => {
                    const studio = studios.find(s => s.id === f.studio_id);
                    return <div key={f.id}>{studio?.name ?? `(ID:${f.studio_id})`}: ¥{f.amount.toLocaleString()}</div>;
                  }) : '—'}
                </DetailRow>
                <DetailRow label="プロフィール">{detail.profile_text || '—'}</DetailRow>
                <DetailRow label="給与体系">{detail.salary_type === 'monthly_fixed' ? `固定給 ¥${(detail.monthly_fixed_amount ?? 0).toLocaleString()}/月` : '時給制 (レッスン単価)'}</DetailRow>
                <DetailRow label="銀行">{detail.bank_name || '—'} {detail.bank_branch || ''} / {detail.bank_account_type || ''} {detail.bank_account_number || ''} / {detail.bank_account_holder || ''}</DetailRow>
                <DetailRow label="メモ">{detail.notes || '—'}</DetailRow>
              </div>
            );
          })()}
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
      <Dialog open={!!editing} onOpenChange={open => { if (!open) { setEditing(null); setEditRates([]); setEditFees([]); } }}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'インストラクター編集' : 'インストラクター追加'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <Label className="text-xs">名前*</Label>
                  <Input value={editing.name ?? ''} onChange={e => updateField({ name: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">フリガナ</Label>
                  <Input value={editing.name_kana ?? ''} onChange={e => updateField({ name_kana: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">メール</Label>
                  <Input value={editing.contact_email ?? ''} onChange={e => updateField({ contact_email: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">電話</Label>
                  <Input value={editing.contact_phone ?? ''} onChange={e => updateField({ contact_phone: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Instagram (@なし)</Label>
                  <Input value={editing.instagram_handle ?? ''} onChange={e => updateField({ instagram_handle: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">共有Driveフォルダ URL</Label>
                  <Input value={editing.shared_folder_url ?? ''} onChange={e => updateField({ shared_folder_url: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">プロフィール写真 URL</Label>
                  <Input value={editing.profile_photo_url ?? ''} onChange={e => updateField({ profile_photo_url: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">銀行名</Label>
                  <Input value={editing.bank_name ?? ''} onChange={e => updateField({ bank_name: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">支店</Label>
                  <Input value={editing.bank_branch ?? ''} onChange={e => updateField({ bank_branch: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">口座種別 (普通/当座)</Label>
                  <Input value={editing.bank_account_type ?? ''} onChange={e => updateField({ bank_account_type: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">口座番号</Label>
                  <Input value={editing.bank_account_number ?? ''} onChange={e => updateField({ bank_account_number: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">口座名義</Label>
                  <Input value={editing.bank_account_holder ?? ''} onChange={e => updateField({ bank_account_holder: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">メモ</Label>
                  <Input value={editing.notes ?? ''} onChange={e => updateField({ notes: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">給与体系</Label>
                  <Select
                    value={editing.salary_type ?? 'per_lesson'}
                    onValueChange={v => updateField({ salary_type: v })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="per_lesson">時給制 (レッスン単価)</SelectItem>
                      <SelectItem value="monthly_fixed">固定給 (月額固定)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {editing.salary_type === 'monthly_fixed' && (
                  <div>
                    <Label className="text-xs">固定給額 (月額 ¥)</Label>
                    <Input
                      type="number"
                      value={editing.monthly_fixed_amount ?? ''}
                      onChange={e => updateField({ monthly_fixed_amount: e.target.value === '' ? null : Number(e.target.value) })}
                      placeholder="例: 70000"
                    />
                  </div>
                )}
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  {slugLocked ? (
                    <div>
                      <Label className="text-xs text-muted-foreground">slug (URL用。基本変更不要)</Label>
                      <div className="flex gap-2 items-center">
                        <Input
                          readOnly
                          value={editing.slug ?? ''}
                          className="flex-1 bg-muted cursor-not-allowed"
                        />
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => setSlugConfirmOpen(true)}
                        >
                          <Lock className="size-3" />
                          編集する
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label className="text-xs">slug (URL用。半角英数推奨。日本語もOK)</Label>
                      <div className="flex gap-2 items-center">
                        <Input
                          value={editing.slug ?? ''}
                          onChange={e => updateField({ slug: e.target.value })}
                          className="flex-1"
                        />
                        <Unlock className="size-3.5 text-muted-foreground" />
                      </div>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">ジャンル (例: HIPHOP)</Label>
                    <Input value={editing.genre ?? ''} onChange={e => updateField({ genre: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">クルー (複数なら / で区切り)</Label>
                    <Input value={editing.crews ?? ''} onChange={e => updateField({ crews: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">HP表示順 (小さい順)</Label>
                    <Input
                      type="number"
                      value={editing.public_display_order ?? ''}
                      onChange={e => updateField({ public_display_order: e.target.value === '' ? null : Number(e.target.value) })}
                      placeholder="例: 1"
                    />
                  </div>
                </div>
                <div className="mt-3 space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">動画URL (YouTube)</Label>
                    <Input
                      value={editing.video_url ?? ''}
                      onChange={e => updateField({ video_url: e.target.value })}
                      placeholder="例: https://www.youtube.com/watch?v=ABC123 または ABC123"
                    />
                    <span className="text-[11px] text-muted-foreground mt-0.5 block">
                      YouTube のフルURL or ID
                    </span>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">プロフィール (自己紹介。改行OK)</Label>
                    <Textarea
                      value={editing.profile_text ?? ''}
                      onChange={e => updateField({ profile_text: e.target.value })}
                      rows={4}
                      placeholder="例: HIPHOPダンサー。エネルギッシュなダンスと明るいキャラクターで..."
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">経歴 (受賞歴・出演イベント等。改行OK)</Label>
                    <Textarea
                      value={editing.career_text ?? ''}
                      onChange={e => updateField({ career_text: e.target.value })}
                      rows={5}
                      placeholder={"例:\n2018 JDD vol.19 FINALIST\n2020 全国大会優勝\n2022〜 BOOM 講師"}
                    />
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                  編集後、HPに反映するにはページ上部の「HPに反映」ボタンを押してください。
                  <br />
                  ※ slug は変更しないことを推奨（URL が変わる）
                </p>
              </div>

              {/* 単価設定 */}
              <div className="mt-4">
                <h3 className="font-semibold text-sm mb-2">単価設定</h3>
                {editRates.map((r, i) => (
                  <div key={i} className="flex gap-2 mb-1 items-center">
                    <Input type="number" value={r.duration} onChange={e => {
                      const nr = [...editRates]; nr[i].duration = Number(e.target.value) || 0; setEditRates(nr);
                    }} className="w-20" placeholder="分" />
                    <span className="text-xs">分</span>
                    <Input type="number" value={r.rate} onChange={e => {
                      const nr = [...editRates]; nr[i].rate = Number(e.target.value) || 0; setEditRates(nr);
                    }} className="w-28" placeholder="単価" />
                    <span className="text-xs">¥</span>
                    <Button variant="destructive" size="xs" onClick={() => setEditRates(editRates.filter((_, j) => j !== i))}>
                      <X className="size-3" />
                    </Button>
                  </div>
                ))}
                <Button variant="secondary" size="xs" onClick={() => setEditRates([...editRates, { duration: 90, rate: 0 }])}>
                  <Plus className="size-3" />
                  単価追加
                </Button>
              </div>

              {/* 交通費設定 */}
              <div className="mt-4">
                <h3 className="font-semibold text-sm mb-2">交通費設定 (スタジオ別)</h3>
                {editFees.map((f, i) => (
                  <div key={i} className="flex gap-2 mb-1 items-center">
                    <Select
                      value={f.studio_id ? String(f.studio_id) : ''}
                      onValueChange={v => {
                        const nf = [...editFees]; nf[i].studio_id = Number(v); setEditFees(nf);
                      }}
                    >
                      <SelectTrigger className="w-auto min-w-[140px]">
                        <SelectValue placeholder="スタジオ選択" />
                      </SelectTrigger>
                      <SelectContent>
                        {studios.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input type="number" value={f.amount} onChange={e => {
                      const nf = [...editFees]; nf[i].amount = Number(e.target.value) || 0; setEditFees(nf);
                    }} className="w-28" placeholder="¥" />
                    <Button variant="destructive" size="xs" onClick={() => setEditFees(editFees.filter((_, j) => j !== i))}>
                      <X className="size-3" />
                    </Button>
                  </div>
                ))}
                <Button variant="secondary" size="xs" onClick={() => setEditFees([...editFees, { studio_id: 0, amount: 0 }])}>
                  <Plus className="size-3" />
                  交通費追加
                </Button>
              </div>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); setEditRates([]); setEditFees([]); }}>キャンセル</Button>
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
              このインストラクターを削除します。この操作は取り消せません。
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

      {/* Slug Unlock Confirmation */}
      <AlertDialog open={slugConfirmOpen} onOpenChange={setSlugConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>slug を変更しますか?</AlertDialogTitle>
            <AlertDialogDescription>
              現在: &quot;{originalSlug}&quot;
              <br />
              HPの現在のURL: boom-hp.pages.dev/instructors/{originalSlug}
              <br /><br />
              slug を変更すると、現在のURLが 404 になります。
              SNSやLINEで過去にシェアしたリンクが切れる可能性があります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setSlugLocked(false); setSlugConfirmOpen(false); }}>
              変更する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

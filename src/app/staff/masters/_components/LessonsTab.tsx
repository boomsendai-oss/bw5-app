'use client';

import { useState } from 'react';
import { ClipboardList, Pencil, Plus, Trash2, Globe, Lock, Unlock } from 'lucide-react';
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
import type { Lesson, Studio, Instructor } from './types';
import { DAY_NAMES, dayLabel, TARGET_OPTIONS, LEVEL_OPTIONS, targetLabels, levelLabel } from './types';

type Props = {
  lessons: Lesson[];
  setLessons: React.Dispatch<React.SetStateAction<Lesson[]>>;
  studios: Studio[];
  instructors: Instructor[];
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

export default function LessonsTab({
  lessons, setLessons, studios, instructors, reload, setMsg,
}: Props) {
  const [editing, setEditing] = useState<Partial<Lesson> | null>(null);
  const [detail, setDetail] = useState<Lesson | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [slugLocked, setSlugLocked] = useState(true);
  const [originalSlug, setOriginalSlug] = useState<string | null>(null);
  const [slugConfirmOpen, setSlugConfirmOpen] = useState(false);

  const startEdit = (l: Partial<Lesson>) => {
    setEditing(l);
    setSlugLocked(!!l.id && !!l.slug);
    setOriginalSlug(l.slug ?? null);
  };

  const save = async (data: Partial<Lesson>) => {
    const payload = {
      class_name: data.class_name,
      target: data.target ?? null,
      level: data.level ?? null,
      default_studio_id: data.default_studio_id ?? null,
      default_instructor_id: data.default_instructor_id ?? null,
      default_day_of_week: data.default_day_of_week ?? null,
      default_start_time: data.default_start_time ?? null,
      default_end_time: data.default_end_time ?? null,
      duration_minutes: data.duration_minutes ?? null,
      frequency_type: data.frequency_type ?? null,
      override_rate: data.override_rate ?? null,
      active: data.active ?? 1,
      notes: data.notes ?? null,
      start_date: data.start_date ?? null,
      end_date: data.end_date ?? null,
      description_text: data.description_text ?? null,
      is_public: data.is_public ?? 1,
      video_url: data.video_url ?? null,
      slug: data.slug ?? null,
    };
    setEditing(null);
    if (data.id) {
      setLessons(prev => prev.map(l => l.id === data.id ? { ...l, ...(payload as Partial<Lesson>) } as Lesson : l));
    }
    try {
      if (data.id) {
        await fetch(`/api/staff/master/lessons/${data.id}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`/api/staff/master/lessons`, {
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

  const removeLesson = async (id: number) => {
    setDeleteTarget(null);
    setLessons(prev => prev.map(l => l.id === id ? { ...l, active: 0 } : l));
    try {
      await fetch(`/api/staff/master/lessons/${id}`, { method: 'DELETE', credentials: 'include' });
      reload();
    } catch (e) {
      setMsg(`削除失敗: ${e instanceof Error ? e.message : String(e)}`);
      reload();
    }
  };

  const updateField = (patch: Partial<Lesson>) => {
    if (editing) setEditing({ ...editing, ...patch });
  };

  // 開始/終了から所要分を計算 (HH:MM)
  const calcDuration = (start?: string | null, end?: string | null): number | null => {
    if (!start || !end) return null;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return null;
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    return diff > 0 ? diff : null;
  };

  // 分 → HH:MM
  const fromMinutes = (mins: number): string => {
    const w = ((mins % 1440) + 1440) % 1440;
    return `${String(Math.floor(w / 60)).padStart(2, '0')}:${String(w % 60).padStart(2, '0')}`;
  };

  // 開始変更時: 所要時間を保って新終了を返す
  const shiftEnd = (newStart: string): string | null => {
    if (!editing) return null;
    const [sh, sm] = newStart.split(':').map(Number);
    if (Number.isNaN(sh) || Number.isNaN(sm)) return editing.default_end_time ?? null;
    const keepDur = calcDuration(editing.default_start_time, editing.default_end_time) ?? editing.duration_minutes ?? 60;
    return fromMinutes(sh * 60 + sm + keepDur);
  };

  return (
    <>
      <Button
        onClick={() => startEdit({ active: 1, frequency_type: 'weekly', default_day_of_week: 0, is_public: 1 })}
        className="mb-3"
        size="sm"
      >
        <Plus className="size-4" />
        レッスン追加
      </Button>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-center">曜日</TableHead>
              <TableHead>時刻</TableHead>
              <TableHead>クラス名</TableHead>
              <TableHead>インストラクター</TableHead>
              <TableHead>スタジオ</TableHead>
              <TableHead className="text-center">状態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...lessons].sort((a, b) => b.active - a.active).map(l => (
              <TableRow
                key={l.id}
                className={`cursor-pointer ${l.active === 0 ? 'opacity-50' : ''}`}
                onClick={() => setDetail(l)}
              >
                <TableCell className="text-center font-medium">{dayLabel(l.default_day_of_week)}</TableCell>
                <TableCell className="text-xs font-mono">
                  {l.default_start_time ?? '—'}{l.default_end_time ? `〜${l.default_end_time}` : ''}
                </TableCell>
                <TableCell className="font-medium">{l.class_name}</TableCell>
                <TableCell className="text-xs">{l.instructor_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-xs">{l.studio_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-center">
                  {l.active
                    ? <Badge className="bg-emerald-100 text-emerald-700 border-transparent">有効</Badge>
                    : <Badge variant="secondary">無効</Badge>}
                </TableCell>
              </TableRow>
            ))}
            {lessons.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-6">登録なし</TableCell>
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
              <ClipboardList className="size-4" />
              {detail?.class_name}
              {detail && !detail.active && <Badge variant="secondary">無効</Badge>}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <DetailRow label="曜日">{dayLabel(detail.default_day_of_week)}曜</DetailRow>
              <DetailRow label="時刻">{detail.default_start_time ?? '—'} 〜 {detail.default_end_time ?? '—'}</DetailRow>
              <DetailRow label="所要分">{detail.duration_minutes != null ? `${detail.duration_minutes}分` : '—'}</DetailRow>
              <DetailRow label="スタジオ">{detail.studio_name ?? '—'}</DetailRow>
              <DetailRow label="インストラクター">{detail.instructor_name ?? '—'}</DetailRow>
              <DetailRow label="対象">{targetLabels(detail.target)}</DetailRow>
              <DetailRow label="レベル">{levelLabel(detail.level)}</DetailRow>
              <DetailRow label="頻度">{detail.frequency_type || '—'}</DetailRow>
              <DetailRow label="開始日">{detail.start_date || '—'}</DetailRow>
              <DetailRow label="終了日">{detail.end_date ? `${detail.end_date} (この日がラスト)` : '—'}</DetailRow>
              <DetailRow label="単価上書き">{detail.override_rate != null ? `¥${detail.override_rate.toLocaleString()}` : '—'}</DetailRow>
              <DetailRow label="状態">{detail.active ? '有効' : '無効'}</DetailRow>
              <DetailRow label="メモ">{detail.notes || '—'}</DetailRow>
            </div>
          )}
          <DialogFooter>
            <Button variant="destructive" size="sm" onClick={() => { if (detail) { const id = detail.id; setDetail(null); setDeleteTarget(id); } }}>
              <Trash2 className="size-3.5" />
              削除 (無効化)
            </Button>
            <Button size="sm" onClick={() => { if (detail) { const d = detail; setDetail(null); startEdit(d); } }}>
              <Pencil className="size-3.5" />
              編集する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'レッスン編集' : 'レッスン追加'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 text-sm">
              <div>
                <Label className="text-xs">クラス名*</Label>
                <Input value={editing.class_name ?? ''} onChange={e => updateField({ class_name: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">曜日</Label>
                <Select
                  value={String(editing.default_day_of_week ?? 0)}
                  onValueChange={v => updateField({ default_day_of_week: Number(v) })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAY_NAMES.map((name, i) => <SelectItem key={i} value={String(i)}>{name}曜</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">開始時刻</Label>
                  <Input type="time" value={editing.default_start_time ?? ''} onChange={e => {
                    const start = e.target.value;
                    const newEnd = start ? shiftEnd(start) : editing.default_end_time;
                    updateField({ default_start_time: start, default_end_time: newEnd, duration_minutes: calcDuration(start, newEnd) ?? editing.duration_minutes });
                  }} />
                </div>
                <div>
                  <Label className="text-xs">終了時刻</Label>
                  <Input type="time" value={editing.default_end_time ?? ''} onChange={e => {
                    const end = e.target.value;
                    updateField({ default_end_time: end, duration_minutes: calcDuration(editing.default_start_time, end) ?? editing.duration_minutes });
                  }} />
                </div>
              </div>
              <div>
                <Label className="text-xs">所要分 (開始終了から自動計算)</Label>
                <Input type="number" value={String(editing.duration_minutes ?? '')} onChange={e => updateField({ duration_minutes: e.target.value === '' ? null : (Number(e.target.value) || 0) })} />
              </div>
              <div>
                <Label className="text-xs">スタジオ</Label>
                <Select
                  value={editing.default_studio_id ? String(editing.default_studio_id) : '_none'}
                  onValueChange={v => updateField({ default_studio_id: v === '_none' ? null : Number(v) })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">(未設定)</SelectItem>
                    {studios.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">インストラクター</Label>
                <Select
                  value={editing.default_instructor_id ? String(editing.default_instructor_id) : '_none'}
                  onValueChange={v => updateField({ default_instructor_id: v === '_none' ? null : Number(v) })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">(未設定)</SelectItem>
                    {instructors.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">頻度 (例: weekly)</Label>
                <Input value={editing.frequency_type ?? ''} onChange={e => updateField({ frequency_type: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">単価上書き (¥・空欄でインストラクター標準単価)</Label>
                <Input type="number" value={editing.override_rate == null ? '' : String(editing.override_rate)} onChange={e => updateField({ override_rate: e.target.value === '' ? null : (Number(e.target.value) || 0) })} />
              </div>
              <div>
                <Label className="text-xs">社内メモ</Label>
                <Input value={editing.notes ?? ''} onChange={e => updateField({ notes: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">開始日 (この日から開講・空欄=制限なし)</Label>
                <Input type="date" value={editing.start_date ?? ''} onChange={e => updateField({ start_date: e.target.value === '' ? null : e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">終了日 (この日がラスト・空欄=制限なし)</Label>
                <Input type="date" value={editing.end_date ?? ''} onChange={e => updateField({ end_date: e.target.value === '' ? null : e.target.value })} />
              </div>
              <label className="flex items-center gap-2 pt-1">
                <input type="checkbox" checked={!!editing.active} onChange={e => updateField({ active: e.target.checked ? 1 : 0 })} />
                <span className="text-sm">有効</span>
              </label>

              {/* HP公開情報 */}
              <div className="border-t-2 border-orange-200 pt-4 mt-4">
                <h3 className="font-bold text-sm mb-3 text-orange-700 flex items-center gap-2">
                  <Globe className="size-4" />
                  HP公開情報
                  <span className="text-xs font-normal text-muted-foreground">
                    boom-hp.pages.dev/classes に表示される
                  </span>
                </h3>
                <div className="space-y-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!editing.is_public}
                      onChange={e => updateField({ is_public: e.target.checked ? 1 : 0 })}
                    />
                    <span className="text-sm">HPに表示</span>
                  </label>
                  <div>
                    <Label className="text-xs">対象</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {TARGET_OPTIONS.map(opt => {
                        const selected = (editing.target ?? '').split(',').filter(Boolean);
                        const checked = selected.includes(opt.value);
                        return (
                          <label key={opt.value} className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={e => {
                                let next: string[];
                                if (e.target.checked) {
                                  next = [...selected, opt.value];
                                } else {
                                  next = selected.filter(v => v !== opt.value);
                                }
                                updateField({ target: next.length > 0 ? next.join(',') : null });
                              }}
                            />
                            {opt.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">レベル</Label>
                    <Select
                      value={editing.level ?? '_none'}
                      onValueChange={v => updateField({ level: v === '_none' ? null : v })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">(未設定)</SelectItem>
                        {LEVEL_OPTIONS.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">クラス説明 (HPの体験予約導線。改行OK)</Label>
                    <Textarea
                      value={editing.description_text ?? ''}
                      onChange={e => updateField({ description_text: e.target.value })}
                      rows={4}
                      placeholder="例: 腕を大きく振るダイナミックなダンス。表現力を磨きたい方にオススメです。"
                    />
                  </div>
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
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>キャンセル</Button>
            <Button onClick={() => editing && save(editing)}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete (Deactivate) Confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>このレッスンを無効化しますか?</AlertDialogTitle>
            <AlertDialogDescription>
              レッスンを無効化 (active=0) します。データは残りますが、スケジュール生成の対象外になります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteTarget !== null && removeLesson(deleteTarget)}>
              無効化する
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
              HPの現在のURL: boom-hp.pages.dev/classes/{originalSlug}
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

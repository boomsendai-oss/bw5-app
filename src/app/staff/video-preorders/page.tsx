'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Mail, CreditCard, Clock, CheckCircle2, Copy, RotateCcw, Search } from 'lucide-react';
import StaffPageHeader from '@/components/StaffPageHeader';

type Preorder = {
  id: number;
  merch_id: number;
  buyer_name: string;
  email: string | null;
  phone: string | null;
  note: string | null;
  status: string | null;
  created_at: string;
  confirmation_email_sent_at: string | null;
  payment_link_sent_at: string | null;
  payment_paid_at: string | null;
  merch_name: string | null;
  price: number | null;
};

type ConfirmAction = {
  type: 'confirmation' | 'payment_link' | 'payment_reminder';
  ids: number[];
  label: string;
} | null;

export default function VideoPreordersPage() {
  const [preorders, setPreorders] = useState<Preorder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'duplicate' | 'unsent' | 'sent'>('active');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff/video-preorders', { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/video-preorders';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPreorders(data.preorders || []);
    } catch (e) {
      toast.error(`読み込み失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return preorders.filter(p => {
      if (filter === 'active' && p.status === 'duplicate') return false;
      if (filter === 'duplicate' && p.status !== 'duplicate') return false;
      if (filter === 'unsent' && (p.confirmation_email_sent_at || p.status === 'duplicate')) return false;
      if (filter === 'sent' && !p.confirmation_email_sent_at) return false;
      if (qLower) {
        const hay = `${p.buyer_name} ${p.email ?? ''} ${p.phone ?? ''}`.toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      return true;
    });
  }, [preorders, filter, q]);

  const toggleSelect = (id: number) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  };

  const selectAllVisible = () => {
    const s = new Set(selected);
    for (const p of filtered) {
      if (p.status === 'duplicate') continue;
      if (p.confirmation_email_sent_at) continue;
      if (!p.email) continue;
      s.add(p.id);
    }
    setSelected(s);
  };

  const clearSelection = () => setSelected(new Set());

  const executeSendConfirmation = async (ids: number[]) => {
    setBusy(true);
    toast.info(`${ids.length}件 送信中...`);
    const idSet = new Set(ids);
    const nowIso = new Date().toISOString();
    setPreorders(prev => prev.map(p => idSet.has(p.id) && !p.confirmation_email_sent_at
      ? { ...p, confirmation_email_sent_at: nowIso }
      : p));
    setSelected(new Set());
    try {
      const res = await fetch('/api/staff/video-preorders/send-confirmation', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(`送信完了: 成功 ${data.sent} / スキップ ${data.skipped} / 失敗 ${data.failed}`);
      load();
    } catch (e) {
      toast.error(`送信失敗: ${e instanceof Error ? e.message : String(e)}`);
      load();
    } finally {
      setBusy(false);
    }
  };

  const executeSendPaymentReminder = async () => {
    setBusy(true);
    toast.info('リマインダー送信中...');
    const targetIds = preorders
      .filter(p => p.payment_link_sent_at && !p.payment_paid_at && p.status !== 'duplicate' && p.status !== 'cancelled' && p.email)
      .map(p => p.id);
    if (targetIds.length === 0) {
      toast.info('対象なし (未払い・リンク送信済 が0件)');
      setBusy(false);
      return;
    }
    try {
      const res = await fetch('/api/staff/video-preorders/send-payment-reminder', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'manual', ids: targetIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(`リマインダー送信完了: 成功 ${data.sent} / 失敗 ${data.failed} (期限まで${data.daysRemaining}日)`);
      load();
    } catch (e) {
      toast.error(`送信失敗: ${e instanceof Error ? e.message : String(e)}`);
      load();
    } finally {
      setBusy(false);
    }
  };

  const executeSendPaymentLink = async (ids: number[]) => {
    setBusy(true);
    toast.info(`${ids.length}件 決済リンク送信中...`);
    const idSet = new Set(ids);
    const nowIso = new Date().toISOString();
    setPreorders(prev => prev.map(p => idSet.has(p.id)
      ? { ...p, payment_link_sent_at: p.payment_link_sent_at ?? nowIso }
      : p));
    setSelected(new Set());
    try {
      const res = await fetch('/api/staff/video-preorders/send-payment-link', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(`決済リンク送信完了: 成功 ${data.sent} / スキップ ${data.skipped} / 失敗 ${data.failed}`);
      load();
    } catch (e) {
      toast.error(`送信失敗: ${e instanceof Error ? e.message : String(e)}`);
      load();
    } finally {
      setBusy(false);
    }
  };

  const markStatus = async (id: number, status: 'active' | 'duplicate' | 'cancelled') => {
    setBusy(true);
    setPreorders(prev => prev.map(p => p.id === id ? { ...p, status } : p));
    try {
      const res = await fetch(`/api/staff/video-preorders/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      toast.success(`#${id} を ${status} に変更`);
      load();
    } catch (e) {
      toast.error(`更新失敗: ${e instanceof Error ? e.message : String(e)}`);
      load();
    } finally {
      setBusy(false);
    }
  };

  const fmtDateTime = (iso: string | null) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
      return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const counts = useMemo(() => ({
    total: preorders.length,
    active: preorders.filter(p => p.status !== 'duplicate' && p.status !== 'cancelled').length,
    duplicate: preorders.filter(p => p.status === 'duplicate').length,
    sent: preorders.filter(p => p.confirmation_email_sent_at).length,
    unsent: preorders.filter(p => !p.confirmation_email_sent_at && p.status !== 'duplicate').length,
  }), [preorders]);

  const handleConfirmAction = () => {
    if (!confirmAction) return;
    const { type, ids } = confirmAction;
    setConfirmAction(null);
    if (type === 'confirmation') executeSendConfirmation(ids);
    else if (type === 'payment_link') executeSendPaymentLink(ids);
    else if (type === 'payment_reminder') executeSendPaymentReminder();
  };

  return (
    <div>
      <StaffPageHeader
        title="映像予約 管理"
        description="BW5映像データ予約・確認メール・支払いリンク管理"
      />
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { label: '全体', v: counts.total, variant: 'secondary' as const },
            { label: '有効', v: counts.active, className: 'bg-emerald-100 text-emerald-800' },
            { label: '重複', v: counts.duplicate, className: 'bg-red-100 text-red-800' },
            { label: '確認メール送信済', v: counts.sent, className: 'bg-blue-100 text-blue-800' },
            { label: '未送信', v: counts.unsent, className: 'bg-amber-100 text-amber-800' },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className={`py-2 px-3 ${s.className ?? ''}`}>
                <div className="text-[10px] sm:text-xs">{s.label}</div>
                <div className="text-lg sm:text-xl font-bold">{s.v}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filter + search */}
        <div className="flex flex-wrap gap-2">
          {([
            ['all', '全て'],
            ['active', '有効のみ'],
            ['unsent', '未送信のみ'],
            ['sent', '送信済のみ'],
            ['duplicate', '重複のみ'],
          ] as const).map(([k, label]) => (
            <Button
              key={k}
              variant={filter === k ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(k)}
            >
              {label}
            </Button>
          ))}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="名前/メアド/電話で検索"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        {/* Bulk actions */}
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="secondary" size="sm" onClick={selectAllVisible} disabled={busy}>
            表示中の未送信を全選択
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSelection} disabled={busy || selected.size === 0}>
            選択解除
          </Button>
          <span className="text-xs text-muted-foreground">選択中: {selected.size}件</span>
          <Button
            size="sm"
            onClick={() => setConfirmAction({ type: 'confirmation', ids: Array.from(selected), label: `${selected.size}件に確認メールを送信します。よろしいですか?` })}
            disabled={busy || selected.size === 0}
          >
            <Mail className="size-3.5 mr-1" />選択中{selected.size}件に確認メール送信
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => setConfirmAction({ type: 'payment_link', ids: Array.from(selected), label: `${selected.size}件に決済リンクを送信します。よろしいですか?` })}
            disabled={busy || selected.size === 0}
          >
            <CreditCard className="size-3.5 mr-1" />選択中{selected.size}件に決済リンク送信
          </Button>
          <Button
            size="sm"
            className="bg-amber-500 hover:bg-amber-600 text-white"
            onClick={() => setConfirmAction({ type: 'payment_reminder', ids: [], label: '未払いの方全員にリマインダーを送信します。よろしいですか?' })}
            disabled={busy}
          >
            <Clock className="size-3.5 mr-1" />未払い者にリマインダー送信
          </Button>
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-muted-foreground">読み込み中...</p>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">選</TableHead>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>お名前</TableHead>
                  <TableHead>メール</TableHead>
                  <TableHead>電話</TableHead>
                  <TableHead>予約日</TableHead>
                  <TableHead>確認メール</TableHead>
                  <TableHead>決済リンク</TableHead>
                  <TableHead>支払い</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(p => {
                  const isDup = p.status === 'duplicate';
                  const isSent = !!p.confirmation_email_sent_at;
                  const canSelect = !isDup && !isSent && !!p.email;
                  return (
                    <TableRow key={p.id} className={isDup ? 'opacity-50' : ''}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                          disabled={!canSelect}
                        />
                      </TableCell>
                      <TableCell>{p.id}</TableCell>
                      <TableCell>
                        {isDup
                          ? <Badge variant="destructive" className="text-[10px]"><Copy className="size-2.5 mr-0.5" />重複</Badge>
                          : p.status === 'cancelled'
                          ? <Badge variant="secondary" className="text-[10px]">取消</Badge>
                          : <Badge className="bg-emerald-100 text-emerald-700 text-[10px]" variant="outline"><CheckCircle2 className="size-2.5 mr-0.5" />有効</Badge>}
                      </TableCell>
                      <TableCell className="font-medium">{p.buyer_name}</TableCell>
                      <TableCell>{p.email || <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell>{p.phone || '-'}</TableCell>
                      <TableCell className="text-xs">{fmtDateTime(p.created_at)}</TableCell>
                      <TableCell>
                        {isSent
                          ? <span className="text-blue-700 text-[11px] flex items-center gap-0.5"><Mail className="size-3" />{fmtDateTime(p.confirmation_email_sent_at)}</span>
                          : <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-[10px]">未送信</Badge>}
                      </TableCell>
                      <TableCell>
                        {p.payment_link_sent_at
                          ? <span className="text-emerald-700 text-[11px] flex items-center gap-0.5"><CreditCard className="size-3" />{fmtDateTime(p.payment_link_sent_at)}</span>
                          : <span className="text-muted-foreground text-[11px]">未送信</span>}
                      </TableCell>
                      <TableCell>
                        {p.payment_paid_at
                          ? <Badge className="bg-emerald-100 text-emerald-800 text-[10px]" variant="outline"><CheckCircle2 className="size-2.5 mr-0.5" />支払済</Badge>
                          : <span className="text-muted-foreground text-[11px]">-</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {isDup
                          ? <Button variant="secondary" size="xs" onClick={() => markStatus(p.id, 'active')} disabled={busy}><RotateCcw className="size-2.5 mr-0.5" />有効に戻す</Button>
                          : <Button variant="destructive" size="xs" onClick={() => markStatus(p.id, 'duplicate')} disabled={busy}><Copy className="size-2.5 mr-0.5" />重複マーク</Button>}
                        {p.email && (
                          <>
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => setConfirmAction({ type: 'confirmation', ids: [p.id], label: `#${p.id} に確認メールを送信します。よろしいですか?` })}
                              disabled={busy || isDup}
                              className="ml-1 border-blue-200 text-blue-700"
                            >
                              {isSent ? '再送' : '確認'}
                            </Button>
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => setConfirmAction({ type: 'payment_link', ids: [p.id], label: `#${p.id} に決済リンクを送信します。よろしいですか?` })}
                              disabled={busy || isDup || !!p.payment_paid_at}
                              className="ml-1 border-emerald-200 text-emerald-700"
                            >
                              <CreditCard className="size-2.5 mr-0.5" />{p.payment_link_sent_at ? '再送' : '送信'}
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">該当なし</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Confirm dialog for send actions */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>送信確認</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.label}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction}>送信する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

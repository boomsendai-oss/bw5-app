'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { Ban, Clock, ClipboardList, Check, X, ShieldCheck } from 'lucide-react';

type CancelReq = {
  id: number;
  instructor_id: number;
  instructor_name: string;
  instructor_email: string | null;
  lesson_date: string;
  master_id: number | null;
  instance_id: number | null;
  reason: string;
  substitute_instructor_id: number | null;
  substitute_name: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

type ConfirmState = {
  id: number;
  status: 'approved' | 'rejected';
  applyToInstance: boolean;
} | null;

export default function CancelRequestsPage() {
  const [tab, setTab] = useState<string>('pending');
  const [items, setItems] = useState<CancelReq[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/cancel-requests?status=${tab}`, { credentials: 'include' });
      if (res.status === 401) { window.location.href = '/staff/events/login?next=/staff/cancel-requests'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setItems(d.requests ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const openConfirm = (id: number, status: 'approved' | 'rejected', applyToInstance: boolean) => {
    setConfirmState({ id, status, applyToInstance });
  };

  const executeDecision = async () => {
    if (!confirmState) return;
    const { id, status, applyToInstance } = confirmState;
    setConfirmState(null);

    const nowIso = new Date().toISOString();
    setItems(prev => prev.map(it =>
      it.id === id
        ? { ...it, status, reviewed_by: 'TARO', reviewed_at: nowIso }
        : it
    ));

    try {
      const res = await fetch(`/api/staff/cancel-requests/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, apply: applyToInstance, reviewer: 'TARO' }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(status === 'approved' ? '承認しました' : '却下しました');
      load();
    } catch (e) {
      toast.error(`失敗: ${e instanceof Error ? e.message : String(e)}`);
      load();
    }
  };

  const statusBadge = (s: CancelReq['status']) => {
    switch (s) {
      case 'pending': return <Badge className="bg-amber-100 text-amber-700 border-amber-200" variant="outline"><Clock className="size-3 mr-0.5" />審査中</Badge>;
      case 'approved': return <Badge className="bg-green-100 text-green-700 border-green-200" variant="outline"><Check className="size-3 mr-0.5" />承認済</Badge>;
      case 'rejected': return <Badge className="bg-red-100 text-red-700 border-red-200" variant="outline"><X className="size-3 mr-0.5" />却下</Badge>;
    }
  };

  return (
    <div className="text-foreground">
      <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Ban className="size-5 text-orange-600" />
          <h1 className="text-lg font-bold text-orange-600">休講申請</h1>
          <span className="text-xs text-muted-foreground">インストラクターからの休講申請を確認・承認</span>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList variant="line">
            <TabsTrigger value="pending"><Clock className="size-3.5 mr-1" />審査中</TabsTrigger>
            <TabsTrigger value="all"><ClipboardList className="size-3.5 mr-1" />すべて</TabsTrigger>
          </TabsList>

          <TabsContent value={tab}>
            {loading && <p className="text-muted-foreground text-sm">読込中...</p>}
            {!loading && items.length === 0 && (
              <Card><CardContent className="py-6 text-center text-muted-foreground text-sm">申請なし</CardContent></Card>
            )}

            {items.length > 0 && (
              <div className="space-y-2">
                {items.map(req => (
                  <Card key={req.id} className={
                    req.status === 'pending' ? 'border-amber-300' : req.status === 'approved' ? 'border-green-300' : 'border-red-300'
                  }>
                    <CardContent className="pt-3 pb-3 space-y-2">
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{req.instructor_name}</span>
                          {statusBadge(req.status)}
                        </div>
                        <span className="font-mono text-sm">{req.lesson_date}</span>
                      </div>
                      <div className="text-sm bg-muted rounded p-2">
                        <div><span className="text-xs text-muted-foreground">理由: </span>{req.reason}</div>
                        {req.substitute_name && <div className="mt-1 text-xs"><span className="text-muted-foreground">希望代講: </span>{req.substitute_name}</div>}
                      </div>
                      <div className="text-[10px] text-muted-foreground">申請日時: {new Date(req.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</div>
                      {req.status === 'pending' && (
                        <div className="flex gap-2 flex-wrap">
                          <Button size="sm" onClick={() => openConfirm(req.id, 'approved', true)} className="bg-green-500 hover:bg-green-600 text-white">
                            <ShieldCheck className="size-3.5 mr-1" />承認 (レッスン自動休講化)
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openConfirm(req.id, 'approved', false)} className="border-green-300 text-green-700 hover:bg-green-50">
                            <Check className="size-3.5 mr-1" />承認のみ (休講化は手動で)
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => openConfirm(req.id, 'rejected', false)}>
                            <X className="size-3.5 mr-1" />却下
                          </Button>
                        </div>
                      )}
                      {req.status !== 'pending' && req.reviewed_at && (
                        <div className="text-[10px] text-muted-foreground">
                          {req.reviewed_by ?? 'staff'} が {new Date(req.reviewed_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} に処理
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={!!confirmState} onOpenChange={(open) => { if (!open) setConfirmState(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmState?.status === 'approved' ? '承認確認' : '却下確認'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              この休講申請を{confirmState?.status === 'approved' ? '承認' : '却下'}しますか?
              {confirmState?.applyToInstance && confirmState?.status === 'approved' && (
                <span className="block mt-1">(該当レッスンを自動で「休講」化します)</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeDecision}
              variant={confirmState?.status === 'rejected' ? 'destructive' : 'default'}
            >
              {confirmState?.status === 'approved' ? '承認する' : '却下する'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

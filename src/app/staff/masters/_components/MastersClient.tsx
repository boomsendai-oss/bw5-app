'use client';

import { useCallback, useEffect, useState } from 'react';
import { Globe, ExternalLink, RefreshCw, Loader2, MapPin, User, ClipboardList } from 'lucide-react';
import StaffPageHeader from '@/components/StaffPageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Studio, Instructor, Rate, TransitFee, PhotoCount, Lesson } from './types';
import StudiosTab from './StudiosTab';
import InstructorsTab from './InstructorsTab';
import LessonsTab from './LessonsTab';

export default function MastersClient() {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [fees, setFees] = useState<TransitFee[]>([]);
  const [photoCounts, setPhotoCounts] = useState<PhotoCount[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  // HP deploy state
  const [hpDeploying, setHpDeploying] = useState(false);
  const [hpDeployMsg, setHpDeployMsg] = useState<string | null>(null);
  const [hpDeployConfirmOpen, setHpDeployConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, i, l] = await Promise.all([
        fetch('/api/staff/master/studios', { credentials: 'include' }),
        fetch('/api/staff/master/instructors', { credentials: 'include' }),
        fetch('/api/staff/master/lessons?all=1', { credentials: 'include' }),
      ]);
      if (s.status === 401 || i.status === 401 || l.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/masters';
        return;
      }
      const sData = await s.json();
      const iData = await i.json();
      const lData = await l.json();
      setStudios(sData.studios || []);
      setInstructors(iData.instructors || []);
      setRates(iData.rates || []);
      setFees(iData.transit_fees || []);
      setPhotoCounts(iData.photo_counts || []);
      setLessons(lData.lessons || []);
    } catch (e) {
      setMsg(`読込失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const triggerHpDeploy = async () => {
    setHpDeployConfirmOpen(false);
    if (hpDeploying) return;
    setHpDeploying(true);
    setHpDeployMsg(null);
    try {
      const r = await fetch('/api/staff/hp-deploy', {
        method: 'POST',
        credentials: 'include',
      });
      const j = await r.json();
      if (r.ok) {
        setHpDeployMsg(j.message ?? 'デプロイ開始');
      } else {
        setHpDeployMsg(`エラー: ${j.error ?? '不明なエラー'}`);
      }
    } catch (e) {
      setHpDeployMsg(`通信エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setHpDeploying(false);
    }
  };

  return (
    <div>
      <StaffPageHeader title="マスタ管理" />
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
      {msg && (
        <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-sm">
          {msg}
        </div>
      )}

      {/* HPに反映バー */}
      <div className="mb-4 p-3 bg-brand-50 border border-brand-200 rounded-lg flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-slate-700">
          <span className="font-semibold flex items-center gap-1 inline-flex">
            <Globe className="size-4" />
            BOOM HP
          </span>
          <span className="text-slate-500 ml-2">編集内容はHPに自動反映されません。「反映」を押すと再ビルドが走ります。</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="https://boom-hp.pages.dev" target="_blank" rel="noreferrer">
              HPを開く
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
          <Button
            size="sm"
            disabled={hpDeploying}
            onClick={() => setHpDeployConfirmOpen(true)}
          >
            {hpDeploying ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {hpDeploying ? 'デプロイ中...' : 'HPに反映'}
          </Button>
        </div>
        {hpDeployMsg && (
          <div className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded p-2 mt-1">
            {hpDeployMsg}
          </div>
        )}
      </div>

      {/* HP Deploy Confirmation */}
      <AlertDialog open={hpDeployConfirmOpen} onOpenChange={setHpDeployConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>HPに最新データを反映しますか?</AlertDialogTitle>
            <AlertDialogDescription>
              DBの内容を取得して boom-hp.pages.dev を再ビルドします。3〜5分で完了します。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={triggerHpDeploy}>
              反映する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {loading && <p className="text-muted-foreground text-sm">読込中...</p>}

      {!loading && (
        <Tabs defaultValue="studios">
          <TabsList>
            <TabsTrigger value="studios">
              <MapPin className="size-3.5" />
              スタジオ ({studios.length})
            </TabsTrigger>
            <TabsTrigger value="instructors">
              <User className="size-3.5" />
              インストラクター ({instructors.length})
            </TabsTrigger>
            <TabsTrigger value="lessons">
              <ClipboardList className="size-3.5" />
              レッスン ({lessons.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="studios">
            <StudiosTab
              studios={studios}
              setStudios={setStudios}
              reload={load}
              setMsg={setMsg}
            />
          </TabsContent>

          <TabsContent value="instructors">
            <InstructorsTab
              instructors={instructors}
              setInstructors={setInstructors}
              rates={rates}
              fees={fees}
              photoCounts={photoCounts}
              studios={studios}
              reload={load}
              setMsg={setMsg}
            />
          </TabsContent>

          <TabsContent value="lessons">
            <LessonsTab
              lessons={lessons}
              setLessons={setLessons}
              studios={studios}
              instructors={instructors}
              reload={load}
              setMsg={setMsg}
            />
          </TabsContent>
        </Tabs>
      )}
      </div>
    </div>
  );
}

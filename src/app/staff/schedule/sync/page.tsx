'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Building2, MessageSquare, RefreshCw, Copy, ExternalLink, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// ============================================================
// カレンダー連携ハブ
// マスター = BW5レッスンカレンダー (/staff/schedule/calendar)
// 3つの外部カレンダーへ配信する設定・手順・接続状況を1画面に集約。
//
// 連携方式:
//   Google   : 自動 (ICS購読)
//   HACOMONO : 半自動 (CSVダウンロード→インポート)
//   Lstep    : 層2自動 (休講ブロックICS購読) + 層1手動 (枠構造)
//
// 実エクスポートは既存APIを流用 (新規ロジックなし):
//   GET /api/staff/schedule/export/token
//   GET /api/staff/schedule/export/ics?token=X&months=N           (Googleレッスン)
//   GET /api/staff/schedule/export/ics?token=X&months=N&mode=block (Lstep休講ブロック)
//   GET /api/staff/schedule/export/hacomono?months=N              (HACOMONO形式CSV)
// ============================================================

export default function ScheduleSyncPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenErr, setTokenErr] = useState<string>('');
  const [origin] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.origin : '',
  );

  useEffect(() => {
    let cancelled = false;
    fetch('/api/staff/schedule/export/token', { credentials: 'include' })
      .then(r => {
        if (r.status === 401) {
          window.location.href = '/staff/events/login?next=/staff/schedule/sync';
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { token?: string } | null) => {
        if (!cancelled && d) setToken(d.token ?? null);
      })
      .catch(e => {
        if (!cancelled) setTokenErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const icsUrl = token && origin ? `${origin}/api/staff/schedule/export/ics?token=${token}&months=3` : '';
  const blockIcsUrl =
    token && origin ? `${origin}/api/staff/schedule/export/ics?token=${token}&months=3&mode=block` : '';

  // ===== Google所有カレンダー連携 (Lstep休講ブロック用) =====
  const [gcalConnected, setGcalConnected] = useState<boolean | null>(null);
  const [gcalId, setGcalId] = useState<string | null>(null);
  const [gcalSyncing, setGcalSyncing] = useState(false);
  const [gcalMsg, setGcalMsg] = useState<string>('');

  // ===== 公開Googleレッスンカレンダー (sync-lesson-calendar / 差分同期) =====
  const [lcConnected, setLcConnected] = useState<boolean | null>(null);
  const [lcEmbedUrl, setLcEmbedUrl] = useState<string | null>(null);
  const [lcSyncing, setLcSyncing] = useState(false);
  const [lcMsg, setLcMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/staff/schedule/sync-lesson-calendar', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { connected?: boolean; embedUrl?: string | null } | null) => {
        if (!cancelled && d) {
          setLcConnected(!!d.connected);
          setLcEmbedUrl(d.embedUrl ?? null);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const runLessonSync = async () => {
    setLcSyncing(true);
    setLcMsg('');
    try {
      const res = await fetch('/api/staff/schedule/sync-lesson-calendar?months=3', {
        method: 'POST',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok) {
        setLcMsg(`${d.error ?? res.status}`);
        return;
      }
      setLcEmbedUrl(d.embedUrl ?? null);
      setLcMsg(`同期完了：全${d.total}件（新規 ${d.created} / 更新 ${d.updated} / 維持 ${d.kept} / 削除 ${d.deleted}）`);
    } catch (e) {
      setLcMsg(e instanceof Error ? e.message : '通信エラー');
    } finally {
      setLcSyncing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/staff/schedule/sync-google-calendar', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { connected?: boolean; calendarId?: string | null } | null) => {
        if (!cancelled && d) {
          setGcalConnected(!!d.connected);
          setGcalId(d.calendarId ?? null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const runGcalSync = async () => {
    setGcalSyncing(true);
    setGcalMsg('');
    try {
      const res = await fetch('/api/staff/schedule/sync-google-calendar?months=3', {
        method: 'POST',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok) {
        setGcalMsg(`${d.error ?? res.status}`);
        return;
      }
      setGcalId(d.calendarId ?? null);
      setGcalMsg(`同期完了：休講 ${d.total_cancelled}件（新規 ${d.created} / 維持 ${d.kept} / 削除 ${d.deleted}）`);
    } catch (e) {
      setGcalMsg(e instanceof Error ? e.message : '通信エラー');
    } finally {
      setGcalSyncing(false);
    }
  };

  return (
    <div className="pb-20">
      <div className="max-w-3xl mx-auto px-3 py-4 space-y-4">
        {tokenErr && (
          <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-xs">
            購読トークン取得エラー: {tokenErr}（一部URLが表示されません。再読込してください）
          </div>
        )}

        {/* ===== 連携状況サマリ ===== */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-orange-800">マスター = BW5レッスンカレンダー</CardTitle>
            <CardDescription className="text-[11px]">
              すべての配信元は{' '}
              <Link href="/staff/schedule/calendar" className="text-orange-600 underline font-semibold">
                レッスンカレンダー
              </Link>{' '}
              です。ここを編集すれば、下の3カレンダーへ反映できます（自動/手動は方式により異なる）。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">カレンダー</TableHead>
                  <TableHead className="text-[11px]">用途</TableHead>
                  <TableHead className="text-[11px]">連携方式</TableHead>
                  <TableHead className="text-[11px]">反映</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-[11px] font-semibold"><CalendarDays className="inline size-3.5 mr-1" />Google</TableCell>
                  <TableCell className="text-[11px]">関係者の予定共有</TableCell>
                  <TableCell className="text-[11px]"><Badge variant="default" className="bg-green-600 text-[10px]">自動</Badge> ICS購読</TableCell>
                  <TableCell className="text-[11px]">編集すれば自動反映</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-[11px] font-semibold"><Building2 className="inline size-3.5 mr-1" />HACOMONO</TableCell>
                  <TableCell className="text-[11px]">会員予約カレンダー</TableCell>
                  <TableCell className="text-[11px]"><Badge variant="outline" className="text-amber-700 border-amber-300 text-[10px]">半自動</Badge> CSV</TableCell>
                  <TableCell className="text-[11px]">CSV出力→インポート</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-[11px] font-semibold"><MessageSquare className="inline size-3.5 mr-1" />Lstep</TableCell>
                  <TableCell className="text-[11px]">体験予約カレンダー</TableCell>
                  <TableCell className="text-[11px]"><Badge variant="default" className="bg-green-600 text-[10px]">層2自動</Badge> + <Badge variant="secondary" className="text-[10px]">層1手動</Badge></TableCell>
                  <TableCell className="text-[11px]">休講=自動 / 枠構造=手動</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ===== カード0: 公開Googleレッスンカレンダー (差分同期・本命) ===== */}
        <SyncCard
          icon={<CalendarDays className="size-5 text-orange-600" />}
          title="公開Googleレッスンカレンダー"
          subtitle="生徒・スタッフ・関係者みんなで共有"
          statusLabel="1時間ごと自動 + 手動"
          statusVariant="default"
        >
          <p className="text-[11px] text-neutral-600 leading-relaxed">
            BOOMが所有する<b>公開Googleカレンダー</b>に、アプリのレッスン予定を反映します。
            <b>1時間ごとに自動同期</b>されます。変更を<b>すぐ反映したいときは下のボタン</b>を押してください（差分のみ書き換えるので何度押してもOK）。
          </p>

          {lcConnected === false && (
            <NoteBox tone="amber">
              Googleカレンダー未連携です。下の「Lstep」カードの「Googleカレンダーを連携する」から連携してください（同じ連携を共用します）。
            </NoteBox>
          )}

          {lcEmbedUrl && (
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold mb-0.5">生徒に渡す公開リンク（このまま共有OK）</p>
              <CopyUrlBox url={lcEmbedUrl} onCopied={() => setLcMsg('公開リンクをコピーしました')} />
            </div>
          )}

          <Button
            onClick={runLessonSync}
            disabled={lcSyncing}
            className="w-full"
          >
            <RefreshCw className={`size-4 ${lcSyncing ? 'animate-spin' : ''}`} />
            {lcSyncing ? '同期中...' : '今すぐGoogleカレンダーへ同期する'}
          </Button>
          {lcMsg && <p className="text-[11px] text-neutral-700">{lcMsg}</p>}

          <NoteBox tone="neutral">
            押し忘れても1時間以内に自動で反映されます。急ぎのときだけボタンを押せばOKです。
          </NoteBox>
        </SyncCard>

        {/* ===== カード1: Google ===== */}
        <SyncCard
          icon={<CalendarDays className="size-5 text-orange-600" />}
          title="Googleカレンダー"
          subtitle="関係者の予定共有"
          statusLabel="自動同期"
          statusVariant="default"
        >
          <p className="text-[11px] text-neutral-600 leading-relaxed">
            下のICS購読URLをGoogleカレンダーに登録すると、BW5レッスンが自動反映されます。休講にした回は「キャンセル済み」で表示されます。
          </p>

          <TokenUrlBox label="ICS購読URL (3ヶ月分)" url={icsUrl} token={token} tokenErr={tokenErr} />

          <StepsList
            title="設定手順"
            items={[
              '上のURLをコピー',
              'Googleカレンダー左の「他のカレンダー」+ → 「URLで追加」',
              'URLを貼り付けて「カレンダーを追加」',
            ]}
          />
          <NoteBox tone="neutral">
            一般公開は不要です。反映はGoogle側の都合で数時間〜最大1日かかる場合があります。
          </NoteBox>
          <p className="text-[11px] text-green-700 font-semibold flex items-center gap-1"><Info className="size-3" /> BW5レッスンが自動反映されます。</p>
        </SyncCard>

        {/* ===== カード2: HACOMONO ===== */}
        <SyncCard
          icon={<Building2 className="size-5 text-orange-600" />}
          title="HACOMONO 会員予約カレンダー"
          subtitle="会員の予約枠"
          statusLabel="半自動 (CSV)"
          statusVariant="outline"
        >
          <p className="text-[11px] text-neutral-600 leading-relaxed">
            HACOMONOは毎週レッスン枠を自動生成します。アプリの実予定とズレる「消すべき枠」（5週目・全休・休講・月1/2回クラスの非開催週）を、月ごとに自動リスト化します。
          </p>

          <Link
            href="/staff/schedule/hacomono-tasks"
            className="block"
          >
            <Button className="w-full">
              <Building2 className="size-4" />
              今月のHACOMONO調整リストを見る
            </Button>
          </Link>

          <details className="text-[11px]">
            <summary className="cursor-pointer text-muted-foreground">CSV取込（全件インポート用・上級者向け）</summary>
            <div className="pt-2">
              <p className="text-[11px] text-muted-foreground leading-relaxed mb-1.5">
                <AlertTriangle className="inline size-3 mr-0.5" /> HACOMONOは枠を自動生成済みのため、全件インポートすると枠が二重になります。通常は上の「調整リスト」を使ってください。
              </p>
              <HacomonoDownload />
            </div>
          </details>

          <StepsList
            title="設定手順"
            items={[
              'HACOMONO → 予約スケジュール → インポート',
              'レッスンタイプを選択',
              '文字コードは「UTF-8 (BOM)」を選択',
              '内容を検証 → 問題なければインポート実行',
            ]}
          />
          <NoteBox tone="amber">
            初回は少数（1ヶ月）でテスト推奨。クラス自動生成枠との優先順に注意。休講は「非公開フラグ=1」で反映されます。
          </NoteBox>
          <p className="text-[11px] text-green-700 font-semibold flex items-center gap-1"><Info className="size-3" /> マッピング未解決の確認・件数表示はエクスポートモーダルで行えます。</p>
        </SyncCard>

        {/* ===== カード3: Lstep ===== */}
        <SyncCard
          icon={<MessageSquare className="size-5 text-orange-600" />}
          title="Lstep 体験予約カレンダー"
          subtitle="体験予約の開閉"
          statusLabel="層2自動 + 層1手動"
          statusVariant="default"
        >
          {/* 層2: Google所有カレンダー方式 */}
          <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 space-y-2">
            <h4 className="text-xs font-bold text-orange-800 flex items-center gap-1">
              <Badge variant="default" className="bg-green-600 text-[10px]">層2</Badge> 休講の開閉（自動）
            </h4>
            <p className="text-[11px] text-neutral-600 leading-relaxed">
              休講にした枠を、BOOMが<b>所有するGoogleカレンダー</b>に自動で書き込みます。Lstepはこの所有カレンダーを「シフトに連携」することで、休講日の体験予約が自動で閉じます。
              <br />
              <span className="text-amber-700">※ ICS購読カレンダーはLstepが非対応（所有者でないと連携不可）なため、この方式に変更しました。</span>
            </p>

            {gcalConnected === false && (
              <a
                href="/api/staff/google/calendar-connect"
                className="block"
              >
                <Button className="w-full">
                  <ExternalLink className="size-4" />
                  Googleカレンダーを連携する（初回のみ）
                </Button>
              </a>
            )}

            {gcalConnected && (
              <div className="space-y-2">
                <Badge variant="default" className="bg-green-600">Google連携済み</Badge>
                {gcalId && (
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-0.5">所有カレンダーID（Lstep連携設定に貼り付け）</div>
                    <div className="flex items-center gap-1.5">
                      <code className="flex-1 text-[10px] bg-neutral-100 border border-neutral-200 rounded px-2 py-1.5 break-all">{gcalId}</code>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => { navigator.clipboard?.writeText(gcalId); setGcalMsg('カレンダーIDをコピーしました'); }}
                      >
                        <Copy className="size-3" />
                        コピー
                      </Button>
                    </div>
                  </div>
                )}
                <Button
                  onClick={runGcalSync}
                  disabled={gcalSyncing}
                  className="w-full"
                >
                  <RefreshCw className={`size-4 ${gcalSyncing ? 'animate-spin' : ''}`} />
                  {gcalSyncing ? '同期中...' : '休講をカレンダーへ同期する'}
                </Button>
                <a href="/api/staff/google/calendar-connect" className="block text-center text-[10px] text-muted-foreground underline">
                  別のGoogleアカウントで連携し直す
                </a>
              </div>
            )}
            {gcalMsg && <p className="text-[11px] text-neutral-700">{gcalMsg}</p>}

            <StepsList
              title="Lstep側の設定手順（連携後）"
              items={[
                '上の「Googleカレンダーを連携」→ boom.sendai で認証',
                '表示された所有カレンダーIDをコピー',
                'Lstep → 予約設定 → 外部サービス連携 → Googleカレンダー連携設定を追加',
                'カレンダーIDを貼り付け、予約枠を選び「Googleカレンダーをシフトに連携」',
                '休講を設定したら、このページで「休講をカレンダーへ同期」を実行',
              ]}
            />
          </div>

          {/* 層1 */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1">
            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1">
              <Badge variant="secondary" className="text-[10px]">層1</Badge> 枠の構造（手動）
            </h4>
            <p className="text-[11px] text-neutral-600 leading-relaxed">
              新クラス追加や恒久的な時間変更のときは、Lstep側で手動設定します（複製機能あり）。枠の構造自体はICSでは変わりません。
            </p>
          </div>

          <NoteBox tone="amber">
            Gカレ連携は手動シフトを上書きします。まず1枠でテストしてから22枠へ展開推奨（通常日に過剰開放しないか確認）。
          </NoteBox>
          <NoteBox tone="neutral">
            変動枠（日曜のちゃんなつ / SAYUKI / おっちゃん）は手動微調整が必要です。
          </NoteBox>
        </SyncCard>

        <footer className="pt-2 text-center text-[10px] text-muted-foreground">
          BOOM Dance School / カレンダー連携ハブ
        </footer>
      </div>
    </div>
  );
}

// ============================================================
// 小コンポーネント
// ============================================================

function SyncCard({
  icon,
  title,
  subtitle,
  statusLabel,
  statusVariant,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusVariant: 'default' | 'outline' | 'secondary';
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-2">
        <div className="mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
          <CardTitle className="text-base text-orange-700">{title}</CardTitle>
          <CardDescription className="text-[10px]">{subtitle}</CardDescription>
        </div>
        <Badge variant={statusVariant} className="text-[10px] shrink-0">{statusLabel}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function CopyUrlBox({ url, onCopied }: { url: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('コピーに失敗しました。手動で選択してください。');
    }
  };

  return (
    <div className="flex gap-1.5 items-stretch">
      <Input
        readOnly
        value={url}
        onFocus={e => e.currentTarget.select()}
        className="flex-1 text-[11px] font-mono min-w-0"
      />
      <Button size="sm" onClick={copy} className="whitespace-nowrap">
        <Copy className="size-3" />
        {copied ? 'コピー済' : 'コピー'}
      </Button>
    </div>
  );
}

function TokenUrlBox({
  label,
  url,
  token,
  tokenErr,
}: {
  label: string;
  url: string;
  token: string | null;
  tokenErr: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('コピーに失敗しました。手動で選択してください。');
    }
  };

  return (
    <div>
      <p className="text-[10px] text-muted-foreground font-semibold mb-0.5">{label}</p>
      {tokenErr ? (
        <p className="text-xs text-red-600">トークン取得エラー: {tokenErr}</p>
      ) : !token ? (
        <p className="text-xs text-muted-foreground">トークン取得中...</p>
      ) : (
        <div className="flex gap-1.5 items-stretch">
          <Input
            readOnly
            value={url}
            onFocus={e => e.currentTarget.select()}
            className="flex-1 text-[11px] font-mono min-w-0"
          />
          <Button size="sm" onClick={copy} className="whitespace-nowrap">
            <Copy className="size-3" />
            {copied ? 'コピー済' : 'コピー'}
          </Button>
        </div>
      )}
    </div>
  );
}

function HacomonoDownload() {
  const [months, setMonths] = useState('1');

  const download = () => {
    window.open(`/api/staff/schedule/export/hacomono?months=${months}`, '_blank');
  };

  return (
    <div className="flex gap-1.5 items-stretch">
      <Select value={months} onValueChange={setMonths}>
        <SelectTrigger className="w-[100px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">1ヶ月</SelectItem>
          <SelectItem value="2">2ヶ月</SelectItem>
          <SelectItem value="3">3ヶ月</SelectItem>
        </SelectContent>
      </Select>
      <Button size="sm" onClick={download} className="flex-1 whitespace-nowrap">
        HACOMONO形式CSVをダウンロード ({months}ヶ月分)
      </Button>
    </div>
  );
}

function StepsList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground font-semibold mb-0.5">{title}</p>
      <ol className="text-[11px] text-neutral-600 leading-relaxed list-decimal pl-4 space-y-0.5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ol>
    </div>
  );
}

function NoteBox({ tone, children }: { tone: 'amber' | 'neutral'; children: React.ReactNode }) {
  const cls =
    tone === 'amber'
      ? 'bg-amber-50 border-amber-200 text-amber-800'
      : 'bg-neutral-50 border-neutral-200 text-neutral-600';
  return (
    <p className={`text-[11px] leading-relaxed rounded-lg border px-2.5 py-1.5 flex items-start gap-1 ${cls}`}>
      {tone === 'amber' ? <AlertTriangle className="size-3 mt-0.5 shrink-0" /> : <Info className="size-3 mt-0.5 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

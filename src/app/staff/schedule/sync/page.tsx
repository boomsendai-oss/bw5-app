'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import StaffPageHeader from '@/components/StaffPageHeader';

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
  // origin はクライアントでのみ確定。lazy initializer で同期setStateを避ける。
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

  return (
    <main className="min-h-screen bg-neutral-50 pb-20">
      <StaffPageHeader
        title="📡 カレンダー連携ハブ"
        description="BW5マスタースケジュールを Google / HACOMONO / Lstep へ配信"
        rightExtra={
          <Link href="/staff/schedule/calendar" className="text-xs text-orange-600 underline">
            マスターを編集 →
          </Link>
        }
      />

      <div className="max-w-3xl mx-auto px-3 py-4 space-y-4">
        {tokenErr && (
          <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-xs">
            購読トークン取得エラー: {tokenErr}（一部URLが表示されません。再読込してください）
          </div>
        )}

        {/* ===== 連携状況サマリ ===== */}
        <section className="bg-white border border-orange-200 rounded-xl p-4">
          <h2 className="text-sm font-bold text-orange-800 mb-1">🎯 マスター = BW5レッスンカレンダー</h2>
          <p className="text-[11px] text-neutral-600 leading-relaxed mb-3">
            すべての配信元は{' '}
            <Link href="/staff/schedule/calendar" className="text-orange-600 underline font-semibold">
              レッスンカレンダー
            </Link>{' '}
            です。ここを編集すれば、下の3カレンダーへ反映できます（自動／手動は方式により異なる）。
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-left text-neutral-500 border-b border-neutral-200">
                  <th className="py-1.5 pr-2 font-semibold">カレンダー</th>
                  <th className="py-1.5 pr-2 font-semibold">用途</th>
                  <th className="py-1.5 pr-2 font-semibold">連携方式</th>
                  <th className="py-1.5 font-semibold">反映</th>
                </tr>
              </thead>
              <tbody className="text-neutral-700">
                <tr className="border-b border-neutral-100">
                  <td className="py-1.5 pr-2 font-semibold">📅 Google</td>
                  <td className="py-1.5 pr-2">関係者の予定共有</td>
                  <td className="py-1.5 pr-2">
                    <Badge tone="green">自動</Badge> ICS購読
                  </td>
                  <td className="py-1.5">編集すれば自動反映</td>
                </tr>
                <tr className="border-b border-neutral-100">
                  <td className="py-1.5 pr-2 font-semibold">🏢 HACOMONO</td>
                  <td className="py-1.5 pr-2">会員予約カレンダー</td>
                  <td className="py-1.5 pr-2">
                    <Badge tone="amber">半自動</Badge> CSV
                  </td>
                  <td className="py-1.5">CSV出力→インポート</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-2 font-semibold">💬 Lstep</td>
                  <td className="py-1.5 pr-2">体験予約カレンダー</td>
                  <td className="py-1.5 pr-2">
                    <Badge tone="green">層2自動</Badge> + <Badge tone="slate">層1手動</Badge>
                  </td>
                  <td className="py-1.5">休講=自動 / 枠構造=手動</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ===== カード1: Google ===== */}
        <Card
          icon="📅"
          title="Googleカレンダー"
          subtitle="関係者の予定共有"
          status={{ tone: 'green', label: '✅ 自動同期' }}
        >
          <p className="text-[11px] text-neutral-600 leading-relaxed">
            下のICS購読URLをGoogleカレンダーに登録すると、BW5レッスンが自動反映されます。休講にした回は「キャンセル済み」で表示されます。
          </p>

          <CopyUrlBox label="ICS購読URL (3ヶ月分)" url={icsUrl} token={token} tokenErr={tokenErr} />

          <Steps
            title="設定手順"
            items={[
              '上のURLをコピー',
              'Googleカレンダー左の「他のカレンダー」➕ → 「URLで追加」',
              'URLを貼り付けて「カレンダーを追加」',
            ]}
          />
          <Note tone="neutral">
            一般公開は不要です。反映はGoogle側の都合で数時間〜最大1日かかる場合があります。
          </Note>
          <Status>BW5レッスンが自動反映されます。</Status>
        </Card>

        {/* ===== カード2: HACOMONO ===== */}
        <Card
          icon="🏢"
          title="HACOMONO 会員予約カレンダー"
          subtitle="会員の予約枠"
          status={{ tone: 'amber', label: '半自動 (CSV)' }}
        >
          <p className="text-[11px] text-neutral-600 leading-relaxed">
            HACOMONOの「スケジュールインポート」にそのまま投入できる29列の実物準拠CSV（UTF-8 BOM付き）を出力します。期間を選んでダウンロードしてください。
          </p>

          <HacomonoDownload />

          <Steps
            title="設定手順"
            items={[
              'HACOMONO → 予約スケジュール → インポート',
              'レッスンタイプを選択',
              '文字コードは「UTF-8 (BOM)」を選択',
              '内容を検証 → 問題なければインポート実行',
            ]}
          />
          <Note tone="amber">
            初回は少数（1ヶ月）でテスト推奨。クラス自動生成枠との優先順に注意。休講は「非公開フラグ=1」で反映されます。
          </Note>
          <Status>マッピング未解決の確認・件数表示は📤エクスポートモーダルで行えます。</Status>
        </Card>

        {/* ===== カード3: Lstep ===== */}
        <Card
          icon="💬"
          title="Lstep 体験予約カレンダー"
          subtitle="体験予約の開閉"
          status={{ tone: 'green', label: '層2自動 + 層1手動' }}
        >
          {/* 層2 */}
          <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 space-y-2">
            <h4 className="text-xs font-bold text-orange-800">
              <Badge tone="green">層2</Badge> 休講の開閉（自動）
            </h4>
            <p className="text-[11px] text-neutral-600 leading-relaxed">
              休講にした枠の時間だけを「予定あり」として出力する休講ブロックICSです。Lstepの「Gカレ→シフト連携」は予定がある時間の予約を閉じる逆ロジックのため、休講日の体験予約が自動で閉じます。
            </p>
            <CopyUrlBox
              label="休講ブロックICS購読URL (mode=block, 3ヶ月分)"
              url={blockIcsUrl}
              token={token}
              tokenErr={tokenErr}
            />
            <Steps
              title="設定手順"
              items={[
                '専用のGoogleカレンダーを新規作成',
                'そのカレンダーに上のブロックICS URLを購読登録',
                'Lstep → 予約設定 → 外部サービス連携',
                '各予約枠に作成したGoogleカレンダーを紐付け',
                '「Googleカレンダーをシフトに連携」を選択',
              ]}
            />
          </div>

          {/* 層1 */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1">
            <h4 className="text-xs font-bold text-slate-700">
              <Badge tone="slate">層1</Badge> 枠の構造（手動）
            </h4>
            <p className="text-[11px] text-neutral-600 leading-relaxed">
              新クラス追加や恒久的な時間変更のときは、Lstep側で手動設定します（複製機能あり）。枠の構造自体はICSでは変わりません。
            </p>
          </div>

          <Note tone="amber">
            Gカレ連携は手動シフトを上書きします。まず1枠でテストしてから22枠へ展開推奨（通常日に過剰開放しないか確認）。
          </Note>
          <Note tone="neutral">
            変動枠（日曜のちゃんなつ / SAYUKI / おっちゃん）は手動微調整が必要です。
          </Note>
        </Card>

        <footer className="pt-2 text-center text-[10px] text-neutral-400">
          BOOM Dance School / カレンダー連携ハブ
        </footer>
      </div>
    </main>
  );
}

// ============================================================
// 小コンポーネント
// ============================================================

function Card({
  icon,
  title,
  subtitle,
  status,
  children,
}: {
  icon: string;
  title: string;
  subtitle: string;
  status: { tone: BadgeTone; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      <div className="flex items-start gap-2 p-4 pb-2 border-b border-neutral-100">
        <div className="text-2xl">{icon}</div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-orange-700">{title}</h3>
          <p className="text-[10px] text-neutral-500">{subtitle}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className="p-4 pt-3 space-y-3">{children}</div>
    </section>
  );
}

type BadgeTone = 'green' | 'amber' | 'slate';

function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  const cls =
    tone === 'green'
      ? 'bg-green-50 text-green-700 border-green-200'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-slate-100 text-slate-600 border-slate-300';
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}

function CopyUrlBox({
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
      <p className="text-[10px] text-neutral-500 font-semibold mb-0.5">{label}</p>
      {tokenErr ? (
        <p className="text-xs text-red-600">トークン取得エラー: {tokenErr}</p>
      ) : !token ? (
        <p className="text-xs text-neutral-500">トークン取得中...</p>
      ) : (
        <div className="flex gap-1.5 items-stretch">
          <input
            readOnly
            value={url}
            onFocus={e => e.currentTarget.select()}
            className="flex-1 px-2 py-1.5 border rounded text-[11px] font-mono bg-white text-neutral-700 min-w-0"
          />
          <button
            onClick={copy}
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-xs font-semibold whitespace-nowrap"
          >
            {copied ? '✓ コピー済' : 'コピー'}
          </button>
        </div>
      )}
    </div>
  );
}

function HacomonoDownload() {
  const [months, setMonths] = useState(1);

  const download = () => {
    window.open(`/api/staff/schedule/export/hacomono?months=${months}`, '_blank');
  };

  return (
    <div className="flex gap-1.5 items-stretch">
      <select
        value={months}
        onChange={e => setMonths(Number(e.target.value))}
        className="px-2 py-1.5 border rounded text-xs bg-white"
      >
        <option value={1}>1ヶ月</option>
        <option value={2}>2ヶ月</option>
        <option value={3}>3ヶ月</option>
      </select>
      <button
        onClick={download}
        className="flex-1 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-xs font-semibold whitespace-nowrap"
      >
        HACOMONO形式CSVをダウンロード ({months}ヶ月分)
      </button>
    </div>
  );
}

function Steps({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[10px] text-neutral-500 font-semibold mb-0.5">{title}</p>
      <ol className="text-[11px] text-neutral-600 leading-relaxed list-decimal pl-4 space-y-0.5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ol>
    </div>
  );
}

function Note({ tone, children }: { tone: 'amber' | 'neutral'; children: React.ReactNode }) {
  const cls =
    tone === 'amber'
      ? 'bg-amber-50 border-amber-200 text-amber-800'
      : 'bg-neutral-50 border-neutral-200 text-neutral-600';
  return (
    <p className={`text-[11px] leading-relaxed rounded-lg border px-2.5 py-1.5 ${cls}`}>
      {tone === 'amber' ? '⚠️ ' : 'ℹ️ '}
      {children}
    </p>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-green-700 font-semibold">● {children}</p>;
}

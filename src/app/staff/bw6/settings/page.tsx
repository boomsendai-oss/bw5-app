// スタッフ：BW6 発表会の「設定」（受付と支払いの鍵・料金の規則と検算・設定の鍵・特別な料金の事前登録・試し用のURL・テストデータを消す）。
// 振込先の文や会員の名前を出すので、proxy の cookie の確認に加えてセッションを本検証する（規約4.5）。
// ?ev= は pickStaffEventKey で決まった3つだけ。pay_ok_at を直す欄は作らない（「支払いを開ける」ボタンだけが入れる。K224）。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { RECITAL_EVENT, entryPhase, payGate, pickStaffEventKey, type EntryPhase, type PayGate, type RecitalSettings } from '@/lib/recital';
import { getRecitalEvent, getRecitalSettings, listFeePresets, listFeeRules } from '@/lib/recitalDb';
import { feeCheck } from '@/lib/recitalFee';
import FeePresetsPanel from './FeePresetsPanel';
import FeeRulesTable from './FeeRulesTable';
import GateButtons from './GateButtons';
import SettingsForm from './SettingsForm';
import TestToolsPanel, { PreviewUrlCopy } from './TestToolsPanel';

export const dynamic = 'force-dynamic';

const EVENT_TABS: { key: string; label: string }[] = [
  { key: RECITAL_EVENT.live, label: '本番' },
  { key: RECITAL_EVENT.test, label: '試し' },
  { key: RECITAL_EVENT.smoke, label: '動作確認' },
];

const ENTRY_PHASE_LABEL: Record<EntryPhase, string> = {
  suspended: '止めています',
  before: '受付の前',
  open: '受付中',
  closed: '締切のあと',
};

const PAY_GATE_LABEL: Record<PayGate, string> = {
  before: 'まだ',
  preparing: '準備中（時刻は来たが鍵がまだ）',
  open: '開いている',
};

function withEv(href: string, ev: string): string {
  return `${href}?ev=${encodeURIComponent(ev)}`;
}

/** 今の受付と支払いの状態（時刻を読むのはここだけ。描画の中で Date.now を呼ばない） */
function gatesNow(s: RecitalSettings): { phase: EntryPhase; gate: PayGate } {
  const nowMs = Date.now();
  return { phase: entryPhase(s, nowMs), gate: payGate(s, nowMs) };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function StaffBw6SettingsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const sp = await searchParams;
  const ev = pickStaffEventKey(first(sp.ev));
  const isLive = ev === RECITAL_EVENT.live;

  const [event, settings, rules, presets] = await Promise.all([getRecitalEvent(ev), getRecitalSettings(ev), listFeeRules(ev), listFeePresets(ev)]);
  const { phase, gate } = gatesNow(settings);
  const check = feeCheck(rules, settings.fee_check_first, settings.fee_check_family);

  return (
    <div>
      <StaffPageHeader
        title="設定"
        description={`BW6 発表会（${ev}）`}
        backHref={withEv('/staff/bw6', ev)}
        backLabel="BW6 発表会"
        rightExtra={
          <nav className="flex flex-wrap gap-2 text-sm" aria-label="発表会の切りかえ">
            {EVENT_TABS.map((t) => (
              <Link
                key={t.key}
                href={withEv('/staff/bw6/settings', t.key)}
                className={
                  t.key === ev
                    ? 'rounded-md bg-brand-600 px-3 py-1 font-bold text-white'
                    : 'rounded-md border border-sand-200 bg-white px-3 py-1 text-brand-700'
                }
              >
                {t.label}
              </Link>
            ))}
          </nav>
        }
      />
      <div className="mx-auto max-w-4xl space-y-5 p-4">
        {!event && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            発表会（{ev}）の行がありません。台帳SQLの種が入っているか確かめてください。
          </p>
        )}
        {!isLive && (
          <p className="rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-700">
            試しの発表会（{ev}）の設定を見ています。
          </p>
        )}

        {/* 1. 状態 */}
        <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
          <h2 className="text-lg font-bold">今の状態</h2>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-lg bg-sand-50 px-3 py-2">
              <dt className="text-xs text-sand-800">受付</dt>
              <dd className="text-base font-bold">{ENTRY_PHASE_LABEL[phase]}</dd>
            </div>
            <div className="rounded-lg bg-sand-50 px-3 py-2">
              <dt className="text-xs text-sand-800">支払い</dt>
              <dd className="text-base font-bold">{PAY_GATE_LABEL[gate]}</dd>
            </div>
          </dl>
        </section>

        {/* 2. 受付と支払いの鍵 */}
        <GateButtons ev={ev} suspended={settings.suspended} payOkAt={settings.pay_ok_at} bankEmpty={settings.bank_text.trim() === ''} />

        {/* 3. 料金の規則と検算 */}
        <FeeRulesTable
          ev={ev}
          rules={rules}
          editable={settings.suspended}
          check={check}
          expectFirst={settings.fee_check_first}
          expectFamily={settings.fee_check_family}
        />

        {/* 4. 設定の鍵 */}
        <SettingsForm ev={ev} raw={settings.raw} />

        {/* 5. 特別な料金の事前登録 */}
        <FeePresetsPanel ev={ev} presets={presets} />

        {/* 6. 試し用のURL */}
        <PreviewUrlCopy ev={ev} />

        {/* 7. テストデータを消す（試しの発表会だけ） */}
        {ev === RECITAL_EVENT.test && <TestToolsPanel ev={ev} />}
      </div>
    </div>
  );
}

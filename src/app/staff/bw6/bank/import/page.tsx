// スタッフ：BW6 発表会の「入金の取り込み」（Task 29。決まりの紙 2-17・2-18・2-21・2-23）。
// いちばん新しい合った束・束の一覧・手で打つ欄・明細のファイル・待ちのメールを、今出す。
// proxy の cookie の確認に加えてセッションを本検証する（規約4.5）。?ev= は pickStaffEventKey の3つだけ。
// この画面にも、残高と出金の行は出さない（束の一覧は数と日付だけ。検算の合わない所も日付だけで、金額は出さない）。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { RECITAL_EVENT, pickStaffEventKey } from '@/lib/recital';
import { listImports, type ImportRow } from '@/lib/recitalBankDb';
import { getRecitalEvent } from '@/lib/recitalDb';
import { countRecitalMailsToday, inSendWindow } from '@/lib/recitalMail';
import ImportForms from './ImportForms';

export const dynamic = 'force-dynamic';
// ファイルの取り込みの Server Action（検算・台帳・自動で当てる・メール）が、ふつうの時間で切れないように
export const maxDuration = 60;

const EVENT_TABS: { key: string; label: string }[] = [
  { key: RECITAL_EVENT.live, label: '本番' },
  { key: RECITAL_EVENT.test, label: '試し' },
  { key: RECITAL_EVENT.smoke, label: '動作確認' },
];

const SOURCE_LABEL: Record<string, string> = { chat: 'チャット', manual: '手で打った', file: 'ファイル' };

function withEv(href: string, ev: string): string {
  return `${href}?ev=${encodeURIComponent(ev)}`;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** UTC ISO → JST の 'YYYY/M/D HH:MM' */
function jstDateTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
}

/** 'YYYY-MM-DD' → 'M/D' */
function md(ymd: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd ?? '—';
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

/** 検算：ok → 合った／ng:M/D:金額 → 合わない（M月D日のあたり）。金額は出さない */
function checkLabel(v: string | null): { ok: boolean; text: string } {
  if (v === 'ok') return { ok: true, text: '合った' };
  const m = /^ng:(\d{1,2})\/(\d{1,2}):/.exec(v ?? '');
  return { ok: false, text: m ? `合わない（${Number(m[1])}月${Number(m[2])}日のあたり）` : '合わない' };
}

/** いちばん新しい合った束（chat|file の ok。手で打った束は数えない）。listImports は新しい順 */
function latestOk(imports: ImportRow[]): ImportRow | undefined {
  return imports.find((x) => x.check_result === 'ok' && (x.source === 'chat' || x.source === 'file'));
}

/** 今メールを出せる時間か（時刻を読むのはここだけ。描画の中で Date を直に作らない） */
function canFlushNow(): boolean {
  return inSendWindow(new Date());
}

export default async function StaffBw6BankImportPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const sp = await searchParams;
  const ev = pickStaffEventKey(first(sp.ev));
  const isLive = ev === RECITAL_EVENT.live;

  const [event, imports, mails] = await Promise.all([getRecitalEvent(ev), listImports(ev), countRecitalMailsToday()]);
  const last = latestOk(imports);
  const canFlush = canFlushNow();

  return (
    <div>
      <StaffPageHeader
        title="入金の取り込み"
        description={`BW6 発表会（${ev}）`}
        backHref={withEv('/staff/bw6/bank', ev)}
        backLabel="見てほしい入金"
        rightExtra={
          <div className="flex flex-col items-end gap-2">
            <p className={`text-xs ${mails.warn ? 'font-bold text-red-700' : 'text-sand-800'}`}>
              今日の送信 {mails.count}通{mails.warn && '（上限に近いです）'}
            </p>
            <nav className="flex flex-wrap gap-2 text-sm" aria-label="発表会の切りかえ">
              {EVENT_TABS.map((t) => (
                <Link
                  key={t.key}
                  href={withEv('/staff/bw6/bank/import', t.key)}
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
          </div>
        }
      />
      <div className="mx-auto max-w-3xl space-y-5 p-4">
        {!isLive && (
          <p className="rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-700">
            試しの発表会（{ev}）を見ています。
          </p>
        )}
        {!event && (
          <p className="rounded-lg border border-sand-300 bg-sand-50 px-3 py-2 text-sm text-sand-800">
            この発表会（{ev}）は、まだ作られていません。
          </p>
        )}

        <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
          <h2 className="text-sm font-bold text-sand-800">いちばん新しい合った束</h2>
          <p className="mt-1 text-lg font-bold">{last ? `${jstDateTime(last.imported_at)}（${SOURCE_LABEL[last.source ?? ''] ?? last.source}）` : 'まだありません'}</p>
          <p className="mt-2 text-xs text-sand-800">
            スクショは、GMOあおぞらネット銀行の「入出金明細」の一覧の画面（1行ごとに残高が出る画面）で撮ります。手で打った束は、ここに数えません。
          </p>
        </section>

        <ImportForms ev={ev} canFlush={canFlush} />

        <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
          <h2 className="text-lg font-bold">束の一覧 {imports.length}件</h2>
          {imports.length === 0 ? (
            <p className="mt-2 text-sm text-sand-700">まだありません</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {imports.map((x) => {
                const c = checkLabel(x.check_result);
                return (
                  <li key={x.id} className="rounded-lg border border-sand-100 bg-sand-50 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-bold">{jstDateTime(x.imported_at)}</span>
                      <span>{SOURCE_LABEL[x.source ?? ''] ?? x.source ?? '—'}</span>
                      <span>期間 {x.range_from ? `${md(x.range_from)}〜${md(x.range_to)}` : '—'}</span>
                      <span className={c.ok ? 'text-brand-700' : 'font-bold text-red-800'}>検算 {c.text}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-sand-800">
                      <span>読んだ {x.read_rows}</span>
                      <span>新しく入った {x.inserted}</span>
                      <span>もうあった {x.existing}</span>
                      <span>はじいた {x.rejected}</span>
                      <span>渡した人 {x.imported_by ?? '—'}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="text-xs text-sand-800">
          はじめの5件の「はい」の束に写っていない行も、「はい」で当たります。それでも残った「はじめの5件」の行は、見てほしい入金で人が当てます（はじめの5件に数えます）。
        </p>
      </div>
    </div>
  );
}

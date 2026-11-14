// ⚠️ 公開ページ(認証なし)。理由: BW6 発表会の家庭向けの案内(だれでも見られる入口)。
// 出すのは公開情報(発表会の名前・日時・会場・締切・受付の状態・短い5行)だけで、申込の中身は出さない。
import Link from 'next/link';
import type { ReactNode } from 'react';
import { FiveLines } from '@/components/recital/FiveLines';
import { fiveLines, jpDate, jpOpenLabel } from '@/lib/recitalPublic';
import { getRecitalPublicContext } from './context';
import { Bw6Teaser, MocchinBox } from '@/components/recital/Bw6Teaser';
import { todayJst } from '@/lib/dateJst';

export const dynamic = 'force-dynamic';

const btnCls = 'block w-full rounded-xl border-2 border-navy-700 bg-white px-4 py-3 text-center font-bold text-navy-700';
const primaryBtnCls = 'block w-full rounded-xl bg-navy-700 px-4 py-3 text-center font-bold text-white';
const noticeCls = 'rounded-xl border border-sand-300 bg-sand-100 px-4 py-3 text-center text-sm font-bold text-navy-700';

function PreviewBand() {
  return <p className="mb-4 rounded-lg bg-brand-600 px-3 py-2 text-center text-sm font-bold text-white print:hidden">試し用の表示です</p>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-sand-200 py-2 last:border-b-0">
      <dt className="w-24 shrink-0 font-bold">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default async function Bw6TopPage({ searchParams }: { searchParams: Promise<{ ev?: string; pv?: string }> }) {
  const ctx = await getRecitalPublicContext(await searchParams);
  const { event, settings: s, phase, qs } = ctx;
  const today = todayJst();
  if (!event) {
    // 本番の発表会の行が入る前（〜12/13）は予告を出す（2026-11-14 TARO）
    return <Bw6Teaser today={today} />;
  }

  let entryArea: ReactNode;
  if (phase === 'open') {
    entryArea = (
      <Link href={`/bw6/entry${qs}`} className={primaryBtnCls}>
        申し込む
      </Link>
    );
  } else if (phase === 'before') {
    entryArea = <p className={noticeCls}>{jpOpenLabel(s.entry_open_at)}から受け付けます</p>;
  } else if (phase === 'suspended') {
    entryArea = <p className={noticeCls}>ただいま受付を止めています。再開までお待ちください</p>;
  } else {
    entryArea = (
      <div className={noticeCls}>
        受付は終わりました。ご相談は
        {s.line_url ? (
          <a href={s.line_url} target="_blank" rel="noreferrer noopener" className="underline">
            公式LINE
          </a>
        ) : (
          '公式LINE'
        )}
        へ
      </div>
    );
  }

  return (
    <main className="space-y-6 text-navy-700">
      {ctx.preview && <PreviewBand />}
      <header>
        <p className="text-sm font-bold text-brand-700">BOOMダンススクール 発表会</p>
        <h1 className="mt-1 text-2xl font-bold">{event.title}</h1>
      </header>

      <dl className="rounded-xl border border-sand-200 bg-white px-4 py-2 text-sm">
        <Row label="日時">{jpDate(event.show_date)}</Row>
        {event.rehearsal_date && <Row label="前日リハ">{jpDate(event.rehearsal_date)}</Row>}
        {event.venue && <Row label="会場">{event.venue}</Row>}
        <Row label="申込の締切">
          {jpDate(s.entry_close_at)} {s.entry_close_at.slice(11, 16)}
        </Row>
      </dl>

      <div className="space-y-3">
        <Link href={`/bw6/guide${qs}`} className={btnCls}>
          ご案内を読む
        </Link>
        <Link href={`/bw6/fee${qs}`} className={btnCls}>
          料金を見る
        </Link>
        {entryArea}
      </div>

      {phase === 'before' && <MocchinBox today={today} />}

      <FiveLines lines={fiveLines(s)} />
    </main>
  );
}

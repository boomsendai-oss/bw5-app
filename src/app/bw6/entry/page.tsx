// ⚠️ 公開ページ(認証なし)。理由: BW6 発表会の出演申込フォーム(家庭がスマホで開く入口)。
// ページに出すのは公開情報(作品の一覧・設定の日付と文)だけで、申込の中身は出さない。個人の情報を URL に載せない。
// 受付の状態は表示だけ。「送る」の判定は Server Action(actions.ts)の中で本物の状態から行う(R-40)。
import { randomBytes } from 'node:crypto';
import Link from 'next/link';
import { todayJst } from '@/lib/dateJst';
import { listPublicWorks } from '@/lib/recitalFamilyDb';
import { fiveLines, jpOpenLabel } from '@/lib/recitalPublic';
import { getRecitalPublicContext } from '../context';
import { EntryForm } from './EntryForm';

export const dynamic = 'force-dynamic';
// この画面のボタンの処理（メール・お金が変わったあとの仕事）が、ふつうの時間で切れないように（Server Action はこの画面の時間を使う）
export const maxDuration = 60;

const noticeCls = 'rounded-xl border border-sand-300 bg-sand-100 px-4 py-6 text-center text-base font-bold text-navy-700';

export default async function Bw6EntryPage({ searchParams }: { searchParams: Promise<{ ev?: string; pv?: string }> }) {
  const ctx = await getRecitalPublicContext(await searchParams);
  const { event, settings: s, phase, qs } = ctx;
  if (!event) {
    return <p className="py-10 text-center text-navy-700">準備中です</p>;
  }

  if (phase !== 'open') {
    let body;
    if (phase === 'before') body = `${jpOpenLabel(s.entry_open_at)}から受け付けます`;
    else if (phase === 'suspended') body = 'ただいま受付を止めています。再開までお待ちください';
    else {
      body = (
        <>
          受付は終わりました。ご相談は
          {s.line_url ? (
            <a href={s.line_url} target="_blank" rel="noreferrer noopener" className="underline">
              公式LINE
            </a>
          ) : (
            '公式LINE'
          )}
          へ
        </>
      );
    }
    return (
      <main className="space-y-6 text-navy-700">
        <Link href={`/bw6${qs}`} className="inline-block text-sm font-bold text-navy-700 underline">
          ← 発表会のページ
        </Link>
        <div className={noticeCls}>{body}</div>
      </main>
    );
  }

  // 二重に送らない合い鍵。ページを出すたびにサーバで作る（下書きには入れない）
  const submitKey = randomBytes(16).toString('hex');
  const works = await listPublicWorks(ctx.eventKey);

  return (
    <EntryForm
      eventKey={ctx.eventKey}
      pv={ctx.pv}
      qs={qs}
      preview={ctx.preview}
      submitKey={submitKey}
      todayYmd={todayJst()}
      works={works}
      fiveLines={fiveLines(s)}
      settings={{
        tshirtSizes: s.tshirt_sizes,
        maxWorks: s.max_works_per_person,
        minSelfApplyAge: s.min_self_apply_age,
        entryCloseAt: s.entry_close_at,
        changeCloseAt: s.change_close_at,
        payDue: s.pay_due,
        payOpenAt: s.pay_open_at,
        privacyText: s.privacy_text,
        consentItems: s.consent_items,
        extraCostsText: s.extra_costs_text,
        lineUrl: s.line_url,
      }}
    />
  );
}

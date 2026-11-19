// ⚠️ 公開ページ(認証なし)。理由: プチバトルの申込完了画面。edit_token 完全一致の
// 自分の申込1件だけを表示する(列挙不可・トークンなしでは何も出さない)。
import Link from 'next/link';
import { formatBattleReceiptNo, formatJpDateLong, yen } from '@/lib/battle';
import { getBattleEvent, loadBattleEntryByToken } from '@/lib/battleDb';
import { BattleCard, BattleHero, BattleShell, btnPrimaryCls } from '../ui';
import CheckoutButton from './CheckoutButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'エントリー申込の確認', robots: { index: false } };

export default async function BattleCompletePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const entry = t ? await loadBattleEntryByToken(t) : null;
  const ev = entry ? await getBattleEvent(entry.eventKey) : null;

  if (!entry || !ev) {
    return (
      <BattleShell>
        <BattleHero eventTitle="BOOM DANCE SCHOOL" title="NOT FOUND" subtitle="申込が見つかりません" />
        <div className="space-y-4 px-4">
          <BattleCard><p className="text-neutral-300">URLが正しいかご確認ください。30分以内に決済されなかった申込は無効になります。</p></BattleCard>
          <Link href="/battle" className={`block w-full rounded-2xl py-4 text-center text-lg font-black ${btnPrimaryCls}`}>エントリーページへ</Link>
        </div>
      </BattleShell>
    );
  }

  const st = entry.paymentStatus;
  const hero =
    st === 'paid' ? { title: 'COMPLETE', subtitle: 'エントリーが確定しました!' }
      : st === 'pending' ? { title: 'ONE MORE STEP', subtitle: '決済待ちです' }
        : st === 'expired' ? { title: 'EXPIRED', subtitle: '申込は無効になりました' }
          : st === 'test' ? { title: 'TEST', subtitle: 'スタッフ確認用のテスト申込です(決済なし)' }
            : { title: 'CANCELED', subtitle: 'この申込はキャンセルされています' };
  const divNames = entry.divisions.map((k) => ev.divisions.find((d) => d.key === k)?.name ?? k);

  return (
    <BattleShell>
      <BattleHero eventTitle={ev.title} title={hero.title} subtitle={hero.subtitle} />
      <div className="space-y-4 px-4">
        {(st === 'paid' || st === 'test') && (
          <div className="rounded-2xl bg-black p-5 text-center ring-1 ring-neutral-800">
            <p className="text-xs font-bold tracking-widest text-neutral-400">受付番号</p>
            <p className="mt-1 text-3xl font-black text-white">{formatBattleReceiptNo(entry.entryId, entry.eventKey)}</p>
            {st === 'paid' && <p className="mt-2 text-sm font-bold text-teal-300">お支払い済み: {yen(entry.amountTotal)}</p>}
          </div>
        )}
        {st === 'pending' && (
          <>
            <p className="rounded-xl border-2 border-teal-400 bg-teal-950/40 p-4 text-sm font-bold text-teal-200">
              決済が完了するとエントリー確定になり、エントリー一覧に載ります。
            </p>
            <CheckoutButton token={t!} amountTotal={entry.amountTotal} />
            <p className="text-center text-xs text-neutral-400">※ 申込から30分以内に決済が完了しない場合、この申込は無効になります</p>
          </>
        )}
        {st === 'expired' && (
          <>
            <BattleCard><p className="text-neutral-300">30分以内に決済が完了しなかったため、枠を解放しました。お手数ですがもう一度お申し込みください。</p></BattleCard>
            <Link href={`/battle?e=${encodeURIComponent(ev.eventKey)}`} className={`block w-full rounded-2xl py-4 text-center text-lg font-black ${btnPrimaryCls}`}>もう一度申し込む</Link>
          </>
        )}

        <BattleCard label="申込内容">
          <p className="text-xl font-black text-white">{entry.dancerName} <span className="text-sm text-neutral-400">{entry.dancerKana}</span></p>
          <ul className="mt-2 space-y-1 text-sm text-neutral-200">
            {divNames.map((n) => <li key={n}>・{n}</li>)}
            {entry.spectators > 0 && <li>・同行の観覧 {entry.spectators}名</li>}
            {entry.spectatorsPreschool > 0 && <li>・同行の観覧(未就学児) {entry.spectatorsPreschool}名</li>}
          </ul>
          <p className="mt-2 text-sm text-neutral-400">合計 {yen(entry.amountTotal)}</p>
        </BattleCard>

        <BattleCard label="開催">
          <p className="text-sm text-neutral-200">{formatJpDateLong(ev.eventDate)} {ev.openTime}〜{ev.endTime}</p>
          <p className="text-sm text-neutral-200">{ev.venue}</p>
          {ev.venueAddress && <p className="text-xs text-neutral-400">{ev.venueAddress}</p>}
        </BattleCard>

        <p className="text-center text-xs text-neutral-400">
          内容の変更・キャンセルはBOOM公式LINEまでご連絡ください。
          <br />
          <Link href={`/battle/entries?e=${encodeURIComponent(ev.eventKey)}`} className="underline">エントリー一覧</Link>
        </p>
      </div>
    </BattleShell>
  );
}

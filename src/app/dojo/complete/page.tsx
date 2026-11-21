// ⚠️ 公開ページ(認証なし)。理由: プチバトル(BOOM DOJO)の申込完了画面。edit_token 完全一致の
// 自分の申込1件だけを表示する(列挙不可・トークンなしでは何も出さない)。
import Link from 'next/link';
import { battlePayLabel, buildBattleSummary, formatBattleReceiptNo, formatJpDateLong, yen } from '@/lib/battle';
import { getBattleEvent, loadBattleEntryByToken } from '@/lib/battleDb';
import { BattleCard, BattleHero, BattleShell, BattleSummaryView, Hanko, btnPrimaryCls } from '../ui';
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
        <BattleHero eventTitle="BOOM DOJO" title="申込が見つかりません" />
        <div className="space-y-4 px-[18px]">
          <BattleCard><p>URLが正しいかご確認ください。30分以内に決済されなかった申込は無効になります。</p></BattleCard>
          <Link href="/dojo" className={`block w-full rounded py-4 text-center text-lg font-black ${btnPrimaryCls}`}>エントリーページへ</Link>
        </div>
      </BattleShell>
    );
  }

  const st = entry.paymentStatus;
  const hero =
    st === 'paid' ? { title: 'エントリー完了', subtitle: 'エントリーが確定しました。押忍!' }
      : st === 'onsite' ? { title: 'エントリー完了', subtitle: 'エントリーが確定しました。お支払いは当日、会場で。押忍!' }
      : st === 'pending' ? { title: 'あと一歩', subtitle: '決済待ちです' }
        : st === 'expired' ? { title: '期限切れ', subtitle: '申込は無効になりました' }
          : st === 'test' ? { title: 'テスト申込', subtitle: 'スタッフ確認用のテスト申込です(決済なし)' }
            : { title: 'キャンセル', subtitle: 'この申込はキャンセルされています' };
  const sum = buildBattleSummary(entry, ev);

  return (
    <BattleShell>
      <BattleHero eventTitle={ev.title} title={hero.title} subtitle={hero.subtitle} />
      <div className="space-y-4 px-[18px]">
        {(st === 'paid' || st === 'onsite' || st === 'test') && (
          <div className="relative rounded-md bg-[#efe4cf] p-5 text-center text-[#1d140c] shadow-[0_6px_20px_rgba(0,0,0,0.5)]">
            {(st === 'paid' || st === 'onsite') && <Hanko>確定</Hanko>}
            <p className="text-xs font-bold tracking-widest text-[#7a2a1c]">受付番号</p>
            <p className="f-num mt-1 text-4xl font-bold">{formatBattleReceiptNo(entry)}</p>
            {st === 'paid' && <p className="mt-2 text-sm font-bold">お支払い済み: {yen(entry.amountTotal)}</p>}
            {st === 'onsite' && (
              <p className="mt-2 text-sm font-bold">当日、受付で現金でお支払いください: {yen(entry.amountTotal)}</p>
            )}
          </div>
        )}
        {st === 'pending' && (
          <>
            <BattleCard>
              <p className="text-sm font-bold">決済が完了するとエントリー確定になり、エントリー一覧に載ります。</p>
            </BattleCard>
            <CheckoutButton token={t!} amountTotal={entry.amountTotal} />
            <p className="text-center text-xs text-[#f3eadb]/70">※ 申込から30分以内に決済が完了しない場合、この申込は無効になります</p>
          </>
        )}
        {st === 'expired' && (
          <>
            <BattleCard><p>30分以内に決済が完了しなかったため、枠を解放しました。お手数ですがもう一度お申し込みください。</p></BattleCard>
            <Link href={`/dojo?e=${encodeURIComponent(ev.eventKey)}`} className={`block w-full rounded py-4 text-center text-lg font-black ${btnPrimaryCls}`}>もう一度挑戦する</Link>
          </>
        )}

        <BattleCard title="申込内容">
          <p className="mb-3 text-xl font-black">{entry.dancerName} <span className="text-sm font-bold text-[#6b5a44]">{entry.dancerKana}</span></p>
          <BattleSummaryView sum={sum} total={entry.amountTotal} payLabel={battlePayLabel(entry)} />
        </BattleCard>

        <BattleCard title="開催">
          <p className="text-sm">{formatJpDateLong(ev.eventDate)} {ev.openTime}〜{ev.endTime}</p>
          <p className="text-sm">{ev.venue}</p>
          {ev.venueAddress && <p className="text-xs text-[#6b5a44]">{ev.venueAddress}</p>}
        </BattleCard>

        <p className="text-center text-xs text-[#f3eadb]/70">
          内容の変更・キャンセルはBOOM公式LINEまでご連絡ください。
          <br />
          <Link href={`/dojo/entries?e=${encodeURIComponent(ev.eventKey)}`} className="underline">エントリー一覧</Link>
        </p>
      </div>
    </BattleShell>
  );
}

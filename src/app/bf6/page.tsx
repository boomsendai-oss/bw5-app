// ⚠️ 公開ページ(認証なし)。理由: BF6イベントTOP(一般来場者・外部参加者向け告知)。
import Link from 'next/link';
import { BF6_DIVISIONS } from '@/lib/bf6';
import { calcBf6Remaining, getBf6Settings, getBf6Usage } from '@/lib/bf6Db';

export const dynamic = 'force-dynamic';

export default async function Bf6TopPage() {
  const settings = await getBf6Settings();
  const usage = await getBf6Usage();
  const remaining = calcBf6Remaining(settings, usage);

  return (
    <div className="min-h-screen bg-neutral-100">
      <div className="mx-auto max-w-lg pb-12">
        <header className="bg-neutral-950 px-4 pb-8 pt-10 text-white">
          <p className="text-[11px] font-bold tracking-[0.25em] text-neutral-400">
            BOOM DANCE SCHOOL PRESENTS
          </p>
          <h1 className="mt-2 text-5xl font-black italic leading-[0.95] tracking-tight">
            BOOMER&apos;S<br />FIGHT!!!<span className="text-red-500"> vol.6</span>
          </h1>
          <p className="mt-2 text-sm font-black tracking-widest text-neutral-300">BATTLE &amp; SHOWCASE</p>
          <div className="mt-5 flex items-end gap-4">
            <p className="text-3xl font-black italic">9.26 <span className="text-lg">SAT</span></p>
            <p className="pb-0.5 text-xs font-bold text-neutral-400">OPEN 14:30(予定)</p>
          </div>
          <div className="mt-4 h-1 w-16 bg-red-600" />
        </header>

        <div className="px-4 py-6">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <dl className="space-y-2.5 text-sm">
              <Row k="会場" v="SSM(仙台スクールオブミュージック&ダンス専門学校) 9階ホール" />
              <Row k="部門" v="ビギナー(小学生・バトル初出場限定) / 小中学生 / 一般" />
              <Row k="エントリー" v="1部門¥2,500・2部門¥4,000・3部門¥5,500(事前決済は¥500引き)" />
              <Row k="観覧" v="大人 前売¥2,000/当日¥2,500・小学生¥1,000・未就学児無料" />
              <Row k="受付期間" v="2026.8.8(土)〜 9.24(木)" />
            </dl>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {BF6_DIVISIONS.map((d) => (
              <div key={d.key} className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
                <p className="text-[11px] font-bold text-neutral-500">{d.label}</p>
                <p className="mt-0.5 text-2xl font-black text-red-600">
                  残{remaining.divisions[d.key]}
                </p>
                <p className="text-[10px] text-neutral-400">枠</p>
              </div>
            ))}
          </div>

          <div className="mt-6 space-y-3">
            <Link href="/bf6/entry" className="block w-full rounded-2xl bg-red-600 py-4 text-center text-lg font-black text-white shadow-lg shadow-red-600/30">
              バトルエントリー
            </Link>
            <Link href="/bf6/ticket" className="block w-full rounded-2xl bg-neutral-900 py-4 text-center text-lg font-black text-white">
              観覧チケット購入
            </Link>
            <Link href="/bf6/entries" className="block w-full rounded-2xl border-2 border-neutral-300 bg-white py-4 text-center font-black text-neutral-700">
              エントリーリストを見る
            </Link>
          </div>

          <p className="mt-8 text-center text-xs text-neutral-400">
            <Link href="/bf6/legal" className="underline">特商法表記・キャンセルポリシー</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-[4.5rem] shrink-0 font-black text-neutral-400">{k}</dt>
      <dd className="font-medium text-neutral-800">{v}</dd>
    </div>
  );
}

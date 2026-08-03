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
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-lg px-4 py-10">
        <p className="text-sm font-bold tracking-widest text-red-500">BOOM DANCE SCHOOL PRESENTS</p>
        <h1 className="mt-1 text-4xl font-black leading-tight text-white">
          BOOMER&apos;S<br />FIGHT!!! <span className="text-red-500">vol.6</span>
        </h1>
        <p className="mt-1 font-bold text-zinc-300">BATTLE &amp; SHOWCASE</p>

        <dl className="mt-6 space-y-2 rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-sm">
          <Row k="日時" v="2026.9.26(土) OPEN 14:30(予定)" />
          <Row k="会場" v="SSM(仙台スクールオブミュージック&ダンス専門学校) 9階ホール" />
          <Row k="部門" v="小学生初心者(バトル初出場限定) / 小中学生 / 一般" />
          <Row k="エントリー" v="1部門¥2,500・2部門¥4,000・3部門¥5,500(事前決済は¥500引き)" />
          <Row k="観覧" v="大人 前売¥2,000/当日¥2,500・小学生¥1,000・未就学児無料" />
          <Row k="受付期間" v="2026.8.8(土)〜 9.24(木)" />
        </dl>

        <div className="mt-6 grid grid-cols-3 gap-2 text-center">
          {BF6_DIVISIONS.map((d) => (
            <div key={d.key} className="rounded-lg bg-zinc-900 p-3">
              <p className="text-xs text-zinc-400">{d.label}</p>
              <p className="text-xl font-black text-red-400">
                残{remaining.divisions[d.key]}<span className="text-xs text-zinc-500">枠</span>
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 space-y-3">
          <Link href="/bf6/entry" className="block w-full rounded-xl bg-red-600 py-4 text-center text-lg font-black text-white">
            バトルエントリー
          </Link>
          <Link href="/bf6/ticket" className="block w-full rounded-xl border border-red-600 py-4 text-center text-lg font-black text-red-400">
            観覧チケット購入
          </Link>
          <Link href="/bf6/entries" className="block w-full rounded-xl border border-zinc-600 py-4 text-center font-bold text-zinc-300">
            エントリーリストを見る
          </Link>
        </div>

        <p className="mt-8 text-center text-xs text-zinc-500">
          <Link href="/bf6/legal" className="underline">特商法表記・キャンセルポリシー</Link>
        </p>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 font-bold text-zinc-500">{k}</dt>
      <dd className="text-zinc-200">{v}</dd>
    </div>
  );
}

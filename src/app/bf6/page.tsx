// ⚠️ 公開ページ(認証なし)。理由: BF6イベントTOP(一般来場者・外部参加者向け告知)。
// 構成はDANCEALIVEのイベントページを参考(TARO 2026-08-04):
// ヒーロー → キービジュアル → DETAIL(DATE/TIME/FEE/VENUE/JUDGE) → ENTRY(大ボタン) → ENTRY LIST
import Link from 'next/link';
import { BF6_DIVISIONS } from '@/lib/bf6';
import { calcBf6Remaining, getBf6Settings, getBf6Usage, getPublicBf6Entries } from '@/lib/bf6Db';
import { Bf6DetailBlock, Bf6SectionHead, Bf6Shell } from './ui';

export const dynamic = 'force-dynamic';

export default async function Bf6TopPage() {
  const [settings, usage, entries] = await Promise.all([
    getBf6Settings(),
    getBf6Usage(),
    getPublicBf6Entries(),
  ]);
  const remaining = calcBf6Remaining(settings, usage);
  const countByDivision = Object.fromEntries(
    BF6_DIVISIONS.map((d) => [d.key, entries.filter((e) => e.divisions.includes(d.key)).length])
  );

  return (
    <Bf6Shell wide>
      <div>
        {/* ヒーロー = フライヤー本体(タイトルは画像側が担う。テキストの重複を避ける) */}
        {/* eslint-disable-next-line @next/next/no-img-element -- 静的フライヤー1枚のためnext/image不使用 */}
        <img src="/bf6/flyer.jpg" alt="BOOMER'S FIGHT!!! vol.6 - BATTLE & SHOWCASE" className="w-full" />
        <header className="bg-neutral-950 px-4 pb-7 pt-2 text-center text-white">
          <p className="inline-block bg-red-600 px-3 py-1 text-[11px] font-black tracking-[0.2em]">
            BATTLE &amp; SHOWCASE
          </p>
          <p className="mt-4 text-4xl font-black italic">
            2026.9.26 <span className="text-xl">SAT</span>
          </p>
          <p className="mt-1 text-xs font-bold text-neutral-400">OPEN 14:30(予定)</p>
        </header>

        {/* DETAIL */}
        <section className="px-4 pt-8">
          <Bf6SectionHead en="DETAIL" ja="開催概要" />
          <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-2 shadow-sm">
            <Bf6DetailBlock en="DATE">
              <p className="text-lg font-black text-neutral-900">2026.9.26 <span className="text-sm">SAT</span></p>
            </Bf6DetailBlock>
            <Bf6DetailBlock en="TIME">
              <p className="font-bold text-neutral-800">OPEN 14:30(予定)</p>
              <p className="font-bold text-neutral-800">CLOSE 18:00頃</p>
              <p className="mt-2 text-xs text-neutral-500">※ タイムテーブルはエントリー締切後に発表します</p>
            </Bf6DetailBlock>
            <Bf6DetailBlock en="FEE">
              <p className="text-xs font-black text-neutral-400">バトルエントリー</p>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs text-neutral-400">
                    <th className="py-1 text-left font-bold">部門数</th>
                    <th className="py-1 text-right font-bold">当日現金</th>
                    <th className="py-1 text-right font-bold text-red-600">事前カード決済</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['1部門', 2500],
                    ['2部門', 4000],
                    ['3部門', 5500],
                  ].map(([label, price]) => (
                    <tr key={label} className="border-b border-neutral-100 last:border-b-0">
                      <td className="py-1.5 font-bold text-neutral-800">{label}</td>
                      <td className="py-1.5 text-right text-neutral-500">¥{Number(price).toLocaleString()}</td>
                      <td className="py-1.5 text-right font-black text-red-600">
                        ¥{(Number(price) - 500).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-neutral-500">事前カード決済 = 申込と同時にカードでお支払い(1人¥500引き)</p>
              <p className="text-xs text-neutral-500">当日現金 = 当日、会場受付でお支払い</p>
              <p className="mt-4 text-xs font-black text-neutral-400">観覧チケット</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                <li className="flex justify-between border-b border-neutral-100 pb-1.5">
                  <span className="font-bold text-neutral-800">大人(事前カード決済)</span>
                  <span className="font-black text-red-600">¥2,000</span>
                </li>
                <li className="flex justify-between border-b border-neutral-100 pb-1.5">
                  <span className="font-bold text-neutral-800">大人(当日現金)</span>
                  <span className="text-neutral-600">¥2,500</span>
                </li>
                <li className="flex justify-between border-b border-neutral-100 pb-1.5">
                  <span className="font-bold text-neutral-800">小学生</span>
                  <span className="text-neutral-600">¥1,000(事前・当日共通)</span>
                </li>
                <li className="flex justify-between">
                  <span className="font-bold text-neutral-800">未就学児・出場者本人</span>
                  <span className="text-neutral-600">無料</span>
                </li>
              </ul>
            </Bf6DetailBlock>
            <Bf6DetailBlock en="VENUE">
              <p className="font-bold text-neutral-800">SSM 9階ホール</p>
              <p className="text-sm text-neutral-600">仙台スクールオブミュージック&amp;ダンス専門学校</p>
              <p className="mt-1 text-xs text-neutral-500">仙台市若林区新寺2-1-11</p>
              <p className="text-xs text-neutral-500">JR仙台駅 東口より徒歩5分</p>
            </Bf6DetailBlock>
            <Bf6DetailBlock en="DIVISION">
              <ul className="space-y-1.5">
                {BF6_DIVISIONS.map((d) => (
                  <li key={d.key} className="flex items-baseline gap-2">
                    <span className={`font-black ${d.accentText}`}>{d.label}</span>
                    <span className="text-xs text-neutral-500">{d.note}</span>
                  </li>
                ))}
              </ul>
            </Bf6DetailBlock>
            <Bf6DetailBlock en="JUDGE / DJ / MC">
              <p className="font-black italic tracking-widest text-neutral-300">COMING SOON</p>
            </Bf6DetailBlock>
          </div>
        </section>

        {/* ENTRY */}
        <section className="px-4 pt-10">
          <Bf6SectionHead en="ENTRY" ja="エントリー・観覧チケット" />
          <div className="rounded-2xl bg-neutral-900 p-4 text-center">
            <p className="text-[11px] font-bold tracking-widest text-neutral-400">受付期間</p>
            <p className="mt-1 text-lg font-black italic text-white">
              2026.8.8 <span className="text-xs">SAT</span> — 9.24 <span className="text-xs">THU</span>
            </p>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {BF6_DIVISIONS.map((d) => (
              <div key={d.key} className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
                <p className="text-[10px] font-bold text-neutral-500">{d.label}</p>
                <p className={`mt-0.5 text-2xl font-black ${d.accentText}`}>
                  {remaining.divisions[d.key] > 0 ? `残${remaining.divisions[d.key]}` : '満枠'}
                </p>
                {remaining.divisions[d.key] > 0 && <p className="text-[10px] text-neutral-400">枠</p>}
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            <Link
              href="/bf6/entry"
              className="flex h-[68px] w-full items-center justify-center rounded-2xl bg-red-600 text-lg font-black text-white shadow-lg shadow-red-600/30"
            >
              バトルエントリー
            </Link>
            <Link
              href="/bf6/ticket"
              className="flex h-[68px] w-full items-center justify-center rounded-2xl bg-neutral-900 text-lg font-black text-white"
            >
              観覧チケット購入
            </Link>
          </div>
          <p className="mt-3 text-center text-xs text-neutral-500">
            ※ 必ず<Link href="/bf6/legal" className="underline">注意事項・キャンセルポリシー</Link>をご確認のうえエントリーしてください
            <br />※ 変更・キャンセルは公式LINEからご連絡ください
          </p>
        </section>

        {/* ENTRY LIST */}
        <section className="px-4 pt-10">
          <Bf6SectionHead en="ENTRY LIST" ja="エントリーリスト(リアルタイム更新)" />
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <ul className="divide-y divide-neutral-100">
              {BF6_DIVISIONS.map((d) => (
                <li key={d.key} className="flex items-center justify-between py-2.5">
                  <span className="font-bold text-neutral-800">{d.label}</span>
                  <span className="text-sm font-bold text-neutral-400">
                    <span className={`text-xl font-black ${d.accentText}`}>{countByDivision[d.key]}</span>
                    <span> / {settings.capacity[d.key]}人</span>
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/bf6/entries"
              className="mt-3 flex h-[56px] w-full items-center justify-center rounded-2xl border-2 border-neutral-900 font-black text-neutral-900"
            >
              エントリーリストを見る
            </Link>
          </div>
        </section>

        <p className="mt-10 text-center text-xs text-neutral-400">
          <Link href="/bf6/legal" className="underline">特商法表記・キャンセルポリシー</Link>
        </p>
      </div>
    </Bf6Shell>
  );
}

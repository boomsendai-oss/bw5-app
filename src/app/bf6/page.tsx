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
    <Bf6Shell full>
      <div>
        {/* ヒーロー = フライヤー本体(タイトルは画像側が担う。テキストの重複を避ける)。
            PCはフライヤー+日付/CTAの2カラムでダイナミックに(ダンスライブ参考) */}
        <div className="bg-neutral-950 md:grid md:grid-cols-2 md:items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- 静的フライヤー1枚のためnext/image不使用 */}
          <img src="/bf6/flyer-hero.jpg" alt="BOOMER'S FIGHT!!! vol.6 - BATTLE & SHOWCASE" className="w-full" />
          <header className="px-4 pb-7 pt-2 text-center text-white md:px-8 md:py-10">
            <p className="inline-block bg-red-600 px-3 py-1 text-[11px] font-black tracking-[0.2em] md:text-sm">
              BATTLE &amp; SHOWCASE
            </p>
            <p className="mt-4 text-4xl font-black italic md:mt-6 md:text-6xl">
              2026.9.26 <span className="text-xl md:text-3xl">SAT</span>
            </p>
            <p className="mt-1 text-xs font-bold text-neutral-400 md:mt-2 md:text-sm">OPEN 14:30(予定)</p>
            <div className="mt-6 hidden gap-3 md:flex">
              <Link
                href="/bf6/entry"
                className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-red-600 font-black text-white shadow-lg shadow-red-600/30"
              >
                バトルエントリー
              </Link>
              <Link
                href="/bf6/ticket"
                className="flex h-14 flex-1 items-center justify-center rounded-2xl border-2 border-white/30 font-black text-white"
              >
                観覧チケット
              </Link>
            </div>
          </header>
        </div>

        {/* DETAIL */}
        <section className="px-4 pt-8">
          <Bf6SectionHead en="DETAIL" ja="開催概要" img="/bf6/head-detail.jpg" />
          <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-2 shadow-sm md:grid md:grid-cols-2 md:gap-x-10 md:px-8 md:py-4">
            <Bf6DetailBlock en="DATE">
              <p className="text-lg font-black text-neutral-900">2026.9.26 <span className="text-sm">SAT</span></p>
            </Bf6DetailBlock>
            <Bf6DetailBlock en="TIME">
              <p className="font-bold text-neutral-800">OPEN 14:30(予定)</p>
              <p className="font-bold text-neutral-800">CLOSE 18:00頃</p>
              <p className="mt-2 text-xs text-neutral-500">※ タイムテーブルはエントリー締切後に発表します</p>
            </Bf6DetailBlock>
            <div className="md:row-span-3">
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
            </div>
            <Bf6DetailBlock en="VENUE">
              <p className="font-bold text-neutral-800">SSM 9階ホール</p>
              <p className="text-sm text-neutral-600">仙台スクールオブミュージック&amp;ダンス専門学校</p>
              <p className="mt-1 text-xs text-neutral-500">仙台市若林区新寺2-1-11</p>
              <p className="text-xs text-neutral-500">JR仙台駅 東口より徒歩5分</p>
              <a
                href="https://www.google.com/maps/search/?api=1&query=%E4%BB%99%E5%8F%B0%E5%B8%82%E8%8B%A5%E6%9E%97%E5%8C%BA%E6%96%B0%E5%AF%BA2-1-11%20%E4%BB%99%E5%8F%B0%E3%82%B9%E3%82%AF%E3%83%BC%E3%83%AB%E3%82%AA%E3%83%96%E3%83%9F%E3%83%A5%E3%83%BC%E3%82%B8%E3%83%83%E3%82%AF"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-bold text-neutral-700 hover:border-red-500 hover:text-red-600"
              >
                📍 Googleマップで開く ↗
              </a>
            </Bf6DetailBlock>
            <Bf6DetailBlock en="DIVISION">
              <ul className="space-y-2">
                {BF6_DIVISIONS.map((d) => (
                  <li key={d.key} className={`rounded-xl px-4 py-3 text-white ${d.accentBg}`}>
                    <span className="text-base font-black">{d.key === 'beginner' && '🔰 '}{d.label}</span>
                    <span className="ml-2 text-xs font-bold text-white/80">{d.note}</span>
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
          <Bf6SectionHead en="ENTRY" ja="エントリー・観覧チケット" img="/bf6/head-entry.jpg" />
          <div className="rounded-2xl bg-neutral-900 p-4 text-center">
            <p className="text-[11px] font-bold tracking-widest text-neutral-400">受付期間</p>
            <p className="mt-1 text-lg font-black italic text-white">
              2026.8.8 <span className="text-xs">SAT</span> — 9.24 <span className="text-xs">THU</span>
            </p>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {BF6_DIVISIONS.map((d) => (
              <div key={d.key} className={`rounded-2xl p-3 text-white shadow-sm ${d.accentBg}`}>
                <p className="text-[10px] font-bold text-white/80">{d.key === 'beginner' && '🔰 '}{d.label}</p>
                <p className="mt-0.5 text-xl font-black md:text-2xl">
                  {remaining.divisions[d.key] > 0 ? `限定${settings.capacity[d.key]}名` : '満枠'}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
            <Link
              href="/bf6/entry"
              className="flex h-[68px] w-full items-center justify-center rounded-2xl bg-red-600 text-lg font-black text-white shadow-lg shadow-red-600/30 md:h-20 md:text-xl"
            >
              バトルエントリー
            </Link>
            <Link
              href="/bf6/ticket"
              className="flex h-[68px] w-full items-center justify-center rounded-2xl bg-neutral-900 text-lg font-black text-white md:h-20 md:text-xl"
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
          <Bf6SectionHead en="ENTRY LIST" ja="エントリーリスト(リアルタイム更新)" img="/bf6/head-entrylist.jpg" />
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

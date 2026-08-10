// ⚠️ 公開ページ(認証なし)。理由: BF6イベントTOP(一般来場者・外部参加者向け告知)。
// 構成はDANCEALIVEのイベントページを参考(TARO 2026-08-04):
// ヒーロー → キービジュアル → DETAIL(DATE/TIME/FEE/VENUE/JUDGE) → ENTRY(大ボタン) → ENTRY LIST
import Link from 'next/link';
import { BF6_DIVISIONS } from '@/lib/bf6';
import { calcBf6Remaining, getBf6Faqs, getBf6Settings, getBf6Usage, getPublicBf6Entries } from '@/lib/bf6Db';
import { getBf6StreamConfig } from '@/lib/bf6StreamDb';
import { Bf6DetailBlock, Bf6SectionHead, Bf6Shell } from './ui';

export const dynamic = 'force-dynamic';

export default async function Bf6TopPage() {
  const [settings, usage, entries, streamCfg, faqs] = await Promise.all([
    getBf6Settings(),
    getBf6Usage(),
    getPublicBf6Entries(),
    getBf6StreamConfig(),
    getBf6Faqs(),
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
          <img src="/bf6/flyer-hero-v2.jpg" alt="BOOMER'S FIGHT!!! vol.6 - BATTLE & SHOWCASE" className="w-full" />
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
                className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-gradient-to-b from-red-500 via-red-600 to-red-800 text-white ring-1 ring-red-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(220,38,38,0.5)] font-black"
              >
                バトルエントリー
              </Link>
              <Link
                href="/bf6/ticket"
                className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-gradient-to-b from-neutral-700 via-neutral-800 to-black text-white ring-1 ring-neutral-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_10px_25px_-5px_rgba(0,0,0,0.6)] font-black"
              >
                観覧チケット
              </Link>
            </div>
          </header>
        </div>

        {/* DETAIL */}
        <section className="px-4 pt-8">
          <Bf6SectionHead en="DETAIL" ja="開催概要" img="/bf6/head-detail.png" />
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-2 shadow-sm md:grid md:grid-cols-2 md:gap-x-10 md:px-8 md:py-4">
            <Bf6DetailBlock en="DATE" ja="日程">
              <p className="text-lg font-black text-white">2026.9.26 <span className="text-sm">SAT</span></p>
            </Bf6DetailBlock>
            <Bf6DetailBlock en="TIME" ja="時間">
              <p className="font-bold text-neutral-200">OPEN 14:30(予定)</p>
              <p className="font-bold text-neutral-200">CLOSE 18:00頃</p>
              <p className="mt-2 text-xs text-neutral-400">※ タイムテーブルは追って発表いたします</p>
            </Bf6DetailBlock>
            <div className="md:row-span-3">
            <Bf6DetailBlock en="FEE" ja="料金">
              <p className="text-xs font-black text-neutral-400">バトルエントリー</p>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 text-xs text-neutral-400">
                    <th className="py-1 text-left font-bold">部門数</th>
                    <th className="py-1 text-right font-bold">当日現金</th>
                    <th className="py-1 text-right font-bold text-red-400">事前カード決済</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['1部門', 2500],
                    ['2部門', 4000],
                    ['3部門', 5500],
                  ].map(([label, price]) => (
                    <tr key={label} className="border-b border-neutral-800 last:border-b-0">
                      <td className="py-1.5 font-bold text-neutral-200">{label}</td>
                      <td className="py-1.5 text-right text-neutral-400">¥{Number(price).toLocaleString()}</td>
                      <td className="py-1.5 text-right font-black text-red-400">
                        ¥{(Number(price) - 500).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-neutral-400">事前カード決済 = 申込と同時にカードでお支払い(1人¥500引き)</p>
              <p className="text-xs text-neutral-400">当日現金 = 当日、会場受付でお支払い</p>
              <p className="mt-4 text-xs font-black text-neutral-400">観覧チケット</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                <li className="flex justify-between border-b border-neutral-800 pb-1.5">
                  <span className="font-bold text-neutral-200">大人(事前カード決済)</span>
                  <span className="font-black text-red-400">¥2,000</span>
                </li>
                <li className="flex justify-between border-b border-neutral-800 pb-1.5">
                  <span className="font-bold text-neutral-200">大人(当日現金)</span>
                  <span className="text-neutral-400">¥2,500</span>
                </li>
                <li className="flex justify-between border-b border-neutral-800 pb-1.5">
                  <span className="font-bold text-neutral-200">小学生</span>
                  <span className="text-neutral-400">¥1,000(事前・当日共通)</span>
                </li>
                <li className="flex justify-between">
                  <span className="font-bold text-neutral-200">未就学児・出場者本人</span>
                  <span className="text-neutral-400">無料</span>
                </li>
              </ul>
              <p className="mt-4 text-xs font-black text-neutral-400">オンライン配信</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                <li className="flex justify-between">
                  <span className="font-bold text-neutral-200">視聴チケット(事前カード決済)</span>
                  <span className="font-black text-red-400">¥1,500</span>
                </li>
              </ul>
              <p className="mt-1 text-xs text-neutral-400">
                当日のライブ配信+終了後1週間のアーカイブ。遠方のご家族へのプレゼントにも(視聴キーを送るだけ)
              </p>
            </Bf6DetailBlock>
            </div>
            <Bf6DetailBlock en="VENUE" ja="会場">
              <p className="font-bold text-neutral-200">SSM 9階ホール</p>
              <p className="text-sm text-neutral-400">仙台スクールオブミュージック&amp;ダンス専門学校</p>
              <p className="mt-1 text-xs text-neutral-400">仙台市若林区新寺2-1-11</p>
              <p className="text-xs text-neutral-400">JR仙台駅 東口より徒歩5分</p>
              <a
                href="https://www.google.com/maps/search/?api=1&query=%E4%BB%99%E5%8F%B0%E5%B8%82%E8%8B%A5%E6%9E%97%E5%8C%BA%E6%96%B0%E5%AF%BA2-1-11%20%E4%BB%99%E5%8F%B0%E3%82%B9%E3%82%AF%E3%83%BC%E3%83%AB%E3%82%AA%E3%83%96%E3%83%9F%E3%83%A5%E3%83%BC%E3%82%B8%E3%83%83%E3%82%AF"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-bold text-neutral-300 hover:border-red-500 hover:text-red-400"
              >
                📍 Googleマップで開く ↗
              </a>
            </Bf6DetailBlock>
            <Bf6DetailBlock en="DIVISION" ja="部門">
              <ul className="space-y-2">
                {BF6_DIVISIONS.map((d) => (
                  <li key={d.key} className={`rounded-xl px-4 py-3 text-white ring-1 ring-black/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_12px_rgba(0,0,0,0.4)] ${d.accentBg}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        <span className="text-base font-black">{d.key === 'beginner' && '🔰 '}{d.label}</span>
                        <span className="ml-2 text-xs font-bold text-white/80">{d.note}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[10px] font-bold leading-none text-white/70">優勝賞金</span>
                        <span className="text-lg font-black leading-tight">
                          ¥{(d.key === 'beginner' ? 5000 : d.key === 'kids' ? 10000 : 20000).toLocaleString()}
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Bf6DetailBlock>
            <Bf6DetailBlock en="JUDGE / DJ / MC" ja="審査員・DJ・MC">
              <div className="overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-neutral-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/bf6/judge-shoko.jpg" alt="SHOKO" className="aspect-[3/2] w-full object-cover" />
                <div className="p-4">
                <p className="text-[11px] font-bold tracking-widest text-red-500">JUDGE</p>
                <p className="mt-1 text-2xl font-black italic text-white">SHOKO</p>
                <p className="text-xs font-bold text-neutral-400">CONCLUSION / QWEEN OF QWEENZ</p>
                <p className="text-[11px] font-bold tracking-wide text-neutral-500">BREAK / 仙台</p>
                <p className="mt-2 text-xs leading-relaxed text-neutral-300">
                  仙台のEXCOLLABORATION加入後、日本各地のバトルで数々の優勝を重ね、
                  日本を代表するBGIRLクルーQWEEN OF QWEENZ、東北のBBOYからなるCONCLUSIONに加入。
                  LA・NY・台湾など海外バトルでも好成績を残し、テレビ・雑誌出演も経験。
                  講師・振付・ジャッジ・バトラーとして活動し、キッズの育成にも力を入れている。
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] font-bold text-red-400">主な戦績を見る ▾</summary>
                  <ul className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-neutral-400">
                    <li>UK BBOY CHAMPIONSHIP JAPAN FINAL 2009 優勝 / ロンドン世界大会 BEST8</li>
                    <li>BBOYWARS EPISODE∞,4,6,7,8 優勝</li>
                    <li>FREE STYLE SESSION(ロサンゼルス) BEST8</li>
                    <li>QWEENZ STREET(ニューヨーク) BGIRL 2on2 準優勝</li>
                    <li>Bboy world asia(台湾) BGIRL 2on2 準優勝</li>
                    <li>bcone 弘前 BBOY CREW 優勝 / 2021 JAPAN FINALIST</li>
                    <li>MONSTER 2026 O40ソロ 優勝 ほか多数</li>
                  </ul>
                </details>
                </div>
              </div>
              <div className="mt-2 overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-neutral-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/bf6/judge-kattsu.jpg" alt="K@TTSU" className="aspect-[3/2] w-full object-cover" />
                <div className="p-4">
                  <p className="text-[11px] font-bold tracking-widest text-red-500">JUDGE</p>
                  <p className="mt-1 text-2xl font-black italic text-white">K@TTSU</p>
                  <p className="text-xs font-bold text-neutral-400">Ziel</p>
                  <p className="text-[11px] font-bold tracking-wide text-neutral-500">HOUSE / 仙台</p>
                  <p className="mt-2 text-xs leading-relaxed text-neutral-300">
                    仙台を中心に東北のハウスシーンを牽引するダンスチーム「Ziel」の一人。
                    チームとしても個人としても、数々のコンテスト・バトルで好成績を残す。
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] font-bold text-red-400">主な戦績を見る ▾</summary>
                    <ul className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-neutral-400">
                      <li>DANCE@LIVE HOUSE 東北 2014 優勝 / 2016 準優勝</li>
                      <li>WDC 2013 JAPAN FINAL HOUSE side 準優勝</li>
                      <li>WDC 2013 東北予選 HOUSE side 優勝</li>
                      <li>loop de dance 5th / season7 ファイナル クルーバトル優勝</li>
                      <li>never say never 2nd season ファイナル 2on2 準優勝</li>
                      <li>BUSH ON TOHOKU vol.2 準優勝</li>
                      <li>king 仙台予選 バトルside 優勝 / コンテストside 準優勝</li>
                    </ul>
                  </details>
                </div>
              </div>
              <div className="mt-2 overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-neutral-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/bf6/judge-mao.jpg" alt="Mao" className="aspect-[3/2] w-full object-cover" />
                <div className="p-4">
                  <p className="text-[11px] font-bold tracking-widest text-red-500">JUDGE</p>
                  <p className="mt-1 text-2xl font-black italic text-white">Mao</p>
                  <p className="text-xs font-bold text-neutral-400">Foodies</p>
                  <p className="text-[11px] font-bold tracking-wide text-neutral-500">HIPHOP / 山形</p>
                  <p className="mt-2 text-xs leading-relaxed text-neutral-300">
                    ちゃんなつ・Maoの2人からなる、山形を拠点に活動する女性HIPHOPチーム「Foodies」のメンバー。
                    キッズ時代からダンスを続け、バトル・コンテストの両方で実績を重ねてきた実力派。
                  </p>
                  <p className="mt-2 text-[11px] font-bold leading-relaxed text-neutral-400">
                    JAPAN DANCE DELIGHT vol.30 FINALIST(Foodies)
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-neutral-700">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/bf6/cast-taro.png" alt="TARO" className="aspect-square w-full bg-gradient-to-b from-neutral-800 to-neutral-950 object-cover object-top" />
                  <div className="p-3">
                    <p className="text-[11px] font-bold tracking-widest text-red-500">MC</p>
                    <p className="mt-0.5 text-xl font-black italic text-white">TARO</p>
                    <p className="text-[11px] font-bold text-neutral-400">TARO&amp;TAKE / BSB</p>
                    <ul className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-neutral-300">
                      <li>JAPAN DANCE DELIGHT vol.25 FINALIST</li>
                      <li>WORLD DANCE COLOSSEUM / TOHOKU HIPHOP 優勝</li>
                      <li>LOOP DE DANCE 優勝</li>
                    </ul>
                  </div>
                </div>
                <div className="overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-neutral-700">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/bf6/cast-occhan.png" alt="DJ おっちゃん" className="aspect-square w-full bg-gradient-to-b from-neutral-800 to-neutral-950 object-cover object-top" />
                  <div className="p-3">
                    <p className="text-[11px] font-bold tracking-widest text-red-500">BATTLE DJ</p>
                    <p className="mt-0.5 text-xl font-black italic text-white">DJ おっちゃん</p>
                    <p className="text-[11px] font-bold text-neutral-400">NEW STYLERS</p>
                    <ul className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-neutral-300">
                      <li>JAPAN DANCE DELIGHT vol.19/21/22 FINALIST</li>
                      <li>GRAND SOUL vol.37 優勝</li>
                      <li>WDC 東北予選 HIP-HOP SIDE 優勝</li>
                    </ul>
                  </div>
                </div>
              </div>
            </Bf6DetailBlock>
          </div>
        </section>

        {/* ENTRY */}
        <section className="px-4 pt-10">
          <Bf6SectionHead en="ENTRY" ja="エントリー・観覧チケット" img="/bf6/head-entry.png" />
          <div className="rounded-2xl bg-black p-4 ring-1 ring-neutral-800 text-center">
            <p className="text-[11px] font-bold tracking-widest text-neutral-400">受付期間</p>
            <p className="mt-1 text-lg font-black italic text-white">
              2026.8.8 <span className="text-xs">SAT</span> — 9.24 <span className="text-xs">THU</span>
            </p>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {BF6_DIVISIONS.map((d) => (
              <div key={d.key} className={`rounded-2xl p-3 text-white ring-1 ring-black/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_12px_rgba(0,0,0,0.4)] ${d.accentBg}`}>
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
              className="flex h-[68px] w-full items-center justify-center rounded-2xl bg-gradient-to-b from-red-500 via-red-600 to-red-800 text-white ring-1 ring-red-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(220,38,38,0.5)] text-lg font-black md:h-20 md:text-xl"
            >
              バトルエントリー
            </Link>
            <Link
              href="/bf6/ticket"
              className="flex h-[68px] w-full items-center justify-center rounded-2xl bg-gradient-to-b from-neutral-700 via-neutral-800 to-black text-white ring-1 ring-neutral-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_10px_25px_-5px_rgba(0,0,0,0.6)] text-lg font-black md:h-20 md:text-xl"
            >
              観覧チケット購入
            </Link>
            {streamCfg.open && (
              <Link
                href="/bf6/stream"
                className="col-span-2 flex h-14 w-full items-center justify-center rounded-2xl border-2 border-red-600/60 bg-neutral-900 font-black text-red-400 md:col-span-2"
              >
                📡 オンライン配信チケット(遠方の方向け)
              </Link>
            )}
          </div>
          <p className="mt-3 text-center text-xs text-neutral-400">
            ※ 必ず<Link href="/bf6/legal" className="underline">注意事項・キャンセルポリシー</Link>をご確認のうえエントリーしてください
            <br />※ 変更・キャンセルは公式LINEからご連絡ください
          </p>
        </section>

        {/* ENTRY LIST */}
        <section className="px-4 pt-10">
          <Bf6SectionHead en="ENTRY LIST" ja="エントリーリスト(リアルタイム更新)" img="/bf6/head-entrylist.png" />
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm">
            <ul className="divide-y divide-neutral-800">
              {BF6_DIVISIONS.map((d) => (
                <li key={d.key} className="flex items-center justify-between py-2.5">
                  <span className="font-bold text-neutral-200">{d.label}</span>
                  <span className="text-sm font-bold text-neutral-400">
                    <span className={`text-xl font-black ${d.accentText}`}>{countByDivision[d.key]}</span>
                    <span> / {settings.capacity[d.key]}人</span>
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/bf6/entries"
              className="mt-3 flex h-[56px] w-full items-center justify-center rounded-2xl border-2 border-neutral-300 font-black text-white"
            >
              エントリーリストを見る
            </Link>
          </div>
        </section>

        {/* FAQ: 初出場者がつまずきやすい点をエントリー前に自己解決できるように */}
        {faqs.length > 0 && (
        <section className="px-4 pt-10">
          <div className="mb-4 text-center">
            <p className="text-2xl font-black italic tracking-wider text-white">FAQ</p>
            <p className="mt-1 text-xs font-bold text-neutral-400">よくある質問</p>
            <div className="mx-auto mt-2 h-1 w-10 bg-red-600" />
          </div>
          <div className="divide-y divide-neutral-800 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
            {faqs.map((item) => (
              <details key={item.q} className="group p-4">
                <summary className="flex cursor-pointer items-start gap-2 text-sm font-bold text-neutral-100">
                  <span className="mt-0.5 text-red-500">Q.</span>
                  <span className="flex-1">{item.q}</span>
                  <span className="text-neutral-500 transition-transform group-open:rotate-180">▾</span>
                </summary>
                <div className="mt-3 flex gap-2 text-xs leading-relaxed text-neutral-300">
                  <span className="font-bold text-neutral-500">A.</span>
                  <p className="flex-1 whitespace-pre-line">{item.a}</p>
                </div>
              </details>
            ))}
          </div>
          <p className="mt-3 text-center text-xs text-neutral-400">
            その他のご質問は公式LINEからお気軽にどうぞ
          </p>
        </section>
        )}

        {/* 主催スクールへの導線: 見に来て「踊ってみたい」と思った人を受け止める */}
        <section className="px-4 pt-10">
          <div className="rounded-2xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950 p-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <p className="text-[11px] font-bold tracking-[0.2em] text-red-500">PRESENTED BY</p>
            <p className="mt-1 text-2xl font-black italic text-white">BOOM DANCE SCHOOL</p>
            <p className="mt-3 text-sm leading-relaxed text-neutral-300">
              このイベントを主催しているのは、仙台のストリートダンススクール BOOM。
              <br className="hidden md:block" />
              初心者から現役バトラーまで、幅広いクラスがあります。
            </p>
            <p className="mt-2 text-xs text-neutral-400">
              「自分も踊ってみたい」「いつかバトルに出てみたい」と思ったら、まずは体験レッスンから。
            </p>
            <div className="mt-4 space-y-2 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
              <a
                href="https://boom-sendai.com/trial/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-14 w-full items-center justify-center rounded-2xl bg-gradient-to-b from-neutral-200 to-neutral-400 font-black text-neutral-900 ring-1 ring-neutral-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
              >
                体験レッスンを見る ↗
              </a>
              <a
                href="https://boom-sendai.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-14 w-full items-center justify-center rounded-2xl border-2 border-neutral-700 bg-neutral-900 font-bold text-neutral-300"
              >
                スクール公式サイト ↗
              </a>
            </div>
          </div>
        </section>

        <p className="mt-10 text-center text-xs text-neutral-400">
          <Link href="/bf6/legal" className="underline">特商法表記・キャンセルポリシー</Link>
        </p>
      </div>
    </Bf6Shell>
  );
}

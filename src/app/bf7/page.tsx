// ⚠️ 公開ページ(認証なし)。理由: vol.7の告知とウェイトリスト登録(一般来場者向け)。
//
// 9/26のBF6会場でvol.7を発表するのに合わせて先に出しておくページ(TARO 2026-09-24)。
// 構成はvol.6のトップと同じ並び(ヒーロー → DETAIL → ENTRY → ENTRY LIST → FAQ → PRESENTED BY)。
// ⚠️ まだ決まっていない項目は ComingSoon で「決まり次第お知らせ」とだけ出す。
//    仮の時間・料金・部門をそれらしく書かないこと(TARO方針)。
import type { Metadata } from 'next';
import { getBf6Faqs } from '@/lib/bf6Db';
import { pickBf7Faqs } from '@/lib/bf7';
import Bf7Client from './Bf7Client';
import { Bf7DetailBlock, Bf7SectionHead, Bf7Shell, ComingSoon } from './ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "BOOMER'S FIGHT!!! vol.7 | 2027.1.30(土) SSM 9階ホール",
  description:
    "BOOMER'S FIGHT!!! vol.7 は2027年1月30日(土)、仙台スクールオブミュージック&ダンス専門学校 9階ホールで開催。エントリー開始のお知らせを受け取るウェイトリストを受付中。",
};

// 端末の上下に出る色。vol.6は黒、vol.7はこの青にする(BW5のオレンジが出ないように)
export const viewport = { themeColor: '#0b1b36' };

export default async function Bf7Page() {
  // vol.6のFAQのうち、いつでも成り立つ質問だけを出す(料金・部門が前提のものは除く)
  const faqs = pickBf7Faqs(await getBf6Faqs().catch(() => []));

  return (
    <Bf7Shell>
      <Bf7Client />

      {/* DETAIL */}
      <section className="px-4 pt-8">
        <Bf7SectionHead en="DETAIL" ja="開催概要" img="/bf7/head-detail.png" />
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-2 shadow-sm">
          <Bf7DetailBlock en="DATE" ja="日程">
            <p className="text-lg font-black text-white">
              2027.1.30 <span className="text-sm">SAT</span>
            </p>
          </Bf7DetailBlock>

          <Bf7DetailBlock en="TIME" ja="時間">
            <ComingSoon note="開場・開演・終演の時刻は調整中です。決まり次第お知らせします。" />
          </Bf7DetailBlock>

          <Bf7DetailBlock en="FEE" ja="料金">
            <ComingSoon note="エントリー費・観覧チケットの料金は調整中です。エントリー受付の開始に合わせてお知らせします。" />
          </Bf7DetailBlock>

          <Bf7DetailBlock en="VENUE" ja="会場">
            <p className="font-bold text-neutral-200">SSM 9階ホール</p>
            <p className="text-sm text-neutral-400">仙台スクールオブミュージック&amp;ダンス専門学校</p>
            <p className="mt-1 text-xs text-neutral-400">仙台市若林区新寺2-1-11</p>
            <p className="text-xs text-neutral-400">JR仙台駅 東口より徒歩5分</p>
            <a
              href="https://www.google.com/maps/search/?api=1&query=%E4%BB%99%E5%8F%B0%E5%B8%82%E8%8B%A5%E6%9E%97%E5%8C%BA%E6%96%B0%E5%AF%BA2-1-11%20%E4%BB%99%E5%8F%B0%E3%82%B9%E3%82%AF%E3%83%BC%E3%83%AB%E3%82%AA%E3%83%96%E3%83%9F%E3%83%A5%E3%83%BC%E3%82%B8%E3%83%83%E3%82%AF"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-bold text-neutral-300 hover:border-sky-500 hover:text-sky-400"
            >
              📍 Googleマップで開く ↗
            </a>
          </Bf7DetailBlock>

          <Bf7DetailBlock en="DIVISION" ja="部門">
            <ComingSoon note="部門の構成は参加人数を見て決めます。決まり次第お知らせします。" />
          </Bf7DetailBlock>

          <Bf7DetailBlock en="JUDGE / DJ / MC" ja="審査員・DJ・MC">
            <ComingSoon note="スペシャルゲストは Hiro(MIDDLE FILTER / 大阪)。審査員・DJ・MCは決まり次第お知らせします。" />
          </Bf7DetailBlock>
        </div>
      </section>

      {/* ENTRY */}
      <section className="px-4 pt-10">
        <Bf7SectionHead en="ENTRY" ja="エントリー" img="/bf7/head-entry.png" />
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-2 shadow-sm">
          <Bf7DetailBlock en="OPEN" ja="受付開始">
            <p className="text-lg font-black text-white">2026年11月30日 〜</p>
            <p className="mt-1 text-xs text-neutral-400">開催の約2か月前に受付を始めます</p>
          </Bf7DetailBlock>
          <Bf7DetailBlock en="DIVISION" ja="募集する部門">
            <ComingSoon note="どの部門を設けるかは、これから決めます。ウェイトリストで希望を集めています。" />
          </Bf7DetailBlock>
          <Bf7DetailBlock en="FEE" ja="エントリー費">
            <ComingSoon />
          </Bf7DetailBlock>
        </div>
        <p className="mt-3 text-center text-xs leading-relaxed text-neutral-400">
          受付が始まったらすぐ分かるように、上の<span className="font-bold text-sky-300">ウェイトリスト</span>にご登録ください。
        </p>
      </section>

      {/* ENTRY LIST(受付開始までは枠だけ) */}
      <section className="px-4 pt-10">
        <Bf7SectionHead en="ENTRY LIST" ja="エントリーリスト" img="/bf7/head-entrylist.png" />
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-center shadow-sm">
          <ComingSoon note="エントリー受付が始まると、部門ごとの人数と出場者の一覧をここでリアルタイムに公開します。" />
        </div>
      </section>

      {/* FAQ */}
      {faqs.length > 0 && (
        <section className="px-4 pt-10">
          <div className="mb-4 text-center">
            <p className="text-2xl font-black italic tracking-wider text-white">FAQ</p>
            <p className="mt-1 text-xs font-bold text-neutral-400">よくある質問</p>
            <div className="mx-auto mt-2 h-1 w-10 bg-sky-500" />
          </div>
          <div className="divide-y divide-neutral-800 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
            {faqs.map((item) => (
              <details key={item.q} className="group p-4">
                <summary className="flex cursor-pointer items-start gap-2 text-sm font-bold text-neutral-100">
                  <span className="mt-0.5 text-sky-400">Q.</span>
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
            料金・部門についてのご質問は、決まり次第ここに追加します
          </p>
        </section>
      )}

      {/* PRESENTED BY */}
      <section className="px-4 pt-10">
        <div className="rounded-2xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950 p-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <p className="text-[11px] font-bold tracking-[0.2em] text-sky-400">PRESENTED BY</p>
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

      <footer className="mt-10 px-4 text-center text-xs text-neutral-500">
        <p>BOOM DANCE SCHOOL ／ 仙台市太白区長町・宮城野区・七ヶ浜</p>
        <p className="mt-1">
          前回(vol.6)の様子は{' '}
          <a href="https://boomersfight.vercel.app" className="text-sky-400 underline">
            こちら
          </a>
        </p>
      </footer>
    </Bf7Shell>
  );
}

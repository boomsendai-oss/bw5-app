// 1/31 HIRO WORKSHOP の欄(告知サイト /bf7)。中身の正本は src/lib/bf7.ts の BF7_WORKSHOP。
// 見た目は告知画像(BF7_WS告知)と同じ「時間割表」の形にそろえる:
//   左=濃い青の時間の列 / 右=クラス名 → 正式な説明 → 番号付きの対象Step
// WSの告知画像のQRコードは /bf7#workshop に飛ぶので、id="workshop" を外さないこと。
import { BF7_WORKSHOP } from '@/lib/bf7';
import { formatJpDate } from '@/lib/bf7Entry';
import { Bf7SectionHead } from './ui';
import ScrollToHash from './ScrollToHash';

const yen = (n: number) => n.toLocaleString();
const MAP_URL = 'https://www.google.com/maps/search/?api=1&query=%E3%82%A8%E3%83%AB%E3%83%BB%E3%83%91%E3%83%BC%E3%82%AF%E4%BB%99%E5%8F%B0';

export default function WorkshopSection() {
  const ws = BF7_WORKSHOP;
  return (
    <section id="workshop" className="scroll-mt-6 px-4 pt-10">
      <ScrollToHash id="workshop" />
      <Bf7SectionHead en="WORKSHOP" ja="HIRO ワークショップ" img="/bf7/head-workshop.png" wide />

      <p className="text-center text-sm leading-relaxed text-neutral-300">
        バトル翌日の <span className="font-bold text-white">1/31(日)</span>、
        <br className="md:hidden" />
        HIRO さんのワークショップを2本開催します。
      </p>

      {/* 日時・会場 */}
      <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-3xl font-black italic leading-none tracking-tight text-white">
            {ws.dateLabel.replace(' SUN', '')}
            <span className="ml-1.5 text-base not-italic text-sky-300">SUN</span>
          </p>
        </div>
        <p className="mt-3 font-bold text-neutral-100">{ws.venue}</p>
        <p className="mt-0.5 text-xs text-neutral-400">{ws.address}</p>
        <p className="text-xs text-neutral-400">{ws.access}</p>
        <a
          href={MAP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-bold text-neutral-300 hover:border-sky-500 hover:text-sky-400"
        >
          📍 Googleマップで開く ↗
        </a>
      </div>

      {/* クラス(時間割表) */}
      <div className="mt-4 space-y-3">
        {ws.classes.map((c) => (
          <article
            key={c.no}
            className="grid grid-cols-[84px_1fr] overflow-hidden rounded-2xl border border-sky-500/35 bg-neutral-900 md:grid-cols-[104px_1fr]"
          >
            <div className="flex flex-col items-center justify-center bg-gradient-to-b from-blue-600 to-blue-800 px-1 py-4 text-white">
              <span className="text-[11px] font-black tracking-[0.25em] text-white/80">{c.no}</span>
              <span className="mt-1 text-2xl font-black italic leading-none md:text-3xl">{c.start}</span>
              <span className="mt-1 text-xs font-bold text-white/85">〜{c.end}</span>
            </div>
            <div className="px-4 py-3.5">
              <h3 className="text-xl font-black italic leading-tight tracking-tight text-white md:text-2xl">{c.title}</h3>
              <p className="mt-2 text-[13px] font-bold leading-relaxed text-neutral-300">{c.description}</p>
              {c.steps.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] font-black tracking-[0.18em] text-sky-300">対象Step</p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {c.steps.map((s, i) => (
                      <li
                        key={s}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/50 bg-sky-500/10 px-2 py-1 text-xs font-bold text-white"
                      >
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-400 text-[10px] font-black text-neutral-950">
                          {i + 1}
                        </span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      {/* 料金(一般価格のみ) */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-neutral-700 bg-neutral-900 px-2 py-3 text-center">
          <p className="text-xs font-bold text-neutral-400">1本受講</p>
          <p className="mt-1 text-3xl font-black leading-none text-white">
            <span className="mr-0.5 text-lg">¥</span>
            {yen(ws.price.one)}
          </p>
        </div>
        <div className="rounded-2xl border border-sky-400 bg-sky-500/10 px-2 py-3 text-center shadow-[0_8px_24px_-8px_rgba(56,182,255,0.55)]">
          <p className="text-xs font-bold text-neutral-300">2本受講</p>
          <p className="mt-1 text-3xl font-black leading-none text-white">
            <span className="mr-0.5 text-lg">¥</span>
            {yen(ws.price.two)}
          </p>
          <p className="mt-1 text-[11px] font-black text-sky-300">¥{yen(ws.price.one * 2 - ws.price.two)} おトク</p>
        </div>
      </div>

      {/* 定員・受付 */}
      <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-black tracking-[0.18em] text-sky-300">定員</p>
          <p className="text-sm font-bold text-white">各クラス {ws.capacity}名(先着順)</p>
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-neutral-800 pt-3">
          <p className="text-xs font-black tracking-[0.18em] text-sky-300">受付開始</p>
          <p className="text-sm font-bold text-white">{formatJpDate(ws.openFrom)} 〜</p>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-neutral-400">
          お申込みは受付開始日から、このページでできるようになります。
        </p>
      </div>
    </section>
  );
}

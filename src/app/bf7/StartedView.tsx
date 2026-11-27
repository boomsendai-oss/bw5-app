// vol.7 受付開始後(とスタッフの下見)のページ本体。
// 構成はBOOM DOJOの申込ページと同じ型(TARO 2026-11-27「DOJOのページは見やすい・スイスイ読める」):
//   ヒーロー(ロゴ・日付・会場・申込ボタン) → 同じ形のカードを縦に並べる
//   案内は「項目名｜短い答え」の表、長い説明は畳む、カード1枚に話は1つ
// 色はvol.7の青と黒のまま。受付前(ウェイトリスト)の表示は page.tsx の従来の並びを使う。
// ⚠️ 金額と定員は bf7_settings から取り、ここに直書きしない。
import type { ReactNode } from 'react';
import Link from 'next/link';
import { BF7_DIVISIONS, formatJpDate, type Bf7Settings } from '@/lib/bf7Entry';
import Bf7CastList from './CastList';
import { btnDarkCls, btnPrimaryCls } from './ui';

const yen = (n: number) => `¥${n.toLocaleString()}`;

function Card({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-2xl border border-neutral-800 bg-neutral-900 px-4 pb-4 pt-3.5">
      <h2 className="flex items-center gap-2 border-b border-neutral-800 pb-2.5 text-base font-black text-white">
        <span className="h-4 w-1.5 skew-x-[-12deg] bg-gradient-to-b from-sky-400 to-blue-600" />
        {title}
      </h2>
      <div className="pt-3">{children}</div>
    </section>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-2 border-b border-neutral-800/70 py-2.5 text-sm last:border-b-0">
      <p className="font-black text-sky-300">{k}</p>
      <div className="font-bold leading-relaxed text-neutral-100">{children}</div>
    </div>
  );
}

const Sub = ({ children }: { children: ReactNode }) => (
  <span className="block text-xs font-normal leading-relaxed text-neutral-400">{children}</span>
);

export default function Bf7StartedView({
  settings,
  entryOpen,
  ticketOpen,
  remaining,
  countOf,
  faqs,
}: {
  settings: Bf7Settings;
  entryOpen: boolean;
  ticketOpen: boolean;
  remaining: Record<string, number> | null;
  countOf: (key: string) => number;
  faqs: { q: string; a: string }[];
}) {
  const p = settings.pricing;
  return (
    <>
      {/* ヒーロー */}
      <div className="px-4 pb-2 pt-10">
        <p className="text-[11px] font-bold tracking-[0.25em] text-neutral-400">BOOM DANCE SCHOOL PRESENTS</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/bf7/title.png" alt="BOOMER'S FIGHT!!! vol.7" className="mt-3 w-full" />
        <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="text-4xl font-black leading-none text-white">
            2027.1.30<span className="ml-2 text-lg text-sky-300">SAT</span>
          </p>
          <p className="text-sm font-bold text-neutral-300">SSM 9階ホール</p>
        </div>
        <p className="mt-3 text-sm font-bold leading-relaxed text-neutral-300">
          仙台のフリースタイル1on1ダンスバトル。
          <br />
          スペシャルゲストジャッジに <span className="text-white">HIRO</span>(MIDDLE FILTER / 大阪)。
        </p>
        <div className="mt-6 space-y-3">
          {entryOpen && (
            <Link href="/bf7/entry" className={`flex h-[72px] w-full items-center justify-center rounded-2xl text-xl font-black active:scale-[0.99] ${btnPrimaryCls}`}>
              バトルエントリー
            </Link>
          )}
          {ticketOpen && (
            <Link href="/bf7/ticket" className={`flex h-14 w-full items-center justify-center rounded-2xl text-base font-black active:scale-[0.99] ${btnDarkCls}`}>
              観覧チケット
            </Link>
          )}
          {!entryOpen && !ticketOpen && (
            <p className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 text-center text-sm font-bold text-neutral-300">受付は終了しました</p>
          )}
        </div>
      </div>

      <div className="space-y-4 px-4 pt-6">
        <Card title="開催案内">
          <Row k="日時">
            2027年1月30日(土)
            <Sub>開場・開演の時刻は調整中です。決まり次第お知らせします。</Sub>
          </Row>
          <Row k="会場">
            SSM 9階ホール
            <Sub>仙台スクールオブミュージック&amp;ダンス専門学校(仙台市若林区新寺2-1-11・JR仙台駅 東口から徒歩5分)</Sub>
            <a
              href="https://www.google.com/maps/search/?api=1&query=%E4%BB%99%E5%8F%B0%E5%B8%82%E8%8B%A5%E6%9E%97%E5%8C%BA%E6%96%B0%E5%AF%BA2-1-11%20%E4%BB%99%E5%8F%B0%E3%82%B9%E3%82%AF%E3%83%BC%E3%83%AB%E3%82%AA%E3%83%96%E3%83%9F%E3%83%A5%E3%83%BC%E3%82%B8%E3%83%83%E3%82%AF"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs font-bold text-sky-400 underline"
            >
              地図を開く ↗
            </a>
          </Row>
          <Row k="ルール">フリースタイル 1on1</Row>
          <Row k="エントリー">
            1部門 事前{yen(p.entryBase - p.prepaidDiscount)} / 当日{yen(p.entryBase)}
            <Sub>2部門目から +{yen(p.entryPerExtraDivision)}。事前はカード決済。</Sub>
          </Row>
          <Row k="観覧">
            大人 事前{yen(p.ticketAdultPrepaid)} / 当日{yen(p.ticketAdultOnsite)}
            <Sub>小学生{yen(p.ticketChild)}。未就学児と出場者本人は無料。</Sub>
          </Row>
          <Row k="締切">
            エントリー {formatJpDate(settings.entryDeadline)}まで
            <Sub>観覧チケットは当日まで購入できます。</Sub>
          </Row>
        </Card>

        <Card title="部門">
          <div className="space-y-2">
            {BF7_DIVISIONS.map((d) => {
              const left = remaining ? remaining[d.key] : null;
              return (
                <div key={d.key} className="flex items-center justify-between rounded-xl border border-sky-500/30 bg-sky-500/[0.07] px-3.5 py-3">
                  <div>
                    <p className="text-base font-black text-white">{d.label}</p>
                    <p className="text-xs font-bold text-neutral-400">{d.note}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-neutral-400">{settings.capacity[d.key]}名限定</p>
                    <p className="text-sm font-black text-sky-300">
                      {left !== null && left <= 0 ? '満員' : `エントリー ${countOf(d.key)}名`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <Link
            href="/bf7/entries"
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-neutral-700 text-sm font-black text-neutral-200"
          >
            エントリーリストを見る <span aria-hidden>→</span>
          </Link>
        </Card>

        <Card title="審査員・DJ・MC">
          <Bf7CastList />
        </Card>

        <Card title="1/31 HIRO WORKSHOP" id="workshop">
          <p className="text-sm font-bold leading-relaxed text-neutral-200">
            バトルの翌日、HIROさんのワークショップを開きます。
          </p>
          <div className="mt-2">
            <Row k="日時">
              2027年1月31日(日)
              <Sub>1st 13:30〜15:00 / 2nd 15:15〜16:45</Sub>
            </Row>
            <Row k="会場">エル・パーク仙台 フィットネススタジオ</Row>
          </div>
          <Link
            href="/bf7/workshop"
            className={`mt-3 flex h-12 w-full items-center justify-center rounded-xl text-sm font-black ${btnDarkCls}`}
          >
            内容・料金・申込はこちら →
          </Link>
        </Card>

        {faqs.length > 0 && (
          <Card title="よくある質問">
            <div className="divide-y divide-neutral-800">
              {faqs.map((item) => (
                <details key={item.q} className="group py-3">
                  <summary className="flex cursor-pointer items-start gap-2 text-sm font-bold text-neutral-100">
                    <span className="text-sky-400">Q.</span>
                    <span className="flex-1">{item.q}</span>
                    <span className="text-neutral-500 transition-transform group-open:rotate-180">▾</span>
                  </summary>
                  <p className="mt-2 whitespace-pre-line pl-6 text-xs leading-relaxed text-neutral-300">{item.a}</p>
                </details>
              ))}
            </div>
          </Card>
        )}

        <p className="text-center text-xs text-neutral-400">
          お申込みの前に
          <Link href="/bf7/legal" className="mx-1 underline">
            注意事項・キャンセルポリシー
          </Link>
          をご確認ください
        </p>

        <Card title="主催">
          <p className="text-sm font-bold text-white">BOOM DANCE SCHOOL</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-400">
            仙台のストリートダンススクール。初心者から現役バトラーまで、幅広いクラスがあります。
          </p>
          <a
            href="https://boom-sendai.com/trial/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex h-12 w-full items-center justify-center rounded-xl border border-neutral-700 text-sm font-bold text-neutral-200"
          >
            体験レッスンを見る ↗
          </a>
        </Card>
      </div>
    </>
  );
}

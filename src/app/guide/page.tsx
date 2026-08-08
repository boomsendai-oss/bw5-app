import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LINE_URL, PORTAL_URL, HACOMONO_MANUAL_URL } from './_components/GuideShell';

export const metadata: Metadata = {
  title: '会員の使い方ガイド | BOOM Dance School',
  description:
    'BOOMポータル（会員サイト）の使い方。プラン変更・ログイン・予約・キャンセル・休会・支払いの手続きをまとめています。',
};

/**
 * 会員向けガイドのハブ。
 * 設計: docs/superpowers/specs/2026-08-08-member-guide-redesign-design.md
 *
 * 上段=詰まりの多い用事(FAQボット実ログ監査#3で頻出の3件)を専用ページへ。
 * 下段=それ以外の手続きを1画面で読み切れる参照として残す。
 */

/** 詰まりが多く、実画面の手順が要る用事 */
const TOPICS: { href: string; emoji: string; title: string; lead: string; badge?: string }[] = [
  {
    href: '/guide/plan-change',
    emoji: '🔁',
    title: 'プランを変えたい',
    lead: '回数を増やす・減らす、チケット会員に切り替える',
    badge: '締切は毎月10日',
  },
  {
    href: '/guide/login',
    emoji: '🔑',
    title: 'ログインできない',
    lead: 'パスワードを忘れた・入れなくなった',
  },
  {
    href: '/guide/email',
    emoji: '📩',
    title: 'メールが届かない',
    lead: '登録・予約の確認メールが来ない',
  },
];

/** 1画面で読み切れる手続き。画面の手順が要るほど詰まっていないもの */
const SECTIONS: { id: string; emoji: string; title: string; deadline?: string; body: ReactNode }[] =
  [
    {
      id: 'yoyaku',
      emoji: '📅',
      title: 'レッスンを予約する',
      body: (
        <>
          <p>
            BOOMポータルにログイン →「予約」→ レッスンカレンダーから受けたいレッスンを選びます。
          </p>
          <p className="mt-2">契約中のプラン、または所持チケットで予約できます。</p>
          <p className="mt-2 text-neutral-500">※ レッスンは予約制です。予約にはログインが必要です。</p>
        </>
      ),
    },
    {
      id: 'cancel',
      emoji: '↩️',
      title: 'キャンセル（来られない時）',
      body: (
        <>
          <p>
            来られなくなったら、<b>必ずご自身でキャンセル</b>してください。ポータルの「予定管理」から該当レッスンをキャンセルできます。
          </p>
          <p className="mt-2">
            チケットで予約した分は、キャンセルすると<b>チケットが戻ります</b>。
          </p>
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
            ⚠️ キャンセルせず無断欠席すると、チケットは消化されます。来られないと分かったら早めに操作してください。
          </div>
        </>
      ),
    },
    {
      id: 'kyukai',
      emoji: '😴',
      title: '休会',
      deadline: '毎月10日まで',
      body: (
        <>
          <p>
            休会は1ヶ月単位です。開始・復帰はどちらも<b>月の1日から</b>
            （月の途中からはできません）。最長4ヶ月まで休会でき、期間が終わると自動的に復会します。
          </p>
          <p className="mt-2">
            翌月から休会するには<b>毎月10日まで</b>の手続きが必要です（11日以降は翌々月から）。
          </p>
          <p className="mt-2">システム変更手数料 ¥1,500 がかかります。</p>
          <p className="mt-2 text-neutral-500">※ 手続き方法は公式LINEでスタッフにご相談ください。</p>
        </>
      ),
    },
    {
      id: 'pay',
      emoji: '💳',
      title: 'お支払い',
      body: (
        <>
          <p>月会費は前払い制で、翌月分を当月中にお支払いいただきます。</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              クレジットカード：毎月<b>20日</b>に翌月分を自動決済
            </li>
            <li>
              口座振替：毎月<b>27日頃</b>の引き落とし（休業日は翌営業日）
            </li>
          </ul>
          <p className="mt-2 text-neutral-500">
            ※ カードの変更はマイページ →「お客様情報の設定」→「クレジットカード情報」から。口座振替に関する変更は公式LINEへ。
          </p>
        </>
      ),
    },
    {
      id: 'ticket',
      emoji: '🎟️',
      title: 'チケット',
      body: (
        <>
          <p>
            5回チケットも1枚チケットも<b>購入日から2ヶ月間</b>有効です。ビジターチケットは当日のみ有効です。
          </p>
          <p className="mt-2 text-neutral-500">
            ※ 間違えて購入した場合、原則キャンセルはできません。有効期限内に別のレッスンでお使いください。
          </p>
        </>
      ),
    },
  ];

export default function MemberGuidePage() {
  return (
    <main className="min-h-screen bg-sand-50 text-neutral-900">
      <header className="bg-navy-700 px-5 pb-8 pt-10 text-white">
        <div className="mx-auto max-w-md">
          <p className="text-xs font-semibold tracking-widest text-brand-200">BOOM MEMBER GUIDE</p>
          <h1 className="mt-2 text-2xl font-bold">会員の使い方ガイド</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/70">
            BOOMポータル（会員サイト）の手続きをまとめました。いつでもここで確認できます。
          </p>
        </div>
      </header>

      {/* 詰まりの多い用事を最上段に。ここが会員の入口 */}
      <div className="mx-auto -mt-4 max-w-md px-5">
        <nav className="space-y-2">
          {TOPICS.map((t) => (
            <a
              key={t.href}
              href={t.href}
              className="flex items-center gap-3 rounded-xl border border-sand-200 bg-white p-4 shadow-sm"
            >
              <span aria-hidden className="text-2xl">
                {t.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[16px] font-bold text-navy-800">{t.title}</span>
                  {t.badge && (
                    <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                      {t.badge}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[13px] leading-snug text-neutral-500">
                  {t.lead}
                </span>
              </span>
              <span aria-hidden className="text-sand-400">
                ›
              </span>
            </a>
          ))}
        </nav>
      </div>

      <div className="mx-auto max-w-md space-y-4 px-5 py-6">
        <h2 className="pt-2 text-sm font-semibold tracking-wide text-navy-700">そのほかの手続き</h2>

        {SECTIONS.map((s) => (
          <section
            key={s.id}
            id={s.id}
            className="scroll-mt-4 rounded-xl border border-sand-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="flex items-center gap-2 text-lg font-bold text-navy-800">
                <span className="text-xl">{s.emoji}</span>
                {s.title}
              </h3>
              {s.deadline && (
                <span className="shrink-0 rounded-full border border-brand-200 bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-700">
                  {s.deadline}
                </span>
              )}
            </div>
            <div className="mt-2 text-[15px] leading-relaxed text-neutral-700">{s.body}</div>
          </section>
        ))}

        {/* hacomono純正マニュアル。予約・入会のスライドはここが正 */}
        <a
          href={HACOMONO_MANUAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-xl border border-sand-200 bg-white px-4 py-3 text-[14px] text-navy-800 shadow-sm"
        >
          <span>
            <b>会員サイトの公式マニュアル</b>
            <span className="mt-0.5 block text-[13px] text-neutral-500">
              入会・予約の画面つき手順（システム提供元のページ）
            </span>
          </span>
          <span aria-hidden className="text-sand-400">
            ↗
          </span>
        </a>

        <section className="rounded-xl bg-navy-700 p-5 text-center text-white">
          <p className="text-lg font-bold">困ったときは</p>
          <p className="mt-1 text-sm text-white/70">
            解決しない時は、公式LINEでいつでもご相談ください。
          </p>
          <div className="mt-4 grid grid-cols-1 gap-2">
            <a href={LINE_URL} className="rounded-lg bg-[#06C755] py-3 font-semibold text-white">
              💬 公式LINEで相談する
            </a>
            <a href={PORTAL_URL} className="rounded-lg bg-white py-3 font-semibold text-navy-800">
              🖥 会員ポータルを開く
            </a>
          </div>
        </section>

        <p className="pt-2 text-center text-xs text-neutral-400">BOOM Dance School</p>
      </div>
    </main>
  );
}

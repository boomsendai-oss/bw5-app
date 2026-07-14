'use client';

const LINE_URL = 'https://lin.ee/4EYB9zZ';
const PORTAL_URL = 'https://boom.hacomono.jp/home';

type Sec = {
  id: string;
  emoji: string;
  title: string;
  body: React.ReactNode;
  deadline?: string;
};

const SECTIONS: Sec[] = [
  {
    id: 'yoyaku',
    emoji: '📅',
    title: 'レッスンを予約する',
    body: (
      <>
        <p>
          BOOMポータル（<a className="text-brand-700 underline" href={PORTAL_URL}>boom.hacomono.jp</a>）にログイン →「予約」→ レッスンカレンダーから受けたいレッスンを選びます。
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
        <p className="mt-2">チケットで予約した分は、キャンセルすると<b>チケットが戻ります</b>。</p>
        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-[13px] text-amber-900">
          ⚠️ キャンセルせず無断欠席すると、チケットは消化されます。締切を過ぎるとキャンセルできなくなるので、来られないと分かったら早めに操作を。
        </div>
        <p className="mt-2 text-neutral-500">※ うまくできない時は公式LINEへご連絡ください。</p>
      </>
    ),
  },
  {
    id: 'plan',
    emoji: '🔁',
    title: 'プラン変更',
    deadline: '毎月10日まで',
    body: (
      <>
        <p>マイページ →「契約管理」から、プラン・オプションを変更できます。</p>
        <p className="mt-2">
          月会費は前払いのため、締切は<b>毎月10日</b>。<b>10日まで</b>の手続きで翌月から、<b>11日以降</b>は翌々月からの適用になります。
        </p>
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
        <p>休会は1ヶ月単位です。開始・復帰はどちらも<b>月の1日から</b>（月の途中からはできません）。</p>
        <p className="mt-2">翌月から休会するには<b>毎月10日まで</b>の手続きが必要です（11日以降は翌々月から）。</p>
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
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>クレジットカード：毎月<b>20日</b>に翌月分を自動決済</li>
          <li>口座振替：毎月<b>27日頃</b>の引き落とし（休業日は翌営業日）</li>
        </ul>
        <p className="mt-2 text-neutral-500">※ カードの変更はマイページ →「お客様情報の設定」から。</p>
      </>
    ),
  },
  {
    id: 'ticket',
    emoji: '🎟️',
    title: 'チケット',
    body: (
      <>
        <p>5回チケットは<b>購入日から2ヶ月間</b>有効です。ビジターチケットは当日のみ有効です。</p>
      </>
    ),
  },
  {
    id: 'login',
    emoji: '🔑',
    title: 'ログインできない時',
    body: (
      <>
        <p>登録したメールアドレスとパスワードでログインします（LINEアカウントでのログインも可能）。</p>
        <p className="mt-2">パスワードを忘れた場合は、ログイン画面の「パスワードを忘れた方はこちら」から再設定できます。</p>
      </>
    ),
  },
];

export default function MemberGuidePage() {
  return (
    <main className="min-h-screen bg-sand-50 text-neutral-900">
      {/* Hero */}
      <header className="bg-navy-700 text-white px-5 pt-10 pb-8">
        <div className="max-w-md mx-auto">
          <p className="text-brand-200 text-xs font-semibold tracking-widest">BOOM MEMBER GUIDE</p>
          <h1 className="mt-2 text-2xl font-bold">会員の使い方ガイド</h1>
          <p className="mt-2 text-white/70 text-sm">予約・キャンセル・プラン変更・休会など、よくある操作をまとめました。いつでもここで確認できます。</p>
        </div>
      </header>

      {/* 目次 */}
      <nav className="max-w-md mx-auto px-5 -mt-4">
        <div className="rounded-xl bg-white border border-sand-200 shadow-sm p-3 flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="inline-flex items-center gap-1 rounded-full bg-sand-50 border border-sand-200 px-3 py-1 text-[13px] text-navy-800 hover:bg-sand-100"
            >
              <span>{s.emoji}</span>
              {s.title.replace(/（.*/, '')}
            </a>
          ))}
        </div>
      </nav>

      {/* Sections */}
      <div className="max-w-md mx-auto px-5 py-6 space-y-4">
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-4 rounded-xl bg-white border border-sand-200 shadow-sm p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-bold text-navy-800 flex items-center gap-2">
                <span className="text-xl">{s.emoji}</span>
                {s.title}
              </h2>
              {s.deadline && (
                <span className="shrink-0 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-[11px] font-semibold px-2 py-1">
                  {s.deadline}
                </span>
              )}
            </div>
            <div className="mt-2 text-[15px] leading-relaxed text-neutral-700">{s.body}</div>
          </section>
        ))}

        {/* 困ったとき CTA */}
        <section className="rounded-xl bg-navy-700 text-white p-5 text-center">
          <p className="text-lg font-bold">困ったときは</p>
          <p className="mt-1 text-white/70 text-sm">解決しない時は、公式LINEでいつでもご相談ください。</p>
          <div className="mt-4 grid grid-cols-1 gap-2">
            <a href={LINE_URL} className="rounded-lg bg-[#06C755] text-white font-semibold py-3">💬 公式LINEで相談する</a>
            <a href={PORTAL_URL} className="rounded-lg bg-white text-navy-800 font-semibold py-3">🖥 会員ポータルを開く</a>
          </div>
        </section>

        <p className="text-center text-xs text-neutral-400 pt-2">BOOM Dance School</p>
      </div>
    </main>
  );
}

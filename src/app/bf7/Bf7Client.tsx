'use client';

// vol.7 告知ページの上半分(ヒーロー・ウェイトリスト・カウントダウン・ゲスト)。
// 下半分(DETAIL以降)はサーバ側の page.tsx が出す。
//
// 見た目はvol.6のフライヤー系(黒地・クローム)を踏襲しつつ、色はオレンジ→青
// (TARO 2026-09-24「クローム調は同じで、色だけ変えてイメージを変える」)。
// 並び順は ウェイトリスト → カウントダウン → ゲスト(TARO 2026-09-25)。
import { useEffect, useState } from 'react';
import { BF7_DIVISIONS, BF7_ENTRY_OPEN_AT, HIRO_CREDITS, countdownTo } from '@/lib/bf7';
import { submitBf7Notify } from './actions';

const inputCls =
  'w-full rounded-xl border-2 border-neutral-800 bg-neutral-900 px-3.5 py-3 text-base text-white placeholder:text-neutral-500 focus:border-sky-500 focus:outline-none';

function Unit({ n, label }: { n: number; label: string }) {
  return (
    <div className="min-w-[4.5rem] rounded-2xl bg-white/[0.06] px-3 py-3 text-center ring-1 ring-white/10">
      <p className="text-3xl font-black tabular-nums leading-none text-white sm:text-4xl">{n}</p>
      <p className="mt-1 text-[10px] font-bold tracking-[0.2em] text-sky-300">{label}</p>
    </div>
  );
}

export default function Bf7Client() {
  // 初期描画はサーバと合わせるため null。マウント後に時計を動かす(ハイドレーションのズレ防止)
  const [left, setLeft] = useState<ReturnType<typeof countdownTo> | null>(null);
  useEffect(() => {
    const tick = () => setLeft(countdownTo(BF7_ENTRY_OPEN_AT));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const [form, setForm] = useState({ name: '', email: '', divisions: [] as string[], note: '' });
  // まず大きなボタンだけ見せ、押したらフォームを出す(TARO 2026-09-25「押したくなるボタンが最初に要る」)
  const [formOpen, setFormOpen] = useState(false);
  // ゲストの経歴は畳んでおき、「プロフィール」で開く(TARO 2026-09-25)
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<null | { already: boolean }>(null);

  const toggle = (key: string) =>
    setForm((f) => ({
      ...f,
      divisions: f.divisions.includes(key) ? f.divisions.filter((d) => d !== key) : [...f.divisions, key],
    }));

  const submit = async () => {
    setBusy(true);
    setError('');
    const r = await submitBf7Notify(form);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setDone({ already: r.already });
  };

  return (
    <div className="px-4 pb-4 pt-10">
      <p className="text-[11px] font-bold tracking-[0.25em] text-neutral-400">BOOM DANCE SCHOOL PRESENTS</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/bf7/title.png" alt="BOOMER&apos;S FIGHT!!! vol.7" className="mt-3 w-full" />

      <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-4xl font-black leading-none text-white">
          2027.1.30<span className="ml-2 text-lg text-sky-300">SAT</span>
        </p>
        <p className="text-sm font-bold text-neutral-300">SSM 9階ホール</p>
      </div>
      <p className="mt-1 text-xs text-neutral-500">仙台スクールオブミュージック&amp;ダンス専門学校</p>

      {/* ウェイトリスト。カウントダウンより上に置く */}
      <section className="mt-8">
        <div className="text-center">
          <h2 className="text-3xl font-black italic tracking-tight text-white md:text-4xl">
            WAIT LIST<span className="text-sky-400">.</span>
          </h2>
          <p className="mt-2 text-xs font-bold text-neutral-400">エントリー受付のお知らせを受け取る</p>
          <div className="mx-auto mt-3 h-1 w-12 bg-sky-500" />
        </div>
        <p className="mt-4 text-sm leading-relaxed text-neutral-400">
          登録しておくと、エントリー受付が始まったときにメールでお知らせします。この時点では申し込みではありません。
        </p>

        {!done && !formOpen && (
          // 押せると一目で分かるように、vol.6のCTAと同じツヤ(内側のハイライト+影)を付ける
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="mt-4 flex h-20 w-full flex-col items-center justify-center rounded-2xl bg-gradient-to-b from-sky-400 via-sky-500 to-blue-700 text-white ring-1 ring-blue-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-3px_0_rgba(0,0,0,0.3),0_12px_28px_-6px_rgba(2,132,199,0.6)] transition active:translate-y-0.5 active:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_6px_16px_-6px_rgba(2,132,199,0.6)]"
          >
            <span className="text-xl font-black md:text-2xl">ウェイトリストに登録する</span>
            <span className="mt-1 text-[11px] font-bold text-sky-50 md:text-xs">約30秒 ／ 申し込みではありません</span>
          </button>
        )}

        {done ? (
          <div className="mt-4 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-5">
            <p className="text-base font-black text-white">
              {done.already ? '登録の内容を更新しました' : '登録しました'}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-neutral-300">
              確認のメールをお送りしています。届かない場合は迷惑メールもご確認ください。
            </p>
          </div>
        ) : formOpen ? (
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-bold text-neutral-400">お名前</label>
              <input
                className={`mt-1 ${inputCls}`}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="山田 太郎"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-400">メールアドレス</label>
              <input
                className={`mt-1 ${inputCls}`}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-400">出たい部門(いくつでも)</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {BF7_DIVISIONS.map((d) => {
                  const on = form.divisions.includes(d.key);
                  return (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => toggle(d.key)}
                      className={`rounded-xl px-4 py-2.5 text-sm font-black ${
                        on ? 'bg-sky-500 text-neutral-950' : 'bg-neutral-900 text-neutral-300 ring-1 ring-neutral-700'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-neutral-500">
                ※ 部門の構成は参加人数を見て決めます。ご希望の部門が開催されない場合があります。
              </p>
            </div>

            {error && <p className="rounded-xl bg-red-600/20 px-3 py-2 text-sm font-bold text-red-300">{error}</p>}

            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="flex h-16 w-full items-center justify-center rounded-2xl bg-gradient-to-b from-sky-400 via-sky-500 to-blue-700 text-lg font-black text-white ring-1 ring-blue-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-3px_0_rgba(0,0,0,0.3),0_12px_28px_-6px_rgba(2,132,199,0.6)] disabled:opacity-50"
            >
              {busy ? '送信中…' : 'この内容で登録する'}
            </button>
            <p className="text-xs text-neutral-500">いただいたメールアドレスは、vol.7のご案内にのみ使います。</p>
          </div>
        ) : null}
      </section>

      {/* カウントダウン */}
      <section className="mt-8 rounded-2xl border border-sky-500/30 bg-white/[0.03] p-5">
        <p className="text-xs font-black tracking-[0.2em] text-sky-300">エントリー開始まで</p>
        {left === null ? (
          <p className="mt-3 text-sm text-neutral-400">読み込み中…</p>
        ) : left.done ? (
          <p className="mt-3 text-xl font-black text-white">エントリー受付中です</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <Unit n={left.days} label="DAYS" />
            <Unit n={left.hours} label="HOURS" />
            <Unit n={left.minutes} label="MIN" />
            <Unit n={left.seconds} label="SEC" />
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-neutral-400">
          エントリー受付は2026年11月30日からの予定です。日程・料金・部門の詳細は決まり次第お知らせします。
        </p>
      </section>

      {/* スペシャルゲスト。写真・経歴は本人からもらったもの(2026-09-25) */}
      <section className="mt-8 overflow-hidden rounded-2xl border border-sky-500/30 bg-gradient-to-b from-sky-500/10 to-transparent">
        <div className="flex items-stretch gap-3 px-5 pt-5">
          <div className="flex-1 pb-4">
            <p className="text-xs font-black tracking-[0.22em] text-sky-300">SPECIAL GUEST</p>
            <p className="mt-2 text-4xl font-black leading-none text-white">Hiro</p>
            <p className="mt-2 text-sm font-bold text-neutral-300">MIDDLE FILTER</p>
            <p className="mt-1 text-xs font-bold tracking-[0.14em] text-sky-300">FROM OSAKA</p>
            <p className="mt-3 text-xs leading-relaxed text-neutral-300">
              90年代より大阪を拠点に活動。MIDDLE SCHOOL(new jack swing / 90s HIPHOP)を広めつづける、唯一無二の伝道師的存在。
              国内・海外のイベント、SHOW、WORKSHOP、振付、コンテスト審査まで幅広く活動している。
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bf7/guest-hiro.webp"
            alt="Hiro (MIDDLE FILTER)"
            className="w-[42%] max-w-[210px] self-end object-contain object-bottom"
          />
        </div>

        <div className="border-t border-white/10 bg-neutral-950/40 px-5 py-4">
          <button
            type="button"
            onClick={() => setCreditsOpen((v) => !v)}
            aria-expanded={creditsOpen}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 py-3 text-sm font-black text-sky-200"
          >
            プロフィール
            <span className={`transition-transform ${creditsOpen ? 'rotate-180' : ''}`}>▾</span>
          </button>
          {creditsOpen && (
            <dl className="mt-3">
              {HIRO_CREDITS.map((c) => (
                <div key={c.label} className="border-b border-white/[0.06] py-2 last:border-0">
                  <dt className="text-[10px] font-black tracking-[0.18em] text-sky-300">{c.label}</dt>
                  <dd className="mt-1 text-xs leading-relaxed text-neutral-300">{c.body}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>
    </div>
  );
}

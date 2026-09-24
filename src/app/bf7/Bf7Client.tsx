'use client';

// vol.7 告知ページの中身。カウントダウン + お知らせリスト登録。
// 見た目はvol.6のフライヤー系(黒地・クロム)を踏襲しつつ、色はオレンジ→青に変えている
// (TARO 2026-09-24「クロム調は同じで、色だけ変えてイメージを変える」)。
import { useEffect, useState } from 'react';
import { BF7_DIVISIONS, BF7_ENTRY_OPEN_AT, countdownTo } from '@/lib/bf7';
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
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="relative mx-auto max-w-lg px-4 pb-16 pt-10 md:max-w-xl">
        {/* 背景の光。青に振る */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-32 top-0 h-80 w-80 rounded-full bg-sky-600/20 blur-[120px]" />
          <div className="absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-blue-900/30 blur-[140px]" />
        </div>

        <div className="relative">
          <p className="text-[11px] font-bold tracking-[0.25em] text-neutral-400">BOOM DANCE SCHOOL PRESENTS</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bf7/title.png" alt="BOOMER'S FIGHT!!! vol.7" className="mt-3 w-full" />

          <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-4xl font-black leading-none">
              2027.1.30<span className="ml-2 text-lg text-sky-300">SAT</span>
            </p>
            <p className="text-sm font-bold text-neutral-300">SSM 9階ホール</p>
          </div>
          <p className="mt-1 text-xs text-neutral-500">仙台スクールオブミュージック&amp;ダンス専門学校</p>

          {/* カウントダウン */}
          <section className="mt-8 rounded-2xl border border-sky-500/30 bg-white/[0.03] p-5">
            <p className="text-xs font-black tracking-[0.2em] text-sky-300">エントリー開始まで</p>
            {left === null ? (
              <p className="mt-3 text-sm text-neutral-400">読み込み中…</p>
            ) : left.done ? (
              <p className="mt-3 text-xl font-black">エントリー受付中です</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Unit n={left.days} label="DAYS" />
                <Unit n={left.hours} label="HOURS" />
                <Unit n={left.minutes} label="MIN" />
                <Unit n={left.seconds} label="SEC" />
              </div>
            )}
            <p className="mt-3 text-xs leading-relaxed text-neutral-400">
              エントリー開始は2026年11月30日ごろの予定です。日程・料金・部門の詳細は決まり次第お知らせします。
            </p>
          </section>

          {/* スペシャルゲスト(名前は出さない) */}
          <section className="mt-4 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-3xl">?</div>
            <div>
              <p className="text-sm font-black tracking-[0.18em] text-sky-300">SPECIAL GUEST</p>
              <p className="mt-1 text-sm text-neutral-300">大阪から、あの人が来ます。発表までお楽しみに。</p>
            </div>
          </section>

          {/* お知らせリスト */}
          <section className="mt-8">
            <h2 className="text-lg font-black">お知らせリスト</h2>
            <p className="mt-1 text-sm leading-relaxed text-neutral-400">
              登録しておくと、エントリー受付が始まったときにメールでお知らせします。この時点では申し込みではありません。
            </p>

            {done ? (
              <div className="mt-4 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-5">
                <p className="text-base font-black">
                  {done.already ? '登録の内容を更新しました' : '登録しました'}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-neutral-300">
                  確認のメールをお送りしています。届かない場合は迷惑メールもご確認ください。
                </p>
              </div>
            ) : (
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
                  className="w-full rounded-xl bg-sky-500 py-4 text-base font-black text-neutral-950 disabled:opacity-50"
                >
                  {busy ? '送信中…' : 'お知らせリストに登録する'}
                </button>
                <p className="text-xs text-neutral-500">
                  いただいたメールアドレスは、vol.7のご案内にのみ使います。
                </p>
              </div>
            )}
          </section>

          <footer className="mt-10 border-t border-white/10 pt-5 text-xs text-neutral-500">
            <p>BOOM DANCE SCHOOL ／ 仙台市太白区長町・宮城野区・七ヶ浜</p>
            <p className="mt-1">
              前回(vol.6)の様子は{' '}
              <a href="https://boomersfight.vercel.app" className="text-sky-400 underline">
                こちら
              </a>
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

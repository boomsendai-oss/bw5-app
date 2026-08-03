'use client';

// ⚠️ 公開ページ(認証なし)。理由: BOOMER'S FIGHT vol.6 の外部参加者向けエントリーフォーム。
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getBf6Context,
  submitBf6Order,
  startBf6Checkout,
  type Bf6PublicContext,
} from '../actions';
import {
  BF6_DIVISIONS,
  BF6_GRADE_OPTIONS,
  bf6DivisionLabel,
  bf6GradeLabel,
  calcEntryFee,
  calcOrderTotal,
  calcTicketUnitPrice,
  canEnterBeginner,
  canEnterKids,
  isElementaryGrade,
  type Bf6Division,
} from '@/lib/bf6';

const TOKEN_KEY = 'bf6_order_token';

type PerformerRow = {
  performerName: string;
  dancerName: string;
  dancerKana: string;
  grade: string;
  genre: string;
  rep: string;
  instagram: string;
  isFirstBattle: boolean;
  divisions: Bf6Division[];
  sameAsBuyer: boolean;
};

function emptyPerformer(): PerformerRow {
  return {
    performerName: '', dancerName: '', dancerKana: '', grade: '',
    genre: '', rep: '', instagram: '', isFirstBattle: false, divisions: [], sameAsBuyer: false,
  };
}

const yen = (n: number) => `¥${n.toLocaleString()}`;

export default function Bf6EntryPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Bf6PublicContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'input' | 'confirm' | 'pay'>('input');

  const [buyerName, setBuyerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [payMethod, setPayMethod] = useState<'prepaid' | 'onsite'>('prepaid');
  const [rows, setRows] = useState<PerformerRow[]>([emptyPerformer()]);
  const [adultTickets, setAdultTickets] = useState(0);
  const [childTickets, setChildTickets] = useState(0);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [doneToken, setDoneToken] = useState('');
  const [amountTotal, setAmountTotal] = useState(0);

  useEffect(() => {
    (async () => {
      setCtx(await getBf6Context());
      setLoading(false);
    })();
  }, []);

  const pricing = ctx?.pricing;
  const total = useMemo(() => {
    if (!pricing) return 0;
    return calcOrderTotal(
      { entries: rows.map((r) => ({ divisions: r.divisions })), adultTickets, childTickets },
      payMethod,
      pricing
    );
  }, [pricing, rows, adultTickets, childTickets, payMethod]);

  const totalOther = useMemo(() => {
    if (!pricing) return 0;
    return calcOrderTotal(
      { entries: rows.map((r) => ({ divisions: r.divisions })), adultTickets, childTickets },
      payMethod === 'prepaid' ? 'onsite' : 'prepaid',
      pricing
    );
  }, [pricing, rows, adultTickets, childTickets, payMethod]);

  function updateRow(i: number, patch: Partial<PerformerRow>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function toggleDivision(i: number, d: Bf6Division) {
    setRows((prev) =>
      prev.map((r, j) => {
        if (j !== i) return r;
        const has = r.divisions.includes(d);
        return { ...r, divisions: has ? r.divisions.filter((x) => x !== d) : [...r.divisions, d] };
      })
    );
  }

  function divisionDisabledReason(row: PerformerRow, d: Bf6Division): string {
    if (!ctx) return '';
    if (!row.divisions.includes(d) && ctx.remaining.divisions[d] <= 0) return '満枠';
    if (d === 'beginner') {
      if (row.grade && !isElementaryGrade(row.grade)) return '小学生のみ';
      if (row.grade && !row.isFirstBattle) return '初出場のみ';
    }
    if (d === 'kids' && row.grade && !canEnterKids(row.grade)) return '小・中学生のみ';
    return '';
  }

  function localCheck(): string {
    if (!buyerName.trim()) return '申込者のお名前を入力してください';
    if (!email.trim()) return 'メールアドレスを入力してください';
    if (!phone.trim()) return '電話番号を入力してください';
    for (const r of rows) {
      if (!r.performerName.trim()) return '出場者の本名(カタカナ)を入力してください';
      if (!r.dancerName.trim()) return 'ダンサーネームを入力してください';
      if (!r.dancerKana.trim()) return 'ダンサーネームの呼び方(フリガナ)を入力してください';
      if (!r.grade) return '学年を選んでください';
      if (r.divisions.length === 0) return '出場部門を1つ以上選んでください';
      if (r.divisions.includes('beginner') && !canEnterBeginner(r.grade, r.isFirstBattle)) {
        return '小学生初心者部門は「小学生」かつ「バトル初出場」の方のみです';
      }
    }
    return '';
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    const res = await submitBf6Order({
      buyerName, email, phone, payMethod,
      entries: rows.map((r) => ({
        performerName: r.performerName, dancerName: r.dancerName, dancerKana: r.dancerKana,
        grade: r.grade, genre: r.genre, rep: r.rep, instagram: r.instagram,
        isFirstBattle: r.isFirstBattle, divisions: r.divisions,
      })),
      adultTickets, childTickets,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      setStep('input');
      return;
    }
    try { localStorage.setItem(TOKEN_KEY, res.token); } catch { /* private mode */ }
    setDoneToken(res.token);
    setAmountTotal(res.amountTotal);
    if (res.payMethod === 'prepaid') {
      setStep('pay');
    } else {
      router.push(`/bf6/complete?t=${res.token}`);
    }
  }

  async function handleGoCheckout() {
    setSubmitting(true);
    setError('');
    const res = await startBf6Checkout(doneToken);
    setSubmitting(false);
    if (res.ok) {
      window.location.href = res.url;
    } else {
      setError(res.error);
    }
  }

  if (loading) {
    return <Shell><p className="text-zinc-400">読み込み中…</p></Shell>;
  }
  if (!ctx || !ctx.entryOpen) {
    return (
      <Shell>
        <h1 className="text-2xl font-black text-white">バトルエントリー</h1>
        <p className="mt-4 rounded-lg bg-zinc-800 p-4 text-zinc-200">
          現在エントリーは受け付けていません。受付期間: 8/8(土)〜9/24(木)
        </p>
      </Shell>
    );
  }

  // ===== 確認画面 =====
  if (step === 'confirm' || step === 'pay') {
    return (
      <Shell>
        {step === 'confirm' ? (
          <>
            <h1 className="text-2xl font-black text-white">入力内容の確認</h1>
            <p className="mt-1 text-sm text-zinc-400">この内容でエントリーします。よろしいですか?</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-black text-white">申込を受け付けました</h1>
            <p className="mt-1 text-sm text-zinc-400">あと1歩です。決済が完了するとエントリー確定になります。</p>
          </>
        )}

        <section className="mt-6 space-y-4">
          <ConfirmBlock label="申込者">
            <p>{buyerName}</p>
            <p className="text-sm text-zinc-400">{email} / {phone}</p>
          </ConfirmBlock>
          {rows.map((r, i) => (
            <ConfirmBlock key={i} label={`出場者 ${rows.length > 1 ? i + 1 : ''}`}>
              <p className="text-lg font-bold">{r.dancerName} <span className="text-sm font-normal text-zinc-400">({r.dancerKana})</span></p>
              <p className="text-sm text-zinc-400">{r.performerName} / {bf6GradeLabel(r.grade)}</p>
              <p className="mt-1">{r.divisions.map(bf6DivisionLabel).join('・')}</p>
              {(r.genre || r.rep) && <p className="text-sm text-zinc-400">{[r.genre, r.rep].filter(Boolean).join(' / ')}</p>}
              {r.instagram && <p className="text-sm text-zinc-400">{r.instagram}</p>}
            </ConfirmBlock>
          ))}
          {(adultTickets > 0 || childTickets > 0) && (
            <ConfirmBlock label="観覧チケット">
              {adultTickets > 0 && <p>大人 × {adultTickets}</p>}
              {childTickets > 0 && <p>小学生 × {childTickets}</p>}
            </ConfirmBlock>
          )}
          <ConfirmBlock label="お支払い">
            <p className="text-2xl font-black text-red-400">{yen(step === 'pay' ? amountTotal : total)}</p>
            <p className="text-sm text-zinc-400">
              {payMethod === 'prepaid' ? '事前カード決済(割引適用済み)' : '当日会場でのお支払い(現金)'}
            </p>
          </ConfirmBlock>
        </section>

        {error && <p className="mt-4 rounded-lg bg-red-900/40 p-3 text-red-300">{error}</p>}

        {step === 'confirm' ? (
          <div className="mt-6 space-y-3">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full rounded-xl bg-red-600 py-4 text-lg font-black text-white disabled:opacity-50"
            >
              {submitting ? '送信中…' : payMethod === 'prepaid' ? 'この内容で申し込む(次で決済)' : 'この内容でエントリーする'}
            </button>
            <button onClick={() => setStep('input')} disabled={submitting} className="w-full rounded-xl border border-zinc-600 py-3 text-zinc-300">
              入力に戻る
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <p className="text-center font-bold text-white">決済に進みますか?</p>
            <button
              onClick={handleGoCheckout}
              disabled={submitting}
              className="w-full rounded-xl bg-red-600 py-4 text-lg font-black text-white disabled:opacity-50"
            >
              {submitting ? '接続中…' : `はい、決済に進む(${yen(amountTotal)})`}
            </button>
            <button
              onClick={() => router.push(`/bf6/complete?t=${doneToken}`)}
              disabled={submitting}
              className="w-full rounded-xl border border-zinc-600 py-3 text-zinc-300"
            >
              いいえ、あとで決済する
            </button>
            <p className="text-center text-xs text-zinc-500">
              ※ 30分以内に決済が完了しない場合、この申込は無効になります
            </p>
          </div>
        )}
      </Shell>
    );
  }

  // ===== 入力画面 =====
  return (
    <Shell>
      <h1 className="text-2xl font-black text-white">バトルエントリー</h1>
      <p className="mt-1 text-sm text-zinc-400">
        BOOMER&apos;S FIGHT!!! vol.6 — 2026.9.26(土) SSM 9階ホール
      </p>

      <section className="mt-6">
        <h2 className="font-bold text-red-400">申込者(保護者の方でもOK)</h2>
        <div className="mt-2 space-y-3">
          <Field label="お名前" required>
            <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="メールアドレス" required hint="エントリー完了のご連絡が届きます">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </Field>
          <Field label="電話番号" required hint="必ず当日連絡が取れる番号を入力してください">
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </section>

      {rows.map((row, i) => (
        <section key={i} className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-red-400">出場者{rows.length > 1 ? ` ${i + 1}` : ''}</h2>
            {rows.length > 1 && (
              <button onClick={() => setRows((p) => p.filter((_, j) => j !== i))} className="text-sm text-zinc-500 underline">
                削除
              </button>
            )}
          </div>
          <div className="mt-2 space-y-3">
            <Field label="本名(カタカナ)" required hint="受付での確認用。公開されません">
              <input
                value={row.performerName}
                onChange={(e) => updateRow(i, { performerName: e.target.value, sameAsBuyer: false })}
                placeholder="ヤマダタロウ"
                className={inputCls}
              />
            </Field>
            <Field label="ダンサーネーム(エントリーネーム)" required hint="エントリーリスト・トーナメント表に載ります">
              <input value={row.dancerName} onChange={(e) => updateRow(i, { dancerName: e.target.value })} className={inputCls} />
            </Field>
            <Field label="呼び方(フリガナ)" required hint="当日MCがお呼びする読み方">
              <input value={row.dancerKana} onChange={(e) => updateRow(i, { dancerKana: e.target.value })} className={inputCls} />
            </Field>
            <Field label="学年" required>
              <select value={row.grade} onChange={(e) => updateRow(i, { grade: e.target.value })} className={inputCls}>
                <option value="">選択してください</option>
                {BF6_GRADE_OPTIONS.map((g) => (
                  <option key={g.key} value={g.key}>{g.label}</option>
                ))}
              </select>
            </Field>
            <Field label="エントリージャンル" hint="例: HIPHOP / BREAK / FREESTYLE など(自由記入)">
              <input value={row.genre} onChange={(e) => updateRow(i, { genre: e.target.value })} className={inputCls} />
            </Field>
            <Field label="REP(チーム名・地域・スクールなど)" hint="エントリーリストに載ります(任意)">
              <input value={row.rep} onChange={(e) => updateRow(i, { rep: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Instagram" hint="結果発表やレポートでタグ付けします。なるべくご入力ください">
              <input value={row.instagram} onChange={(e) => updateRow(i, { instagram: e.target.value })} placeholder="@boom_dance_school" className={inputCls} />
            </Field>

            <div>
              <p className="text-sm font-bold text-zinc-300">出場部門 <span className="text-red-400">*</span> <span className="font-normal text-zinc-500">(複数選択可)</span></p>
              <div className="mt-2 space-y-2">
                {BF6_DIVISIONS.map((d) => {
                  const reason = divisionDisabledReason(row, d.key);
                  const checked = row.divisions.includes(d.key);
                  const remaining = ctx.remaining.divisions[d.key];
                  return (
                    <label
                      key={d.key}
                      className={`flex items-center gap-3 rounded-lg border p-3 ${
                        checked ? 'border-red-500 bg-red-950/40' : 'border-zinc-700'
                      } ${reason && !checked ? 'opacity-50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={Boolean(reason) && !checked}
                        onChange={() => toggleDivision(i, d.key)}
                      />
                      <span className="flex-1">
                        <span className="font-bold text-white">{d.label}</span>
                        <span className="ml-2 text-xs text-zinc-400">残り{remaining}枠</span>
                        {reason && <span className="ml-2 text-xs text-yellow-500">{reason}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
              {row.divisions.length > 0 && pricing && (
                <p className="mt-2 text-sm text-zinc-400">
                  この出場者のエントリー料:
                  <span className="ml-1 font-bold text-white">{yen(calcEntryFee(row.divisions.length, payMethod, pricing))}</span>
                </p>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={row.isFirstBattle}
                onChange={(e) => updateRow(i, { isFirstBattle: e.target.checked })}
              />
              バトルに出るのは初めて(小学生初心者部門に出る場合は必須)
            </label>
          </div>
        </section>
      ))}

      <button
        onClick={() => setRows((p) => (p.length < 5 ? [...p, emptyPerformer()] : p))}
        className="mt-4 w-full rounded-xl border border-dashed border-zinc-600 py-3 text-zinc-300"
      >
        + 出場者を追加(きょうだい等)
      </button>

      <section className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <h2 className="font-bold text-red-400">観覧チケットも一緒に購入</h2>
        <p className="mt-1 text-xs text-zinc-500">
          出場者本人と未就学児は無料です。残り{ctx.remaining.tickets}枚
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label={`大人 ${pricing ? `(${yen(calcTicketUnitPrice('ticket_adult', payMethod, pricing))}/枚)` : ''}`}>
            <NumberSelect value={adultTickets} onChange={setAdultTickets} />
          </Field>
          <Field label={`小学生 ${pricing ? `(${yen(calcTicketUnitPrice('ticket_child', payMethod, pricing))}/枚)` : ''}`}>
            <NumberSelect value={childTickets} onChange={setChildTickets} />
          </Field>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <h2 className="font-bold text-red-400">お支払い方法</h2>
        <div className="mt-3 space-y-2">
          <label className={`flex items-center gap-3 rounded-lg border p-3 ${payMethod === 'prepaid' ? 'border-red-500 bg-red-950/40' : 'border-zinc-700'}`}>
            <input type="radio" checked={payMethod === 'prepaid'} onChange={() => setPayMethod('prepaid')} />
            <span>
              <span className="font-bold text-white">事前カード決済</span>
              <span className="ml-2 rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">エントリー1人あたり¥500引き</span>
            </span>
          </label>
          <label className={`flex items-center gap-3 rounded-lg border p-3 ${payMethod === 'onsite' ? 'border-red-500 bg-red-950/40' : 'border-zinc-700'}`}>
            <input type="radio" checked={payMethod === 'onsite'} onChange={() => setPayMethod('onsite')} />
            <span className="font-bold text-white">当日会場でお支払い(現金)</span>
          </label>
        </div>
      </section>

      <section className="mt-6 rounded-xl bg-zinc-800 p-4 text-center">
        <p className="text-sm text-zinc-400">合計金額</p>
        <p className="text-4xl font-black text-red-400">{yen(total)}</p>
        <p className="mt-1 text-xs text-zinc-500">
          {payMethod === 'prepaid' ? `当日払いの場合 ${yen(totalOther)}` : `事前決済なら ${yen(totalOther)}`}
        </p>
      </section>

      {error && <p className="mt-4 rounded-lg bg-red-900/40 p-3 text-red-300">{error}</p>}

      <button
        onClick={() => {
          const e = localCheck();
          if (e) { setError(e); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
          setError('');
          setStep('confirm');
          window.scrollTo({ top: 0 });
        }}
        className="mt-6 w-full rounded-xl bg-red-600 py-4 text-lg font-black text-white"
      >
        入力内容を確認する
      </button>

      <p className="mt-4 text-center text-xs text-zinc-500">
        <a href="/bf6/entries" className="underline">エントリーリストを見る</a> ・ <a href="/bf6/legal" className="underline">特商法表記・キャンセルポリシー</a>
      </p>
    </Shell>
  );
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-white placeholder-zinc-600 focus:border-red-500 focus:outline-none';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-lg px-4 py-8">{children}</div>
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-zinc-300">
        {label} {required && <span className="text-red-400">*</span>}
      </span>
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function NumberSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputCls}>
      {Array.from({ length: 11 }, (_, n) => (
        <option key={n} value={n}>{n}枚</option>
      ))}
    </select>
  );
}

function ConfirmBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</p>
      <div className="mt-1 text-white">{children}</div>
    </div>
  );
}

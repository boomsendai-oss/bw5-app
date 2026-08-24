'use client';

// ⚠️ 公開ページ(認証なし)。理由: BOOMER'S FIGHT vol.6 の外部参加者向けエントリーフォーム。
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
  isKatakanaText,
  isValidBf6Email,
  isValidBf6Phone,
  type Bf6Division,
} from '@/lib/bf6';
import { Bf6Hero, Bf6CallTimeNotice, Bf6Card, Bf6SectionTitle, Bf6Field, Bf6NumberSelect, Bf6Shell, inputCls, inputClsWith } from '../ui';

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
};

function emptyPerformer(): PerformerRow {
  return {
    performerName: '', dancerName: '', dancerKana: '', grade: '',
    genre: '', rep: '', instagram: '', isFirstBattle: false, divisions: [],
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
  const [ssmHint, setSsmHint] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [doneToken, setDoneToken] = useState('');
  const [amountTotal, setAmountTotal] = useState(0);

  // 欄を離れた時点で形式エラーをその場に赤字表示する(TARO 2026-08-04)
  const [blurred, setBlurred] = useState<Record<string, boolean>>({});
  const markBlurred = (key: string) => setBlurred((p) => ({ ...p, [key]: true }));
  const emailError =
    blurred.email && email.trim() && !isValidBf6Email(email) ? 'メールアドレスの形式が正しくありません' : '';
  const phoneError =
    blurred.phone && phone.trim() && !isValidBf6Phone(phone)
      ? '電話番号は数字10〜11桁で入力してください(例: 090-1234-5678)'
      : '';
  const kanaError = (key: string, v: string) =>
    blurred[key] && v.trim() && !isKatakanaText(v) ? 'カタカナで入力してください' : '';

  useEffect(() => {
    (async () => {
      setCtx(await getBf6Context());
      setLoading(false);
    })();
    // SSM学生枠のコードを通した人が誤って有料エントリーしないよう案内を出す
    try {
      if (localStorage.getItem('bf6_ssm_ok') === '1') setSsmHint(true);
    } catch { /* private mode */ }
  }, []);

  const pricing = ctx?.pricing;
  const cart = useMemo(
    () => ({ entries: rows.map((r) => ({ divisions: r.divisions })), adultTickets, childTickets }),
    [rows, adultTickets, childTickets]
  );
  const total = useMemo(() => (pricing ? calcOrderTotal(cart, payMethod, pricing) : 0), [pricing, cart, payMethod]);
  const totalOther = useMemo(
    () => (pricing ? calcOrderTotal(cart, payMethod === 'prepaid' ? 'onsite' : 'prepaid', pricing) : 0),
    [pricing, cart, payMethod]
  );

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
      if (row.grade && !row.isFirstBattle) return '下の「バトル初出場」にチェックすると選べます';
    }
    if (d === 'kids' && row.grade && !canEnterKids(row.grade)) return '小・中学生のみ';
    return '';
  }

  function localCheck(): string {
    if (!buyerName.trim()) return '申込者のお名前を入力してください';
    if (!email.trim()) return 'メールアドレスを入力してください';
    if (!phone.trim()) return '電話番号を入力してください';
    for (const r of rows) {
      if (!r.dancerName.trim()) return 'ダンサーネームを入力してください';
      if (!r.dancerKana.trim()) return 'ダンサーネームのフリガナを入力してください';
      if (!r.performerName.trim()) return '本名(カタカナ)を入力してください';
      if (!r.grade) return '学年を選んでください';
      if (!r.genre.trim()) return 'エントリージャンルを入力してください';
      if (!r.rep.trim()) return 'レペゼン(チーム名・地域・スクールなど)を入力してください';
      if (r.divisions.length === 0) return '出場部門を1つ以上選んでください';
      if (r.divisions.includes('beginner') && !canEnterBeginner(r.grade, r.isFirstBattle)) {
        return 'ビギナー部門は「小学生」かつ「バトル初出場」の方のみです';
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
    if (!res.ok) {
      setSubmitting(false);
      setError(res.error);
      setStep('input');
      return;
    }
    try { localStorage.setItem(TOKEN_KEY, res.token); } catch { /* private mode */ }
    setDoneToken(res.token);
    setAmountTotal(res.amountTotal);
    if (res.payMethod === 'prepaid') {
      // 確認画面の1タップでそのまま決済へ。接続失敗時のみ決済確認ステップに退避
      const co = await startBf6Checkout(res.token);
      if (co.ok) { window.location.href = co.url; return; }
      setSubmitting(false);
      setError(co.error);
      setStep('pay');
      window.scrollTo({ top: 0 });
    } else {
      router.push(`/bf6/complete?t=${res.token}`);
    }
  }

  async function handleGoCheckout() {
    setSubmitting(true);
    setError('');
    const res = await startBf6Checkout(doneToken);
    setSubmitting(false);
    if (res.ok) window.location.href = res.url;
    else setError(res.error);
  }

  if (loading) {
    return <Shell><p className="py-16 text-center text-neutral-400">読み込み中…</p></Shell>;
  }
  if (!ctx || !ctx.entryOpen) {
    return (
      <Shell>
        <Bf6Hero title="BATTLE ENTRY" subtitle="バトルエントリー" />
        <div className="px-4 py-8">
          <Bf6Card>
            <p className="text-neutral-300">
              現在エントリーは受け付けていません。<br />
              受付期間: <span className="font-bold">8/8(土)〜9/24(木)</span>
            </p>
          </Bf6Card>
        </div>
      </Shell>
    );
  }

  // ===== 確認画面 / 決済確認 =====
  if (step === 'confirm' || step === 'pay') {
    const payCta = (
      <div className="space-y-3 rounded-2xl border-2 border-red-600 bg-neutral-900 p-4">
        <p className="text-center text-lg font-black text-white">決済に進みますか?</p>
        <button
          onClick={handleGoCheckout}
          disabled={submitting}
          className="w-full rounded-2xl bg-gradient-to-b from-red-500 via-red-600 to-red-800 text-white ring-1 ring-red-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(220,38,38,0.5)] py-4 text-lg font-black active:scale-[0.99] disabled:opacity-50"
        >
          {submitting ? '接続中…' : `はい、決済に進む(${yen(amountTotal)})`}
        </button>
        <button
          onClick={() => router.push(`/bf6/complete?t=${doneToken}`)}
          disabled={submitting}
          className="w-full rounded-2xl bg-gradient-to-b from-neutral-700 via-neutral-800 to-black text-white ring-1 ring-neutral-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_10px_25px_-5px_rgba(0,0,0,0.6)] py-3.5 font-bold opacity-90"
        >
          いいえ、あとで決済する
        </button>
        <p className="text-center text-xs text-neutral-400">※ 30分以内に決済が完了しない場合、この申込は無効になります</p>
      </div>
    );
    return (
      <Shell>
        <Bf6Hero
          title={step === 'confirm' ? 'CONFIRM' : 'ONE MORE STEP'}
          subtitle={step === 'confirm' ? '入力内容の確認' : '申込を受け付けました'}
        />
        <div className="space-y-4 px-4 py-6">
          {step === 'confirm' ? (
            <p className="text-sm text-neutral-400">この内容でエントリーします。よろしいですか?</p>
          ) : (
            <>
              <p className="rounded-xl bg-red-950/40 p-4 text-sm font-bold text-red-300">
                あと1歩! 決済が完了するとエントリー確定になり、エントリーリストに掲載されます。
              </p>
              {error && <p className="rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}
              {payCta}
            </>
          )}

          <Bf6Card label="申込者">
            <p className="font-bold text-white">{buyerName}</p>
            <p className="text-sm text-neutral-400">{email} / {phone}</p>
          </Bf6Card>

          {rows.map((r, i) => (
            <Bf6Card key={i} label={`出場者${rows.length > 1 ? ` ${i + 1}` : ''}`}>
              <p className="text-xl font-black text-white">
                {r.dancerName} <span className="text-sm font-bold text-neutral-400">{r.dancerKana}</span>
              </p>
              <p className="mt-0.5 text-sm text-neutral-400">{r.performerName} / {bf6GradeLabel(r.grade)}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.divisions.map((d) => (
                  <span key={d} className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">
                    {bf6DivisionLabel(d)}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-sm text-neutral-400">{r.genre} / REP: {r.rep}</p>
              {r.instagram && <p className="text-sm text-neutral-400">{r.instagram.startsWith('@') ? r.instagram : `@${r.instagram}`}</p>}
            </Bf6Card>
          ))}

          {(adultTickets > 0 || childTickets > 0) && (
            <Bf6Card label="観覧チケット">
              {adultTickets > 0 && <p className="text-white">大人 × {adultTickets}</p>}
              {childTickets > 0 && <p className="text-white">小学生 × {childTickets}</p>}
            </Bf6Card>
          )}

          <div className="rounded-2xl bg-black p-5 ring-1 ring-neutral-800 text-center">
            <p className="text-xs font-bold tracking-widest text-neutral-400">
              {payMethod === 'prepaid' ? '事前カード決済(割引適用済み)' : '当日会場でのお支払い(現金)'}
            </p>
            <p className="mt-1 text-4xl font-black text-white">{yen(step === 'pay' ? amountTotal : total)}</p>
          </div>

            {step === 'confirm' && (
            <>
              {error && <p className="rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}
              <div className="space-y-3 pt-2">
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full rounded-2xl bg-gradient-to-b from-red-500 via-red-600 to-red-800 text-white ring-1 ring-red-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(220,38,38,0.5)] py-4 text-lg font-black active:scale-[0.99] disabled:opacity-50"
                >
                  {submitting ? (payMethod === 'prepaid' ? '決済画面に接続中…' : '送信中…') : payMethod === 'prepaid' ? `この内容で申し込んで決済に進む(${yen(total)})` : 'この内容でエントリーする'}
                </button>
                {payMethod === 'prepaid' && (
                  <p className="text-center text-xs text-neutral-400">※ このあとカード決済画面(Stripe)に移動します。30分以内の決済完了でエントリー確定です</p>
                )}
                <button onClick={() => setStep('input')} disabled={submitting} className="w-full rounded-2xl bg-gradient-to-b from-neutral-700 via-neutral-800 to-black text-white ring-1 ring-neutral-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_10px_25px_-5px_rgba(0,0,0,0.6)] py-3.5 font-bold opacity-90">
                  入力に戻る
                </button>
              </div>
            </>
          )}
        </div>
      </Shell>
    );
  }

  // ===== 入力画面 =====
  return (
    <Shell>
      <Bf6Hero title="BATTLE ENTRY" subtitle="バトルエントリー / 2026.9.26 SAT — SSM 9階ホール" />
      <Bf6CallTimeNotice />
      {ssmHint && (
        <div className="mx-4 mt-4 rounded-2xl border-2 border-red-600 bg-red-950/40 p-4">
          <p className="text-sm font-black text-red-300">SSMの学生の方へ</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-300">
            このページは<span className="font-bold text-white">有料</span>のエントリーです。
            SSM学生無料枠でお申し込みの方は、専用ページからお進みください。
          </p>
          <Link
            href="/bf6/ssm"
            className="mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-b from-red-500 via-red-600 to-red-800 text-sm font-black text-white ring-1 ring-red-950"
          >
            SSM学生 無料エントリーへ戻る
          </Link>
        </div>
      )}
      <div className="px-4 py-6">
        <section>
          <Bf6SectionTitle no="1" title="申込者" note="保護者の方でもOK" />
          <Bf6Card>
            <div className="space-y-4">
              <Bf6Field label="お名前" required>
                <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputCls} />
              </Bf6Field>
              <Bf6Field label="メールアドレス" required hint="エントリー完了のご連絡が届きます" error={emailError}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => markBlurred('email')}
                  className={inputClsWith(emailError)}
                />
              </Bf6Field>
              <Bf6Field label="電話番号" required hint="必ず当日連絡が取れる番号を入力してください" error={phoneError}>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => markBlurred('phone')}
                  className={inputClsWith(phoneError)}
                />
              </Bf6Field>
            </div>
          </Bf6Card>
        </section>

        <section className="mt-8">
          <Bf6SectionTitle no="2" title="出場者" note="兄弟・姉妹は「追加」でまとめて申込OK" />
          {rows.map((row, i) => (
            <div key={i} className="mt-3 first:mt-0">
              <Bf6Card>
                {rows.length > 1 && (
                  <div className="mb-3 flex items-center justify-between border-b border-neutral-800 pb-2">
                    <p className="font-black text-red-400">出場者 {i + 1}</p>
                    <button onClick={() => setRows((p) => p.filter((_, j) => j !== i))} className="text-sm text-neutral-400 underline">
                      削除
                    </button>
                  </div>
                )}
                <div className="space-y-4">
                  <Bf6Field label="ダンサーネーム(エントリーネーム)" required hint="エントリーリスト・トーナメント表に載る名前です">
                    <input value={row.dancerName} onChange={(e) => updateRow(i, { dancerName: e.target.value })} placeholder="例: TARO" className={inputCls} />
                  </Bf6Field>
                  <Bf6Field label="ダンサーネームのフリガナ" required hint="当日MCがお呼びする読み方です" error={kanaError(`kana${i}`, row.dancerKana)}>
                    <input
                      value={row.dancerKana}
                      onChange={(e) => updateRow(i, { dancerKana: e.target.value })}
                      onBlur={() => markBlurred(`kana${i}`)}
                      placeholder="例: タロー"
                      className={inputClsWith(kanaError(`kana${i}`, row.dancerKana))}
                    />
                  </Bf6Field>
                  <Bf6Field label="本名(カタカナ)" required hint="受付での本人確認用。公開されません" error={kanaError(`pname${i}`, row.performerName)}>
                    <input
                      value={row.performerName}
                      onChange={(e) => updateRow(i, { performerName: e.target.value })}
                      onBlur={() => markBlurred(`pname${i}`)}
                      placeholder="例: ヤマダタロウ"
                      className={inputClsWith(kanaError(`pname${i}`, row.performerName))}
                    />
                  </Bf6Field>
                  <Bf6Field label="学年" required>
                    <select value={row.grade} onChange={(e) => updateRow(i, { grade: e.target.value })} className={inputCls}>
                      <option value="">選択してください</option>
                      {BF6_GRADE_OPTIONS.map((g) => (
                        <option key={g.key} value={g.key}>{g.label}</option>
                      ))}
                    </select>
                  </Bf6Field>
                  <Bf6Field label="エントリージャンル" required hint="例: HIPHOP / BREAK / FREESTYLE など">
                    <input value={row.genre} onChange={(e) => updateRow(i, { genre: e.target.value })} placeholder="例: HIPHOP" className={inputCls} />
                  </Bf6Field>
                  <Bf6Field label="レペゼン(チーム名・地域・スクールなど)" required hint="エントリーリストに載ります">
                    <input value={row.rep} onChange={(e) => updateRow(i, { rep: e.target.value })} placeholder="例: 仙台(地域名・チーム名など)" className={inputCls} />
                  </Bf6Field>
                  <Bf6Field label="Instagram" hint="結果発表やレポートでタグ付けします。なるべくご入力ください">
                    <input value={row.instagram} onChange={(e) => updateRow(i, { instagram: e.target.value })} placeholder="@boom_dance_school" className={inputCls} />
                  </Bf6Field>

                  <div>
                    <p className="text-sm font-bold text-neutral-200">
                      出場部門 <span className="text-red-400">*</span>
                      <span className="ml-1 font-normal text-neutral-400">(複数選択可)</span>
                    </p>
                    <div className="mt-2 space-y-2">
                      {BF6_DIVISIONS.map((d) => {
                        const reason = divisionDisabledReason(row, d.key);
                        const checked = row.divisions.includes(d.key);
                        const remaining = ctx.remaining.divisions[d.key];
                        return (
                          <label
                            key={d.key}
                            className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3.5 transition ${
                              checked ? 'border-red-600 bg-red-950/40' : 'border-neutral-800 bg-neutral-900'
                            } ${reason && !checked ? 'opacity-60' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={Boolean(reason) && !checked}
                              onChange={() => toggleDivision(i, d.key)}
                              className="h-5 w-5 accent-red-600"
                            />
                            <span className="flex-1">
                              <span className="flex items-center gap-2">
                                <span className="font-black text-white">{d.key === 'beginner' && '🔰 '}{d.label}</span>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${remaining > 0 ? 'bg-neutral-950 text-neutral-400' : 'bg-yellow-100 text-yellow-700'}`}>
                                  {remaining > 0 ? `限定${ctx.capacity[d.key]}名` : '満枠'}
                                </span>
                              </span>
                              <span className="block text-xs text-neutral-400">{d.note}</span>
                              {reason && reason !== '満枠' && <span className="block text-xs font-bold text-red-500">{reason}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-bold text-neutral-300">
                      <input
                        type="checkbox"
                        checked={row.isFirstBattle}
                        onChange={(e) => updateRow(i, { isFirstBattle: e.target.checked })}
                        className="h-5 w-5 accent-red-600"
                      />
                      バトルに出るのは初めて
                      <span className="font-normal text-neutral-400">(ビギナー部門は必須)</span>
                    </label>
                    <p className="mt-1.5 pl-8 text-[11px] leading-relaxed text-neutral-400">
                      イベントとして開催されているバトル(他団体を含む)への出場歴で判断します。
                      <span className="text-neutral-300">練習会やレッスン内のサイファー・模擬バトルは含みません。</span>
                      <br />
                      本番当日(9/26)までに公式なバトルへ出場した場合は対象外となり、小中学生部門への変更をお願いします。
                    </p>
                    {row.divisions.length > 0 && pricing && (
                      <p className="mt-3 rounded-lg bg-neutral-800/60 px-3 py-2 text-sm text-neutral-400">
                        この出場者のエントリー料:
                        <span className="ml-1 text-base font-black text-white">{yen(calcEntryFee(row.divisions.length, payMethod, pricing))}</span>
                      </p>
                    )}
                  </div>
                </div>
              </Bf6Card>
            </div>
          ))}
          <button
            onClick={() => setRows((p) => (p.length < 5 ? [...p, emptyPerformer()] : p))}
            className="mt-3 w-full rounded-2xl border-2 border-dashed border-neutral-700 bg-neutral-900 py-3.5 font-bold text-neutral-400"
          >
            + 出場者を追加(兄弟・姉妹など)
          </button>
        </section>

        <section className="mt-8">
          <Bf6SectionTitle no="3" title="観覧チケットも一緒に購入" note={`出場者本人と未就学児は無料 / 残り${ctx.remaining.tickets}枚`} />
          <Bf6Card>
            <div className="grid grid-cols-2 gap-4">
              <Bf6Field label={`大人 ${pricing ? `${yen(calcTicketUnitPrice('ticket_adult', payMethod, pricing))}/枚` : ''}`}>
                <Bf6NumberSelect value={adultTickets} onChange={setAdultTickets} />
              </Bf6Field>
              <Bf6Field label={`小学生 ${pricing ? `${yen(calcTicketUnitPrice('ticket_child', payMethod, pricing))}/枚` : ''}`}>
                <Bf6NumberSelect value={childTickets} onChange={setChildTickets} />
              </Bf6Field>
            </div>
          </Bf6Card>
        </section>

        <section className="mt-8">
          <Bf6SectionTitle no="4" title="お支払い方法" />
          <div className="space-y-2">
            <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 bg-neutral-900 p-4 ${payMethod === 'prepaid' ? 'border-red-600 bg-red-950/40' : 'border-neutral-800'}`}>
              <input type="radio" checked={payMethod === 'prepaid'} onChange={() => setPayMethod('prepaid')} className="h-5 w-5 accent-red-600" />
              <span className="flex-1">
                <span className="font-black text-white">事前カード決済</span>
                <span className="ml-2 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white">おトク</span>
                <span className="block text-xs text-neutral-400">
                  割引対象: エントリー料(出場者1人につき¥500引き)と大人観覧(事前¥2,000/当日¥2,500)。
                  小学生観覧は一律¥1,000(割引対象外)
                </span>
              </span>
            </label>
            <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 bg-neutral-900 p-4 ${payMethod === 'onsite' ? 'border-red-600 bg-red-950/40' : 'border-neutral-800'}`}>
              <input type="radio" checked={payMethod === 'onsite'} onChange={() => setPayMethod('onsite')} className="h-5 w-5 accent-red-600" />
              <span className="flex-1">
                <span className="font-black text-white">当日会場でお支払い</span>
                <span className="block text-xs text-neutral-400">受付にて現金でお支払い</span>
              </span>
            </label>
          </div>
        </section>

        <div className="mt-8 rounded-2xl bg-black p-5 ring-1 ring-neutral-800">
          {pricing && (rows.some((r) => r.divisions.length > 0) || adultTickets > 0 || childTickets > 0) && (
            <ul className="space-y-2 border-b border-neutral-700 pb-3 text-sm">
              {rows.map((r, i) =>
                r.divisions.length > 0 ? (
                  <li key={i} className="flex items-baseline justify-between gap-2 text-neutral-300">
                    <span>
                      エントリー {r.dancerName.trim() || `出場者${i + 1}`}({r.divisions.length}部門)
                      {payMethod === 'prepaid' && (
                        <span className="ml-1 whitespace-nowrap text-xs text-red-400">¥500引き適用</span>
                      )}
                    </span>
                    <span className="font-bold text-white">{yen(calcEntryFee(r.divisions.length, payMethod, pricing))}</span>
                  </li>
                ) : null
              )}
              {adultTickets > 0 && (
                <li className="flex items-baseline justify-between gap-2 text-neutral-300">
                  <span>観覧 大人 {yen(calcTicketUnitPrice('ticket_adult', payMethod, pricing))} × {adultTickets}枚</span>
                  <span className="font-bold text-white">{yen(calcTicketUnitPrice('ticket_adult', payMethod, pricing) * adultTickets)}</span>
                </li>
              )}
              {childTickets > 0 && (
                <li className="flex items-baseline justify-between gap-2 text-neutral-300">
                  <span>
                    観覧 小学生 {yen(calcTicketUnitPrice('ticket_child', payMethod, pricing))} × {childTickets}枚
                    <span className="ml-1 text-xs text-neutral-400">(一律)</span>
                  </span>
                  <span className="font-bold text-white">{yen(calcTicketUnitPrice('ticket_child', payMethod, pricing) * childTickets)}</span>
                </li>
              )}
            </ul>
          )}
          <div className="pt-3 text-center">
            <p className="text-xs font-bold tracking-widest text-neutral-400">合計金額</p>
            <p className="mt-1 text-5xl font-black text-white">{yen(total)}</p>
            {total !== totalOther && (
              <p className={`mt-2 text-xs font-bold ${payMethod === 'prepaid' ? 'text-red-400' : 'text-neutral-400'}`}>
                {payMethod === 'prepaid'
                  ? `事前決済で ${yen(totalOther - total)} お得になっています(当日払いだと ${yen(totalOther)})`
                  : `事前カード決済にすると ${yen(total - totalOther)} お得(合計 ${yen(totalOther)})`}
              </p>
            )}
          </div>
        </div>

        {error && <p className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}

        <button
          onClick={() => {
            const e = localCheck();
            if (e) { setError(e); return; }
            setError('');
            setStep('confirm');
            window.scrollTo({ top: 0 });
          }}
          className="mt-5 w-full rounded-2xl bg-gradient-to-b from-red-500 via-red-600 to-red-800 text-white ring-1 ring-red-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(220,38,38,0.5)] py-4 text-lg font-black active:scale-[0.99]"
        >
          入力内容を確認する
        </button>

        <p className="mt-5 text-center text-xs text-neutral-400">
          <Link href="/bf6/entries" className="underline">エントリーリスト</Link>
          <span className="mx-2">·</span>
          <Link href="/bf6/legal" className="underline">特商法表記・キャンセルポリシー</Link>
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <Bf6Shell>{children}</Bf6Shell>;
}

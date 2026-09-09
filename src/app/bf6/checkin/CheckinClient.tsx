'use client';

// 当日の受付端末。出場者が自分で操作する。
// 流れ: 部門を選ぶ → 名前を選ぶ → (未払いなら支払い案内) → くじ引き → 完了
// 2部門に出ている人は、完了画面から続けてもう片方の受付に進める。
//
// 迷わせないことを最優先にする。1画面につき操作は1つ、文字は大きく、戻れるようにする。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { kioskDraw, kioskMarkPaid } from './actions';
import { needsPhotoGuide, nextKioskStep, phaseForDivision, remainingDivisions } from '@/lib/bf6Kiosk';
import KioskBracket from './KioskBracket';
import type { Bf6DrawDivision } from '@/lib/bf6Draw';
import type { KioskEntrant } from '@/lib/bf6Kiosk';
import type { KioskRow } from '@/lib/bf6KioskDb';

type Entrant = KioskRow;
type Screen = 'home' | 'division' | 'name' | 'pay' | 'draw' | 'result' | 'done';

const DIV = [
  { key: 'beginner', label: 'ビギナー部門', note: '小学生・バトル初出場', color: 'from-emerald-500 to-emerald-700' },
  { key: 'kids', label: '小中学生部門', note: '小学生・中学生', color: 'from-orange-500 to-orange-700' },
  { key: 'general', label: '一般部門', note: '年齢制限なし', color: 'from-red-500 to-red-700' },
];
const DIV_LABEL: Record<string, string> = Object.fromEntries(DIV.map((d) => [d.key, d.label]));
// リストバンドの表記。当日は「小中A」「一般B」と書かれたバンドを配る(TARO 2026-09-09)
const BAND_LABEL: Record<string, string> = { kids: '小中', general: '一般', beginner: 'ビギナー' };

export default function CheckinClient({ entrants }: { entrants: Entrant[] }) {
  const [screen, setScreen] = useState<Screen>('home');
  const [division, setDivision] = useState('');
  const [sel, setSel] = useState<Entrant | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [doneLocal, setDoneLocal] = useState<Set<string>>(new Set());

  // 抽選演出
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<{
    slotNo: number;
    block?: 'A' | 'B';
    holders?: Record<number, string>;
    slotCount?: number;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRef = useRef<{
    slotNo: number;
    block?: 'A' | 'B';
    holders?: Record<number, string>;
    slotCount?: number;
  } | null>(null);

  const inDivision = useMemo(
    () => entrants.filter((e) => e.divisions.includes(division)),
    [entrants, division]
  );
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? inDivision.filter((e) => e.dancerName.toLowerCase().includes(k)) : inDivision;
  }, [inDivision, q]);

  // この端末で引き終わった人。
  // ⚠️ 受付中はサーバ主導の再描画を入れられない(進行中の画面が壊れるため)ので、
  //    一覧のdrawnDivisionsは開いたときのまま古くなる。ここで補う。
  //    これが無いと、引いた直後の人がまた選べてしまい「二重に引ける」ように見える。
  const isDrawn = (e: Entrant, div: string) =>
    e.drawnDivisions.includes(div) || doneLocal.has(`${e.itemId}:${div}`);

  const reset = () => {
    setScreen('home');
    setDivision('');
    setSel(null);
    setQ('');
    setError('');
    setResult(null);
    pendingRef.current = null;
  };

  /** 名前を選んだあとの分岐 */
  const pickName = (e: Entrant) => {
    setSel(e);
    setError('');
    const step = nextKioskStep(
      { ...e, drawnDivisions: isDrawn(e, division) ? [...e.drawnDivisions, division] : e.drawnDivisions },
      division
    );
    if (step.kind === 'pay') setScreen('pay');
    else if (step.kind === 'done') {
      setError('この部門の受付はすでに完了しています。スタッフにお声がけください。');
      setScreen('name');
    } else setScreen('draw');
  };

  const stopSpin = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * ルーレットを回し始める。回している裏で枠を確保しておく。
   * 見た目だけ回して止めた瞬間に枠を取りに行くと、複数台で同時に操作したときに
   * 「表示された番号と実際に取れた枠が違う」が起きるため、先に確定させる。
   */
  const startRoll = useCallback(async () => {
    if (!sel || rolling) return;
    setError('');
    pendingRef.current = null;
    setRolling(true);
    // ⚠️ 回っている間に数字を出さない。順番でもランダムでもぼかしても「予想できる」と
    //    思われる(TARO実機 2026-09-09)。実際は押す前にサーバ側で枠が確定しているので、
    //    狙えると思わせるのはイカサマを疑われる最悪の形。数字は結果画面で初めて出す。
    stopSpin();

    try {
      const r = await kioskDraw(sel.itemId, division);
      if ('error' in r) {
        stopSpin();
        setRolling(false);
        setError(r.error);
        return;
      }
      pendingRef.current = r;
    } catch {
      stopSpin();
      setRolling(false);
      setError('通信に失敗しました。もう一度お試しください。');
    }
  }, [sel, division, rolling, stopSpin]);

  /** 止める。まだ結果が返っていなければ、返るまで回し続ける。 */
  const stopRoll = useCallback(() => {
    let waited = 0;
    const settle = () => {
      const r = pendingRef.current;
      if (!r) {
        waited += 120;
        if (waited > 10000) {
          stopSpin();
          setRolling(false);
          setError('時間内に確定できませんでした。スタッフにお声がけください。');
          return;
        }
        setTimeout(settle, 120);
        return;
      }
      stopSpin();
      setRolling(false);
      setResult(r);
      if (sel) setDoneLocal((prev) => new Set(prev).add(`${sel.itemId}:${division}`));
      setScreen('result');
    };
    settle();
    // ⚠️ sel と division を依存に入れないと、最初の描画時の null を掴んだままになり
    //    「引いた人を覚える」が一度も動かない(実機で HiMa が灰色にならなかった)
  }, [stopSpin, sel, division]);

  // 画面を離れるときにルーレットを止める(タイマーが残り続けないように)
  useEffect(() => () => stopSpin(), [stopSpin]);

  const markPaid = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      await kioskMarkPaid(sel.orderId);
      // 支払い済みとして扱い、そのまま抽選へ
      setSel({ ...sel, amountDue: 0, paymentStatus: 'paid' });
      setScreen('draw');
    } finally {
      setBusy(false);
    }
  };

  /** 完了後、もう片方の部門が残っていれば続けて受付する(この端末で引いた分も除く) */
  const rest = sel
    ? remainingDivisions({
        ...sel,
        drawnDivisions: sel.divisions.filter((d) => d === division || isDrawn(sel, d)),
      })
    : [];

  return (
    <div className="min-h-screen bg-neutral-950 px-5 py-6 text-white">
      {/* ── ホーム ── */}
      {screen === 'home' && (
        <Center>
          <p className="text-[4vh] font-black tracking-[0.3em] text-orange-400">RECEPTION</p>
          <p className="mt-2 text-[2.4vh] font-bold text-white/70">バトルエントリー受付</p>
          <button
            onClick={() => setScreen('division')}
            className="mt-10 w-full max-w-md rounded-3xl bg-gradient-to-b from-orange-500 to-orange-700 py-8 text-[3.4vh] font-black"
          >
            エントリー受付をする
          </button>
          <p className="mt-8 text-center text-[1.8vh] leading-relaxed text-white/50">
            受付は14:00まで / 組み合わせ抽選を行います<br />
            分からないことがあればスタッフにお声がけください
          </p>
        </Center>
      )}

      {/* ── 部門を選ぶ ── */}
      {screen === 'division' && (
        <>
          <Head title="出場する部門を選んでください" onBack={reset} />
          <div className="mt-6 space-y-4">
            {DIV.map((d) => (
              <button
                key={d.key}
                onClick={() => { setDivision(d.key); setQ(''); setError(''); setScreen('name'); }}
                className={`block w-full rounded-3xl bg-gradient-to-b ${d.color} px-6 py-8 text-left`}
              >
                <span className="block text-[3.2vh] font-black">{d.label}</span>
                <span className="block text-[1.9vh] font-bold text-white/80">{d.note}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── 名前を選ぶ ── */}
      {screen === 'name' && (
        <>
          <Head title={`${DIV_LABEL[division]}`} sub="お名前を選んでください" onBack={() => setScreen('division')} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="名前で探す"
            className="mt-4 w-full rounded-2xl border border-white/20 bg-neutral-900 px-5 py-4 text-[2.2vh]"
          />
          {error && <Err>{error}</Err>}
          <div className="mt-4 space-y-2 pb-8">
            {list.map((e) => {
              const already = isDrawn(e, division);
              return (
                <button
                  key={e.itemId}
                  onClick={() => pickName(e)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-5 py-5 text-left ${
                    already ? 'border-white/10 bg-neutral-900 text-white/35' : 'border-white/25 bg-neutral-900'
                  }`}
                >
                  <span className="text-[2.6vh] font-black">{e.dancerName}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {e.amountDue > 0 ? (
                      <span className="rounded-full bg-amber-500/20 px-3 py-1 text-[1.6vh] font-black text-amber-300">
                        当日現金 ¥{e.amountDue.toLocaleString()}
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[1.6vh] font-bold text-emerald-300">
                        支払い済み
                      </span>
                    )}
                    {already && <span className="text-[1.7vh] font-bold">受付済</span>}
                  </span>
                </button>
              );
            })}
            {list.length === 0 && <p className="py-10 text-center text-white/40">該当なし</p>}
          </div>
        </>
      )}

      {/* ── 支払い案内 ── */}
      {screen === 'pay' && sel && (
        <Center>
          <p className="text-[2.4vh] font-bold text-white/70">{sel.dancerName} さん</p>
          <p className="mt-6 text-[3vh] font-black leading-relaxed">
            お近くのスタッフに声をかけて<br />エントリー費をお支払いください
          </p>
          <p className="mt-6 text-[5vh] font-black text-orange-400">¥{sel.amountDue.toLocaleString()}</p>
          {sel.breakdown.length > 0 && (
            <ul className="mt-3 w-full max-w-md rounded-2xl bg-white/[0.05] px-5 py-3 text-left">
              {sel.breakdown.map((l, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 py-1 text-[1.9vh]">
                  <span className="text-white/75">
                    {l.label}
                    {l.qty > 1 && <span className="text-white/45"> ×{l.qty}</span>}
                  </span>
                  <span className="font-bold">¥{l.amount.toLocaleString()}</span>
                </li>
              ))}
              <li className="mt-1 flex items-baseline justify-between border-t border-white/15 pt-2 text-[2vh]">
                <span className="font-bold text-white/75">合計</span>
                <span className="font-black text-orange-300">¥{sel.amountDue.toLocaleString()}</span>
              </li>
            </ul>
          )}
          <p className="mt-8 text-[1.8vh] text-white/50">支払いが済んだら、下のボタンを押してください</p>
          <button
            disabled={busy}
            onClick={markPaid}
            className="mt-4 w-full max-w-md rounded-2xl bg-gradient-to-b from-orange-500 to-orange-700 py-6 text-[2.6vh] font-black disabled:opacity-50"
          >
            {busy ? '…' : '支払いを終了しました'}
          </button>
          <button onClick={() => setScreen('name')} className="mt-3 text-[1.8vh] text-white/40 underline">
            戻る
          </button>
        </Center>
      )}

      {/* ── 抽選 ── */}
      {screen === 'draw' && sel && (
        <Center>
          <p className="text-[2.4vh] font-bold text-white/70">
            {DIV_LABEL[division]} / {sel.dancerName} さん
          </p>
          <p className="mt-3 text-[2.2vh] font-bold text-orange-400">
            {phaseForDivision(division) === 'block' ? '予選のブロックを決めます' : 'トーナメントの位置を決めます'}
          </p>

          {/* 回っている間は数字を一切出さない(読めると目押しできると思われる) */}
          <style>{`
            @keyframes kioskSpin { to { transform: rotate(360deg); } }
            @keyframes kioskPulse { 0%,100% { opacity: .35; transform: scale(.92); } 50% { opacity: 1; transform: scale(1.08); } }
          `}</style>
          <div className="relative mt-8 flex h-[26vh] w-[26vh] items-center justify-center">
            <div
              className={`absolute inset-0 rounded-full border-[1.1vh] border-orange-500/25 ${
                rolling ? 'border-t-orange-400 border-r-orange-300' : ''
              }`}
              style={rolling ? { animation: 'kioskSpin 0.55s linear infinite' } : undefined}
            />
            <span
              className="text-[12vh] font-black italic leading-none text-orange-400"
              style={rolling ? { animation: 'kioskPulse 0.9s ease-in-out infinite' } : undefined}
            >
              ?
            </span>
          </div>
          {rolling && <p className="mt-3 text-[1.9vh] font-bold text-white/45">抽選中…</p>}

          {error && <Err>{error}</Err>}

          {!rolling ? (
            <button
              onClick={startRoll}
              className="mt-8 w-full max-w-md rounded-2xl bg-gradient-to-b from-orange-500 to-orange-700 py-7 text-[3vh] font-black"
            >
              くじを引く
            </button>
          ) : (
            <button
              onClick={stopRoll}
              className="mt-8 w-full max-w-md rounded-2xl bg-gradient-to-b from-red-500 to-red-700 py-7 text-[3vh] font-black"
            >
              ストップ
            </button>
          )}
        </Center>
      )}

      {/* ── 結果 ── */}
      {screen === 'result' && sel && result && (
        <Center>
          <p className="text-[2.4vh] font-bold text-white/70">{sel.dancerName} さん</p>
          <p className="mt-2 text-[2vh] font-bold text-white/50">{DIV_LABEL[division]}</p>
          <p className="mt-8 text-[2.4vh] font-bold text-orange-400">
            {result.block ? '予選ブロック' : 'トーナメント'}
          </p>
          <p
            className={`mt-2 font-black italic leading-none text-orange-400 ${
              result.holders ? 'text-[11vh]' : 'text-[16vh]'
            }`}
          >
            {result.block ?? result.slotNo}
          </p>
          <p className="mt-2 text-[2.4vh] font-bold">
            {result.block ? `${result.block}ブロック` : `${result.slotNo}番`}
          </p>

          {/* 番号だけでは伝わらないので、LEDと同じ形の表の中に自分の名前を出す */}
          {result.holders && result.slotCount ? (
            <KioskBracket
              division={division as Bf6DrawDivision}
              mySlot={result.slotNo}
              slotCount={result.slotCount}
              holders={result.holders}
            />
          ) : null}

          {result.block && (
            <div className="mt-7 w-full max-w-md rounded-2xl border border-orange-500/40 bg-orange-500/5 p-5 text-center">
              <p className="text-[2.6vh] font-black text-orange-300">
                「{BAND_LABEL[division]}{result.block}」のリストバンド
              </p>
              <p className="mt-2 text-[2vh] leading-relaxed text-white/70">
                受付で受け取って、腕につけておいてください。
              </p>
              {rest.length === 0 && needsPhotoGuide(sel.divisions) && (
                <p className="mt-3 text-[1.8vh] text-orange-200/80">このあとビギナー部門の写真撮影があります</p>
              )}
            </div>
          )}

          <button
            onClick={() => setScreen('done')}
            className="mt-10 w-full max-w-md rounded-2xl bg-gradient-to-b from-orange-500 to-orange-700 py-6 text-[2.6vh] font-black"
          >
            確認しました
          </button>
        </Center>
      )}

      {/* ── 完了 ── */}
      {screen === 'done' && sel && (
        <Center>
          <p className="text-[3.4vh] font-black">エントリー受付が完了しました</p>
          <p className="mt-3 text-[2.2vh] font-bold text-white/70">{sel.dancerName} さん</p>

          {/* 写真の案内は全部門が終わってから出す。途中で出すと次の部門の受付を忘れる(TARO 2026-09-09) */}
          {rest.length === 0 && needsPhotoGuide(sel.divisions) && (
            <div className="mt-8 w-full max-w-md rounded-2xl border border-orange-500/60 bg-orange-500/10 px-5 py-6">
              <p className="text-[2.4vh] font-black text-orange-300">ビギナー部門の写真撮影があります</p>
              <p className="mt-2 text-[1.9vh] leading-relaxed text-white/80">
                お近くのスタッフに声をかけて、<br />エントリー写真を撮ってもらってください
              </p>
            </div>
          )}

          {rest.length > 0 ? (
            <>
              <p className="mt-8 text-[2.2vh] font-black text-orange-300">
                次は {rest.map((d) => DIV_LABEL[d]).join('・')} の受付です
              </p>
              {rest.map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    setDivision(d);
                    setResult(null);
                    pendingRef.current = null;
                    setSel({ ...sel, drawnDivisions: [...sel.drawnDivisions, division] });
                    setScreen('draw');
                  }}
                  className="mt-3 w-full max-w-md rounded-2xl bg-gradient-to-b from-orange-500 to-orange-700 py-6 text-[2.4vh] font-black"
                >
                  次は {DIV_LABEL[d]} の受付に進む
                </button>
              ))}
              <button onClick={reset} className="mt-4 text-[1.9vh] text-white/40 underline">
                最初の画面に戻る
              </button>
            </>
          ) : (
            <>
              <p className="mt-8 text-[2.2vh] text-white/60">以上となります。ありがとうございました。</p>
              <button
                onClick={reset}
                className="mt-6 w-full max-w-md rounded-2xl border border-white/30 py-6 text-[2.4vh] font-bold"
              >
                最初の画面に戻る
              </button>
            </>
          )}
        </Center>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[88vh] flex-col items-center justify-center">{children}</div>;
}

function Head({ title, sub, onBack }: { title: string; sub?: string; onBack: () => void }) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-[2.8vh] font-black">{title}</p>
        {sub && <p className="mt-1 text-[2vh] font-bold text-white/60">{sub}</p>}
      </div>
      <button onClick={onBack} className="rounded-xl border border-white/25 px-4 py-2 text-[1.8vh]">
        戻る
      </button>
    </div>
  );
}

function Err({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 w-full max-w-md rounded-xl bg-red-600 px-4 py-3 text-center text-[1.9vh] font-bold">
      {children}
    </p>
  );
}

'use client';

// 当日の受付端末。出場者が自分で操作する。
// 流れ: 部門を選ぶ → 名前を選ぶ → (未払いなら支払い案内) → くじ引き → 完了
// 2部門に出ている人は、完了画面から続けてもう片方の受付に進める。
//
// 迷わせないことを最優先にする。1画面につき操作は1つ、文字は大きく、戻れるようにする。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { kioskDraw, kioskMarkPaid } from './actions';
import { needsPhotoGuide, nextKioskStep, phaseForDivision, remainingDivisions } from '@/lib/bf6Kiosk';
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

export default function CheckinClient({ entrants }: { entrants: Entrant[] }) {
  const [screen, setScreen] = useState<Screen>('home');
  const [division, setDivision] = useState('');
  const [sel, setSel] = useState<Entrant | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 抽選演出
  const [rolling, setRolling] = useState(false);
  const [rollFace, setRollFace] = useState('?');
  const [result, setResult] = useState<{ slotNo: number; block?: 'A' | 'B' } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRef = useRef<{ slotNo: number; block?: 'A' | 'B' } | null>(null);

  const inDivision = useMemo(
    () => entrants.filter((e) => e.divisions.includes(division)),
    [entrants, division]
  );
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? inDivision.filter((e) => e.dancerName.toLowerCase().includes(k)) : inDivision;
  }, [inDivision, q]);

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
    const step = nextKioskStep(e, division);
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
    const faces =
      phaseForDivision(division) === 'block'
        ? ['A', 'B']
        : Array.from({ length: 16 }, (_, i) => String(i + 1));
    let i = 0;
    stopSpin();
    timerRef.current = setInterval(() => {
      i += 1;
      setRollFace(faces[i % faces.length]);
    }, 70);

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
      setScreen('result');
    };
    settle();
  }, [stopSpin]);

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

  /** 完了後、もう片方の部門が残っていれば続けて受付する */
  const rest = sel
    ? remainingDivisions({ ...sel, drawnDivisions: [...sel.drawnDivisions, division] })
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
              const already = e.drawnDivisions.includes(division);
              return (
                <button
                  key={e.itemId}
                  onClick={() => pickName(e)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-5 py-5 text-left ${
                    already ? 'border-white/10 bg-neutral-900 text-white/35' : 'border-white/25 bg-neutral-900'
                  }`}
                >
                  <span className="text-[2.6vh] font-black">{e.dancerName}</span>
                  {already && <span className="text-[1.7vh] font-bold">受付済</span>}
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
          <p className="mt-8 text-[1.8vh] text-white/50">支払いが済んだら、スタッフが下のボタンを押します</p>
          <button
            disabled={busy}
            onClick={markPaid}
            className="mt-4 w-full max-w-md rounded-2xl bg-gradient-to-b from-orange-500 to-orange-700 py-6 text-[2.6vh] font-black disabled:opacity-50"
          >
            {busy ? '…' : '支払いを受け取りました(スタッフ操作)'}
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

          <div className="mt-8 flex h-[26vh] w-[26vh] items-center justify-center rounded-3xl border-4 border-orange-500 bg-neutral-900">
            <span className="text-[12vh] font-black italic leading-none">{rolling ? rollFace : '?'}</span>
          </div>

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
          <p className="mt-2 text-[16vh] font-black italic leading-none text-orange-400">
            {result.block ?? result.slotNo}
          </p>
          <p className="mt-2 text-[2.4vh] font-bold">
            {result.block ? `${result.block}ブロック` : `${result.slotNo}番`}
          </p>
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

          {needsPhotoGuide([division]) && (
            <div className="mt-8 w-full max-w-md rounded-2xl border border-orange-500/60 bg-orange-500/10 px-5 py-6">
              <p className="text-[2.4vh] font-black text-orange-300">写真の撮影があります</p>
              <p className="mt-2 text-[1.9vh] leading-relaxed text-white/80">
                お近くのスタッフに声をかけて、<br />エントリー写真を撮ってもらってください
              </p>
            </div>
          )}

          {rest.length > 0 ? (
            <>
              <p className="mt-8 text-[2vh] font-bold text-white/70">
                続けて {rest.map((d) => DIV_LABEL[d]).join('・')} の受付ができます
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
                  {DIV_LABEL[d]} の受付に進む
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

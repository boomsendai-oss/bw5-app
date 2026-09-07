'use client';

// LED出力(16:9横長)。1秒ごとに状態を取りに行き、変化したところだけ演出する。
//
// 演出の方針(TARO 2026-09-07):
//   VS      … 左右から名前が飛び込み、中央でVSが着弾する
//   勝者確定 … 勝った側が発光→次のラウンドの枠へせり上がる
// ポーリングで同じ状態が返り続けるため、再生の判定は bf6ScreenAnim に寄せている
// (毎秒アニメが再生され続けるのを防ぐ)。
import { useEffect, useRef, useState } from 'react';
import { detectNewWinners, vsAnimKey, type AnimMatch } from '@/lib/bf6ScreenAnim';

type Match = { round: string; matchNo: number; slotA: number | null; slotB: number | null; winnerSlot: number | null };
type Slot = { slotNo: number; dancerName: string; rep: string; hasPhoto: boolean };
type Payload = {
  state: { mode: 'logo' | 'bracket' | 'vs'; division: string; round: string | null; matchNo: number | null; rev: number };
  matches: Match[];
  slots: Record<string, Slot>;
  nextMatch: Match | null;
};

const DIV_LABEL: Record<string, string> = { beginner: 'ビギナー', kids: '小中学生', general: '一般' };
const ROUND_LABEL: Record<string, string> = { r16: 'BEST 16', qf: 'BEST 8', sf: 'SEMI FINAL', f: 'FINAL' };

/** 勝者演出を出す時間。会場で見て分かる長さ。 */
const WIN_FLASH_MS = 2600;

export function ScreenClient() {
  const [data, setData] = useState<Payload | null>(null);
  // 直近で勝者が決まった試合(発光させる対象)
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const prevMatchesRef = useRef<AnimMatch[] | null>(null);
  // 部門を跨ぐとラウンド名が同じで誤検出するため、直前の部門も覚えておく
  const prevDivisionRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const tick = async () => {
      try {
        const r = await fetch('/api/bf6/screen', { cache: 'no-store' });
        const j: Payload = await r.json();
        if (!alive) return;

        const fresh = detectNewWinners(prevMatchesRef.current, j.matches, {
          prevScope: prevDivisionRef.current,
          scope: j.state.division,
        });
        prevMatchesRef.current = j.matches;
        prevDivisionRef.current = j.state.division;
        setData(j);

        if (fresh.length > 0) {
          const keys = fresh.map((w) => `${w.round}|${w.matchNo}`);
          setFlash((p) => new Set([...p, ...keys]));
          timers.push(
            setTimeout(() => {
              if (!alive) return;
              setFlash((p) => {
                const n = new Set(p);
                for (const k of keys) n.delete(k);
                return n;
              });
            }, WIN_FLASH_MS)
          );
        }
      } catch {
        /* 会場の回線が一瞬切れても落とさない */
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
      timers.forEach(clearTimeout);
    };
  }, []);

  if (!data) return <Stage><Logo /></Stage>;

  const { state, matches, slots } = data;

  if (state.mode === 'logo') return <Stage><Logo /></Stage>;

  if (state.mode === 'vs') {
    const m = state.round && state.matchNo
      ? matches.find((x) => x.round === state.round && x.matchNo === state.matchNo)
      : data.nextMatch;
    if (!m) return <Stage><Logo /></Stage>;
    const a = m.slotA ? slots[String(m.slotA)] : undefined;
    const b = m.slotB ? slots[String(m.slotB)] : undefined;
    return (
      <Stage>
        {/* key を変えることで、試合が変わったときだけ登場アニメを再生し直す */}
        <div key={vsAnimKey(state)} className="flex h-full w-full flex-col">
          <p className="bf6-drop pt-[3vh] text-center text-[2.4vw] font-black tracking-[0.4em] text-orange-400">
            {DIV_LABEL[state.division]} / {ROUND_LABEL[m.round] ?? m.round}
          </p>
          <div className="relative flex flex-1 items-center justify-center gap-[4vw] px-[4vw]">
            {/* 着弾の衝撃波 */}
            <span className="bf6-shock pointer-events-none absolute left-1/2 top-1/2 h-[22vw] w-[22vw] -translate-x-1/2 -translate-y-1/2 rounded-full border-[0.4vw] border-orange-500/70" />
            <div className="bf6-in-left flex-1">
              <Side slot={a} align="right" division={state.division} />
            </div>
            <p className="bf6-vs shrink-0 text-[9vw] font-black italic leading-none text-orange-500 drop-shadow-[0_0_3vw_rgba(249,115,22,0.6)]">
              VS
            </p>
            <div className="bf6-in-right flex-1">
              <Side slot={b} align="left" division={state.division} />
            </div>
          </div>
          <p className="bf6-rise pb-[4vh] text-center text-[2vw] font-black tracking-[0.5em] text-white/70">BATTLE START</p>
        </div>
      </Stage>
    );
  }

  // トーナメント表
  const rounds = Array.from(new Set(matches.map((m) => m.round)));
  return (
    <Stage>
      <div className="flex h-full w-full flex-col px-[3vw] py-[3vh]">
        <p className="text-center text-[2.4vw] font-black tracking-[0.4em] text-orange-400">
          {DIV_LABEL[state.division]}部門 TOURNAMENT
        </p>
        <div className="mt-[2vh] flex flex-1 items-center justify-center gap-[2vw]">
          {rounds.map((rd) => (
            <div key={rd} className="flex flex-1 flex-col justify-center gap-[1vh]">
              <p className="text-center text-[1.3vw] font-black tracking-widest text-white/50">{ROUND_LABEL[rd] ?? rd}</p>
              {matches.filter((m) => m.round === rd).map((m) => {
                const hot = flash.has(`${m.round}|${m.matchNo}`);
                return (
                  <div
                    key={m.matchNo}
                    className={`rounded-[0.6vw] p-[0.6vw] transition-colors duration-500 ${
                      hot ? 'bf6-card-hot bg-orange-500/15' : 'bg-white/5'
                    }`}
                  >
                    <Name
                      slot={m.slotA ? slots[String(m.slotA)] : undefined}
                      win={m.winnerSlot === m.slotA}
                      hot={hot && m.winnerSlot === m.slotA}
                    />
                    <div className="my-[0.3vh] h-px bg-white/10" />
                    <Name
                      slot={m.slotB ? slots[String(m.slotB)] : undefined}
                      win={m.winnerSlot === m.slotB}
                      hot={hot && m.winnerSlot === m.slotB}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Stage>
  );
}

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05070c] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_20%,rgba(249,115,22,0.10),transparent_60%)]" />
      <div className="relative h-full w-full">{children}</div>
      <ScreenAnimStyles />
    </div>
  );
}

/** LED専用のアニメ定義。この画面でしか使わないのでここに置く。 */
function ScreenAnimStyles() {
  return (
    <style>{`
      @keyframes bf6InLeft {
        0%   { opacity: 0; transform: translateX(-70vw) skewX(-14deg); }
        62%  { opacity: 1; transform: translateX(2.5vw) skewX(-4deg); }
        100% { opacity: 1; transform: translateX(0) skewX(0); }
      }
      @keyframes bf6InRight {
        0%   { opacity: 0; transform: translateX(70vw) skewX(14deg); }
        62%  { opacity: 1; transform: translateX(-2.5vw) skewX(4deg); }
        100% { opacity: 1; transform: translateX(0) skewX(0); }
      }
      @keyframes bf6VsHit {
        0%   { opacity: 0; transform: scale(3.4) rotate(-10deg); filter: blur(1.2vw); }
        70%  { opacity: 1; transform: scale(0.88) rotate(0deg); filter: blur(0); }
        84%  { transform: scale(1.1); }
        100% { opacity: 1; transform: scale(1); }
      }
      @keyframes bf6Shock {
        0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.2); }
        55%  { opacity: 0; transform: translate(-50%, -50%) scale(0.2); }
        70%  { opacity: 0.85; }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(2.6); }
      }
      @keyframes bf6Drop {
        0%   { opacity: 0; transform: translateY(-3vh); }
        100% { opacity: 1; transform: translateY(0); }
      }
      @keyframes bf6Rise {
        0%   { opacity: 0; transform: translateY(3vh); }
        100% { opacity: 1; transform: translateY(0); }
      }
      /* 勝者: 発光しながら少しせり上がる(次のラウンドへ上がるイメージ) */
      @keyframes bf6WinUp {
        0%   { transform: translateY(0) scale(1); text-shadow: none; }
        30%  { transform: translateY(-0.9vh) scale(1.16); text-shadow: 0 0 1.6vw rgba(249,115,22,0.95); }
        70%  { transform: translateY(-0.5vh) scale(1.08); text-shadow: 0 0 1.2vw rgba(249,115,22,0.8); }
        100% { transform: translateY(0) scale(1); text-shadow: 0 0 0.4vw rgba(249,115,22,0.45); }
      }
      @keyframes bf6CardHot {
        0%, 100% { box-shadow: 0 0 0 0 rgba(249,115,22,0); }
        35%      { box-shadow: 0 0 2.2vw 0.3vw rgba(249,115,22,0.55); }
      }

      .bf6-in-left  { animation: bf6InLeft  .62s cubic-bezier(.16,.9,.3,1) both; }
      .bf6-in-right { animation: bf6InRight .62s cubic-bezier(.16,.9,.3,1) both; }
      .bf6-vs       { animation: bf6VsHit   .58s cubic-bezier(.2,1.4,.35,1) .34s both; }
      .bf6-shock    { animation: bf6Shock   .9s  ease-out .34s both; }
      .bf6-drop     { animation: bf6Drop    .5s  ease-out both; }
      .bf6-rise     { animation: bf6Rise    .5s  ease-out .8s both; }
      .bf6-win      { animation: bf6WinUp   1.5s ease-out both; }
      .bf6-card-hot { animation: bf6CardHot 1.5s ease-out; }
    `}</style>
  );
}

function Logo() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/bf6/flyer-hero-v2.jpg" alt="" className="max-h-[70vh] object-contain opacity-90" />
      <p className="mt-[3vh] text-[2vw] font-black tracking-[0.5em] text-orange-400">2026.9.26 SAT — SSM 9F</p>
    </div>
  );
}

function Side({ slot, align, division }: { slot?: Slot; align: 'left' | 'right'; division: string }) {
  return (
    <div className={align === 'right' ? 'text-right' : 'text-left'}>
      {slot?.hasPhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/bf6/photo/${slot.slotNo}?division=${division}`}
          alt=""
          className={`mb-[2vh] h-[34vh] w-full rounded-[1vw] object-cover ${align === 'right' ? 'object-right' : 'object-left'}`}
        />
      )}
      <p className="text-[5.5vw] font-black italic leading-[1.05] text-white">{slot?.dancerName ?? '—'}</p>
      {slot?.rep && <p className="mt-[0.5vh] text-[1.6vw] font-bold text-white/60">{slot.rep}</p>}
    </div>
  );
}

function Name({ slot, win, hot }: { slot?: Slot; win: boolean; hot?: boolean }) {
  return (
    <p
      className={`truncate text-[1.25vw] font-black ${hot ? 'bf6-win ' : ''}${
        win ? 'text-orange-400' : slot ? 'text-white/85' : 'text-white/25'
      }`}
    >
      {slot?.dancerName || '—'}
    </p>
  );
}

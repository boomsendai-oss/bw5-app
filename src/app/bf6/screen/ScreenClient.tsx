'use client';

// LED出力(16:9横長)。1秒ごとに状態を取りに行き、変化したところだけ演出する。
//
// 演出の方針(TARO 2026-09-07):
//   VS       … 左=赤コーナー / 右=青コーナー。左右から寄ってきて中央で衝突→火花。全体3秒。
//   トーナメント … 下から上へ積む縦型。勝者のカードが上の段へせり上がり、敗者はグレーアウト。
// ポーリングで同じ状態が返り続けるため、再生の判定は bf6ScreenAnim に寄せている
// (毎秒アニメが再生され続けるのを防ぐ)。
import { useEffect, useRef, useState } from 'react';
import { detectNewWinners, vsAnimKey, type AnimMatch } from '@/lib/bf6ScreenAnim';
import { buildBracketRows, type BracketCell } from '@/lib/bf6BracketRows';
import type { Bf6DrawDivision } from '@/lib/bf6Draw';

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
const WIN_FLASH_MS = 3000;
/** 火花の粒。座標は決め打ちにして毎フレーム再計算しない。 */
const SPARKS = Array.from({ length: 26 }, (_, i) => {
  const a = (i / 26) * Math.PI * 2 + (i % 3) * 0.28;
  const d = 12 + ((i * 37) % 26);
  return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.62, s: 0.5 + ((i * 13) % 10) / 10, delay: (i % 5) * 26 };
});

export function ScreenClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const prevMatchesRef = useRef<AnimMatch[] | null>(null);
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
        <div key={vsAnimKey(state)} className="relative h-full w-full">
          {/* 赤コーナー / 青コーナーの下地 */}
          <div className="bf6-corner-l absolute inset-y-0 left-0 w-1/2 bg-[linear-gradient(100deg,rgba(220,38,38,0.42),rgba(220,38,38,0.06)_72%,transparent)]" />
          <div className="bf6-corner-r absolute inset-y-0 right-0 w-1/2 bg-[linear-gradient(260deg,rgba(37,99,235,0.42),rgba(37,99,235,0.06)_72%,transparent)]" />
          {/* 衝突の閃光 */}
          <div className="bf6-flashout pointer-events-none absolute inset-0 bg-white" />

          <div className="relative flex h-full w-full flex-col">
            <p className="bf6-drop pt-[3vh] text-center text-[2.4vw] font-black tracking-[0.4em] text-white/80">
              {DIV_LABEL[state.division]} / {ROUND_LABEL[m.round] ?? m.round}
            </p>

            <div className="relative flex flex-1 items-center justify-center px-[3vw]">
              <div className="bf6-in-left flex-1 text-center">
                <Side slot={a} corner="red" division={state.division} />
              </div>

              <div className="relative flex-none px-[1vw]">
                {/* 火花 */}
                <span className="pointer-events-none absolute left-1/2 top-1/2">
                  {SPARKS.map((s, i) => (
                    <span
                      key={i}
                      className="bf6-spark absolute block rounded-full bg-orange-300"
                      style={{
                        width: `${0.45 * s.s}vw`,
                        height: `${0.45 * s.s}vw`,
                        // @ts-expect-error CSS変数でキーフレームに終点を渡す
                        '--sx': `${s.x}vw`,
                        '--sy': `${s.y}vw`,
                        animationDelay: `${1000 + s.delay}ms`,
                      }}
                    />
                  ))}
                </span>
                <span className="bf6-shock pointer-events-none absolute left-1/2 top-1/2 h-[24vw] w-[24vw] -translate-x-1/2 -translate-y-1/2 rounded-full border-[0.35vw] border-orange-400/80" />
                <span className="bf6-shock2 pointer-events-none absolute left-1/2 top-1/2 h-[24vw] w-[24vw] -translate-x-1/2 -translate-y-1/2 rounded-full border-[0.2vw] border-white/60" />
                <p className="bf6-vs relative text-[9vw] font-black italic leading-none text-white drop-shadow-[0_0_3vw_rgba(249,115,22,0.85)]">
                  VS
                </p>
              </div>

              <div className="bf6-in-right flex-1 text-center">
                <Side slot={b} corner="blue" division={state.division} />
              </div>
            </div>

            <p className="bf6-rise pb-[4vh] text-center text-[2vw] font-black tracking-[0.5em] text-white/70">BATTLE START</p>
          </div>
        </div>
      </Stage>
    );
  }

  // 縦型トーナメント表(下から上へ)
  const rows = buildBracketRows(state.division as Bf6DrawDivision, matches);
  return (
    <Stage>
      <div className="flex h-full w-full flex-col px-[2.5vw] py-[2vh]">
        <p className="text-center text-[2vw] font-black tracking-[0.4em] text-orange-400">
          {DIV_LABEL[state.division]}部門 TOURNAMENT
        </p>
        <div className="mt-[1.5vh] flex flex-1 flex-col">
          {rows.map((row, ri) => (
            <div
              key={row.kind === 'champion' ? 'champ' : row.round}
              className={row.kind === 'champion' ? 'flex-none' : 'flex flex-1 flex-col'}
            >
              {row.kind === 'champion' ? (
                <div className="flex justify-center">
                  <ChampionCard cell={row.cells[0]} slots={slots} />
                </div>
              ) : (
                <>
                  {/* 上の段へつながる線。最上段(決勝)の上は優勝枠へ1本。 */}
                  <Connectors count={row.cells.length / 2} />
                  <div className="flex">
                    {row.cells.map((c, i) => (
                      <div key={i} className="flex min-w-0 flex-1 justify-center px-[0.25vw]">
                        <PersonCard
                          cell={c}
                          slots={slots}
                          hot={c.round !== null && flash.has(`${c.round}|${c.matchNo}`)}
                          compact={row.cells.length > 8}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="mt-[0.5vh] text-center text-[1vw] font-black tracking-[0.3em] text-white/35">
                    {ROUND_LABEL[row.round ?? ''] ?? row.round}
                  </p>
                </>
              )}
              {ri === 0 && <div className="mx-auto h-[1.5vh] w-px bg-white/25" />}
            </div>
          ))}
        </div>
      </div>
    </Stage>
  );
}

/** 隣り合う2枠を ⊓ で結び、その中央から上の段へ伸ばす。 */
function Connectors({ count }: { count: number }) {
  return (
    <div className="flex min-h-[2vh] flex-1 items-stretch">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="relative flex-1">
          <div className="absolute inset-x-[25%] bottom-0 top-1/2 border-l border-r border-t border-white/25" />
          <div className="absolute left-1/2 top-0 h-1/2 w-px bg-white/25" />
        </div>
      ))}
    </div>
  );
}

function PersonCard({
  cell, slots, hot, compact,
}: { cell: BracketCell; slots: Record<string, Slot>; hot: boolean; compact: boolean }) {
  const slot = cell.slotNo ? slots[String(cell.slotNo)] : undefined;
  const base = 'w-full truncate rounded-[0.4vw] border px-[0.4vw] py-[0.5vh] text-center font-black transition-all duration-500';
  const size = compact ? 'text-[0.85vw]' : 'text-[1.2vw]';
  const look =
    cell.state === 'won'
      ? 'border-orange-400/80 bg-orange-500/20 text-orange-200'
      : cell.state === 'lost'
        ? 'border-white/10 bg-white/[0.03] text-white/25 line-through decoration-white/20'
        : cell.state === 'pending'
          ? 'border-white/20 bg-white/[0.06] text-white/90'
          : 'border-dashed border-white/10 bg-transparent text-white/20';
  return (
    <p className={`${base} ${size} ${look} ${hot ? 'bf6-advance' : ''}`}>
      {slot?.dancerName || '—'}
    </p>
  );
}

function ChampionCard({ cell, slots }: { cell: BracketCell; slots: Record<string, Slot> }) {
  const slot = cell.slotNo ? slots[String(cell.slotNo)] : undefined;
  return (
    <div className="text-center">
      <p className="text-[1vw] font-black tracking-[0.4em] text-orange-400">WINNER</p>
      <p
        className={`mt-[0.4vh] rounded-[0.5vw] border px-[1.6vw] py-[0.8vh] text-[2.2vw] font-black italic ${
          slot
            ? 'bf6-champ border-orange-400 bg-orange-500/25 text-white'
            : 'border-dashed border-white/15 text-white/20'
        }`}
      >
        {slot?.dancerName || '—'}
      </p>
    </div>
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
      /* ── VS: 左右から寄って中央で衝突(全体3秒) ── */
      @keyframes bf6InLeft {
        0%   { opacity: 0; transform: translateX(-62vw) skewX(-12deg); }
        14%  { opacity: 1; }
        58%  { transform: translateX(-6vw) skewX(-8deg); }   /* 溜め */
        72%  { transform: translateX(1.6vw) skewX(0deg); }   /* 衝突 */
        79%  { transform: translateX(-0.9vw); }
        86%  { transform: translateX(0.4vw); }
        100% { opacity: 1; transform: translateX(0); }
      }
      @keyframes bf6InRight {
        0%   { opacity: 0; transform: translateX(62vw) skewX(12deg); }
        14%  { opacity: 1; }
        58%  { transform: translateX(6vw) skewX(8deg); }
        72%  { transform: translateX(-1.6vw) skewX(0deg); }
        79%  { transform: translateX(0.9vw); }
        86%  { transform: translateX(-0.4vw); }
        100% { opacity: 1; transform: translateX(0); }
      }
      @keyframes bf6VsHit {
        0%   { opacity: 0; transform: scale(4.2) rotate(-12deg); filter: blur(1.4vw); }
        60%  { opacity: 0; transform: scale(4.2) rotate(-12deg); filter: blur(1.4vw); }
        84%  { opacity: 1; transform: scale(0.84) rotate(0deg); filter: blur(0); }
        92%  { transform: scale(1.14); }
        100% { opacity: 1; transform: scale(1); }
      }
      @keyframes bf6Shock {
        0%, 62%  { opacity: 0; transform: translate(-50%,-50%) scale(0.18); }
        70%      { opacity: 0.9; }
        100%     { opacity: 0; transform: translate(-50%,-50%) scale(2.8); }
      }
      @keyframes bf6Shock2 {
        0%, 64%  { opacity: 0; transform: translate(-50%,-50%) scale(0.1); }
        72%      { opacity: 1; }
        100%     { opacity: 0; transform: translate(-50%,-50%) scale(1.9); }
      }
      @keyframes bf6Spark {
        0%   { opacity: 0; transform: translate(-50%,-50%) scale(0.2); }
        4%   { opacity: 1; transform: translate(-50%,-50%) scale(1); }
        100% { opacity: 0; transform: translate(calc(-50% + var(--sx)), calc(-50% + var(--sy))) scale(0.15); }
      }
      @keyframes bf6FlashOut {
        0%, 62% { opacity: 0; }
        68%     { opacity: 0.55; }
        100%    { opacity: 0; }
      }
      @keyframes bf6CornerIn {
        0%   { opacity: 0; }
        100% { opacity: 1; }
      }
      @keyframes bf6Drop { 0% { opacity:0; transform: translateY(-3vh); } 100% { opacity:1; transform:none; } }
      @keyframes bf6Rise { 0% { opacity:0; transform: translateY(3vh); } 100% { opacity:1; transform:none; } }

      /* ── トーナメント: 勝者カードがせり上がる ── */
      @keyframes bf6Advance {
        0%   { transform: translateY(2.2vh) scale(0.94); box-shadow: 0 0 0 rgba(249,115,22,0); }
        45%  { transform: translateY(-0.5vh) scale(1.12); box-shadow: 0 0 2.4vw 0.3vw rgba(249,115,22,0.6); }
        100% { transform: translateY(0) scale(1); box-shadow: 0 0 0.6vw rgba(249,115,22,0.35); }
      }
      @keyframes bf6Champ {
        0%,100% { box-shadow: 0 0 1.6vw rgba(249,115,22,0.45); }
        50%     { box-shadow: 0 0 3.4vw 0.4vw rgba(249,115,22,0.85); }
      }

      .bf6-corner-l { animation: bf6CornerIn .5s ease-out both; }
      .bf6-corner-r { animation: bf6CornerIn .5s ease-out both; }
      .bf6-in-left  { animation: bf6InLeft   2.5s cubic-bezier(.5,0,.2,1) both; }
      .bf6-in-right { animation: bf6InRight  2.5s cubic-bezier(.5,0,.2,1) both; }
      .bf6-vs       { animation: bf6VsHit    2.5s cubic-bezier(.2,1.3,.35,1) both; }
      .bf6-shock    { animation: bf6Shock    2.5s ease-out both; }
      .bf6-shock2   { animation: bf6Shock2   2.5s ease-out both; }
      .bf6-spark    { animation: bf6Spark    .75s ease-out both; }
      .bf6-flashout { animation: bf6FlashOut 2.5s ease-out both; }
      .bf6-drop     { animation: bf6Drop     .5s ease-out both; }
      .bf6-rise     { animation: bf6Rise     .5s ease-out 2.3s both; }
      .bf6-advance  { animation: bf6Advance  1.4s cubic-bezier(.2,1.2,.3,1) both; }
      .bf6-champ    { animation: bf6Champ    2.2s ease-in-out infinite; }
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

function Side({ slot, corner, division }: { slot?: Slot; corner: 'red' | 'blue'; division: string }) {
  const accent = corner === 'red' ? 'text-red-400' : 'text-blue-400';
  const ring = corner === 'red' ? 'ring-red-500/60' : 'ring-blue-500/60';
  return (
    <div>
      <p className={`text-[1.3vw] font-black tracking-[0.5em] ${accent}`}>
        {corner === 'red' ? 'RED' : 'BLUE'}
      </p>
      {slot?.hasPhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/bf6/photo/${slot.slotNo}?division=${division}`}
          alt=""
          className={`mx-auto my-[1.5vh] h-[28vh] w-[28vh] rounded-full object-cover ring-[0.4vw] ${ring}`}
        />
      )}
      <p className="mt-[1vh] break-words text-[5vw] font-black italic leading-[1.05] text-white">
        {slot?.dancerName ?? '—'}
      </p>
      {slot?.rep && <p className="mt-[0.6vh] text-[1.5vw] font-bold text-white/60">{slot.rep}</p>}
    </div>
  );
}

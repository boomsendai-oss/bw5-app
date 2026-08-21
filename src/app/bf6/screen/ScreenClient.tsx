'use client';

// LED出力(16:9横長)。1秒ごとに状態を取りに行き、revが変わったら描き替える。
import { useEffect, useRef, useState } from 'react';

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

export function ScreenClient() {
  const [data, setData] = useState<Payload | null>(null);
  const revRef = useRef(-1);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/bf6/screen', { cache: 'no-store' });
        const j: Payload = await r.json();
        if (alive) setData(j);
      } catch { /* 会場の回線が一瞬切れても落とさない */ }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!data) return <Stage><Logo /></Stage>;

  const { state, matches, slots } = data;
  if (state.rev !== revRef.current) revRef.current = state.rev;

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
        <div className="flex h-full w-full flex-col">
          <p className="pt-[3vh] text-center text-[2.4vw] font-black tracking-[0.4em] text-orange-400">
            {DIV_LABEL[state.division]} / {ROUND_LABEL[m.round] ?? m.round}
          </p>
          <div className="flex flex-1 items-center justify-center gap-[4vw] px-[4vw]">
            <Side slot={a} align="right" division={state.division} />
            <p className="shrink-0 text-[9vw] font-black italic leading-none text-orange-500 drop-shadow-[0_0_3vw_rgba(249,115,22,0.6)]">VS</p>
            <Side slot={b} align="left" division={state.division} />
          </div>
          <p className="pb-[4vh] text-center text-[2vw] font-black tracking-[0.5em] text-white/70">BATTLE START</p>
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
              {matches.filter((m) => m.round === rd).map((m) => (
                <div key={m.matchNo} className="rounded-[0.6vw] bg-white/5 p-[0.6vw]">
                  <Name slot={m.slotA ? slots[String(m.slotA)] : undefined} win={m.winnerSlot === m.slotA} />
                  <div className="my-[0.3vh] h-px bg-white/10" />
                  <Name slot={m.slotB ? slots[String(m.slotB)] : undefined} win={m.winnerSlot === m.slotB} />
                </div>
              ))}
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
    </div>
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
    <div className={`flex-1 ${align === 'right' ? 'text-right' : 'text-left'}`}>
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

function Name({ slot, win }: { slot?: Slot; win: boolean }) {
  return (
    <p className={`truncate text-[1.25vw] font-black ${win ? 'text-orange-400' : slot ? 'text-white/85' : 'text-white/25'}`}>
      {slot?.dancerName || '—'}
    </p>
  );
}

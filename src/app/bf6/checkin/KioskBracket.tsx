'use client';

// 受付の結果画面に出すトーナメント表。LED(/bf6/screen)と同じ「下から上へ勝ち上がる」形。
//
// 「7番」と番号だけ出しても出場者には伝わらない。番号の羅列でも伝わらない(TARO 2026-09-09)。
// LEDで見慣れる形と同じ表の中に、自分の名前がポンと入るのがいちばん分かる。
//
// 受付の途中なので試合(bf_match)はまだ無い。1回戦の枠だけを組んで表にする。
// 引いていない枠は「—」で、受付が進むほど埋まっていく。
import { buildBracketRows, type BracketCell } from '@/lib/bf6BracketRows';
import { seedRound1 } from '@/lib/bf6Bracket';
import type { Bf6DrawDivision } from '@/lib/bf6Draw';

export default function KioskBracket({
  division,
  mySlot,
  slotCount,
  holders,
}: {
  division: Bf6DrawDivision;
  mySlot: number;
  slotCount: number;
  holders: Record<number, string>;
}) {
  const rows = buildBracketRows(division, seedRound1(division, slotCount));

  return (
    <div className="mt-6 w-full">
      <style>{`
        @keyframes kioskPop {
          0%   { transform: scale(0.2); opacity: 0; }
          60%  { transform: scale(1.25); opacity: 1; }
          80%  { transform: scale(0.95); }
          100% { transform: scale(1); }
        }
        .kiosk-pop { animation: kioskPop 700ms cubic-bezier(.2,.9,.3,1.2) 250ms both; }
        @keyframes kioskGlow {
          0%, 100% { box-shadow: 0 0 0.8vh rgba(251,146,60,.55); }
          50%      { box-shadow: 0 0 2.4vh rgba(251,146,60,.95); }
        }
        .kiosk-me { animation: kioskGlow 1.6s ease-in-out 950ms infinite; }
      `}</style>

      <p className="text-center text-[1.7vh] font-black tracking-[0.35em] text-orange-400">
        TOURNAMENT
      </p>

      <div className="mt-2 flex flex-col">
        {rows.map((row, ri) => (
          <div key={row.kind === 'champion' ? 'champ' : row.round}>
            {row.kind === 'champion' ? (
              <div className="flex justify-center">
                <p className="rounded-lg border border-dashed border-white/15 px-6 py-1 text-[1.6vh] font-black tracking-widest text-white/25">
                  WINNER
                </p>
              </div>
            ) : (
              <>
                <Connectors count={row.cells.length / 2} />
                <div className="flex">
                  {row.cells.map((c, i) => (
                    <div key={i} className="flex min-w-0 flex-1 justify-center px-[0.3vw]">
                      <Card
                        cell={c}
                        holders={holders}
                        mine={c.slotNo === mySlot}
                        depth={rows.length - 1 - ri}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 上の段へつながる線。LEDと同じ形(両脚が立ち上がって中央から上へ抜ける)。 */
function Connectors({ count }: { count: number }) {
  return (
    <div className="flex h-[2.2vh] items-stretch">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="relative flex-1">
          <div className="absolute inset-x-[25%] bottom-0 top-1/2 border-l border-r border-t border-white/25" />
          <div className="absolute left-1/2 top-0 h-1/2 w-px bg-white/25" />
        </div>
      ))}
    </div>
  );
}

function Card({
  cell,
  holders,
  mine,
  depth,
}: {
  cell: BracketCell;
  holders: Record<number, string>;
  mine: boolean;
  /** 1回戦=0。上の段ほど枠が広いので文字を大きくする */
  depth: number;
}) {
  const name = cell.slotNo ? holders[cell.slotNo] : undefined;
  // 縦持ちiPadで16枠を横に並べるので、1回戦はかなり小さい。上の段は広い
  const SIZES = ['text-[1.15vh]', 'text-[1.6vh]', 'text-[2vh]', 'text-[2.4vh]'];
  const size = SIZES[Math.min(depth, SIZES.length - 1)];
  const look = mine
    ? 'kiosk-pop kiosk-me border-orange-400 bg-orange-500 text-black'
    : name
      ? 'border-white/20 bg-white/[0.06] text-white/90'
      : 'border-dashed border-white/10 bg-transparent text-white/20';
  return (
    <div className="w-full">
      <p className={`w-full truncate rounded-md border px-[0.4vw] py-[0.7vh] text-center font-black ${size} ${look}`}>
        {name ?? '—'}
      </p>
      {cell.slotNo !== null && depth === 0 && (
        <p className={`mt-0.5 text-center text-[1.05vh] font-black ${mine ? 'text-orange-300' : 'text-white/30'}`}>
          {cell.slotNo}
        </p>
      )}
    </div>
  );
}

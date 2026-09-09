'use client';

// 受付の結果画面に出す簡易トーナメント表。
// 「7番」だけでは出場者に伝わらないので、表の中の自分の位置と、
// 勝ち上がったとき誰と当たるのかまで見せる(TARO指摘 2026-09-09)。
//
// 受付の途中なので、まだ引いていない枠は「—」になる。受付が進むほど埋まっていく。
import { buildKioskBracket } from '@/lib/bf6KioskBracket';

export default function BracketView({
  mySlot,
  slotCount,
  holders,
}: {
  mySlot: number;
  slotCount: number;
  holders: Record<number, string>;
}) {
  const { pairs, path } = buildKioskBracket(mySlot, slotCount, holders);

  return (
    <div className="mt-7 w-full max-w-md space-y-5">
      {/* 勝ち上がり: 何回勝てば誰に当たるか */}
      <div className="rounded-2xl border border-orange-500/40 bg-orange-500/5 p-4">
        <p className="text-center text-[1.8vh] font-black tracking-widest text-orange-300">
          勝ち上がると
        </p>
        <ul className="mt-3 space-y-2">
          {path.map((p, i) => (
            <li key={p.label} className="flex items-center gap-3">
              <span className="w-[9vh] shrink-0 text-[1.7vh] font-black text-white/45">{p.label}</span>
              <span className="flex-1 text-[2vh] font-bold">
                {p.opponentName ? (
                  <>
                    <span className="text-white/45">{p.opponentSlots[0]}番 </span>
                    {p.opponentName}
                  </>
                ) : (
                  <span className="text-white/60">
                    {p.opponentSlots[0]}–{p.opponentSlots[p.opponentSlots.length - 1]}番
                    {i === 0 ? ' (まだ未定)' : ' の勝者'}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* 表全体 */}
      <div className="rounded-2xl border border-white/15 bg-neutral-900 p-4">
        <p className="text-center text-[1.8vh] font-black tracking-widest text-white/45">
          トーナメント表
        </p>
        <ul className="mt-3 space-y-1.5">
          {pairs.map((pair, i) => (
            <li
              key={i}
              className={`rounded-xl px-3 py-2 ${
                pair.mine ? 'bg-orange-500/20 ring-1 ring-orange-400/60' : 'bg-white/[0.04]'
              }`}
            >
              {pair.seats.map((s) => (
                <div key={s.slotNo} className="flex items-center gap-2 py-0.5">
                  <span
                    className={`w-[3.4vh] shrink-0 text-center text-[1.6vh] font-black ${
                      s.slotNo === mySlot ? 'text-orange-300' : 'text-white/40'
                    }`}
                  >
                    {s.slotNo}
                  </span>
                  <span
                    className={`truncate text-[1.9vh] ${
                      s.slotNo === mySlot ? 'font-black text-orange-200' : 'font-bold text-white/80'
                    }`}
                  >
                    {s.name ?? <span className="text-white/25">—</span>}
                  </span>
                  {s.slotNo === mySlot && (
                    <span className="ml-auto shrink-0 rounded-full bg-orange-500 px-2 py-0.5 text-[1.4vh] font-black text-black">
                      あなた
                    </span>
                  )}
                </div>
              ))}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-center text-[1.6vh] text-white/35">
          「—」はまだ受付していない人です
        </p>
      </div>
    </div>
  );
}

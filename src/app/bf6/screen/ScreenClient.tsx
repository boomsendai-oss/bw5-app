'use client';

// LED出力(16:9横長)。1秒ごとに状態を取りに行き、変化したところだけ演出する。
//
// 演出の方針(TARO 2026-09-07):
//   VS       … 左=赤コーナー / 右=青コーナー。左右から寄ってきて中央で衝突→火花。全体3秒。
//   トーナメント … 下から上へ積む縦型。勝者のカードが上の段へせり上がり、敗者はグレーアウト。
// ポーリングで同じ状態が返り続けるため、再生の判定は bf6ScreenAnim に寄せている
// (毎秒アニメが再生され続けるのを防ぐ)。
import { useEffect, useRef, useState } from 'react';
import { detectNewWinners, parentMatch, vsAnimKey, type AnimMatch } from '@/lib/bf6ScreenAnim';
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
/** 火花。中心から放射する筋。角度と距離を決め打ちして毎フレーム再計算しない。 */
const SPARKS = Array.from({ length: 64 }, (_, i) => {
  const a = (i / 64) * 360 + ((i * 47) % 17) - 8;
  const rad = (a * Math.PI) / 180;
  const far = i % 9 === 0;                       // 数本だけ遠くまで飛ぶ
  const dist = (far ? 34 : 12) + ((i * 31) % 30);
  // 色温度: 出た直後は白熱、飛ぶほど赤くなる
  const hot = ['#ffffff', '#fff4d6', '#ffd98a', '#ffb347'][i % 4];
  return {
    deg: a,
    dist,
    len: (far ? 3.4 : 1.8) + ((i * 17) % 26) / 10,
    thick: 0.13 + ((i * 7) % 8) / 40,
    fall: 1.5 + ((i * 23) % 40) / 6,             // 重力で落ちる量
    delay: (i % 9) * 14,
    dur: (far ? 900 : 520) + ((i * 53) % 460),
    hot,
  };
});

export function ScreenClient() {
  const [data, setData] = useState<Payload | null>(null);
  // 勝った枠(光る) と 上がった先の枠(着弾) は演出が違うので分けて持つ
  const [flashWin, setFlashWin] = useState<Set<string>>(new Set());
  const [flashArrive, setFlashArrive] = useState<Set<string>>(new Set());
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
          const winKeys = fresh.map((w) => `${w.round}|${w.matchNo}`);
          const upKeys = fresh
            .map((w) => parentMatch(j.state.division, w.round, w.matchNo))
            .filter((x): x is { round: string; matchNo: number } => x !== null)
            .map((up) => `${up.round}|${up.matchNo}`);
          setFlashWin((p) => new Set([...p, ...winKeys]));
          setFlashArrive((p) => new Set([...p, ...upKeys]));
          timers.push(
            setTimeout(() => {
              if (!alive) return;
              setFlashWin((p) => { const n = new Set(p); winKeys.forEach((k) => n.delete(k)); return n; });
              setFlashArrive((p) => { const n = new Set(p); upKeys.forEach((k) => n.delete(k)); return n; });
            }, WIN_FLASH_MS)
          );
        }
      } catch {
        /* 会場の回線が一瞬切れても落とさない */
      }
    };

    // ロゴ画面の画像を先に読んでおく(ロゴに戻すときだけ重い・TARO実機 2026-09-10)
    for (const src of ['/bf6/flyer-hero-v2.jpg', '/bf6/led-title.png', '/bf6/vs-bg-last.jpg']) {
      const im = new Image();
      im.src = src;
    }
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
      <Stage plain>
        {/* key を変えることで、試合が変わったときだけ登場アニメを再生し直す */}
        <div key={vsAnimKey(state)} className="bf6-shake relative h-full w-full">
          {/* 背景は動画。暗闇→左右から赤青が突入→中央で衝突→煙が広がって落ち着く。
              試合ごとに1回だけ再生し、最後のコマで止める(ループさせない)。
              読み込みや再生に失敗しても、poster の静止画が残るので画面は成立する。 */}
          <video
            key={vsAnimKey(state)}
            className="absolute inset-0 h-full w-full object-cover"
            src="/bf6/vs-bg.mp4"
            poster="/bf6/vs-bg-last.jpg"
            autoPlay
            muted
            playsInline
            preload="auto"
          />
          {/* 名前が乗る下端だけ軽く落とす。中央に暗幕を敷くと動画の鮮やかさが死ぬ。 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[26%] bg-[linear-gradient(to_top,rgba(5,7,12,0.62),transparent)]" />
          {/* 衝突の閃光 */}
          <div className="bf6-flashout pointer-events-none absolute inset-0 bg-white" />

          <div className="relative flex h-full w-full flex-col">
            <div className="bf6-drop flex items-start justify-between px-[2.5vw] pt-[2vh]">
              <p className="text-[2vw] font-black tracking-[0.35em] text-white/85">
                {DIV_LABEL[state.division]}部門 / {ROUND_LABEL[m.round] ?? m.round}
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/bf6/led-title.png" alt="" className="h-[8vh] w-auto opacity-95" />
            </div>

            <div className="relative flex flex-1 items-center justify-center px-[1.5vw] pb-[2vh]">
              {/* 左右は内容量に関係なく必ず半分ずつ(片側が空でもVSが中央からずれない・TARO実機 2026-09-10) */}
              <div className="bf6-in-left w-1/2 min-w-0 shrink-0 grow-0 basis-1/2 overflow-hidden text-center will-change-transform">
                <Side slot={a} corner="red" division={state.division} />
              </div>

              {/* 衝突点。画面のちょうど中央に重ねる */}
              <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-0 w-0">
                {SPARKS.map((sp, i) => (
                  <span
                    key={i}
                    className="bf6-spark-g absolute left-0 top-0 block"
                    style={{
                      animationDelay: `${1200 + sp.delay}ms`,
                      animationDuration: `${sp.dur}ms`,
                      // @ts-expect-error CSS変数でキーフレームに終点を渡す
                      '--fall': `${sp.fall}vw`,
                    }}
                  >
                    <span
                      className="bf6-spark absolute left-0 top-0 block origin-left rounded-full"
                      style={{
                        width: `${sp.len}vw`,
                        height: `${sp.thick}vw`,
                        background: `linear-gradient(90deg, #fff 0%, ${sp.hot} 32%, rgba(255,120,20,0.65) 62%, rgba(255,60,0,0) 100%)`,
                        boxShadow: `0 0 0.35vw ${sp.hot}`,
                        // @ts-expect-error CSS変数でキーフレームに終点を渡す
                        '--sx': `${sp.dist}vw`,
                        '--rot': `${sp.deg}deg`,
                        animationDelay: `${1200 + sp.delay}ms`,
                        animationDuration: `${sp.dur}ms`,
                      }}
                    />
                  </span>
                ))}
                <span className="bf6-core absolute left-0 top-0 block h-[6vw] w-[6vw] rounded-full bg-[radial-gradient(circle,#fff_0%,#fde68a_35%,rgba(249,115,22,0)_70%)]" />
                <span className="bf6-shock absolute left-0 top-0 block h-[26vw] w-[26vw] rounded-full border-[0.3vw] border-orange-400/80" />
                <span className="bf6-shock2 absolute left-0 top-0 block h-[26vw] w-[26vw] rounded-full border-[0.16vw] border-white/70" />
              </div>

              {/* VSは衝突して離れたあとに割り込む */}
              <p
                // ⚠️ -translate-x-1/2 を付けないこと。Tailwind v4 では `translate` プロパティになり、
                //    キーフレーム(bf6VsHit)の transform: translate(-50%,-50%) と二重にかかって
                //    VSがちょうど自分の幅ぶん左にずれる(TARO実機 2026-09-10・実測で確認)。
                className="bf6-face bf6-vs bf6-chrome bf6-sheen pointer-events-none absolute left-1/2 top-1/2 z-30 whitespace-nowrap text-[10vw] font-black italic leading-none"
                data-text="VS"
              >
                VS
              </p>

              <div className="bf6-in-right w-1/2 min-w-0 shrink-0 grow-0 basis-1/2 overflow-hidden text-center will-change-transform">
                <Side slot={b} corner="blue" division={state.division} />
              </div>
            </div>

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
        <div className="flex items-start justify-between">
          <p className="text-[2vw] font-black tracking-[0.4em] text-orange-400">
            {DIV_LABEL[state.division]}部門 TOURNAMENT
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bf6/led-title.png" alt="" className="h-[8vh] w-auto opacity-95" />
        </div>
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
                  {/* 上の段へつながる線。勝者が出た枠の線だけ光が走って上へ抜ける。 */}
                  <Connectors
                    count={row.cells.length / 2}
                    active={
                      new Map(
                        Array.from({ length: row.cells.length / 2 }, (_, k) => k)
                          .filter((k) => flashWin.has(`${row.round}|${k + 1}`))
                          // 光は勝った側の脚から立ち上がるので、左右どちらかを渡す
                          .map((k) => [k, row.cells[k * 2]?.state === 'won' ? 'a' : 'b'] as const)
                      )
                    }
                  />
                  <div className="flex">
                    {row.cells.map((c, i) => (
                      <div key={i} className="flex min-w-0 flex-1 justify-center px-[0.25vw]">
                        <PersonCard
                          cell={c}
                          slots={slots}
                          rowIndex={ri}
                          rowCount={rows.length}
                          mode={
                            c.round !== null && flashArrive.has(`${c.round}|${c.matchNo}`)
                              ? 'arrive'
                              : c.round !== null && flashWin.has(`${c.round}|${c.matchNo}`)
                                ? 'win'
                                : null
                          }
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

/**
 * 隣り合う2枠を ⊓ で結び、その中央から上の段へ伸ばす。
 * active な枠は、勝者が決まった直後に光が下から上へ走り抜ける。
 */
function Connectors({ count, active }: { count: number; active: Map<number, 'a' | 'b'> }) {
  return (
    <div className="flex min-h-[2vh] flex-1 items-stretch">
      {Array.from({ length: count }, (_, i) => {
        const side = active.get(i);
        const on = side !== undefined;
        // 勝った側の脚(左=25% / 右=75%)から立ち上がり、横に折れて中央から上へ抜ける
        const legLeft = side === 'b' ? '75%' : '25%';
        return (
          <div key={i} className="relative flex-1">
            <div
              className={`absolute inset-x-[25%] bottom-0 top-1/2 border-l border-r border-t transition-colors duration-300 ${
                on ? 'border-orange-400' : 'border-white/25'
              }`}
            />
            <div className={`absolute left-1/2 top-0 h-1/2 w-px ${on ? 'bg-orange-400' : 'bg-white/25'}`} />
            {on && (
              <>
                {/* ① 勝った側の脚を上る */}
                <span
                  className="bf6-trace-leg absolute bottom-0 w-[0.2vw] -translate-x-1/2 rounded-full bg-[linear-gradient(0deg,rgba(255,255,255,0),#fdba74_45%,#fff_100%)] shadow-[0_0_1.2vw_#fb923c]"
                  style={{ left: legLeft }}
                />
                {/* ② 横棒を中央へ渡る */}
                <span
                  className={`bf6-trace-bar absolute top-1/2 h-[0.2vw] -translate-y-1/2 rounded-full shadow-[0_0_1.2vw_#fb923c] ${
                    side === 'b'
                      ? 'right-[25%] bg-[linear-gradient(270deg,#fff,#fdba74)]'
                      : 'left-[25%] bg-[linear-gradient(90deg,#fff,#fdba74)]'
                  }`}
                />
                {/* ③ 中央の柱を上へ抜ける */}
                <span className="bf6-trace-stem absolute left-1/2 top-0 w-[0.2vw] -translate-x-1/2 rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0),#fdba74_45%,#fff_100%)] shadow-[0_0_1.2vw_#fb923c]" />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PersonCard({
  cell, slots, mode, compact, rowIndex, rowCount,
}: {
  cell: BracketCell; slots: Record<string, Slot>; mode: 'win' | 'arrive' | null;
  compact: boolean; rowIndex: number; rowCount: number;
}) {
  const slot = cell.slotNo ? slots[String(cell.slotNo)] : undefined;
  const base = 'w-full truncate rounded-[0.4vw] border px-[0.4vw] py-[0.6vh] text-center font-black transition-all duration-500';
  // 上の段ほど残っている人が少ない=枠が広いので、文字も大きくする。
  // rowIndex 0 は優勝枠(別描画)なので、1回戦が最大の rowIndex になる。
  const depth = rowCount - 1 - rowIndex; // 1回戦=0、決勝=最大
  const SIZES = ['text-[0.95vw]', 'text-[1.4vw]', 'text-[2vw]', 'text-[2.8vw]'];
  const size = SIZES[Math.min(depth, SIZES.length - 1)] ?? (compact ? 'text-[0.95vw]' : 'text-[1.4vw]');
  const look =
    cell.state === 'won'
      ? 'border-orange-400/80 bg-orange-500/20 text-orange-200'
      : cell.state === 'lost'
        ? 'border-white/10 bg-white/[0.03] text-white/25 line-through decoration-white/20'
        : cell.state === 'pending'
          ? 'border-white/20 bg-white/[0.06] text-white/90'
          : 'border-dashed border-white/10 bg-transparent text-white/20';
  return (
    <p
      className={`${base} ${size} ${look} ${
        slot && mode === 'arrive' ? 'bf6-arrive' : slot && mode === 'win' ? 'bf6-winlit' : ''
      }`}
    >
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


function Stage({ children, plain }: { children: React.ReactNode; plain?: boolean }) {
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05070c] text-white">
      {/* オレンジの膜はロゴ/表用。背景動画の上に乗せると色が濁るのでVSでは出さない */}
      {!plain && (
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_20%,rgba(249,115,22,0.10),transparent_60%)]" />
      )}
      <div className="relative h-full w-full">{children}</div>
      <ScreenAnimStyles />
    </div>
  );
}

/** LED専用のアニメ定義。この画面でしか使わないのでここに置く。 */
function ScreenAnimStyles() {
  return (
    <style>{`
      /* ── VS: 名前どうしが中央で正面衝突 → 弾かれる → VSが割り込む(全体3.4秒) ──
         時間の設計: 0-46% 寄せ / 46-52% 衝突と圧縮 / 52-70% 弾かれる / 70-100% 収まる  */
      @keyframes bf6InLeft {
        0%   { opacity: 0; transform: translateX(-64vw) skewX(-10deg) scale(0.94); }
        12%  { opacity: 1; }
        40%  { transform: translateX(9vw) skewX(-7deg) scale(0.98); }
        46%  { transform: translateX(13.5vw) skewX(0deg) scale(1.06); } /* 接触 */
        50%  { transform: translateX(12.4vw) scaleX(0.9) scaleY(1.1); } /* 潰れる */
        58%  { transform: translateX(-3.5vw) scale(1); }                 /* 弾かれる */
        70%  { transform: translateX(1.6vw); }
        82%  { transform: translateX(-0.6vw); }
        100% { opacity: 1; transform: translateX(0); }
      }
      @keyframes bf6InRight {
        0%   { opacity: 0; transform: translateX(64vw) skewX(10deg) scale(0.94); }
        12%  { opacity: 1; }
        40%  { transform: translateX(-9vw) skewX(7deg) scale(0.98); }
        46%  { transform: translateX(-13.5vw) skewX(0deg) scale(1.06); }
        50%  { transform: translateX(-12.4vw) scaleX(0.9) scaleY(1.1); }
        58%  { transform: translateX(3.5vw) scale(1); }
        70%  { transform: translateX(-1.6vw); }
        82%  { transform: translateX(0.6vw); }
        100% { opacity: 1; transform: translateX(0); }
      }
      /* VSは衝突して離れたあと(58%〜)に割り込む */
      /* ⚠️ ここで filter を使わないこと。.bf6-chrome の drop-shadow(立体感)を
         上書きしてしまい、VSだけ平たく見える。登場は scale と opacity で作る。 */
      @keyframes bf6VsHit {
        0%, 56% { opacity: 0; transform: translate(-50%,-50%) scale(3.6) rotate(-9deg); }
        72%     { opacity: 1; transform: translate(-50%,-50%) scale(0.86) rotate(0deg); }
        80%     { transform: translate(-50%,-50%) scale(1.12); }
        100%    { opacity: 1; transform: translate(-50%,-50%) scale(1); }
      }
      /* 衝突の熱源 */
      @keyframes bf6Core {
        0%, 45.5% { opacity: 0; transform: translate(-50%,-50%) scale(0.1); }
        48%       { opacity: 1; transform: translate(-50%,-50%) scale(1.2); }
        62%       { opacity: 0; transform: translate(-50%,-50%) scale(2.4); }
        100%      { opacity: 0; }
      }
      @keyframes bf6Shock {
        0%, 46% { opacity: 0; transform: translate(-50%,-50%) scale(0.12); }
        50%     { opacity: 0.95; }
        70%     { opacity: 0; transform: translate(-50%,-50%) scale(2.2); }
        100%    { opacity: 0; transform: translate(-50%,-50%) scale(2.2); }
      }
      @keyframes bf6Shock2 {
        0%, 46.5% { opacity: 0; transform: translate(-50%,-50%) scale(0.06); }
        51%       { opacity: 1; }
        64%       { opacity: 0; transform: translate(-50%,-50%) scale(1.5); }
        100%      { opacity: 0; transform: translate(-50%,-50%) scale(1.5); }
      }
      /* 火花: 中心から放射しつつ失速し、同時に重力で落ちる。
         明滅を挟むと「燃えている粒」に見える。 */
      @keyframes bf6Spark {
        0%   { opacity: 0; transform: rotate(var(--rot)) translateX(0) scaleX(0.15); }
        6%   { opacity: 1; transform: rotate(var(--rot)) translateX(0.8vw) scaleX(1); }
        34%  { opacity: 1; }
        46%  { opacity: 0.55; }
        58%  { opacity: 1; }
        78%  { opacity: 0.5; }
        100% { opacity: 0; transform: rotate(var(--rot)) translateX(var(--sx)) scaleX(0.18); }
      }
      /* 外側は重力ぶんだけ落とす(放射と分けることで放物線になる) */
      @keyframes bf6SparkGravity {
        0%   { transform: translateY(0); }
        100% { transform: translateY(var(--fall)); }
      }
      /* 衝突の瞬間だけ画面を揺らす */
      @keyframes bf6Shake {
        0%, 45.5% { transform: translate(0,0) rotate(0deg); }
        46.4%     { transform: translate(-0.9vw, 0.5vw) rotate(-0.35deg); }
        47.3%     { transform: translate(0.8vw, -0.6vw) rotate(0.3deg); }
        48.2%     { transform: translate(-0.6vw, -0.35vw) rotate(-0.2deg); }
        49.1%     { transform: translate(0.45vw, 0.4vw) rotate(0.15deg); }
        50%       { transform: translate(-0.3vw, -0.2vw) rotate(-0.1deg); }
        51%       { transform: translate(0.15vw, 0.12vw); }
        52%, 100% { transform: translate(0,0) rotate(0deg); }
      }
      @keyframes bf6FlashOut {
        0%, 45.5% { opacity: 0; }
        47%       { opacity: 0.5; }
        53%       { opacity: 0; }
        100%      { opacity: 0; }
      }
      @keyframes bf6CornerIn { 0% { opacity:0; } 100% { opacity:1; } }
      /* ── 背景に常時の動き ── */
      /* 稲妻の明滅。放電は「ほぼ消えている→一瞬強く光る→残光」なので、
         滞在時間の大半を暗くしておき、短い山を2つ作る。層ごとに周期をずらす。 */

      /* ── VS: 名前どうしが中央で正面衝突 → 弾かれる → VSが割り込む(全体3.4秒) ──
         時間の設計: 0-46% 寄せ / 46-52% 衝突と圧縮 / 52-70% 弾かれる / 70-100% 収まる  */
      @keyframes bf6InLeft {
        0%   { opacity: 0; transform: translateX(-64vw) skewX(-10deg) scale(0.94); }
        12%  { opacity: 1; }
        40%  { transform: translateX(9vw) skewX(-7deg) scale(0.98); }
        46%  { transform: translateX(13.5vw) skewX(0deg) scale(1.06); } /* 接触 */
        50%  { transform: translateX(12.4vw) scaleX(0.9) scaleY(1.1); } /* 潰れる */
        58%  { transform: translateX(-3.5vw) scale(1); }                 /* 弾かれる */
        70%  { transform: translateX(1.6vw); }
        82%  { transform: translateX(-0.6vw); }
        100% { opacity: 1; transform: translateX(0); }
      }
      @keyframes bf6InRight {
        0%   { opacity: 0; transform: translateX(64vw) skewX(10deg) scale(0.94); }
        12%  { opacity: 1; }
        40%  { transform: translateX(-9vw) skewX(7deg) scale(0.98); }
        46%  { transform: translateX(-13.5vw) skewX(0deg) scale(1.06); }
        50%  { transform: translateX(-12.4vw) scaleX(0.9) scaleY(1.1); }
        58%  { transform: translateX(3.5vw) scale(1); }
        70%  { transform: translateX(-1.6vw); }
        82%  { transform: translateX(0.6vw); }
        100% { opacity: 1; transform: translateX(0); }
      }
      /* VSは衝突して離れたあと(58%〜)に割り込む */
      /* ⚠️ ここで filter を使わないこと。.bf6-chrome の drop-shadow(立体感)を
         上書きしてしまい、VSだけ平たく見える。登場は scale と opacity で作る。 */
      @keyframes bf6VsHit {
        0%, 56% { opacity: 0; transform: translate(-50%,-50%) scale(3.6) rotate(-9deg); }
        72%     { opacity: 1; transform: translate(-50%,-50%) scale(0.86) rotate(0deg); }
        80%     { transform: translate(-50%,-50%) scale(1.12); }
        100%    { opacity: 1; transform: translate(-50%,-50%) scale(1); }
      }
      /* 衝突の熱源 */
      @keyframes bf6Core {
        0%, 45.5% { opacity: 0; transform: translate(-50%,-50%) scale(0.1); }
        48%       { opacity: 1; transform: translate(-50%,-50%) scale(1.2); }
        62%       { opacity: 0; transform: translate(-50%,-50%) scale(2.4); }
        100%      { opacity: 0; }
      }
      @keyframes bf6Shock {
        0%, 46% { opacity: 0; transform: translate(-50%,-50%) scale(0.12); }
        50%     { opacity: 0.95; }
        70%     { opacity: 0; transform: translate(-50%,-50%) scale(2.2); }
        100%    { opacity: 0; transform: translate(-50%,-50%) scale(2.2); }
      }
      @keyframes bf6Shock2 {
        0%, 46.5% { opacity: 0; transform: translate(-50%,-50%) scale(0.06); }
        51%       { opacity: 1; }
        64%       { opacity: 0; transform: translate(-50%,-50%) scale(1.5); }
        100%      { opacity: 0; transform: translate(-50%,-50%) scale(1.5); }
      }
      /* 火花: 中心から放射しつつ失速し、同時に重力で落ちる。
         明滅を挟むと「燃えている粒」に見える。 */
      @keyframes bf6Spark {
        0%   { opacity: 0; transform: rotate(var(--rot)) translateX(0) scaleX(0.15); }
        6%   { opacity: 1; transform: rotate(var(--rot)) translateX(0.8vw) scaleX(1); }
        34%  { opacity: 1; }
        46%  { opacity: 0.55; }
        58%  { opacity: 1; }
        78%  { opacity: 0.5; }
        100% { opacity: 0; transform: rotate(var(--rot)) translateX(var(--sx)) scaleX(0.18); }
      }
      /* 外側は重力ぶんだけ落とす(放射と分けることで放物線になる) */
      @keyframes bf6SparkGravity {
        0%   { transform: translateY(0); }
        100% { transform: translateY(var(--fall)); }
      }
      /* 衝突の瞬間だけ画面を揺らす */
      @keyframes bf6Shake {
        0%, 45.5% { transform: translate(0,0) rotate(0deg); }
        46.4%     { transform: translate(-0.9vw, 0.5vw) rotate(-0.35deg); }
        47.3%     { transform: translate(0.8vw, -0.6vw) rotate(0.3deg); }
        48.2%     { transform: translate(-0.6vw, -0.35vw) rotate(-0.2deg); }
        49.1%     { transform: translate(0.45vw, 0.4vw) rotate(0.15deg); }
        50%       { transform: translate(-0.3vw, -0.2vw) rotate(-0.1deg); }
        51%       { transform: translate(0.15vw, 0.12vw); }
        52%, 100% { transform: translate(0,0) rotate(0deg); }
      }
      @keyframes bf6FlashOut {
        0%, 45.5% { opacity: 0; }
        47%       { opacity: 0.5; }
        53%       { opacity: 0; }
        100%      { opacity: 0; }
      }
      @keyframes bf6CornerIn { 0% { opacity:0; } 100% { opacity:1; } }
      /* ── 背景に常時の動き ── */
      /* 背景: ゆっくり寄りながら流れる。2枚の明滅を入れ替えて放電が絶えない状態にする。 */
      @keyframes bf6BgDrift {
        0%   { transform: scale(1.06) translate3d(-0.6%, -0.4%, 0); }
        50%  { transform: scale(1.12) translate3d(0.6%, 0.5%, 0); }
        100% { transform: scale(1.06) translate3d(-0.6%, -0.4%, 0); }
      }
      /* 放電のゆらぎ。等間隔にせず刻みを散らす */
      @keyframes bf6BgFlickA {
        0%,100% { opacity: 1;    filter: brightness(1); }
        9%      { opacity: 0.86; filter: brightness(1.3); }
        14%     { opacity: 1;    filter: brightness(0.94); }
        37%     { opacity: 0.72; filter: brightness(1.18); }
        52%     { opacity: 1;    filter: brightness(1); }
        68%     { opacity: 0.8;  filter: brightness(1.34); }
        74%     { opacity: 1;    filter: brightness(0.96); }
        91%     { opacity: 0.9;  filter: brightness(1.22); }
      }
      @keyframes bf6BgFlickB {
        0%,100% { opacity: 0;    filter: brightness(1.1); }
        11%     { opacity: 0.55; }
        17%     { opacity: 0.05; }
        33%     { opacity: 0.7;  filter: brightness(1.3); }
        41%     { opacity: 0.1;  }
        59%     { opacity: 0.62; }
        66%     { opacity: 0;    }
        83%     { opacity: 0.75; filter: brightness(1.25); }
        88%     { opacity: 0.08; }
      }
      /* 赤/青が不規則に脈打つ(等間隔だと機械的に見えるので刻みを散らす) */
      @keyframes bf6PulseL {
        0%,100% { filter: brightness(1); }
        12%     { filter: brightness(1.22); }
        18%     { filter: brightness(0.96); }
        41%     { filter: brightness(1.14); }
        58%     { filter: brightness(1); }
        73%     { filter: brightness(1.28); }
        79%     { filter: brightness(1.02); }
      }
      @keyframes bf6PulseR {
        0%,100% { filter: brightness(1); }
        9%      { filter: brightness(1.1); }
        27%     { filter: brightness(1.26); }
        33%     { filter: brightness(0.97); }
        52%     { filter: brightness(1.18); }
        67%     { filter: brightness(1); }
        88%     { filter: brightness(1.24); }
      }
      /* 中央の境目が放電のように明滅する */
      @keyframes bf6Seam {
        0%,100% { opacity: 0.25; transform: translateX(-50%) scaleX(1); }
        7%      { opacity: 0.9;  transform: translateX(-50%) scaleX(2.2); }
        11%     { opacity: 0.15; transform: translateX(-50%) scaleX(0.7); }
        23%     { opacity: 0.75; transform: translateX(-50%) scaleX(1.7); }
        29%     { opacity: 0.3;  }
        44%     { opacity: 1;    transform: translateX(-50%) scaleX(2.6); }
        49%     { opacity: 0.2;  transform: translateX(-50%) scaleX(0.9); }
        63%     { opacity: 0.7;  transform: translateX(-50%) scaleX(1.5); }
        71%     { opacity: 0.25; }
        86%     { opacity: 0.85; transform: translateX(-50%) scaleX(2); }
        92%     { opacity: 0.2;  }
      }
      @keyframes bf6Seam2 {
        0%,100% { opacity: 0.35; }
        44%     { opacity: 0.85; }
        63%     { opacity: 0.45; }
      }
      @keyframes bf6Drop { 0% { opacity:0; transform: translateY(-3vh); } 100% { opacity:1; transform:none; } }
      @keyframes bf6Rise { 0% { opacity:0; transform: translateY(3vh); } 100% { opacity:1; transform:none; } }

      /* ── トーナメント: 勝者が光る → 線を光が走る → 上の段に名前が着弾 ──
         時間の設計: 0-0.45s 勝者が点灯 / 0.35-1.0s 光が線を上る / 0.95-1.6s 着弾 */
      @keyframes bf6WinLit {
        0%   { transform: scale(1); box-shadow: 0 0 0 rgba(249,115,22,0); }
        18%  { transform: scale(1.16); box-shadow: 0 0 2.6vw 0.35vw rgba(249,115,22,0.85); }
        42%  { transform: scale(1.05); box-shadow: 0 0 1.6vw 0.15vw rgba(249,115,22,0.6); }
        100% { transform: scale(1); box-shadow: 0 0 0.6vw rgba(249,115,22,0.35); }
      }
      /* 線を走る光。ブラケットの形どおり ①脚を上る → ②横棒を渡る → ③中央の柱を上る */
      @keyframes bf6TraceLeg {
        0%,  10% { height: 0; opacity: 0; }
        14%      { height: 0; opacity: 1; }
        34%      { height: 50%; opacity: 1; }
        52%      { height: 50%; opacity: 0.35; }
        100%     { height: 50%; opacity: 0; }
      }
      @keyframes bf6TraceBar {
        0%,  32% { width: 0; opacity: 0; }
        35%      { width: 0; opacity: 1; }
        52%      { width: 25%; opacity: 1; }
        68%      { width: 25%; opacity: 0.3; }
        100%     { width: 25%; opacity: 0; }
      }
      @keyframes bf6TraceStem {
        0%,  50% { height: 0; opacity: 0; }
        54%      { height: 0; opacity: 1; }
        72%      { height: 50%; opacity: 1; }
        84%      { height: 50%; opacity: 0.3; }
        100%     { height: 50%; opacity: 0; }
      }
      /* 上の段への着弾: 奥から超特大で来て縮んで止まる */
      @keyframes bf6Arrive {
        0%, 46% { opacity: 0; transform: scale(7) translateY(-1.5vh); }
        53%     { opacity: 1; }
        70%     { opacity: 1; transform: scale(0.88) translateY(0); }
        78%     { transform: scale(1.14); }
        86%     { transform: scale(0.97); }
        100%    { opacity: 1; transform: scale(1); box-shadow: 0 0 1vw rgba(249,115,22,0.5); }
      }
      @keyframes bf6Champ {
        0%,100% { box-shadow: 0 0 1.6vw rgba(249,115,22,0.45); }
        50%     { box-shadow: 0 0 3.4vw 0.4vw rgba(249,115,22,0.85); }
      }

      /* バストアップは腰のあたりで切れるので、下端をフェードさせて地に溶かす。
         写真ごとに加工しなくてよいよう、表示側でマスクをかける。 */
      .bf6-cut {
        -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 72%, rgba(0,0,0,0.55) 88%, transparent 100%);
        mask-image: linear-gradient(to bottom, #000 0%, #000 72%, rgba(0,0,0,0.55) 88%, transparent 100%);
      }

      /* ダンサーネームとVSは欧文が主。Hiragino Sans の最太ウェイトは "S" の右上が
         平らに切り落とされた字形で、クロムを乗せると「文字が欠けている」ように見える。
         欧文フェイスを先に置き、日本語名のときだけHiraginoに落とす。 */
      .bf6-face {
        font-family: 'Helvetica Neue', Helvetica, Arial, 'Hiragino Sans', sans-serif;
      }
      /* クロム調。グラデーションを文字型で切り抜くのでどんな名前でも効く(画像生成不要)。
         本物の金属らしさは「空の映り込み」と「地面の映り込み」が硬い境界(地平線)で
         切り替わることで出る。等間隔のグラデーションだと単調な縞にしか見えない。 */
      .bf6-chrome {
        background-image: linear-gradient(180deg,
          #39434f 0%,    /* 上端の暗い縁 */
          #7d8b9a 4%,
          #dfe8f2 9%,
          #ffffff 15%,   /* 空のハイライト */
          #cdd8e4 22%,
          #aab6c4 29%,
          #8b98a8 36%,
          #6b7887 43%,
          #4a5563 49%,
          #2b3440 52%,
          #38424f 53.4%, /* ── 地平線(反射の境目。黒くしすぎると欠けに見える) ── */
          #2c3542 54.2%,
          #f2f6fa 55.2%, /* 地面側の強い反射 */
          #ffffff 57%,
          #dbe3ec 62%,
          #b2bdca 68%,
          #8b96a5 74%,
          #6f7b8a 78%,
          #9fa9b6 83%,
          #e6ecf3 88%,
          #ffffff 93%,
          #8d97a4 98%,
          #39414c 100%);
        -webkit-background-clip: text; background-clip: text; color: transparent;
        -webkit-text-stroke: 0.018em rgba(255,255,255,0.6);
        filter:
          drop-shadow(0 0.012em 0 rgba(255,255,255,0.55))
          drop-shadow(0 -0.012em 0 rgba(0,0,0,0.7))
          drop-shadow(0 0.05em 0.03em rgba(0,0,0,0.9))
          drop-shadow(0 0.13em 0.2em rgba(0,0,0,0.6));
      }
      /* 走る光沢。金属は光源が動くと質感が出る。
         ⚠️ ここで position を指定しない。absolute配置のVSを流してしまうため。
         位置の基準は要素側(relative / absolute)で持たせる。 */
      .bf6-sheen::after {
        content: attr(data-text);
        position: absolute; inset: 0;
        background-image: linear-gradient(102deg,
          transparent 36%, rgba(255,255,255,0.0) 42%, rgba(255,255,255,0.95) 50%,
          rgba(255,255,255,0.0) 58%, transparent 64%);
        background-size: 260% 100%;
        -webkit-background-clip: text; background-clip: text; color: transparent;
        /* ⚠️ 親から縁取りを受け継ぐと輪郭が二重に出て、文字が欠けて見える */
        -webkit-text-stroke: 0;
        animation: bf6Sheen 2.6s cubic-bezier(.3,0,.2,1) both;
        pointer-events: none;
      }
      @keyframes bf6Sheen {
        0%, 52%  { background-position: 190% 0; }
        76%      { background-position: -60% 0; }
        100%     { background-position: -60% 0; }
      }

      .bf6-pulse-l  { animation: bf6CornerIn .5s ease-out both, bf6PulseL 4.2s ease-in-out infinite; }
      .bf6-pulse-r  { animation: bf6CornerIn .5s ease-out both, bf6PulseR 3.7s ease-in-out infinite; }
      .bf6-corner-l { animation: bf6CornerIn .5s ease-out both; }
      .bf6-corner-r { animation: bf6CornerIn .5s ease-out both; }
      .bf6-in-left  { animation: bf6InLeft   2.6s cubic-bezier(.7,0,.28,1) both; }
      .bf6-in-right { animation: bf6InRight  2.6s cubic-bezier(.7,0,.28,1) both; }
      .bf6-vs       { animation: bf6VsHit    2.6s cubic-bezier(.2,1.3,.35,1) both; }
      .bf6-core     { animation: bf6Core     2.6s ease-out both; }
      .bf6-shock    { animation: bf6Shock    2.6s ease-out both; }
      .bf6-shock2   { animation: bf6Shock2   2.6s ease-out both; }
      .bf6-spark    { animation-name: bf6Spark; animation-timing-function: cubic-bezier(.08,.75,.3,1); animation-fill-mode: both; }
      .bf6-spark-g  { animation-name: bf6SparkGravity; animation-timing-function: cubic-bezier(.35,0,.85,1); animation-fill-mode: both; }
      .bf6-shake    { animation: bf6Shake 2.6s linear both; }
      .bf6-flashout { animation: bf6FlashOut 2.6s ease-out both; }
      .bf6-drop     { animation: bf6Drop     .5s ease-out both; }
      .bf6-rise     { animation: bf6Rise     .5s ease-out 2.4s both; }
      .bf6-winlit   { animation: bf6WinLit  1.5s cubic-bezier(.2,1.2,.3,1) both; }
      .bf6-trace-leg  { animation: bf6TraceLeg  1.5s cubic-bezier(.3,.1,.2,1) both; }
      .bf6-trace-bar  { animation: bf6TraceBar  1.5s cubic-bezier(.3,.1,.2,1) both; }
      .bf6-trace-stem { animation: bf6TraceStem 1.5s cubic-bezier(.3,.1,.2,1) both; }
      .bf6-arrive   { animation: bf6Arrive  2.2s cubic-bezier(.18,1.1,.28,1) both; z-index: 5; position: relative; }
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
  // 背景を切り抜いた人物を大きく出す。切り抜き前提なので枠も丸マスクも付けない。
  // 写真が無い人は名前だけで成立する(全員ぶん集まらなくても破綻しない)。
  // ぼかし半径の大きい drop-shadow を2重にかけると、大きな切り抜き画像では
  // 登場アニメ中にカクつく(TARO実機 2026-09-10)。色の縁取りは1つ・半径小さめに。
  const glow =
    corner === 'red'
      ? 'drop-shadow(0 0 1vw rgba(239,68,68,0.6))'
      : 'drop-shadow(0 0 1vw rgba(59,130,246,0.6))';
  return (
    <div>
      <p className={`text-[1.6vw] font-black tracking-[0.5em] ${accent}`}>
        {corner === 'red' ? 'RED' : 'BLUE'}
      </p>
      {/* 写真の有無で名前の高さがずれないよう、枠は常に確保する */}
      <div className="flex h-[64vh] items-end justify-center">
        {slot?.hasPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/bf6/photo/${slot.slotNo}?division=${division}`}
            alt=""
            className="bf6-cut max-h-full w-auto max-w-[46vw] object-contain object-bottom"
            style={{ filter: glow }}
          />
        )}
      </div>
      {slot?.dancerName ? (
        <p
          className="bf6-face bf6-chrome bf6-sheen relative -mt-[1.5vh] break-words text-[9vw] font-black italic leading-[0.92]"
          data-text={slot.dancerName}
        >
          {slot.dancerName}
        </p>
      ) : (
        <p className="relative -mt-[1.5vh] text-[4vw] font-black tracking-[0.3em] text-white/35">不戦勝</p>
      )}
      {slot?.rep && <p className="mt-[0.2vh] text-[1.9vw] font-bold text-white/60">{slot.rep}</p>}
    </div>
  );
}

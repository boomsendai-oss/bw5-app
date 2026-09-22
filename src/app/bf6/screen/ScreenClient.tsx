'use client';

// LED出力(16:9横長)。1秒ごとに状態を取りに行き、変化したところだけ演出する。
//
// 演出の方針(TARO 2026-09-07):
//   VS       … 左=赤コーナー / 右=青コーナー。左右から寄ってきて中央で衝突→火花。全体3秒。
//   トーナメント … 下から上へ積む縦型。勝者のカードが上の段へせり上がり、敗者はグレーアウト。
// ポーリングで同じ状態が返り続けるため、再生の判定は bf6ScreenAnim に寄せている
// (毎秒アニメが再生され続けるのを防ぐ)。
import { useEffect, useRef, useState } from 'react';
import { detectNewWinners, parentMatch, sceneKey, vsAnimKey, type AnimMatch } from '@/lib/bf6ScreenAnim';
import { buildBracketRows, type BracketCell } from '@/lib/bf6BracketRows';
import { divisionTheme } from '@/lib/bf6Theme';
import type { Bf6DrawDivision } from '@/lib/bf6Draw';
import type { DivisionTheme } from '@/lib/bf6Theme';
import { contentTopRatio, headAlignShift, photoFadeStops, VS_HEAD_TARGET, VS_PHOTO_SCALE } from '@/lib/bf6PhotoAlign';

type Match = { round: string; matchNo: number; slotA: number | null; slotB: number | null; winnerSlot: number | null };
type Slot = { slotNo: number; dancerName: string; rep: string; genre: string; hasPhoto: boolean; photoAt?: string | null };
type Champion = {
  division: string; label: string; slotNo: number | null;
  dancerName: string; hasPhoto: boolean; photoAt: string | null;
};
type Payload = {
  state: { mode: 'logo' | 'bracket' | 'vs' | 'drumroll' | 'champions'; division: string; round: string | null; matchNo: number | null; rev: number };
  matches: Match[];
  slots: Record<string, Slot>;
  nextMatch: Match | null;
  /** トーナメント開始前(くじ引きの結果をそのまま映している) */
  pending?: boolean;
  /** 優勝者発表のときだけ入る(3部門ぶん) */
  champions?: Champion[] | null;
};

const DIV_LABEL: Record<string, string> = { beginner: 'ビギナー', kids: '小中学生', general: '一般' };
const ROUND_LABEL: Record<string, string> = { r16: 'BEST 16', qf: 'BEST 8', sf: 'SEMI FINAL', f: 'FINAL' };

/** 勝者演出を出す時間。会場で見て分かる長さ。 */
const WIN_FLASH_MS = 3000;
/** 場面を切り替えるとき、暗くしてから差し替えるまでの時間(TARO実機 2026-09-16) */
const SCENE_FADE_MS = 260;
/** 火花。中心から放射する筋。角度と距離を決め打ちして毎フレーム再計算しない。 */
// 本数は見た目とPCの負荷の妥協点。64本は実機でカクついた(TARO 2026-09-10)
// 本数と装飾は負荷とのトレードオフ。box-shadow付き64本→28本→16本(にじみ無し)→10本と段階的に削った
// (TARO実機 2026-09-10/09-16・LED出力のPCで衝突の瞬間だけ重くなるため)
const SPARK_COUNT = 10;
const SPARKS = Array.from({ length: SPARK_COUNT }, (_, i) => {
  const a = (i / SPARK_COUNT) * 360 + ((i * 47) % 17) - 8;
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
  /** 先読みした顔写真。同じものを何度も取りに行かない */
  const photoPre = useRef<Set<string>>(new Set());
  // ⚠️ 実際に映すのは data ではなく shown。場面が変わるときは一度暗くしてから差し替えるため、
  //    その間だけ古い内容を映し続ける(切り替わる瞬間に新旧が混ざらないよう、状態だけでなく
  //    試合や名前もまとめて止める)。TARO実機 2026-09-16
  const [shown, setShown] = useState<Payload | null>(null);
  const [dark, setDark] = useState(false);
  const shownRef = useRef<Payload | null>(null);
  const latestRef = useRef<Payload | null>(null);
  const fadingRef = useRef(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  shownRef.current = shown;
  latestRef.current = data;

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

        // ⚠️ 顔写真はVSを出した瞬間に初めて取りに行くと、その人の初回だけ表示が遅れる
        //    (TARO実機 2026-09-14「写真が出てくるのが一瞬遅れる」)。表示中の部門ぶんを先に読む。
        for (const s of Object.values(j.slots)) {
          if (!s.hasPhoto) continue;
          const key = `${j.state.division}:${s.slotNo}:${s.photoAt ?? ''}`;
          if (photoPre.current.has(key)) continue;
          photoPre.current.add(key);
          const im = new Image();
          im.src = photoUrl(s.slotNo, j.state.division, s.photoAt);
          measurePhotoTop(im.src);
        }

        if (fresh.length > 0) {
          const winKeys = fresh.map((w) => `${w.round}|${w.matchNo}`);
          // ⚠️ 試合単位のキーだと、同じ準決勝に入る2人の両方が光ってしまう
          //    (SORAが勝ったのにJINも光った・TARO実機 2026-09-10)。枠番号まで含める。
          const upKeys = fresh
            .map((w) => {
              const up = parentMatch(j.state.division, w.round, w.matchNo);
              return up ? `${up.round}|${up.matchNo}|${w.winnerSlot}` : null;
            })
            .filter((x): x is string => x !== null);
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
    for (const src of ['/bf6/flyer-hero-v2.jpg', '/bf6/led-title.png', '/bf6/vs-bg-first.jpg']) {
      const im = new Image();
      im.src = src;
    }
    // 背景動画は先に取っておく(最初に出すとき遅れる・TARO実機 2026-09-10)
    for (const src of ['/bf6/vs-bg.mp4', '/bf6/led-loop.mp4']) {
      const pre = document.createElement('video');
      pre.src = src;
      pre.preload = 'auto';
      pre.muted = true;
      pre.load();
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
      timers.forEach(clearTimeout);
    };
  }, []);

  // 場面が変わったら暗幕を出し、暗くなりきってから中身を差し替える。
  // ⚠️ このタイマーを effect のクリーンアップで消さないこと。ポーリングは毎秒 data を
  //    差し替えるため、クリーンアップに任せると暗転の途中でタイマーが消えて明るくならない。
  useEffect(() => {
    if (!data) return;
    const prev = shownRef.current;
    if (!prev) { setShown(data); return; }
    if (fadingRef.current) return;
    if (sceneKey(data.state) === sceneKey(prev.state)) { setShown(data); return; }
    fadingRef.current = true;
    setDark(true);
    fadeTimer.current = setTimeout(() => {
      setShown(latestRef.current ?? data);
      setDark(false);
      fadingRef.current = false;
    }, SCENE_FADE_MS);
  }, [data]);

  useEffect(() => () => { if (fadeTimer.current) clearTimeout(fadeTimer.current); }, []);

  if (!shown) return <Stage dark={dark}><Logo /></Stage>;
  const { state, matches, slots } = shown;
  if (state.mode === 'logo') return <Stage dark={dark}><Logo /></Stage>;

  // 優勝者発表。ドラムロール → 発表(カード形式・3部門同時)(TARO 2026-09-22)
  if (state.mode === 'champions' || state.mode === 'drumroll') {
    return (
      <Stage dark={dark}>
        <ChampionsScene rows={shown.champions ?? []} reveal={state.mode === 'champions'} />
      </Stage>
    );
  }

  if (state.mode === 'vs') {
    const m = state.round && state.matchNo
      ? matches.find((x) => x.round === state.round && x.matchNo === state.matchNo)
      : shown.nextMatch;
    if (!m) return <Stage dark={dark}><Logo /></Stage>;
    const a = m.slotA ? slots[String(m.slotA)] : undefined;
    const b = m.slotB ? slots[String(m.slotB)] : undefined;
    return (
      <Stage plain dark={dark}>
        {/* key を変えることで、試合が変わったときだけ登場アニメを再生し直す */}
        {/* ⚠️ ここに bf6-shake を付けないこと。動画を含む全体を毎フレーム動かすことになり、
               画面ごと描き直しになってカクつく(TARO実機 2026-09-10)。揺れは前景だけに掛ける。 */}
        <div key={vsAnimKey(state)} className="relative h-full w-full">
          {/* 背景は動画。暗闇→左右から赤青が突入→中央で衝突→煙が広がって落ち着く。
              試合ごとに1回だけ再生する。5秒で終わるが、そこで固まると急に止まって見えるので
              終わったあとは最後のコマをゆっくり拡大させ、薄い靄を流す(TARO実機 2026-09-14)。
              追加で読み込むものは無いので重くならない。 */}
          <VsBackground animKey={vsAnimKey(state)} />

          {/* 名前が乗るあたりだけ軽く落とす。中央に暗幕を敷くと動画の鮮やかさが死ぬ。
              ⚠️ 帯を切って持ち上げると、下端の直線が画面の真ん中に見えてしまう
                 (TARO実機 2026-09-17)。画面の下まで伸ばし、濃さの山だけ名前に合わせる。 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[34%] bg-[linear-gradient(to_bottom,rgba(5,7,12,0)_0%,rgba(5,7,12,0.55)_42%,rgba(5,7,12,0.62)_60%,rgba(5,7,12,0.34)_100%)]" />
          {/* 衝突の閃光 */}
          <div className="bf6-flashout pointer-events-none absolute inset-0 bg-white" />

          {/* ⚠️ LEDの前にジャッジが座るため、下1/3は客席から見えない(TARO 2026-09-17)。
                 写真も名前もジャンルも、必ず上から2/3の中に収める。
                 縮小(transform: scale)は使わない。bf6-shake が transform を使うので
                 レイヤーが上がり、1920x1080のLEDで文字がぼやける。高さの配分で詰める。 */}
          <div className="bf6-shake relative flex h-[72%] w-full flex-col">
            <div className="bf6-drop flex shrink-0 items-start justify-between px-[2.5vw] pt-[1vh]">
              <p className="text-[1.6vw] font-black tracking-[0.35em] text-white/85">
                {DIV_LABEL[state.division]}部門 / {ROUND_LABEL[m.round] ?? m.round}
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/bf6/led-title.png" alt="" className="h-[4.2vh] w-auto opacity-95" />
            </div>

            <div className="relative flex min-h-0 flex-1 items-stretch justify-center px-[1.5vw] pb-[0.8vh]">
              {/* 左右は内容量に関係なく必ず半分ずつ(片側が空でもVSが中央からずれない・TARO実機 2026-09-10) */}
              <div className="bf6-in-left w-1/2 min-w-0 shrink-0 grow-0 basis-1/2 overflow-hidden text-center">
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
                        background: `linear-gradient(90deg, #fff 0%, ${sp.hot} 40%, rgba(255,140,40,0.7) 70%, rgba(255,60,0,0) 100%)`,
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
                {/* 衝撃波は1本だけ。2本重ねると衝突の瞬間が重くなる(TARO実機 2026-09-16) */}
                <span className="bf6-shock absolute left-0 top-0 block h-[26vw] w-[26vw] rounded-full border-[0.3vw] border-orange-400/80" />
              </div>

              {/* VSは衝突して離れたあとに割り込む */}
              <p
                // ⚠️ -translate-x-1/2 を付けないこと。Tailwind v4 では `translate` プロパティになり、
                //    キーフレーム(bf6VsHit)の transform: translate(-50%,-50%) と二重にかかって
                //    VSがちょうど自分の幅ぶん左にずれる(TARO実機 2026-09-10・実測で確認)。
                className="bf6-face bf6-vs bf6-chrome bf6-sheen pointer-events-none absolute left-1/2 top-1/2 z-30 whitespace-nowrap text-[9.5vw] font-black italic leading-none"
                data-text="VS"
              >
                VS
              </p>

              <div className="bf6-in-right w-1/2 min-w-0 shrink-0 grow-0 basis-1/2 overflow-hidden text-center">
                <Side slot={b} corner="blue" division={state.division} />
              </div>
            </div>

          </div>
        </div>
      </Stage>
    );
  }

  // 縦型トーナメント表(下から上へ)
  const rows = buildBracketRows(state.division as Bf6DrawDivision, matches, { pending: shown.pending });
  const theme = divisionTheme(state.division);
  return (
    <Stage dark={dark}>
      {/* ⚠️ VS画面と同じ理由でLEDの上2/3に収める。手前にジャッジ3名が座るため
             下1/3は客席から見えない(TARO 2026-09-17)。表は各段が flex-1 なので
             高さを絞れば段間が詰まる。文字が潰れないよう札の大きさも下げてある。 */}
      <div className="flex h-[72%] w-full flex-col px-[2.5vw] py-[1.5vh]">
        <div className="flex shrink-0 items-start justify-between">
          <p className={`text-[2vw] font-black tracking-[0.4em] ${theme.text}`}>
            {DIV_LABEL[state.division]}部門
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bf6/led-title.png" alt="" className="h-[6vh] w-auto opacity-95" />
        </div>
        <div className="mt-[1.5vh] flex flex-1 flex-col">
          {rows.map((row, ri) => (
            <div
              key={row.kind === 'champion' ? 'champ' : row.round}
              className={row.kind === 'champion' ? 'flex-none' : 'flex flex-1 flex-col'}
            >
              {row.kind === 'champion' ? (
                <div className="flex justify-center">
                  <ChampionCard cell={row.cells[0]} slots={slots} theme={theme} />
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
                          // 光は勝った側の脚から立ち上がる。負けた側(lost)でなければ左脚。
                          .map((k) => [k, row.cells[k * 2]?.state === 'lost' ? 'b' : 'a'] as const)
                      )
                    }
                  />
                  <div className="flex">
                    {row.cells.map((c, i) => (
                      <div key={i} className="flex min-w-0 flex-1 justify-center px-[0.25vw]">
                        <PersonCard
                          cell={c}
                          slots={slots}
                          theme={theme}
                          rowIndex={ri}
                          rowCount={rows.length}
                          mode={
                            c.round !== null && flashArrive.has(`${c.round}|${c.matchNo}|${c.slotNo}`)
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
                  <p className="mt-[0.3vh] text-center text-[0.85vw] font-black tracking-[0.3em] text-white/35">
                    {ROUND_LABEL[row.round ?? ''] ?? row.round}
                  </p>
                </>
              )}
              {ri === 0 && <div className="mx-auto h-[1vh] w-px bg-white/25" />}
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
  cell, slots, mode, compact, rowIndex, rowCount, theme,
}: {
  cell: BracketCell; slots: Record<string, Slot>; mode: 'win' | 'arrive' | null;
  compact: boolean; rowIndex: number; rowCount: number; theme: DivisionTheme;
}) {
  const slot = cell.slotNo ? slots[String(cell.slotNo)] : undefined;
  // ⚠️ 会場のLEDでは1回戦の名前が小さすぎて読めなかった(TARO実機 2026-09-14)。
  //    1行に収めるのをやめ、2行まで折り返して大きく出す。
  const base =
    'flex w-full items-center justify-center rounded-[0.4vw] border px-[0.3vw] py-[0.35vh] text-center font-black leading-[1.05] transition-all duration-500 [overflow-wrap:anywhere] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden';
  // 上の段ほど残っている人が少ない=枠が広いので、文字も大きくする。
  // rowIndex 0 は優勝枠(別描画)なので、1回戦が最大の rowIndex になる。
  const depth = rowCount - 1 - rowIndex; // 1回戦=0、決勝=最大
  const SIZES = ['text-[1.6vw]', 'text-[2.2vw]', 'text-[2.9vw]', 'text-[3.6vw]'];
  const size = SIZES[Math.min(depth, SIZES.length - 1)] ?? (compact ? 'text-[1.6vw]' : 'text-[2.2vw]');
  // 部門の色=まだ勝ち残っている / グレー+取り消し線=負けた / 破線=空き枠。
  const look =
    cell.state === 'alive'
      ? theme.cardAlive
      : cell.state === 'lost'
        ? 'border-white/10 bg-white/[0.03] text-white/25 line-through decoration-white/20'
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

function ChampionCard({ cell, slots, theme }: { cell: BracketCell; slots: Record<string, Slot>; theme: DivisionTheme }) {
  const slot = cell.slotNo ? slots[String(cell.slotNo)] : undefined;
  return (
    <div className="text-center">
      <p className={`text-[1vw] font-black tracking-[0.4em] ${theme.text}`}>WINNER</p>
      <p
        className={`mt-[0.3vh] rounded-[0.5vw] border px-[1.6vw] py-[0.6vh] text-[2.7vw] font-black italic ${
          slot ? `bf6-champ ${theme.champion}` : 'border-dashed border-white/15 text-white/20'
        }`}
      >
        {slot?.dancerName || '—'}
      </p>
    </div>
  );
}


function Stage({ children, plain, dark }: { children: React.ReactNode; plain?: boolean; dark?: boolean }) {
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05070c] text-white">
      {/* オレンジの膜はロゴ/表用。背景動画の上に乗せると色が濁るのでVSでは出さない */}
      {!plain && (
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_20%,rgba(249,115,22,0.10),transparent_60%)]" />
      )}
      <div className="relative h-full w-full">{children}</div>
      {/* 場面の切り替え用の暗幕。暗くなりきってから中身を差し替え、そのあとゆっくり明ける。
          透明度だけを動かすので、切り替えのために新しく読み込むものは無い。 */}
      <div
        className="pointer-events-none absolute inset-0 z-[60] bg-[#05070c]"
        style={{ opacity: dark ? 1 : 0, transition: `opacity ${dark ? SCENE_FADE_MS - 20 : 420}ms ease-in-out` }}
      />
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
        50%  { transform: translateX(12.4vw) scale(1.02); }              /* 受け止める */
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
        50%  { transform: translateX(-12.4vw) scale(1.02); }
        58%  { transform: translateX(3.5vw) scale(1); }
        70%  { transform: translateX(-1.6vw); }
        82%  { transform: translateX(0.6vw); }
        100% { opacity: 1; transform: translateX(0); }
      }
      /* VSは衝突して離れたあと(58%〜)に割り込む */
      /* ⚠️ ここで filter を使わないこと。.bf6-chrome の drop-shadow(立体感)を
         上書きしてしまい、VSだけ平たく見える。登場は scale と opacity で作る。 */
      @keyframes bf6VsHit {
        0%, 56% { opacity: 0; transform: translate(-50%,-50%) scale(2.1) rotate(-9deg); }
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
        46.4%     { transform: translate(-0.5vw, 0.3vw); }
        47.3%     { transform: translate(0.45vw, -0.3vw); }
        48.2%     { transform: translate(-0.3vw, -0.2vw); }
        49.1%     { transform: translate(0.2vw, 0.2vw); }
        50%       { transform: translate(-0.12vw, -0.1vw); }
        51%       { transform: translate(0.06vw, 0.05vw); }
        52%, 100% { transform: translate(0,0) rotate(0deg); }
      }
      @keyframes bf6FlashOut {
        0%, 45.5% { opacity: 0; }
        47%       { opacity: 0.34; }
        53%       { opacity: 0; }
        100%      { opacity: 0; }
      }
      @keyframes bf6CornerIn { 0% { opacity:0; } 100% { opacity:1; } }
      /* ── 背景に常時の動き ── */
      /* 稲妻の明滅。放電は「ほぼ消えている→一瞬強く光る→残光」なので、
         滞在時間の大半を暗くしておき、短い山を2つ作る。層ごとに周期をずらす。 */

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
      /* 優勝者発表(カード形式)。ドラムロール中はタイトルが鼓動する */
      @keyframes bf6Drum { 0%,100% { transform: scale(1); } 50% { transform: scale(1.025); } }
      .bf6-drum { animation: bf6Drum .9s ease-in-out infinite; }
      @keyframes bf6Hud { from { opacity: 0; } to { opacity: 1; } }
      .bf6-hud { animation: bf6Hud .6s ease-out .45s both; }
      /* カードがふわっと出る(下から・ぼかしから・起き上がりながら)。最後に各カードの傾きで止まる */
      @keyframes bf6CardIn {
        0%   { opacity: 0; filter: blur(12px); transform: translateY(13vh) rotate(calc(var(--tilt) * 2.5)) rotateX(25deg) scale(.92); }
        60%  { opacity: 1; }
        100% { opacity: 1; filter: blur(0); transform: translateY(0) rotate(var(--tilt)) rotateX(0deg) scale(1); }
      }
      .bf6-card-in { animation: bf6CardIn 1.3s cubic-bezier(.2,.8,.2,1) both; }
      /* 出たあとも、ゆっくり浮き沈みしながら少し首を振る */
      @keyframes bf6CardFloat {
        0%,100% { transform: translateY(-0.4vh) rotateY(-2.5deg); }
        50%     { transform: translateY(0.4vh) rotateY(2.5deg); }
      }
      .bf6-card-float { animation: bf6CardFloat 5.2s ease-in-out infinite; }
      @keyframes bf6NameIn { from { opacity: 0; transform: scale(1.06); } to { opacity: 1; transform: scale(1); } }
      .bf6-name-in { animation: bf6NameIn .8s ease-out .6s both; }
      /* 光の筋。カードの上を左から右へ横切り続ける */
      @keyframes bf6CardSweep {
        0%   { transform: translateX(-14vw) skewX(-18deg); }
        45%  { transform: translateX(34vw) skewX(-18deg); }
        100% { transform: translateX(34vw) skewX(-18deg); }
      }
      .bf6-card-sweep {
        left: 0;
        background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,250,235,0.30), rgba(255,255,255,0));
        animation: bf6CardSweep 4.8s ease-in-out 1.2s infinite both;
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
      /* VS背景が終わったあとの、ごくゆっくりした動き。止まって見えないようにするだけ */
      @keyframes bf6BgDrift { from { transform: scale(1); } to { transform: scale(1.07); } }
      .bf6-bgdrift { animation: bf6BgDrift 26s ease-out both; }

      @keyframes bf6Haze { 0% { opacity: 0; transform: translate3d(-3%,0,0); } 50% { opacity: .5; } 100% { opacity: 0; transform: translate3d(3%,0,0); } }
      .bf6-haze {
        background: radial-gradient(60% 45% at 35% 60%, rgba(255,255,255,0.06), transparent 70%),
                    radial-gradient(50% 40% at 70% 45%, rgba(255,160,80,0.05), transparent 70%);
        animation: bf6Haze 14s ease-in-out infinite;
      }
    `}</style>
  );
}

/**
 * 優勝者発表(カード形式)。TARO 2026-09-22 に6案から「ポスター・カード」を選んだ。
 *
 * 流れ: 操作卓で ①ドラムロール → 「TODAY'S / CHAMPION IS…」を出す
 *       ②「ジャーン」で発表 → 3部門のカードが同時にふわっと出る(会場ではジャッジが同時に手を上げる)
 * - 並びは左からビギナー・一般・小中学生(CHAMPION_ORDER)。決勝の2人が立つ位置と同じ。
 * - LEDの前に人が立つので、カードは上72%に収める(下端 約70vh)。
 * - 出たあとも、カードはゆっくり浮き沈みし、光の筋が横切り続ける(TARO「ずっと続けばかなりいい」)。
 * - カードの縦書きは「CHAMPION BF6」。番号(No.01…)は付けない(TARO)。
 *
 * ⚠️ ドラムロール → 発表は同じ場面(sceneKey)。暗転を挟まず、この部品の中で切り替える。
 * ⚠️ 写真の頭頂はドラムロールの間に測り終えておく(発表の瞬間に1枚だけ遅れて出ないように)。
 *    発表を押したときにまだなら、最大1.5秒だけ待って3枚そろえて出す。
 */
const CARD_PHOTO_SCALE = 1.25;
/** カードの中で頭頂を置く高さ(写真の高さに対する割合)。部門名のすぐ下に頭が来る位置 */
const CARD_HEAD_TARGET = 0.17;
/** カードの傾き(度)。左・中・右 */
const CARD_TILT = [-4.5, 1.5, 4.5];
/** カード上端の帯と下地のにじみに使う部門の色(CSSの値) */
const CARD_COLOR: Record<string, string> = { beginner: '#34d399', general: '#f87171', kids: '#fb923c' };

function ChampionsScene({ rows, reveal }: { rows: Champion[]; reveal: boolean }) {
  const srcs = rows.map((c) => (c.hasPhoto && c.slotNo !== null ? photoUrl(c.slotNo, c.division, c.photoAt) : null));
  const key = srcs.join('|');
  const [measuredKey, setMeasuredKey] = useState<string | null>(null);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all(key.split('|').map((s) => (s ? measurePhotoTop(s) : Promise.resolve(null)))).then(() => {
      if (alive) setMeasuredKey(key);
    });
    return () => { alive = false; };
  }, [key]);
  useEffect(() => {
    if (!reveal) return;
    const t = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(t);
  }, [reveal]);
  const shown = reveal && (measuredKey === key || waited);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#020203]">
      {/* 背景。ロゴ画面の煙をぼかして落とした暗い下地 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/bf6/led-loop-poster.jpg"
        alt=""
        className="absolute inset-0 h-full w-full scale-[1.15] object-cover opacity-55 [filter:blur(34px)_grayscale(.5)_brightness(.5)]"
      />
      <div className="absolute inset-0 bg-[radial-gradient(70%_55%_at_50%_38%,rgba(252,211,77,0.07),transparent_70%),linear-gradient(180deg,rgba(0,0,0,0.25),rgba(0,0,0,0.7))]" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_40%,transparent_35%,rgba(3,3,6,0.9)_100%)]" />

      {/* ドラムロール中の画面。発表で消える */}
      <div className={`absolute inset-0 transition-opacity duration-500 ${shown ? 'opacity-0' : 'opacity-100'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/bf6/led-bg.png" alt="" className="absolute inset-0 h-full w-full object-cover opacity-55" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_36%,rgba(252,211,77,0.10),transparent_70%),radial-gradient(120%_90%_at_50%_40%,transparent_30%,rgba(5,7,12,0.92)_100%)]" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/bf6/led-title.png" alt="" className="absolute left-1/2 top-[6.5vh] h-[9.3vh] w-auto -translate-x-1/2" />
        <div className="absolute inset-x-0 top-[20vh] flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bf6/todays-title.png" alt="TODAY'S CHAMPION IS…" className="bf6-drum w-[70vw] max-w-none" />
        </div>
      </div>

      {shown && (
        <>
          <p className="bf6-hud absolute left-[2.5vw] top-[2.4vh] text-[1.8vw] font-black tracking-[0.4em] text-amber-300">CHAMPIONS</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bf6/led-title.png" alt="" className="bf6-hud absolute right-[2.5vw] top-[1.7vh] h-[5.7vh] w-auto" />
        </>
      )}

      {rows.map((c, i) => (
        <ChampionPosterCard key={c.division} c={c} src={srcs[i]} index={i} shown={shown} />
      ))}
    </div>
  );
}

function ChampionPosterCard({ c, src, index, shown }: { c: Champion; src: string | null; index: number; shown: boolean }) {
  const theme = divisionTheme(c.division);
  const color = CARD_COLOR[c.division] ?? '#fb923c';
  const top = usePhotoTop(src);
  const shift = headAlignShift(top ?? null, { scale: CARD_PHOTO_SCALE, target: CARD_HEAD_TARGET });
  const centerVw = [16.667, 50, 83.333][index] ?? 50;
  if (!shown) return null;
  return (
    <div
      className="bf6-card-in absolute top-[9.6vh] h-[60.2vh] w-[28.125vw]"
      style={{
        left: `${centerVw - 14.0625}vw`,
        perspective: '1400px',
        ['--tilt' as string]: `${CARD_TILT[index] ?? 0}deg`,
      }}
    >
      <div className="bf6-card-float relative h-full w-full" style={{ animationDelay: `${-index * 1.7}s` }}>
        <div
          className="relative h-full w-full overflow-hidden rounded-md"
          style={{ boxShadow: '0 4vh 8vh rgba(0,0,0,0.75), 0 0 0 1px rgba(235,240,248,0.35)' }}
        >
          <div
            className="absolute inset-0"
            style={{ background: `radial-gradient(90% 45% at 50% 0%, ${color}33, transparent 70%), linear-gradient(165deg, #171a21 0%, #08090c 58%, #0e0f13 100%)` }}
          />
          <p className="absolute left-[1.15vw] top-[5.7vh] whitespace-nowrap text-[2.4vw] font-black italic leading-none tracking-[0.08em] text-transparent [-webkit-text-stroke:1.2px_rgba(252,211,77,0.75)] [writing-mode:vertical-rl]">
            CHAMPION BF6
          </p>
          <p className="absolute right-[1.04vw] top-[8.3vh] whitespace-nowrap text-[0.68vw] font-bold tracking-[0.5em] text-[rgba(220,228,240,0.55)] [writing-mode:vertical-rl]">
            BOOMER&apos;S FIGHT!!! VOL.6
          </p>
          {/* 写真。頭頂をそろえ、下と左右をぼかして溶かす */}
          <div className="absolute inset-0 [mask-composite:intersect] [mask-image:linear-gradient(to_bottom,#000_0%,#000_58%,transparent_90%),linear-gradient(to_right,transparent_0,#000_8%,#000_92%,transparent_100%)] [-webkit-mask-composite:source-in] [-webkit-mask-image:linear-gradient(to_bottom,#000_0%,#000_58%,transparent_90%),linear-gradient(to_right,transparent_0,#000_8%,#000_92%,transparent_100%)]">
            {src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt=""
                className="absolute left-0 top-0 h-auto w-full origin-top"
                style={{ transform: `translateY(${(shift * 100).toFixed(2)}%) scale(${CARD_PHOTO_SCALE})` }}
              />
            )}
          </div>
          <div className="absolute inset-[1.1vh] rounded-sm border border-[rgba(252,211,77,0.55)]" />
          <div className="absolute inset-x-0 top-0 h-[0.46vh]" style={{ background: color }} />
          <p className={`absolute inset-x-0 top-[2.4vh] whitespace-nowrap text-center text-[1.56vw] font-black tracking-[0.3em] ${theme.text}`}>
            {c.label}部門
          </p>
          <p
            className="bf6-name-in bf6-face bf6-chrome bf6-sheen absolute inset-x-0 top-[77.8%] break-words px-[0.6vw] text-center text-[5.2vw] font-black italic leading-none"
            data-text={c.dancerName || '—'}
          >
            {c.dancerName || '—'}
          </p>
          <p className="bf6-name-in absolute inset-x-0 top-[92%] text-center text-[1.15vw] font-black tracking-[0.5em] text-amber-300">
            WINNER
          </p>
          {/* 光の筋。ずっと横切り続ける */}
          <div className="bf6-card-sweep pointer-events-none absolute -top-[30%] h-[160%] w-[11.5vw] mix-blend-screen" style={{ animationDelay: `${0.35 * index}s` }} />
        </div>
      </div>
    </div>
  );
}

/**
 * 待機画面。クローム調のロゴだけを中央に置く(TARO 2026-09-14)。
 * 人物写真と日付の文字は出さない。背景は控えめな絵で、あとで動画に差し替える。
 * 差し替えるときは public/bf6/led-bg.mp4 を置いて video に変えるだけでよい。
 */
function Logo() {
  // ⚠️ Chromeはタブが裏に回ると動画を止める。操作卓で別タブに切り替えて戻したとき、
  //    ロゴが止まったまま固まって見えるのを防ぐ(TARO 2026-09-17の検証で判明)。
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const resume = () => { if (!document.hidden) void videoRef.current?.play().catch(() => undefined); };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, []);
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {/* ⚠️ 動画が出ないときの保険。上の動画が再生されればこれは見えない。
             ここにCSSのアニメは付けないこと(見えない裏で動かすとGPUを食う)。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/bf6/led-bg.png" alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_50%,transparent_35%,rgba(5,7,12,0.75)_100%)]" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/bf6/led-title.png" alt="BOOMER'S FIGHT!!! vol.6" className="relative w-[62vw] max-w-none" />

      {/* 待機中のロゴ。煙が流れ、クロムがときどき鈍く光る。継ぎ目が出ないよう
          末尾を頭に溶かし込んであるので、loop で回しっぱなしにできる(TARO 2026-09-17)。
          ⚠️ ロゴはこの動画に焼き込まれている。作り直すときは必ず公式素材から。 */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        src="/bf6/led-loop.mp4"
        poster="/bf6/led-loop-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />
    </div>
  );
}

/**
 * VSの背景。5秒の動画を1回再生し、終わったらゆっくり動かし続ける。
 * ⚠️ 止めたままにすると「ばしゃんと弾けて急にぴたっと止まる」ように見える(TARO実機 2026-09-14)。
 */
function VsBackground({ animKey }: { animKey: string }) {
  const [ended, setEnded] = useState(false);
  useEffect(() => setEnded(false), [animKey]);
  return (
    <>
      <video
        key={animKey}
        className={`absolute inset-0 h-full w-full object-cover ${ended ? 'bf6-bgdrift' : ''}`}
        src="/bf6/vs-bg.mp4"
        /* ⚠️ poster に最終フレームを使わないこと。再生前に明るい終わりの絵が出て、
              暗転してから再生が始まる不自然な順になる(TARO実機 2026-09-10)。
              先頭フレーム(ほぼ真っ黒)なら、そのまま自然に動画へつながる。 */
        poster="/bf6/vs-bg-first.jpg"
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={() => setEnded(true)}
      />
      {/* 動画が終わったあとに流す薄い靄。動画の上に重ねるだけで、読み込みは増えない */}
      {ended && <div className="bf6-haze pointer-events-none absolute inset-0" />}
    </>
  );
}

/** LEDに出す出場者の写真のURL。先読みと表示で必ず同じ文字列にする(頭頂の測定を使い回すため)。 */
function photoUrl(slotNo: number, division: string, photoAt?: string | null): string {
  return `/api/bf6/photo/${slotNo}?division=${division}&v=${encodeURIComponent(photoAt ?? '')}`;
}

/**
 * 写真ごとの頭頂の位置(画像の高さに対する割合)。一度測ったら覚えておく。
 * undefined = まだ測っていない / null = 測れなかった(ずらさない)。
 */
const photoTops = new Map<string, number | null>();
const photoTopWaiters = new Map<string, Array<(v: number | null) => void>>();

/**
 * 写真の頭頂を測る。ブラウザの中で1回だけ画素を読む(同じドメインから配信しているので読める)。
 * ⚠️ 毎フレームやる処理ではない。先読みのときに1回だけ。LED出力のPCに負荷をかけない。
 */
function measurePhotoTop(src: string): Promise<number | null> {
  if (photoTops.has(src)) return Promise.resolve(photoTops.get(src) ?? null);
  return new Promise((resolve) => {
    const waiting = photoTopWaiters.get(src);
    if (waiting) { waiting.push(resolve); return; }
    photoTopWaiters.set(src, [resolve]);
    const done = (v: number | null) => {
      photoTops.set(src, v);
      (photoTopWaiters.get(src) ?? []).forEach((f) => f(v));
      photoTopWaiters.delete(src);
    };
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = im.naturalWidth;
        c.height = im.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return done(null);
        ctx.drawImage(im, 0, 0);
        done(contentTopRatio(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height));
      } catch {
        done(null);
      }
    };
    im.onerror = () => done(null);
    im.src = src;
  });
}

function usePhotoTop(src: string | null): number | null | undefined {
  const [top, setTop] = useState<number | null | undefined>(() => (src && photoTops.has(src) ? photoTops.get(src) : undefined));
  useEffect(() => {
    if (!src) return;
    let alive = true;
    measurePhotoTop(src).then((v) => { if (alive) setTop(v); });
    return () => { alive = false; };
  }, [src]);
  return top;
}

function Side({ slot, division }: { slot?: Slot; corner: 'red' | 'blue'; division: string }) {
  // 背景を切り抜いた人物を大きく出す。切り抜き前提なので枠も丸マスクも付けない。
  // 写真が無い人は名前だけで成立する(全員ぶん集まらなくても破綻しない)。
  // ⚠️ 切り抜き写真に drop-shadow をかけないこと。大きな画像に効かせると
  //    登場アニメ中にカクつく(TARO実機 2026-09-10・影は不要とTARO判断)。
  // RED/BLUE の見出しは外した(TARO 2026-09-18)。赤青は背景動画の色で伝わる。
  const src = slot?.hasPhoto ? photoUrl(slot.slotNo, division, slot.photoAt) : null;
  const top = usePhotoTop(src);
  // 頭頂をそろえる。写真ごとに頭の位置が 18%〜35% とばらつくため(本番の写真で実測)。
  const shift = headAlignShift(top ?? null, { scale: VS_PHOTO_SCALE, target: VS_HEAD_TARGET });
  // 下のぼかし。見た目で枠の60%からぼけ始め、97%で消える(2人とも同じ高さで)
  const fade = photoFadeStops(shift, VS_PHOTO_SCALE, 0.6, 0.97);
  // 左右の端もぼかす。写真の端で切れた腕が縦の直線に見えないように(TARO実機 2026-09-18)。
  // 保存する写真は1.2:1(PHOTO_ASPECT)で、LEDで1人が使える幅とほぼ同じ。なので写真の端を
  // ぼかすと、内側は画面の中央(VSの裏)で、外側は画面の端で、手がふわっと消える(TARO 2026-09-19 ④案)。
  // 12% はLED上でおよそ画面幅の6%(約115px)。人物が端に触れていなければ端は透明なので何も起きない。
  // 下のぼかしと重ねて(intersect)掛ける。
  const mask =
    `linear-gradient(to bottom, #000 ${(fade.start * 100).toFixed(2)}%, transparent ${(fade.end * 100).toFixed(2)}%), ` +
    'linear-gradient(to right, transparent 0%, #000 12%, #000 88%, transparent 100%)';
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 写真の有無で名前の高さがずれないよう、枠は常に確保する。
          ⚠️ 高さは固定しない。名前/ジャンルを引いた残りを写真が受け持つことで、
             前景が上72%に収まることを配分で保証する(TARO 2026-09-17)。
          ⚠️ 写真は1.3倍に拡大するので枠の下へはみ出す。はみ出しは下に向かって
             ぼかして消す(写真1枚ずつのマスク・photoFadeStops)。切り抜き写真は人物が
             画像の下端まで続いていて、そのままだと胴体が一直線に切れて見える
             (本番の4枚すべて下端99.9%まで人物)。 */}
      <div className="flex min-h-0 flex-1 items-start justify-center">
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            className="bf6-cut max-h-full w-auto max-w-[46vw] origin-top object-contain object-top"
            style={{
              transform: `translateY(${(shift * 100).toFixed(2)}%) scale(${VS_PHOTO_SCALE})`,
              // ⚠️ ぼかしは写真1枚ずつに掛ける(枠全体に掛けると画面を横切る段差が出る)。
              //    .bf6-cut の固定のぼかしはここで上書きされる。
              maskImage: mask,
              WebkitMaskImage: mask,
              maskComposite: 'intersect',
              WebkitMaskComposite: 'source-in',
              // 頭頂を測り終えるまでは出さない(出してから動くと、頭がずれて見える)
              opacity: top === undefined ? 0 : 1,
            }}
          />
        )}
      </div>
      {slot?.dancerName ? (
        <p
          className="bf6-face bf6-chrome bf6-sheen relative -mt-[14vh] shrink-0 break-words text-[11vw] font-black italic leading-[0.92]"
          data-text={slot.dancerName}
        >
          {slot.dancerName}
        </p>
      ) : (
        <p className="relative -mt-[14vh] shrink-0 text-[3.6vw] font-black tracking-[0.3em] text-white/35">不戦勝</p>
      )}
      {/* 名前の下はジャンル。レペゼンより「何で戦う人か」が伝わる(TARO実機 2026-09-16)。
          ⚠️ 大文字にしたり綴りを揃えたりしない。本人が書いたまま出す。 */}
      {slot?.genre && (
        <p className="mt-[0.2vh] shrink-0 text-[2vw] font-bold tracking-[0.2em] text-white/60">{slot.genre}</p>
      )}
    </div>
  );
}

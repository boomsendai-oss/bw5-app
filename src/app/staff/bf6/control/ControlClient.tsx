'use client';
import { isByeMatch, isEmptyMatch } from '@/lib/bf6Bracket';

// 操作卓。手元には「いまLEDに映っているもの」のプレビューと操作UIの両方が見える。
// LED側には出力用の映像だけが行く(別機器で /bf6/screen を開いているため)。
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import {
  controlBattleStart,
  controlReflectBracket,
  controlResetBracket,
  controlSetMode,
  controlSetWinner,
  controlShowVs,
} from './actions';
import type { Bf6DrawDivision } from '@/lib/bf6Draw';
import type { Match, Round } from '@/lib/bf6Bracket';
import type { ScreenMode, ScreenState, SlotName } from '@/lib/bf6ScreenDb';

const DIVS: { key: Bf6DrawDivision; label: string }[] = [
  { key: 'beginner', label: 'ビギナー' },
  { key: 'kids', label: '小中学生' },
  { key: 'general', label: '一般' },
];
const MODES: { key: ScreenMode; label: string }[] = [
  { key: 'logo', label: 'ロゴ' },
  { key: 'bracket', label: 'トーナメント表' },
  { key: 'vs', label: 'VS' },
  // 配信できているかをLEDで確かめるためのボタン(TARO 2026-09-25「PCまで行くのがタイムロス」)
  { key: 'stream', label: '配信' },
];
// 結果発表のモード(ドラムロール・発表・記念撮影)。これらのボタンは「結果発表」を選んだときだけ出す
// (TARO 2026-09-23「普通のトーナメント表とかのところに常にドラムロールの画面を出すボタンがあると邪魔」)。
// 本番中に間違って押すとネタバレになるので、普段の画面からは見えないようにする。
const RESULT_MODES: ScreenMode[] = ['drumroll', 'champions', 'champion', 'runnerup'];
const MODE_LABEL: Record<string, string> = {
  logo: 'ロゴ', bracket: 'トーナメント表', vs: 'VS', stream: '配信', drumroll: 'ドラムロール', champions: '優勝者発表',
  champion: '記念撮影(優勝)', runnerup: '記念撮影(準優勝)',
};
const ROUND_LABEL: Record<string, string> = { r16: 'ベスト16', qf: 'ベスト8', sf: '準決勝', f: '決勝' };

export function ControlClient({
  initialState, matches, slots, nextMatch, draw, allowReset, bracketPending,
}: {
  initialState: ScreenState;
  matches: Match[];
  slots: Record<string, SlotName>;
  nextMatch: Match | null;
  /** その部門のトーナメント枠の数と、まだ誰も引いていない枠の数 */
  draw: { slots: number; undrawn: number };
  /** リセットを出すか。本番中の押し間違いを防ぐため、クルー画面では出さない */
  allowReset: boolean;
  /** トーナメント開始前(くじ引きの結果をそのまま出している)。ボタン処理中の pending とは別物 */
  bracketPending: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const s = initialState;
  const name = (slot: number | null) => (slot ? slots[String(slot)]?.dancerName || `${slot}番` : '—');
  // 読み方。TAROがMCを兼ねるので、画面を見ながら「◯◯ VS ◯◯」と読み上げられるようにする(TARO 2026-09-23)。
  // 操作卓だけに出す。名前がもともとカタカナで読み方と同じなら重ねて出さない
  const kana = (slot: number | null) => {
    if (!slot) return '';
    const sl = slots[String(slot)];
    return sl?.kana && sl.kana !== sl.dancerName ? sl.kana : '';
  };
  // 結果発表の操作を開いているか。LEDがロゴのままでも開いていられるよう、LEDのモードとは別に持つ
  const [resultsOpen, setResultsOpen] = useState(RESULT_MODES.includes(initialState.mode));
  // 決勝の勝者を押したときの確認(TARO 2026-09-23「本当に優勝は◯◯で間違いないですかって確認が出るとより良い」)
  const [confirmWinner, setConfirmWinner] = useState<{ round: Round; matchNo: number; slot: number } | null>(null);

  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  // 勝者を押す対象は「いまLEDに映っている試合」。任意の試合を出しているときに
  // 次の試合の勝者ボタンが出ると押し間違える(TARO実機 2026-09-10)。
  // いま出している試合。バトル中(背景に切り替えたあと)も覚えたままにする。
  const shown =
    s.round && s.matchNo
      ? matches.find((m) => m.round === s.round && m.matchNo === s.matchNo) ?? null
      : null;
  const target = shown ?? nextMatch;
  const targetIsShown = shown !== null;
  const vsNow = s.mode === 'vs' && shown !== null;
  const battling = s.mode === 'logo' && shown !== null;

  return (
    <div className="space-y-5">
      {/* いまLEDに映っているもの */}
      <div className="rounded-2xl border border-sand-300 bg-navy-900 p-4 text-white">
        <p className="text-xs font-bold tracking-widest text-sand-300">いまLEDに映っているもの</p>
        <p className="mt-1 text-xl font-black">
          {MODE_LABEL[s.mode] ?? s.mode}
          <span className="ml-2 text-sm font-bold text-sand-200">
            {DIVS.find((d) => d.key === s.division)?.label}部門
          </span>
        </p>
        <div className="mt-3 overflow-hidden rounded-xl border border-white/15" style={{ aspectRatio: '16 / 9' }}>
          <iframe src="/bf6/screen" title="LEDプレビュー" className="h-full w-full" />
        </div>
      </div>

      {s.mode === 'vs' && matches.length === 0 && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800 ring-1 ring-amber-300">
          VSモードですが、この部門のトーナメントがまだありません。
          映す試合が無いときLEDにはロゴが出ます(観客に崩れた画面を見せないため)。
          最初のVSを出すと自動でトーナメントが作られます。
        </p>
      )}

      {/* モード切替(常時自由) */}
      <div>
        <p className="text-xs font-bold text-neutral-500">画面モード</p>
        <div className="mt-2 flex gap-2">
          {MODES.map((m) => (
            <button
              key={m.key}
              disabled={pending}
              onClick={() => { setResultsOpen(false); run(() => controlSetMode(m.key)); }}
              className={`flex-1 rounded-xl py-4 text-sm font-black disabled:opacity-50 ${
                !resultsOpen && s.mode === m.key ? 'bg-brand-600 text-white' : 'bg-sand-100 text-neutral-700'
              }`}
            >
              {m.label}
            </button>
          ))}
          {/* 結果発表を選んだ直後はロゴ動画を出す(TARO 2026-09-23)。ここから先の操作は下に出る */}
          <button
            disabled={pending}
            onClick={() => { setResultsOpen(true); if (!RESULT_MODES.includes(s.mode)) run(() => controlSetMode('logo')); }}
            className={`flex-1 rounded-xl py-4 text-sm font-black disabled:opacity-50 ${
              resultsOpen ? 'bg-amber-500 text-white' : 'bg-sand-100 text-neutral-700'
            }`}
          >
            結果発表
          </button>
        </div>
      </div>

      {/* 部門切替(常時自由) */}
      <div>
        <p className="text-xs font-bold text-neutral-500">部門</p>
        <div className="mt-2 flex gap-2">
          {DIVS.map((d) => (
            <button
              key={d.key}
              disabled={pending}
              onClick={() => run(() => controlSetMode(s.mode, d.key))}
              className={`flex-1 rounded-xl py-4 text-sm font-black disabled:opacity-50 ${
                s.division === d.key ? 'bg-navy-900 text-white' : 'bg-sand-100 text-neutral-700'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* 最後の結果発表。決勝の勝者を入れてもLEDには出ないので、
          表彰のタイミングでここから出す(TARO 2026-09-16)。「結果発表」を選んだときだけ出す */}
      {/* ⚠️ 開閉は hidden で切り替え、要素を消さない。押した瞬間に要素を消すと、同時に走る
          router.refresh の再描画とぶつかって React が removeChild で落ち、ボタンが無効のまま固まった
          (2026-09-23 手元で再現。[[revalidatepath-crashes-mid-transition]] と同じ症状) */}
      <div className={`rounded-2xl border border-amber-300 bg-amber-50 p-4 ${resultsOpen ? '' : 'hidden'}`}>
        <p className="text-xs font-black tracking-widest text-amber-800">結果発表</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-900">
          3部門とも決勝の勝者を入れ終わってから使います。ロゴ → ①ドラムロールの間に「TODAY&apos;S CHAMPION IS…」→
          ②「ジャーン」で発表 → 記念撮影の順です(TARO 2026-09-22)。
        </p>
        <button
          disabled={pending}
          onClick={() => run(() => controlSetMode('logo'))}
          className={`mt-3 w-full rounded-xl py-3 text-sm font-black disabled:opacity-50 ${
            s.mode === 'logo' ? 'bg-amber-600 text-white' : 'bg-white text-amber-800 ring-1 ring-amber-400'
          }`}
        >
          {s.mode === 'logo' ? 'ロゴ動画を映しています' : 'ロゴ動画に戻す'}
        </button>
        <button
          disabled={pending}
          onClick={() => run(() => controlSetMode('drumroll'))}
          className={`mt-2 w-full rounded-xl py-4 text-base font-black disabled:opacity-50 ${
            s.mode === 'drumroll' ? 'bg-amber-600 text-white' : 'bg-white text-amber-800 ring-2 ring-amber-500 active:scale-95'
          }`}
        >
          {s.mode === 'drumroll' ? '① ドラムロール画面を映しています' : '① ドラムロール画面を出す'}
        </button>
        <button
          disabled={pending}
          onClick={() => run(() => controlSetMode('champions'))}
          className={`mt-2 w-full rounded-xl py-5 text-lg font-black disabled:opacity-50 ${
            s.mode === 'champions' ? 'bg-amber-600 text-white' : 'bg-amber-500 text-white active:scale-95'
          }`}
        >
          {s.mode === 'champions' ? '優勝者を映しています' : '② 優勝者を発表する(3部門)'}
        </button>
        {/* 記念撮影用(TARO 2026-09-22)。1人ずつ撮るとき、その人のカードを後ろに大きく出す。
            準優勝も撮る(TARO 2026-09-23)。準優勝は銀のカード・銀のスポットライトで、優勝と差をつける */}
        <p className="mt-4 text-xs font-black tracking-widest text-amber-800">記念撮影(1人ずつ・カードを大きく)</p>
        {([
          { mode: 'champion' as const, label: '優勝', on: 'bg-amber-600 text-white', off: 'bg-white text-amber-800 ring-1 ring-amber-400' },
          { mode: 'runnerup' as const, label: '準優勝', on: 'bg-slate-600 text-white', off: 'bg-white text-slate-700 ring-1 ring-slate-400' },
        ]).map((t) => (
          <div key={t.mode} className="mt-2 flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs font-black text-neutral-600">{t.label}</span>
            {DIVS.map((d) => (
              <button
                key={d.key}
                disabled={pending}
                onClick={() => run(() => controlSetMode(t.mode, d.key))}
                className={`flex-1 rounded-xl py-3 text-sm font-black disabled:opacity-50 ${
                  s.mode === t.mode && s.division === d.key ? t.on : t.off
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* 通常運転: 次の試合 → VS表示 → 勝者タップ。結果発表を開いている間は隠す(要素は消さない) */}
      <div className={`rounded-2xl border-2 border-brand-500 bg-white p-4 ${resultsOpen ? 'hidden' : ''}`}>
        {target ? (
          <>
            <p className="text-xs font-bold tracking-widest text-brand-600">
              {battling ? 'バトル中' : targetIsShown ? 'いまLEDに出ている試合' : '次の試合'} —{' '}
              {ROUND_LABEL[target.round] ?? target.round} 第{target.matchNo}試合
            </p>
            <p className="mt-2 text-center text-lg font-black text-navy-900">
              {name(target.slotA)}
              {kana(target.slotA) && <span className="text-sm font-bold text-neutral-500">（{kana(target.slotA)}）</span>}
              <span className="mx-2 text-brand-600">VS</span>
              {name(target.slotB)}
              {kana(target.slotB) && <span className="text-sm font-bold text-neutral-500">（{kana(target.slotB)}）</span>}
            </p>
            {!targetIsShown && (
              <button
                disabled={pending}
                onClick={() => run(() => controlShowVs(target.round, target.matchNo))}
                className="mt-3 w-full rounded-xl bg-brand-600 py-4 font-black text-white disabled:opacity-50"
              >
                この試合のVS画面を出す
              </button>
            )}
            {/* 呼び込み中はVS、バトル中は背景(TARO 2026-09-14) */}
            {vsNow && (
              <button
                disabled={pending}
                onClick={() => run(() => controlBattleStart())}
                className="mt-3 w-full rounded-xl bg-navy-900 py-5 text-lg font-black text-white disabled:opacity-50"
              >
                バトルスタート(背景に切り替える)
              </button>
            )}
            {battling && (
              <div className="mt-3 flex gap-2">
                <p className="flex-1 rounded-xl bg-navy-900 px-3 py-3 text-center text-sm font-black text-white">
                  バトル中(LEDは背景)
                </p>
                <button
                  disabled={pending}
                  onClick={() => run(() => controlShowVs(target.round, target.matchNo))}
                  className="rounded-xl border border-sand-300 px-4 py-3 text-sm font-bold text-navy-800 disabled:opacity-50"
                >
                  VSに戻す
                </button>
              </div>
            )}
            {target.winnerSlot && (
              <p className="mt-3 rounded-lg bg-sand-100 px-3 py-2 text-center text-xs font-bold text-neutral-600">
                この試合は {name(target.winnerSlot)} の勝ちで確定済みです
              </p>
            )}
            <p className="mt-4 text-xs font-bold text-neutral-500">勝者をタップ</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[target.slotA, target.slotB].map((slot) =>
                slot ? (
                  <button
                    key={slot}
                    disabled={pending}
                    onClick={() => {
                      // 決勝だけは確認を挟む。優勝がそのまま表彰で発表されるため
                      if (target.round === 'f') setConfirmWinner({ round: 'f', matchNo: target.matchNo, slot });
                      else run(() => controlSetWinner(s.division, target.round as Round, target.matchNo, slot));
                    }}
                    className="rounded-xl bg-navy-900 py-5 text-base font-black text-white disabled:opacity-50"
                  >
                    {name(slot)}
                    {kana(slot) && <span className="block text-xs font-bold text-sand-200">（{kana(slot)}）</span>}
                  </button>
                ) : (
                  <span key="bye" className="rounded-xl bg-sand-100 py-5 text-center text-sm font-bold text-neutral-400">
                    不戦勝
                  </span>
                )
              )}
            </div>
          </>
        ) : (
          <div className="text-center">
            <p className="text-sm font-bold text-neutral-500">
              {bracketPending
                ? 'まだ対戦がそろっていません。くじを引くと自動で表に入ります'
                : 'この部門は全試合終了しました'}
            </p>
          </div>
        )}
      </div>


      {/* 手動で任意の試合を出す */}
      {matches.length > 0 && (
        <details className={`rounded-2xl border border-sand-300 bg-white p-4 ${resultsOpen ? 'hidden' : ''}`}>
          <summary className="cursor-pointer text-sm font-bold text-navy-900">
            任意の試合を出す(順番を飛ばす・戻す)
          </summary>
          {matches.some((m) => isByeMatch(m) || isEmptyMatch(m)) && (
            <p className="mt-2 text-[11px] text-neutral-500">
              不戦勝(相手がいない試合)はVSを出さず自動で上がるので、ここには出しません。
            </p>
          )}
          <div className="mt-3 space-y-2">
            {matches.filter((m) => !isByeMatch(m) && !isEmptyMatch(m)).map((m) => (
              <div key={`${m.round}-${m.matchNo}`} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-[11px] font-bold text-neutral-500">
                  {ROUND_LABEL[m.round] ?? m.round}#{m.matchNo}
                </span>
                <span className="flex-1 truncate text-xs text-neutral-700">
                  {name(m.slotA)}{kana(m.slotA) && `（${kana(m.slotA)}）`} vs {name(m.slotB)}{kana(m.slotB) && `（${kana(m.slotB)}）`}
                  {m.winnerSlot && <span className="ml-1 font-bold text-brand-600">→ {name(m.winnerSlot)}</span>}
                </span>
                <button
                  disabled={pending}
                  onClick={() => run(() => controlShowVs(m.round, m.matchNo))}
                  className="rounded-lg bg-sand-100 px-3 py-2 text-[11px] font-black text-neutral-700 disabled:opacity-50"
                >
                  VS表示
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* くじ引きの結果は自動で反映する。ボタンは押さない(TARO 2026-09-11) */}
      <div className="rounded-2xl border border-sand-300 bg-white p-4">
        <p className="text-sm font-black text-navy-900">
          くじ引きの結果 <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">自動で反映</span>
        </p>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
          {bracketPending
            ? 'トーナメント開始前です。くじを引くたびにLEDの表へ自動で名前が入ります。最初のVS画面を出した時点で、まだ引いていない枠は不戦勝になります。'
            : '開始後に遅れて誰かがくじを引いても、その人の試合がまだなら自動で対戦に戻ります。'}
        </p>
        <p className="mt-2 text-xs font-bold tabular-nums text-navy-800">
          {draw.slots === 0
            ? 'この部門のトーナメント枠はまだありません'
            : draw.undrawn === 0
              ? `${draw.slots}枠すべて引き終わっています`
              : `${draw.slots}枠のうち、まだ引いていない枠 ${draw.undrawn}枠`}
        </p>
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] font-bold text-neutral-400">自動で反映されないとき</summary>
          <button
            disabled={pending || bracketPending || draw.slots === 0}
            onClick={() =>
              run(async () => {
                const r = await controlReflectBracket(s.division);
                if (!r.ok) setMsg(r.reason);
                else if (r.changed === 0) setMsg('変わったところはありません');
                else setMsg(`${r.changed}試合を反映しました`);
              })
            }
            className="mt-2 w-full rounded-xl border border-navy-900 py-2.5 text-xs font-black text-navy-900 disabled:opacity-40"
          >
            今すぐ反映する(開始後のみ)
          </button>
        </details>
        {msg && <p className="mt-3 text-xs font-bold text-brand-700">{msg}</p>}
      </div>

      {allowReset && matches.length > 0 && (
        <details className="rounded-2xl border border-red-200 bg-white p-4">
          <summary className="cursor-pointer text-xs font-bold text-neutral-400">
            開発・テスト用: この部門をリセット
          </summary>
          <p className="mt-2 text-xs text-neutral-500">
            この部門の試合結果と組み合わせをすべて消します。くじ引きの結果(枠の割当)は残ります。
            本番中は使いません。
          </p>
          <button
            disabled={pending}
            onClick={() => {
              const label = DIVS.find((d) => d.key === s.division)?.label;
              const word = prompt(`${label}部門の試合結果を全部消します。本当に消す場合は「リセット」と入力してください`);
              if (word !== 'リセット') return;
              run(async () => {
                const r = await controlResetBracket(s.division, word);
                setMsg(r.ok ? 'リセットしました' : 'リセットしませんでした');
              });
            }}
            className="mt-3 w-full rounded-xl bg-red-600 py-3 text-sm font-black text-white disabled:opacity-50"
          >
            この部門をリセット
          </button>
        </details>
      )}

      {/* ⚠️ body 直下に出す。画面側の親要素に transform 等があると fixed が画面基準にならず、
          確認が画面の下にはみ出して見えなかった(2026-09-23 スマホ幅で確認) */}
      {confirmWinner && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-xl">
            <p className="text-xs font-bold tracking-widest text-neutral-500">
              {DIVS.find((d) => d.key === s.division)?.label}部門 決勝
            </p>
            <p className="mt-3 text-base font-bold text-navy-900">本当に優勝は</p>
            <p className="mt-1 text-2xl font-black text-navy-900">
              {name(confirmWinner.slot)}
              {kana(confirmWinner.slot) && <span className="block text-sm font-bold text-neutral-500">（{kana(confirmWinner.slot)}）</span>}
            </p>
            <p className="mt-1 text-base font-bold text-navy-900">で間違いないですか？</p>
            <p className="mt-2 text-[11px] text-neutral-500">LEDには出ません。結果発表で出ます。</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => setConfirmWinner(null)}
                className="rounded-xl border border-sand-300 bg-white py-4 text-base font-black text-neutral-700"
              >
                いいえ
              </button>
              <button
                disabled={pending}
                onClick={() => {
                  const w = confirmWinner;
                  setConfirmWinner(null);
                  run(() => controlSetWinner(s.division, w.round, w.matchNo, w.slot));
                }}
                className="rounded-xl bg-brand-600 py-4 text-base font-black text-white disabled:opacity-50"
              >
                はい
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

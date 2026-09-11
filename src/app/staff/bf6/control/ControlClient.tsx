'use client';
import { isByeMatch, isEmptyMatch } from '@/lib/bf6Bracket';

// 操作卓。手元には「いまLEDに映っているもの」のプレビューと操作UIの両方が見える。
// LED側には出力用の映像だけが行く(別機器で /bf6/screen を開いているため)。
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { controlReflectBracket, controlResetBracket, controlSetMode, controlSetWinner, controlShowVs } from './actions';
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
];
const ROUND_LABEL: Record<string, string> = { r16: 'ベスト16', qf: 'ベスト8', sf: '準決勝', f: '決勝' };

export function ControlClient({
  initialState, matches, slots, nextMatch, draw, allowReset,
}: {
  initialState: ScreenState;
  matches: Match[];
  slots: Record<string, SlotName>;
  nextMatch: Match | null;
  /** その部門のトーナメント枠の数と、まだ誰も引いていない枠の数 */
  draw: { slots: number; undrawn: number };
  /** リセットを出すか。本番中の押し間違いを防ぐため、クルー画面では出さない */
  allowReset: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const s = initialState;
  const name = (slot: number | null) => (slot ? slots[String(slot)]?.dancerName || `${slot}番` : '—');

  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  // 勝者を押す対象は「いまLEDに映っている試合」。任意の試合を出しているときに
  // 次の試合の勝者ボタンが出ると押し間違える(TARO実機 2026-09-10)。
  const shown =
    s.mode === 'vs' && s.round && s.matchNo
      ? matches.find((m) => m.round === s.round && m.matchNo === s.matchNo) ?? null
      : null;
  const target = shown ?? nextMatch;
  const targetIsShown = shown !== null;

  return (
    <div className="space-y-5">
      {/* いまLEDに映っているもの */}
      <div className="rounded-2xl border border-sand-300 bg-navy-900 p-4 text-white">
        <p className="text-xs font-bold tracking-widest text-sand-300">いまLEDに映っているもの</p>
        <p className="mt-1 text-xl font-black">
          {MODES.find((m) => m.key === s.mode)?.label}
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
          下の「くじ引きの結果を反映する」を押してください。
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
              onClick={() => run(() => controlSetMode(m.key))}
              className={`flex-1 rounded-xl py-4 text-sm font-black disabled:opacity-50 ${
                s.mode === m.key ? 'bg-brand-600 text-white' : 'bg-sand-100 text-neutral-700'
              }`}
            >
              {m.label}
            </button>
          ))}
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

      {/* 通常運転: 次の試合 → VS表示 → 勝者タップ */}
      <div className="rounded-2xl border-2 border-brand-500 bg-white p-4">
        {target ? (
          <>
            <p className="text-xs font-bold tracking-widest text-brand-600">
              {targetIsShown ? 'いまLEDに出ている試合' : '次の試合'} — {ROUND_LABEL[target.round] ?? target.round} 第{target.matchNo}試合
            </p>
            <p className="mt-2 text-center text-lg font-black text-navy-900">
              {name(target.slotA)} <span className="mx-2 text-brand-600">VS</span> {name(target.slotB)}
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
                    onClick={() => run(() => controlSetWinner(s.division, target.round as Round, target.matchNo, slot))}
                    className="rounded-xl bg-navy-900 py-5 text-base font-black text-white disabled:opacity-50"
                  >
                    {name(slot)}
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
              {matches.length === 0
                ? 'トーナメントがまだありません。下の「くじ引きの結果を反映する」を押してください'
                : 'この部門は全試合終了しました'}
            </p>
          </div>
        )}
      </div>

      {/* 手動で任意の試合を出す */}
      {matches.length > 0 && (
        <details className="rounded-2xl border border-sand-300 bg-white p-4">
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
                  {name(m.slotA)} vs {name(m.slotB)}
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

      {/* くじ引きの結果を反映する。試合前なら何度押してもよい(TARO 2026-09-11) */}
      <div className="rounded-2xl border border-sand-300 bg-white p-4">
        <p className="text-sm font-black text-navy-900">くじ引きの結果をトーナメントに反映</p>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
          {draw.slots === 0
            ? 'この部門のトーナメント枠はまだありません。'
            : draw.undrawn === 0
              ? `${draw.slots}枠すべて引き終わっています。`
              : `${draw.slots}枠のうち、まだ引いていない枠が ${draw.undrawn} つあります。反映するとその相手は不戦勝で上がります。`}
          あとから引いた人がいても、その人の試合がまだならもう一度押せば対戦に戻ります。
        </p>
        <button
          disabled={pending || draw.slots === 0}
          onClick={() => {
            if (
              draw.undrawn > 0 &&
              !confirm(`まだ引いていない枠が ${draw.undrawn} つあります。その相手は不戦勝になります。反映しますか?`)
            ) {
              return;
            }
            run(async () => {
              const r = await controlReflectBracket(s.division);
              if (!r.ok) setMsg(r.reason);
              else if (r.changed === 0) setMsg('変わったところはありません');
              else setMsg(`${r.changed}試合を反映しました`);
            });
          }}
          className="mt-3 w-full rounded-xl bg-navy-900 py-4 font-black text-white disabled:opacity-50"
        >
          くじ引きの結果を反映する
        </button>
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
    </div>
  );
}

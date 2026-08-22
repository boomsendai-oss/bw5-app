'use client';

// 操作卓。手元には「いまLEDに映っているもの」のプレビューと操作UIの両方が見える。
// LED側には出力用の映像だけが行く(別機器で /bf6/screen を開いているため)。
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { controlResetBracket, controlSeedBracket, controlSetMode, controlSetWinner, controlShowVs } from './actions';
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
  initialState, matches, slots, nextMatch,
}: {
  initialState: ScreenState;
  matches: Match[];
  slots: Record<string, SlotName>;
  nextMatch: Match | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const s = initialState;
  const name = (slot: number | null) => (slot ? slots[String(slot)]?.dancerName || `${slot}番` : '—');

  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

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
          下の「くじ引きの結果からトーナメントを作る」を押してください。
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
        {nextMatch ? (
          <>
            <p className="text-xs font-bold tracking-widest text-brand-600">
              次の試合 — {ROUND_LABEL[nextMatch.round] ?? nextMatch.round} 第{nextMatch.matchNo}試合
            </p>
            <p className="mt-2 text-center text-lg font-black text-navy-900">
              {name(nextMatch.slotA)} <span className="mx-2 text-brand-600">VS</span> {name(nextMatch.slotB)}
            </p>
            <button
              disabled={pending}
              onClick={() => run(() => controlShowVs(nextMatch.round, nextMatch.matchNo))}
              className="mt-3 w-full rounded-xl bg-brand-600 py-4 font-black text-white disabled:opacity-50"
            >
              この試合のVS画面を出す
            </button>
            <p className="mt-4 text-xs font-bold text-neutral-500">勝者をタップ</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[nextMatch.slotA, nextMatch.slotB].map((slot) =>
                slot ? (
                  <button
                    key={slot}
                    disabled={pending}
                    onClick={() => run(() => controlSetWinner(s.division, nextMatch.round as Round, nextMatch.matchNo, slot))}
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
              {matches.length === 0 ? 'トーナメントが未作成です' : 'この部門は全試合終了しました'}
            </p>
            {matches.length === 0 && (
              <button
                disabled={pending}
                onClick={() => run(async () => {
                  const r = await controlSeedBracket(s.division);
                  setMsg(r.created > 0 ? `${r.created}試合を作成しました` : 'くじ引きが未実施です(先に受付でトーナメント枠を引いてください)');
                })}
                className="mt-3 w-full rounded-xl bg-navy-900 py-4 font-black text-white disabled:opacity-50"
              >
                くじ引きの結果からトーナメントを作る
              </button>
            )}
            {msg && <p className="mt-3 text-xs font-bold text-brand-700">{msg}</p>}
          </div>
        )}
      </div>

      {matches.length > 0 && (
        <details className="rounded-2xl border border-sand-300 bg-white p-4">
          <summary className="cursor-pointer text-xs font-bold text-neutral-400">トーナメントをリセット</summary>
          <p className="mt-2 text-xs text-neutral-500">
            この部門の試合結果と組み合わせを消します。くじ引きの結果(枠の割当)は残ります。
            練習で動かしたあと、本番前に一度押してください。
          </p>
          <button
            disabled={pending}
            onClick={() => { if (confirm(`${DIVS.find((d) => d.key === s.division)?.label}部門の試合結果を消します。よろしいですか?`)) run(() => controlResetBracket(s.division)); }}
            className="mt-3 w-full rounded-xl bg-red-600 py-3 text-sm font-black text-white disabled:opacity-50"
          >
            この部門をリセット
          </button>
        </details>
      )}

      {/* 手動で任意の試合を出す */}
      {matches.length > 0 && (
        <details className="rounded-2xl border border-sand-300 bg-white p-4">
          <summary className="cursor-pointer text-sm font-bold text-navy-900">
            任意の試合を出す(順番を飛ばす・戻す)
          </summary>
          <div className="mt-3 space-y-2">
            {matches.map((m) => (
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
    </div>
  );
}

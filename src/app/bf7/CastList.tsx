// DETAIL の「JUDGE / DJ / MC」。
// 審査員3人は同じ大きさで横に並べる(マイナビDANCEALIVE・Red Bull BC One と同じく、ゲストも同じ形。TARO 2026-11-27)。
// 目玉のHIROさんはページ上の大きい紹介枠で見せるので、ここでは差をつけない(小さな印だけ)。
// 紹介文・戦績は下の「プロフィールを見る」で開く。DJ・MCは同じ形で次の行に並べる。
// 中身は src/lib/bf7Cast.ts。公開するかどうかは page.tsx 側(BF7_CAST_ANNOUNCED / 下見)で決める。
import { BF7_CREW, BF7_JUDGES, type Bf7CastMember } from '@/lib/bf7Cast';

function Tile({ m, label }: { m: Bf7CastMember; label: string }) {
  return (
    <div className="overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-neutral-700">
      <div className="relative">
        {m.photo ? (
          /* eslint-disable-next-line @next/next/no-img-element -- 本人提供の静的画像 */
          <img
            src={m.photo}
            alt={m.name}
            className={`aspect-square w-full object-cover object-top ${m.cutout ? 'bg-gradient-to-b from-sky-900/50 via-neutral-900 to-neutral-950' : ''}`}
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-gradient-to-b from-neutral-800 to-neutral-950">
            <span className="text-[10px] font-black tracking-[0.2em] text-neutral-500">PHOTO SOON</span>
          </div>
        )}
        {m.badge && (
          <span className="absolute bottom-1.5 left-1.5 rounded bg-sky-500 px-1.5 py-0.5 text-[8px] font-black tracking-[0.12em] text-white">
            GUEST
          </span>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-[10px] font-bold tracking-widest text-sky-400">{label}</p>
        <p className="mt-0.5 whitespace-nowrap text-[13px] font-black italic leading-tight text-white">{m.name}</p>
        {m.team && <p className="mt-0.5 text-[10px] font-bold leading-snug text-neutral-400">{m.team}</p>}
        {m.meta && <p className="text-[10px] font-bold tracking-wide text-neutral-500">{m.meta}</p>}
      </div>
    </div>
  );
}

export default function Bf7CastList() {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {BF7_JUDGES.map((m) => (
          <Tile key={m.name} m={m} label="JUDGE" />
        ))}
      </div>

      <details className="mt-2 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2">
        <summary className="cursor-pointer text-center text-xs font-black text-sky-300">審査員のプロフィールを見る ▾</summary>
        <div className="mt-2 divide-y divide-neutral-800">
          {BF7_JUDGES.map((m) => (
            <div key={m.name} className="py-3">
              <p className="text-base font-black italic text-white">
                {m.name}
                {m.badge && <span className="ml-2 text-[10px] font-black not-italic tracking-[0.15em] text-sky-300">{m.badge}</span>}
              </p>
              <p className="text-[11px] font-bold text-neutral-400">
                {[m.team, m.meta].filter(Boolean).join(' ・ ')}
              </p>
              {m.bio && <p className="mt-1.5 text-xs leading-relaxed text-neutral-300">{m.bio}</p>}
              {m.records && m.records.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-neutral-400">
                  {m.records.map((r) => (
                    <li key={r}>・{r}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </details>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {BF7_CREW.map((m) => (
          <Tile key={`${m.role}-${m.name}`} m={m} label={m.role} />
        ))}
      </div>
    </div>
  );
}

// DETAIL の「JUDGE / DJ / MC」。並べ方はvol.6のジャッジ欄と同じで、赤→青。
//   審査員=同じ形の大きいカード(横長写真)を縦に3枚。HIROさんだけ SPECIAL GUEST の印と青い縁
//   DJ・MC=小さい正方形カードを横に並べる
// 中身は src/lib/bf7Cast.ts。公開するかどうかは page.tsx 側(BF7_CAST_ANNOUNCED / 下見)で決める。
import { BF7_CREW, BF7_JUDGES, type Bf7CastMember } from '@/lib/bf7Cast';

const cutoutBg = 'bg-gradient-to-b from-sky-900/60 via-neutral-900 to-neutral-950';

function JudgeCard({ m }: { m: Bf7CastMember }) {
  const special = Boolean(m.badge);
  return (
    <div
      className={`overflow-hidden rounded-xl bg-neutral-900 ${special ? 'ring-2 ring-sky-400/70 shadow-lg shadow-sky-900/40' : 'ring-1 ring-neutral-700'}`}
    >
      <div className={`relative ${m.cutout ? cutoutBg : ''}`}>
        {m.photo ? (
          /* eslint-disable-next-line @next/next/no-img-element -- 本人提供の静的画像 */
          <img
            src={m.photo}
            alt={m.name}
            className={`aspect-[3/2] w-full ${m.cutout ? 'object-contain object-bottom pt-3' : 'object-cover object-top'}`}
          />
        ) : (
          <div className="aspect-[3/2] w-full bg-neutral-800" />
        )}
        {special && (
          <span className="absolute left-3 top-3 rounded-md bg-sky-500 px-2 py-1 text-[10px] font-black tracking-[0.18em] text-white shadow">
            {m.badge}
          </span>
        )}
      </div>
      <div className="p-4">
        <p className="text-[11px] font-bold tracking-widest text-sky-400">{special ? `${m.badge} JUDGE` : m.role}</p>
        <p className="mt-1 text-2xl font-black italic text-white">{m.name}</p>
        {m.team && <p className="text-xs font-bold text-neutral-400">{m.team}</p>}
        {m.meta && <p className="text-[11px] font-bold tracking-wide text-neutral-500">{m.meta}</p>}
        {m.bio && <p className="mt-2 text-xs leading-relaxed text-neutral-300">{m.bio}</p>}
        {m.records && m.records.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] font-bold text-sky-300">主な戦績を見る ▾</summary>
            <ul className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-neutral-400">
              {m.records.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function CrewCard({ m }: { m: Bf7CastMember }) {
  return (
    <div className="overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-neutral-700">
      {m.photo ? (
        /* eslint-disable-next-line @next/next/no-img-element -- 本人提供の静的画像 */
        <img
          src={m.photo}
          alt={m.name}
          className={`aspect-square w-full object-cover object-top ${m.cutout ? 'bg-gradient-to-b from-neutral-800 to-neutral-950' : ''}`}
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-gradient-to-b from-neutral-800 to-neutral-950">
          <span className="text-[10px] font-black tracking-[0.2em] text-neutral-500">PHOTO SOON</span>
        </div>
      )}
      <div className="p-2.5">
        <p className="text-[10px] font-bold tracking-widest text-sky-400">{m.role}</p>
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
      <div className="space-y-2">
        {BF7_JUDGES.map((m) => (
          <JudgeCard key={m.name} m={m} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {BF7_CREW.map((m) => (
          <CrewCard key={`${m.role}-${m.name}`} m={m} />
        ))}
      </div>
    </div>
  );
}

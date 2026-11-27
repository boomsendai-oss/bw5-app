// DETAIL の「JUDGE / DJ / MC」に並べるカード。作りはvol.6のジャッジ欄と同じで、赤→青。
// 中身は src/lib/bf7Cast.ts。公開するかどうかは page.tsx 側(BF7_CAST_ANNOUNCED / 下見)で決める。
import { BF7_CAST, type Bf7CastMember } from '@/lib/bf7Cast';
import { ComingSoon } from './ui';

function CastCard({ m }: { m: Bf7CastMember }) {
  return (
    <div className="overflow-hidden rounded-xl bg-neutral-900 p-4 ring-1 ring-neutral-700">
      <div className="flex items-start gap-3">
      {m.photo && (
        /* eslint-disable-next-line @next/next/no-img-element -- 本人提供の静的画像 */
        <img src={m.photo} alt={m.name} className="h-24 w-24 shrink-0 rounded-lg object-cover ring-1 ring-sky-500/30 bg-gradient-to-b from-neutral-800 to-neutral-950 object-top" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold tracking-widest text-sky-400">{m.role}</p>
        <p className="mt-1 text-2xl font-black italic text-white">{m.name}</p>
        {m.team && <p className="text-xs font-bold text-neutral-400">{m.team}</p>}
        {m.meta && <p className="text-[11px] font-bold tracking-wide text-neutral-500">{m.meta}</p>}
      </div>
      </div>
        {m.bio &&<p className="mt-2 text-xs leading-relaxed text-neutral-300">{m.bio}</p>}
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
  );
}

export default function Bf7CastList() {
  const hasMc = BF7_CAST.some((m) => m.role === 'MC');
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-sky-500/35 bg-sky-500/10 px-4 py-3">
        <p className="text-[11px] font-bold tracking-widest text-sky-300">SPECIAL GUEST JUDGE</p>
        <p className="mt-1 text-lg font-black italic text-white">
          HIRO <span className="text-xs font-bold not-italic text-neutral-300">MIDDLE FILTER / 大阪</span>
        </p>
      </div>
      {BF7_CAST.map((m) => (
        <CastCard key={`${m.role}-${m.name}`} m={m} />
      ))}
      {!hasMc && (
        <div className="pt-1">
          <p className="text-[11px] font-bold tracking-widest text-sky-400">MC</p>
          <ComingSoon note="MCは決まり次第お知らせします。" />
        </div>
      )}
    </div>
  );
}

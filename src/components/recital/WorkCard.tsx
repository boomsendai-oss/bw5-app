'use client';

// BW6 申込フォーム 画面3 の作品のカード（04 4-2 画面3の決まり）。
// 名前・クラス・曜日と時間と会場・担当イントラ・対象（太字）・注意書き（あれば1行）・別料金なら横に金額。
// えらぶのは「出る」「まだ迷っている」「出ない」（初めは「出ない」）。準備中（draft）はえらべない。
// disabled＝1人の上限に達した時。「出る」「まだ迷っている」だけを押せなくする（「出ない」には戻せる）。
import type { PublicWork } from '@/lib/recitalFamilyDb';
import { yenJa } from '@/lib/recitalPublic';

type Choice = 'in' | 'maybe' | 'out';

const CHOICES: { v: Choice; label: string }[] = [
  { v: 'in', label: '出る' },
  { v: 'maybe', label: 'まだ迷っている' },
  { v: 'out', label: '出ない' },
];

export function WorkCard({
  work,
  value,
  onChange,
  disabled,
}: {
  work: PublicWork;
  value: Choice;
  onChange: (v: Choice) => void;
  disabled: boolean;
}) {
  const isDraft = work.status === 'draft';
  const selected = value !== 'out';
  return (
    <div className={`rounded-xl border bg-white p-4 text-navy-700 ${selected ? 'border-brand-600 ring-1 ring-brand-600' : 'border-sand-300'}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-bold leading-snug">{work.title}</p>
        {work.feeType === 'extra' && work.extraFee != null && (
          <span className="shrink-0 rounded-md bg-sand-100 px-2 py-1 text-xs font-bold text-navy-700">別料金 {yenJa(work.extraFee)}</span>
        )}
      </div>
      <dl className="mt-2 space-y-1 text-sm">
        {work.classLabel && <div><dt className="sr-only">クラス</dt><dd>{work.classLabel}</dd></div>}
        {work.slotLabel && <div><dt className="sr-only">曜日と時間と会場</dt><dd>{work.slotLabel}</dd></div>}
        {work.instructors.length > 0 && (
          <div><dt className="sr-only">担当イントラ</dt><dd>担当：{work.instructors.join('・')}</dd></div>
        )}
        {work.targetLabel && (
          <div><dt className="sr-only">対象</dt><dd className="font-bold">対象：{work.targetLabel}</dd></div>
        )}
      </dl>
      {work.publicNote && <p className="mt-2 rounded-md bg-sand-50 px-2 py-1 text-sm">{work.publicNote}</p>}

      {isDraft ? (
        <p className="mt-3 rounded-lg bg-sand-100 px-3 py-2 text-center text-sm font-bold text-navy-700">準備中（決まったら、マイページから足せます）</p>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={`${work.title}に出るか`}>
          {CHOICES.map((c) => {
            const on = value === c.v;
            const off = disabled && c.v !== 'out' && !on;
            return (
              <button
                key={c.v}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={off}
                onClick={() => onChange(c.v)}
                className={`rounded-lg border px-1 py-2 text-sm font-bold ${
                  on ? 'border-navy-700 bg-navy-700 text-white' : 'border-sand-300 bg-white text-navy-700'
                } ${off ? 'opacity-40' : ''}`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

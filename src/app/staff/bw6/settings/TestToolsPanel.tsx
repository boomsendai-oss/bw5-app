'use client';

// BW6 発表会の試しの道具：試し用のURLを写す（PreviewUrlCopy）と、テストデータを消す（TestToolsPanel。ページが bw6-test の時だけ出す）。
// 消すのは2段階：1回目は件数だけ（dryRun）、2回目で消す。confirm() のダイアログは使わない。
// 試しの発表会（is_test=1）以外は、サーバ（resetTestDataAction）と消す文（resetTestEvent）の2か所で守る。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import { previewPathAction, resetTestDataAction } from './actions';

const BTN_MAIN = 'rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50';
const BTN_SUB = 'rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-navy-700 disabled:opacity-50';
const BTN_DANGER = 'rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50';

export function PreviewUrlCopy({ ev }: { ev: string }) {
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, startTransition] = useTransition();

  const make = () => {
    startTransition(async () => {
      const { path } = await previewPathAction(ev);
      if (!path) { setUrl(''); setMsg('この発表会は、試し用のURLを作れません'); return; }
      setUrl(`${window.location.origin}${path}`);
      setMsg('');
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setMsg('写しました。');
    } catch {
      setMsg('写せませんでした。欄の中を長押しして写してください。');
    }
  };

  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      <h2 className="text-lg font-bold">試し用のURL</h2>
      <p className="mt-1 text-sm">身内の試し用。受付の前でもフォームを見られます（本番の発表会は見るだけ）。</p>
      {!url ? (
        <button type="button" onClick={make} disabled={pending} className={`mt-2 ${BTN_MAIN}`}>URLを出す</button>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <input readOnly value={url} onFocus={(e) => e.target.select()} className={`min-w-0 flex-1 ${RECITAL_INPUT_CLS}`} aria-label="試し用のURL" />
          <button type="button" onClick={copy} className={BTN_MAIN}>写す</button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </section>
  );
}

export default function TestToolsPanel({ ev }: { ev: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [deleted, setDeleted] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

  const run = (dryRun: boolean) => {
    if (!name) { setError('名前を選んでください'); return; }
    startTransition(async () => {
      const r = await resetTestDataAction(ev, dryRun, name);
      if (!r.ok) { setError(r.error); return; }
      setError('');
      if (dryRun) { setCounts(r.counts); setDeleted(null); return; }
      setDeleted(r.counts);
      setCounts(null);
      router.refresh();
    });
  };

  return (
    <section className="rounded-xl border border-red-200 bg-white p-4 text-navy-700">
      <h2 className="text-lg font-bold">テストデータを消す（試しの発表会だけ）</h2>
      <p className="mt-1 text-sm">世帯・人・出演・請求・入金などを消します。設定・料金の規則・作品・特別な料金の事前登録は残ります。</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span>押す人：</span>
        <StaffNamePicker value={name} onChange={setName} />
      </div>

      {!counts && (
        <button type="button" onClick={() => run(true)} disabled={pending} className={`mt-2 ${BTN_SUB}`}>テストデータを消す</button>
      )}

      {counts && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-bold">次の件数を消します（合わせて {total(counts)}件）。</p>
          <CountTable counts={counts} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => run(false)} disabled={pending || total(counts) === 0} className={BTN_DANGER}>はい、消す</button>
            <button type="button" onClick={() => { setCounts(null); setError(''); }} disabled={pending} className={BTN_SUB}>やめる</button>
          </div>
        </div>
      )}

      {deleted && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-bold text-brand-800">消しました（合わせて {total(deleted)}件）。</p>
          <CountTable counts={deleted} />
        </div>
      )}
      {error && <p className="mt-2 text-sm font-bold text-red-700">{error}</p>}
    </section>
  );
}

function CountTable({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[14rem] text-left text-sm">
        <tbody className="divide-y divide-sand-100">
          {Object.entries(counts).map(([table, n]) => (
            <tr key={table}>
              <td className="py-1 pr-2 break-all"><code>{table}</code></td>
              <td className="py-1 text-right">{n}件</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

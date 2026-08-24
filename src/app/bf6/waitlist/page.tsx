// ⚠️ 公開ページ(認証なし)。理由: 満枠部門のキャンセル待ち登録(一般来場者・外部参加者向け)。
'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { getBf6WaitlistStatus, submitBf6Waitlist } from '../actions';
import { BF6_DIVISIONS, BF6_GRADE_OPTIONS } from '@/lib/bf6';
import { Bf6Card, Bf6Field, Bf6Hero, Bf6SectionTitle, Bf6Shell, btnPrimaryCls, inputCls } from '../ui';

type Status = { remaining: number; waiting: number; capacity: number; gate: string };

function WaitlistForm() {
  const sp = useSearchParams();
  const router = useRouter();
  const division = sp.get('d') ?? 'beginner';
  const div = BF6_DIVISIONS.find((d) => d.key === division);

  const [status, setStatus] = useState<Status | null>(null);
  const [row, setRow] = useState({
    buyerName: '', email: '', phone: '',
    dancerName: '', dancerKana: '', performerName: '', grade: '', genre: '', rep: '', instagram: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => { getBf6WaitlistStatus(division).then(setStatus); }, [division]);

  if (!div) return null;

  if (done !== null) {
    return (
      <Bf6Shell>
        <Bf6Hero title="WAITLIST" subtitle="キャンセル待ち" />
        <div className="space-y-4 px-4 py-8">
          <h1 className="text-2xl font-black text-white">受け付けました</h1>
          <p className="text-sm leading-relaxed text-neutral-300">
            {div.label}のキャンセル待ち <span className="font-black text-white">{done}番目</span> でご登録しました。
            確認のメールをお送りしています。
          </p>
          <p className="rounded-xl bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-300 ring-1 ring-neutral-800">
            この時点では出場は確定していません。空きが出た場合、順番にご案内のメールをお送りします。
            <br />
            エントリー費は繰り上がりが決まってから<span className="font-bold text-white">当日会場で現金</span>でお支払いいただきます。
            いまのお支払いは不要です。
          </p>
          <Link href="/bf6" className="flex h-12 w-full items-center justify-center rounded-xl bg-neutral-800 font-bold text-white ring-1 ring-neutral-700">
            イベントページへ
          </Link>
        </div>
      </Bf6Shell>
    );
  }

  const blocked =
    status && status.gate !== 'ok'
      ? status.gate === 'not_full'
        ? `${div.label}はまだ空きがあります。通常のエントリーからお申し込みください。`
        : `キャンセル待ちは${status.capacity}名までです。現在は満員のため受け付けできません。`
      : '';

  return (
    <Bf6Shell>
      <Bf6Hero title="WAITLIST" subtitle={`${div.label} キャンセル待ち`} />
      <div className="space-y-4 px-4 py-6">
        <div className="rounded-2xl border border-orange-500/60 bg-orange-950/30 p-4">
          <p className="text-sm font-black text-orange-400">代金は先にいただきません</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-300">
            登録は無料です。空きが出てご案内し、参加が決まってから
            <span className="font-bold text-white">当日会場で現金</span>でお支払いいただきます。
            繰り上がらなかった場合の返金手続きは発生しません。
          </p>
        </div>

        {status && (
          <p className="text-center text-sm font-bold text-neutral-300">
            現在 <span className="text-white">{status.waiting}名</span> がお待ちです(上限{status.capacity}名)
          </p>
        )}

        {blocked ? (
          <div className="space-y-3">
            <p className="rounded-xl bg-red-950/40 p-4 text-sm font-bold text-red-300">{blocked}</p>
            <Link href="/bf6/entry" className="flex h-12 w-full items-center justify-center rounded-xl bg-neutral-800 font-bold text-white ring-1 ring-neutral-700">
              エントリーページへ
            </Link>
          </div>
        ) : (
          <>
            <Bf6Card>
              <Bf6SectionTitle no="1" title="お申し込みの方" />
              <Bf6Field label="保護者・ご本人のお名前"><input className={inputCls} value={row.buyerName} onChange={(e) => setRow({ ...row, buyerName: e.target.value })} /></Bf6Field>
              <Bf6Field label="メールアドレス"><input className={inputCls} type="email" inputMode="email" value={row.email} onChange={(e) => setRow({ ...row, email: e.target.value })} /></Bf6Field>
              <Bf6Field label="電話番号"><input className={inputCls} inputMode="tel" value={row.phone} onChange={(e) => setRow({ ...row, phone: e.target.value })} /></Bf6Field>
            </Bf6Card>

            <Bf6Card>
              <Bf6SectionTitle no="2" title="出場予定の方" />
              <Bf6Field label="ダンサーネーム"><input className={inputCls} value={row.dancerName} onChange={(e) => setRow({ ...row, dancerName: e.target.value })} /></Bf6Field>
              <Bf6Field label="本名"><input className={inputCls} value={row.performerName} onChange={(e) => setRow({ ...row, performerName: e.target.value })} /></Bf6Field>
              <Bf6Field label="フリガナ(カタカナ)"><input className={inputCls} value={row.dancerKana} onChange={(e) => setRow({ ...row, dancerKana: e.target.value })} /></Bf6Field>
              <Bf6Field label="学年">
                <select className={inputCls} value={row.grade} onChange={(e) => setRow({ ...row, grade: e.target.value })}>
                  <option value="">選択してください</option>
                  {BF6_GRADE_OPTIONS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
              </Bf6Field>
              <Bf6Field label="エントリージャンル">
                <input className={inputCls} placeholder="例: HIPHOP" value={row.genre} onChange={(e) => setRow({ ...row, genre: e.target.value })} />
              </Bf6Field>
              <Bf6Field label="レペゼン(チーム名・地域など)"><input className={inputCls} placeholder="例: 仙台(地域名・チーム名など)" value={row.rep} onChange={(e) => setRow({ ...row, rep: e.target.value })} /></Bf6Field>
            </Bf6Card>

            {error && <p className="rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}

            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true); setError('');
                const r = await submitBf6Waitlist(division, row);
                setBusy(false);
                if (r.ok) setDone(r.position); else setError(r.error);
              }}
              className={btnPrimaryCls}
            >
              {busy ? '送信中…' : 'キャンセル待ちに登録する(無料)'}
            </button>
            <button onClick={() => router.push('/bf6/entry')} className="w-full py-2 text-sm font-bold text-neutral-400 underline">
              他の部門にエントリーする
            </button>
          </>
        )}
      </div>
    </Bf6Shell>
  );
}

// useSearchParams はプリレンダー時に Suspense 境界が要る(Next.jsの要件)。
export default function Bf6WaitlistPage() {
  return (
    <Suspense fallback={null}>
      <WaitlistForm />
    </Suspense>
  );
}

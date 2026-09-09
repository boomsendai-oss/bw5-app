'use client';

// 送信に失敗した宛先だけを送り直す。
// Gmail SMTP は連続送信で 421(一時的な制限)を返すことがあり、
// アドレスが正しくても数通落ちる。放置すると「届いていない人」が残る。
import { useState, useTransition } from 'react';
import { staffRetryBf6BroadcastFailures } from '../actions';

export function RetryButton({ templateKey, failed }: { templateKey: string; failed: number }) {
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (failed === 0) return null;
  if (result) return <p className="rounded-xl bg-brand-50 p-3 text-sm font-bold text-brand-700">{result}</p>;

  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await staffRetryBf6BroadcastFailures(templateKey);
          setResult(`再送しました: 成功 ${r.sent}件 / まだ失敗 ${r.failed}件`);
        })
      }
      className="w-full rounded-xl border-2 border-amber-500 bg-amber-50 py-3 text-sm font-black text-amber-800 disabled:opacity-50"
    >
      {pending ? '再送中…(1通ずつ送るので少し待ちます)' : `届かなかった ${failed} 名に送り直す`}
    </button>
  );
}

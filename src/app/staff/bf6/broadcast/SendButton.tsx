'use client';

// 一斉送信は取り消せないため、2段階の確認を挟む。
// 1回目のタップで確認モードに入り、2回目で実行する。
import { useState, useTransition } from 'react';
import { staffSendBf6Broadcast } from '../actions';

export function SendButton({ templateKey, count, alreadySent }: { templateKey: string; count: number; alreadySent: boolean }) {
  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (alreadySent) {
    return (
      <p className="rounded-xl bg-neutral-100 p-4 text-sm font-bold text-neutral-500">
        このメールは送信済みです。同じ内容を二度送ることはできません。
      </p>
    );
  }

  if (result) {
    return <p className="rounded-xl bg-brand-50 p-4 text-sm font-bold text-brand-700">{result}</p>;
  }

  return (
    <div className="space-y-3">
      {!armed ? (
        <button
          onClick={() => setArmed(true)}
          className="w-full rounded-xl bg-brand-600 py-4 font-black text-white"
        >
          この内容で {count} 名に送信する
        </button>
      ) : (
        <div className="space-y-3 rounded-xl border-2 border-red-500 bg-red-50 p-4">
          <p className="text-sm font-black text-red-700">
            本当に送信しますか? {count} 名にメールが届きます。取り消しはできません。
          </p>
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await staffSendBf6Broadcast(templateKey);
                setResult(
                  r.alreadySent
                    ? '既に送信済みでした。今回は何も送っていません。'
                    : `送信しました: 成功 ${r.sent}件 / 失敗 ${r.failed}件`
                );
              })
            }
            className="w-full rounded-xl bg-red-600 py-4 font-black text-white disabled:opacity-50"
          >
            {pending ? '送信中…' : 'はい、送信する'}
          </button>
          <button onClick={() => setArmed(false)} className="w-full rounded-xl bg-white py-3 font-bold text-neutral-600 ring-1 ring-neutral-300">
            やめる
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

// キャンセル完了メールの送信ボタン。返金が済んだのを確認してから人が押す。
// 誤送信を防ぐため2段階、送信後は結果(成功/失敗の理由)をその場に出す。
import { useState, useTransition } from 'react';
import { staffSendCancelMail } from './actions';

export default function CancelMailButton({ orderId, email }: { orderId: number; email: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  if (result?.ok) {
    return <p className="mt-2 text-xs font-bold text-emerald-700">✓ {result.msg}</p>;
  }

  return (
    <div className="mt-2">
      {confirming ? (
        <span className="flex flex-wrap items-center gap-2">
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await staffSendCancelMail(orderId);
                setResult(
                  r.ok
                    ? { ok: true, msg: `${r.to} にキャンセル完了メールを送信しました` }
                    : { ok: false, msg: r.error }
                );
                setConfirming(false);
              })
            }
            className="rounded bg-brand-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {pending ? '送信中…' : `${email} に送信する`}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded border border-sand-300 px-2 py-1 text-xs text-neutral-500"
          >
            やめる
          </button>
        </span>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="rounded border border-brand-300 px-2 py-1 text-xs font-bold text-brand-700 hover:bg-brand-50"
        >
          キャンセル完了メールを送る
        </button>
      )}
      {result && !result.ok && (
        <p className="mt-1 text-xs font-bold text-red-600">送信できませんでした: {result.msg}</p>
      )}
    </div>
  );
}

'use client';

// アンケート回答画面のエラーバウンダリ。描画中のクラッシュで白画面になる代わりに、
// 簡易版フォームへの導線を出し、エラー内容をサーバへ記録する(白画面バグ調査・WS AO 2026-08-31)。
import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { reportSurveyClientError } from './reportError';

export default function SurveyError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const params = useParams<{ slug: string }>();

  useEffect(() => {
    reportSurveyClientError('render-crash: ' + (error?.message || String(error)), error?.stack);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-16">
      <div className="max-w-md mx-auto rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-4">
        <div className="text-base font-bold text-slate-800">画面の表示に失敗しました</div>
        <p className="text-sm text-slate-600 leading-relaxed">
          お手数ですが、下の簡易版フォームからご回答ください。
          <br />
          (この端末でも確実に動く形式です)
        </p>
        <a
          href={`/survey/${params?.slug ?? ''}/simple`}
          className="block w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-bold text-white"
        >
          簡易版フォームを開く
        </a>
        <button type="button" onClick={() => unstable_retry()} className="text-xs text-slate-500 underline">
          もう一度読み込む
        </button>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Me = { id: number; name: string; salary_type: string; payslip_folder_url: string | null };

export default function InstructorDashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch('/api/instructor/auth/me', { credentials: 'include' }).then(r => r.json()).then(d => {
      if (d.me) setMe(d.me);
      else router.push('/instructor');
    });
  }, [router]);

  const logout = async () => {
    await fetch('/api/instructor/auth/logout', { method: 'POST', credentials: 'include' });
    router.push('/instructor');
  };

  if (!me) return <main className="min-h-screen flex items-center justify-center"><p>読込中...</p></main>;

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-orange-100 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-orange-600">🎯 BOOM ポータル</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">{me.name} さん</span>
            <button onClick={logout} className="text-xs text-slate-500 hover:text-orange-600 underline">ログアウト</button>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link href="/instructor/lessons" className="bg-white border hover:border-orange-300 hover:shadow rounded-xl p-4">
            <div className="text-2xl mb-1">📅</div>
            <h2 className="font-bold text-orange-700">担当レッスン一覧</h2>
            <p className="text-xs text-slate-500 mt-1">自分の担当クラスを月別に表示</p>
          </Link>
          <Link href="/instructor/payroll" className="bg-white border hover:border-orange-300 hover:shadow rounded-xl p-4">
            <div className="text-2xl mb-1">💰</div>
            <h2 className="font-bold text-orange-700">給与明細</h2>
            <p className="text-xs text-slate-500 mt-1">過去の給与明細を閲覧</p>
          </Link>
          <Link href="/instructor/cancel" className="bg-white border hover:border-orange-300 hover:shadow rounded-xl p-4">
            <div className="text-2xl mb-1">🚫</div>
            <h2 className="font-bold text-orange-700">休講申請</h2>
            <p className="text-xs text-slate-500 mt-1">休講・代講のお願い</p>
          </Link>
          {me.payslip_folder_url && (
            <a href={me.payslip_folder_url} target="_blank" rel="noopener noreferrer" className="bg-white border hover:border-orange-300 hover:shadow rounded-xl p-4">
              <div className="text-2xl mb-1">📁</div>
              <h2 className="font-bold text-orange-700">明細フォルダ (Drive)</h2>
              <p className="text-xs text-slate-500 mt-1">過去のPDF明細</p>
            </a>
          )}
        </div>

        <p className="text-[10px] text-slate-400 text-center mt-8">BOOM Dance School / Instructor Portal</p>
      </div>
    </main>
  );
}

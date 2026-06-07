'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function DashboardRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/staff/insights'); }, [router]);
  return <div className="p-8 text-neutral-500">リダイレクト中...</div>;
}

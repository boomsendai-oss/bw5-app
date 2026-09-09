// クルー画面の入場ガード。
//
// ⚠️ proxy は edge で cookie の存在しか見られない。ここでサーバ側検証しないと、
// cookie を1行捏造するだけで入れてしまう(クライアント側ガード禁止・CLAUDE.md 4.5)。
import { redirect } from 'next/navigation';
import { isCrewAuthorized } from '@/lib/bf6CrewDb';

export const dynamic = 'force-dynamic';

export default async function CrewGuard({ children }: { children: React.ReactNode }) {
  if (!(await isCrewAuthorized())) redirect('/bf6/crew/login');
  return <div className="min-h-screen bg-sand-50 pb-16">{children}</div>;
}

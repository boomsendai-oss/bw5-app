// クルー画面の入場ガード。
//
// ⚠️ proxy は edge で cookie の存在しか見られない。ここでサーバ側検証しないと、
// cookie を1行捏造するだけで入れてしまう(クライアント側ガード禁止・CLAUDE.md 4.5)。
import { redirect } from 'next/navigation';
import { isCrewAuthorized } from '@/lib/bf6CrewDb';
import PulseRefresh from './PulseRefresh';

export const dynamic = 'force-dynamic';

export default async function CrewGuard({ children }: { children: React.ReactNode }) {
  if (!(await isCrewAuthorized())) redirect('/bf6/crew/login');
  // ⚠️ body の既定の文字色は BW5 用の白。明るい下地のここでは文字色を必ず濃い色に戻す
  //    (色指定の無い数字や入力欄が白く溶けて見えなかった・TARO実機 2026-09-11)。globals.css の .bf6-crew-light も参照
  return (
    <div className="bf6-crew-light min-h-screen bg-sand-50 pb-16 text-navy-900">
      {/* 他の端末が入れた情報を自動で取り込む。配下の全画面(受付・ブロック予選・写真・
          集金・入場受付・LED操作卓)に1つで効く。中身は描かない。 */}
      <PulseRefresh />
      {children}
    </div>
  );
}

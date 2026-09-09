// BF6 当日オペ用アプリ(クルー)。/staff とは別系統のPINで入る隔離エリア。
//
// ここには認証を置かない。ログイン画面 (/bf6/crew/login) もこのlayoutの子になるため、
// ここで弾くと自分自身へリダイレクトし続ける。実際のガードは (app)/layout.tsx。
import type { ReactNode } from 'react';

export const metadata = {
  title: 'BF6 当日オペ',
  // ホーム画面に追加したときにフルスクリーンのアプリとして開く
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent' as const, title: 'BF6 OPS' },
};

export default function CrewShell({ children }: { children: ReactNode }) {
  return <div className="staff-theme min-h-screen">{children}</div>;
}

// ⚠️ 公開ページ(認証なし)。会場のLEDパネルへHDMI出力する専用画面。
// 操作UIは一切置かない(ここに映るものがそのまま観客に見えるため)。
// 操作は /staff/bf6/control 側で行い、サーバ経由で同期する。
import { ScreenClient } from './ScreenClient';

export const dynamic = 'force-dynamic';

export default function Bf6ScreenPage() {
  return <ScreenClient />;
}

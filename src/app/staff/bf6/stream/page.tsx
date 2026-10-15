// スタッフ: 配信の視聴状況。/staff/* 配下のためproxy認証で保護(規約4.5)。
//
// BF6ダッシュボードの「配信 接続中」を押すとここに来る(TARO 2026-09-26
// 「誰が見てるのかの内訳も分かると助かる」)。数えているのは端末で、人数ではない。
import StaffPageHeader from '@/components/StaffPageHeader';
import { listBf6StreamViewers } from '@/lib/bf6StreamDb';
import { StreamViewersClient } from './StreamViewersClient';
import { redirect } from 'next/navigation';
import { isAuthorizedServer } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

export default async function StaffBf6StreamPage() {
  // proxyはcookieの有無しか見ないため、個人情報を出す前にセッションを本検証する(規約4.5)
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const viewers = await listBf6StreamViewers();
  return (
    <div>
      <StaffPageHeader
        title="配信の視聴状況"
        description="いま配信を見ている人。5秒ごとに自動で更新します"
        backHref="/staff/bf6"
        backLabel="BF6ダッシュボード"
      />
      <div className="mx-auto max-w-3xl p-4">
        <StreamViewersClient initial={viewers} />
      </div>
    </div>
  );
}

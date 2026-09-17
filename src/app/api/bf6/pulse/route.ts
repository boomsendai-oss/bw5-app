// 当日オペ画面の「他の端末が何か入れたか」を知らせるだけのAPI。
//
// ⚠️ 公開API(認証なし)。理由: 出場者が自分で操作する受付端末 /bf6/checkin も
//    同期のためにこれを叩く。あの端末は公開ページ(その場でログインさせられない)なので、
//    認証を要求するとタブレット間の同期ができない。
//    返すのは集計をハッシュにした32文字だけ。名前も金額も件数も読み取れない。
//    ⚠️ ハッシュ化は bf6PulseDb の opaque() で必ず行うこと。生の合図をそのまま返すと
//       集金額や受付人数が誰にでも読めてしまう。
//
// ⚠️ 端末3〜4台が2秒おきに叩く。DBは必ず1往復に収めること(bf6PulseDb)。
import { NextResponse } from 'next/server';
import { getBf6Pulse } from '@/lib/bf6PulseDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const token = await getBf6Pulse();
  return NextResponse.json({ token }, { headers: { 'Cache-Control': 'no-store' } });
}

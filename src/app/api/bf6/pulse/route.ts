// 当日オペ画面の「他の端末が何か入れたか」を知らせるだけのAPI。
//
// ⚠️ 認証あり(CLAUDE.md 4.5)。withAuth は使わない。当日オペのiPadは /staff の
//    パスワードではなくクルー用PIN(bf6_crew_auth)で入っているため、
//    クルーとスタッフのどちらかであれば通す形にしている。
//
// 返すのは合図の文字列1本だけで、名前も金額も含まない。
// 3〜4台が2秒おきに叩くので、DBは必ず1往復に収めること(bf6PulseDb)。
import { NextResponse } from 'next/server';
import { isAuthorizedServer, unauthorized } from '@/lib/eventAuth';
import { isCrewAuthorized } from '@/lib/bf6CrewDb';
import { getBf6Pulse } from '@/lib/bf6PulseDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!(await isCrewAuthorized()) && !(await isAuthorizedServer())) return unauthorized();
  const token = await getBf6Pulse();
  return NextResponse.json({ token }, { headers: { 'Cache-Control': 'no-store' } });
}

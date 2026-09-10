// ⚠️ 合言葉(x-bf6-worker-key)必須。会場のMacに常駐する切り抜き係だけが叩く。
// /staff の認証は使わない(Macの常駐プログラムにブラウザのログインは無いため)。
// 返すのは item_id と時刻だけで、氏名・連絡先は含まない。
import { NextRequest, NextResponse } from 'next/server';
import { isWorkerKeyValid } from '@/lib/bf6Photo';
import { getBf6CutoutWorkerKey, listBf6CutoutQueue } from '@/lib/bf6PhotoRawDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!isWorkerKeyValid(req.headers.get('x-bf6-worker-key'), await getBf6CutoutWorkerKey())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ items: await listBf6CutoutQueue() });
}

'use server';

// ⚠️ 公開Server Action(adminパスワード不要)。理由: 太白まつり等の「講師共有用」読み取り専用
// 名簿ページ src/app/roster/[code]/[token]/page.tsx が使う。
// アクセス制御は URL 内の推測不可能な share_token 完全一致のみ(Googleドキュメントの
// 「リンクを知っている人だけ」方式)。返すのはその1イベントの名簿だけで、編集/削除/他イベント/
// 他の管理データには一切触れない(読み取り専用)。トークン総当り対策にIP単位のレート制限をかける。
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/eventAuth';
import { getSharedRoster, type SharedRoster } from '@/lib/eventSignupDb';

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || 'unknown';
}

export type SharedRosterResult = { ok: true; roster: SharedRoster } | { ok: false; error: string };

export async function getSharedRosterAction(code: string, token: string): Promise<SharedRosterResult> {
  const ip = await clientIp();
  // トークン総当り防止(1時間に30回まで)
  if (!(await checkRateLimit(`roster:${ip}`, 30, 3600))) {
    return { ok: false, error: 'アクセスが多すぎます。しばらくしてからお試しください' };
  }
  const roster = await getSharedRoster(code, token);
  if (!roster) return { ok: false, error: 'このリンクは無効です（アクセス権がありません）' };
  return { ok: true, roster };
}

// ⚠️ 公開ページ(認証なし)。理由: BF6エントリーリストは告知の一部として誰でも
// 見られる仕様(TARO 2026-08-03)。掲載はダンサーネーム・ジャンル・レペゼン・部門のみで、
// 本名・連絡先などのPIIは getPublicBf6Entries が返さない(M22)。
import Link from 'next/link';
import { type Bf6Division } from '@/lib/bf6';
import { getBf6Settings, getPublicBf6Entries, type PublicBf6Entry } from '@/lib/bf6Db';
import { Bf6Hero, Bf6Shell } from '../ui';
import EntryListTabs from './EntryListTabs';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: "BOOMER'S FIGHT!!! vol.6 エントリーリスト",
  description: '2026.9.26(土) SSM 9階ホール — 各部門のエントリーリスト(リアルタイム更新)',
};

export default async function Bf6EntriesPage() {
  const [settings, entries] = await Promise.all([getBf6Settings(), getPublicBf6Entries()]);

  const lists: Record<Bf6Division, PublicBf6Entry[]> = { beginner: [], kids: [], general: [] };
  for (const e of entries) {
    for (const d of e.divisions) lists[d].push(e);
  }

  return (
    <Bf6Shell wide>
      <div>
        <Bf6Hero title="ENTRY LIST" subtitle="2026.9.26 SAT — SSM 9階ホール / リアルタイム更新" />
        <div className="px-4 py-6">
          <EntryListTabs lists={lists} capacity={settings.capacity} />

          <Link
            href="/bf6/entry"
            className="mt-8 block w-full rounded-2xl bg-red-600 py-4 text-center text-lg font-black text-white shadow-lg shadow-red-600/30"
          >
            エントリーする
          </Link>
          <p className="mt-4 text-center text-xs text-neutral-400">
            <Link href="/bf6" className="underline">イベント詳細へ</Link>
          </p>
        </div>
      </div>
    </Bf6Shell>
  );
}

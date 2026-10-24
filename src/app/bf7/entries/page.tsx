// ⚠️ 公開ページ(認証なし)。理由: vol.7のエントリーリストは告知の一部として誰でも
// 見られる仕様(vol.6と同じ)。掲載はダンサーネーム・ジャンル・レペゼン・部門のみで、
// 本名・連絡先などのPIIは getPublicBf7Entries が返さない(M22)。
import Link from 'next/link';
import { type Bf6Division } from '@/lib/bf6';
import { formatJpDate, isBf7EntryAccepting } from '@/lib/bf7Entry';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { getBf7Settings, getPublicBf7Entries, type PublicBf7Entry } from '@/lib/bf7EntryDb';
import { Bf7Card, Bf7Hero, Bf7PreviewBanner, Bf7Shell, btnPrimaryCls } from '../ui';
import EntryListTabs from './EntryListTabs';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: "BOOMER'S FIGHT!!! vol.7 エントリーリスト",
  description: '2027.1.30(土) SSM 9階ホール — 各部門のエントリーリスト(リアルタイム更新)',
};

export default async function Bf7EntriesPage() {
  const [settings, entries] = await Promise.all([getBf7Settings(), getPublicBf7Entries()]);
  const accepting = isBf7EntryAccepting(settings);
  // 受付が始まるまでは一般には出さない(部門・定員がまだ仮のため)。スタッフのログイン中は確認用に表示
  const notStarted = !accepting && entries.length === 0;
  const preview = notStarted && (await isAuthorizedServer());

  const lists: Record<Bf6Division, PublicBf7Entry[]> = { beginner: [], kids: [], general: [] };
  for (const e of entries) {
    for (const d of e.divisions) lists[d].push(e);
  }

  return (
    <Bf7Shell>
      {preview && <Bf7PreviewBanner />}
      <Bf7Hero title="ENTRY LIST" subtitle="2027.1.30 SAT — SSM 9階ホール / リアルタイム更新" />
      <div className="px-4 py-6">
        {notStarted && !preview ? (
          <Bf7Card>
            <p className="text-neutral-300">
              エントリーリストは受付開始({formatJpDate(settings.entryStart)})後に公開します。
            </p>
          </Bf7Card>
        ) : (
          <EntryListTabs lists={lists} capacity={settings.capacity} accepting={accepting} />
        )}

        {accepting && (
          <Link href="/bf7/entry" className={`mt-8 block w-full rounded-2xl py-4 text-center text-lg font-black ${btnPrimaryCls}`}>
            エントリーする
          </Link>
        )}
        <p className="mt-4 text-center text-xs text-neutral-400">
          <Link href="/bf7" className="underline">イベント詳細へ</Link>
        </p>
      </div>
    </Bf7Shell>
  );
}

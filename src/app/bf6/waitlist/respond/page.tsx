// ⚠️ 公開ページ(認証なし)。理由: 繰り上げ通知メールのリンクから本人が開くため。
// トークンを知っている人だけが操作できる(メールの受信者=本人)。
import Link from 'next/link';
import { respondBf6Waitlist } from '../../actions';
import { findWaitlistByToken } from '@/lib/bf6WaitlistDb';
import { Bf6Hero, Bf6Shell } from '../../ui';

export const dynamic = 'force-dynamic';

const REASON: Record<string, string> = {
  expired: 'ご返答の期限を過ぎています。次にお待ちの方へご案内が回っている可能性があります。',
  not_offered: 'このリンクは無効です。繰り上げのご案内が出ていないか、URLが正しくありません。',
  already_done: 'このご案内へのご返答は、すでに受け付けています。',
};

export default async function Bf6WaitlistRespondPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; a?: string }>;
}) {
  const { t, a } = await searchParams;
  const token = (t ?? '').trim();
  const accept = a === 'yes';

  if (!token) {
    return <Shell title="リンクが正しくありません" body="メールに記載のURLをもう一度お確かめください。" />;
  }

  const row = await findWaitlistByToken(token);
  const result = await respondBf6Waitlist(token, accept);

  if (!result.ok) {
    return <Shell title="受け付けできませんでした" body={REASON[result.reason] ?? 'もう一度お試しください。'} />;
  }

  if (result.action === 'accepted') {
    return (
      <Shell
        title="出場が確定しました"
        body={`${row?.dancerName ?? ''} さんのご出場を承りました。当日お会いできるのを楽しみにしています。`}
        detail={[
          '■ 当日',
          '  13:30 集合(SSM 9階ホール前で受付) / 14:00 締切',
          '  受付で組み合わせ抽選(くじ引き)を行います。',
          '',
          '■ エントリー費',
          '  当日、会場受付で現金でお支払いください(1部門 ¥2,500)。',
        ]}
      />
    );
  }

  return (
    <Shell
      title="辞退を承りました"
      body="ご連絡ありがとうございました。またの機会にぜひご参加ください。"
    />
  );
}

function Shell({ title, body, detail }: { title: string; body: string; detail?: string[] }) {
  return (
    <Bf6Shell>
      <Bf6Hero title="WAITLIST" subtitle="キャンセル待ち" />
      <div className="space-y-4 px-4 py-8">
        <h1 className="text-2xl font-black text-white">{title}</h1>
        <p className="text-sm leading-relaxed text-neutral-300">{body}</p>
        {detail && (
          <pre className="whitespace-pre-wrap rounded-xl bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-300 ring-1 ring-neutral-800">
            {detail.join('\n')}
          </pre>
        )}
        <Link
          href="/bf6"
          className="flex h-12 w-full items-center justify-center rounded-xl bg-neutral-800 font-bold text-white ring-1 ring-neutral-700"
        >
          イベントページへ
        </Link>
      </div>
    </Bf6Shell>
  );
}

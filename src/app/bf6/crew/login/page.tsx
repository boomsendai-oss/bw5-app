// ⚠️ 公開ページ(認証なし)。理由: BF6当日オペのログイン画面そのもののため。
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function CrewLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <p className="text-xs font-black tracking-[0.2em] text-brand-500">
        BOOMER&apos;S FIGHT!!! vol.6
      </p>
      <h1 className="mt-1 text-3xl font-black text-white">当日オペ</h1>
      <p className="mt-2 text-sm leading-relaxed text-neutral-400">
        スタッフ用のPINを入れてください。
        <br />
        PINはTAROから当日お伝えします。
      </p>
      <LoginForm next={next ?? '/bf6/crew'} />
    </div>
  );
}

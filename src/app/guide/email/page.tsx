import type { Metadata } from 'next';
import { GuideShell, GuideCallout } from '../_components/GuideShell';
import { GuideStep, GuideSteps } from '../_components/GuideStep';

export const metadata: Metadata = {
  title: 'メールが届かない | BOOM 使い方ガイド',
  description:
    'BOOMポータルからのメールが届かない時の対処。@hacomono.jp と @em.hacomono.jp の受信を許可してください。',
};

/** hacomonoからのメールの送信元ドメイン。この2つを許可すれば届くようになる */
const DOMAINS = ['@hacomono.jp', '@em.hacomono.jp'];

/** キャリア別の受信許可設定（各社公式ページ。手順を転記すると仕様変更で腐るのでリンクに寄せる） */
const CARRIERS = [
  { name: 'au', href: 'https://www.au.com/support/service/mobile/trouble/mail/email/filter/' },
  { name: 'docomo', href: 'https://www.docomo.ne.jp/info/spam_mail/domain/' },
  { name: 'SoftBank', href: 'https://www.softbank.jp/mobile/support/mail/antispam/' },
];

export default function EmailGuidePage() {
  return (
    <GuideShell
      title="メールが届かない"
      lead="登録の確認メール・予約の確認メール・パスワード再設定のメールが来ない時の対処です。"
      helpNote="設定を直しても届かない場合、登録されているメールアドレスが違っている可能性があります。公式LINEでご連絡いただければスタッフが確認します。"
    >
      <GuideCallout>
        <p className="font-semibold">BOOMからのメールはこの2つのドメインから届きます</p>
        <ul className="mt-2 space-y-1">
          {DOMAINS.map((d) => (
            <li key={d} className="font-mono text-[15px] font-bold text-brand-800">
              {d}
            </li>
          ))}
        </ul>
        <p className="mt-2">
          迷惑メール判定を受けやすいので、この2つを<b>受信できるように設定</b>するのが確実です。
        </p>
      </GuideCallout>

      <h2 className="mb-5 mt-9 text-lg font-bold text-navy-800">手順</h2>
      <GuideSteps>
        <GuideStep
          n={1}
          title="迷惑メールフォルダを検索する"
          body={
            <>
              メールアプリの検索窓に <b>hacomono</b> と入れて探してください。受信トレイに無くても、迷惑メールフォルダに入っていることがよくあります。
            </>
          }
        />
        <GuideStep
          n={2}
          title="見つかったら「迷惑メールではない」にする"
          body="次回から受信トレイに届くようになります。ここで解決することが多いです。"
        />
        <GuideStep
          n={3}
          title="見つからなければ、受信許可の設定をする"
          body={
            <>
              上の2つのドメインを許可します。携帯キャリアのメール（@docomo.ne.jp、@au.com、
              @softbank.ne.jp など）をお使いの場合は、各社の設定ページから行ってください。
            </>
          }
        />
      </GuideSteps>

      <div className="mt-6 grid grid-cols-1 gap-2">
        {CARRIERS.map((c) => (
          <a
            key={c.name}
            href={c.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-xl border border-sand-200 bg-white px-4 py-3 text-[15px] font-semibold text-navy-800 shadow-sm"
          >
            {c.name} の受信許可設定
            <span aria-hidden className="text-sand-400">
              ↗
            </span>
          </a>
        ))}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-neutral-500">
        Gmail・iCloud・Yahoo!メールなどをお使いの場合は、迷惑メールフォルダの確認（手順1〜2）だけで解決することがほとんどです。
      </p>

      <h2 className="mb-3 mt-10 text-lg font-bold text-navy-800">よくある勘違い</h2>
      <div className="space-y-3">
        <GuideCallout tone="warn">
          <p className="font-semibold">別のメールアドレスで登録し直さないでください</p>
          <p className="mt-1">
            アカウントが二重になり、契約中のプランや残っているチケットが引き継がれません。メールアドレスを変えたい場合は、ログインしたうえでマイページ →「お客様情報の設定」→「メールアドレス」から変更してください。
          </p>
        </GuideCallout>
      </div>
    </GuideShell>
  );
}

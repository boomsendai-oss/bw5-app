import type { Metadata } from 'next';
import { GuideShell, GuideCallout, PORTAL_URL } from '../_components/GuideShell';
import { GuideStep, GuideSteps } from '../_components/GuideStep';

export const metadata: Metadata = {
  title: 'ログインできない | BOOM 使い方ガイド',
  description:
    'BOOMポータルにログインできない時の対処。パスワードの再設定手順を画面つきで案内します。',
};

export default function LoginGuidePage() {
  return (
    <GuideShell
      title="ログインできない"
      lead="多くの場合はパスワードの再設定で解決します。ご自身で数分でできます。"
      helpNote="再設定のメールが届かない、メールアドレス自体がわからない、という場合はスタッフ側で確認できます。公式LINEでご連絡ください。"
    >
      <GuideCallout>
        <p className="font-semibold">まず確認してください</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            ログインに使うのは<b>登録したメールアドレス</b>です（会員番号ではありません）
          </li>
          <li>LINEアカウントでログインしている場合は、パスワードの入力は不要です</li>
          <li>
            パスワードは<b>大文字・小文字が区別されます</b>。スマホの自動大文字化にご注意ください
          </li>
        </ul>
      </GuideCallout>

      <h2 className="mb-5 mt-9 text-lg font-bold text-navy-800">パスワードを再設定する</h2>
      <GuideSteps>
        <GuideStep
          n={1}
          pendingCapture
          title="ログイン画面を開く"
          body={
            <>
              <a className="text-brand-700 underline" href={PORTAL_URL}>
                boom.hacomono.jp
              </a>
              を開いて「ログイン」を押します。
            </>
          }
        />
        <GuideStep
          n={2}
          pendingCapture
          title="「パスワードを忘れた方はこちら」を押す"
          body="パスワードの入力欄の下にあります。文字が小さいので見落としやすい場所です。"
        />
        <GuideStep
          n={3}
          pendingCapture
          title="登録しているメールアドレスを入れて送信する"
          body="ここで入れるアドレスは、入会時に登録したものです。心当たりが複数ある場合は順番に試してください。"
        />
        <GuideStep
          n={4}
          pendingCapture
          title="届いたメールのリンクを開く"
          body={
            <>
              数分たっても届かない時は迷惑メールフォルダを見てください。詳しくは
              <a className="text-brand-700 underline" href="/guide/email">
                メールが届かない
              </a>
              へ。
            </>
          }
        />
        <GuideStep
          n={5}
          pendingCapture
          title="新しいパスワードを決めて保存する"
          body="そのまま新しいパスワードでログインできます。"
        />
      </GuideSteps>

      <h2 className="mb-3 mt-10 text-lg font-bold text-navy-800">それでも入れない時</h2>
      <div className="space-y-3">
        <GuideCallout tone="warn">
          <p className="font-semibold">新しく会員登録し直さないでください</p>
          <p className="mt-1">
            アカウントが二重になり、契約中のプランや残っているチケットが引き継がれません。必ず公式LINEでご連絡ください。
          </p>
        </GuideCallout>
        <GuideCallout>
          <p className="font-semibold">お子さまのアカウントの場合</p>
          <p className="mt-1">
            ご家族で1つのメールアドレスを共有していることがあります。保護者の方のメールで再設定を試してみてください。
          </p>
        </GuideCallout>
      </div>
    </GuideShell>
  );
}

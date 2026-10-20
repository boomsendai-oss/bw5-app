// ⚠️ 公開ページ(認証なし)。理由: 申込者本人の控え。edit_token 完全一致の申込1件だけを表示する
// (トークンなし・不一致では何も出さない。申込を列挙する経路はない)。
import Link from 'next/link';
import Image from 'next/image';
import {
  PARTY_EVENT_KEY,
  XMAS_EVENT_INFO,
  audioOpen,
  formatJstLabel,
  formatMembers,
  formatPartyReceiptNo,
  partyStatusLabel,
  yen,
} from '@/lib/party';
import { getPartySettings, loadPartyOrderByToken } from '@/lib/partyDb';
import { Ticket } from 'lucide-react';
import { Notice, Panel, Row, XmasShell, primaryBtnCls } from '../ui';
import CheckoutButton from './CheckoutButton';
import AudioUpload from './AudioUpload';
import { SHOWCASE_ORDER_NOTE } from '../content';

export const dynamic = 'force-dynamic';

export default async function XmasMyPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const o = t ? await loadPartyOrderByToken(t) : null;

  if (!o || !t) {
    return (
      <XmasShell>
        <h1 className="text-center text-2xl font-black">申込が見つかりません</h1>
        <Notice>
          URLが正しいかご確認ください。カード払いで30分以内に決済されなかった申込は無効になります。控えのURLは
          パーティーの案内ページの下から、もう一度メールで受け取れます。
        </Notice>
        <Link href="/xmas" className={`mt-6 ${primaryBtnCls}`}>
          パーティーの案内へ
        </Link>
      </XmasShell>
    );
  }

  const s = await getPartySettings(PARTY_EVENT_KEY);
  const isEntry = o.kind === 'entry';
  const confirmed = o.status === 'paid' || o.status === 'cash_due';
  const heading =
    o.status === 'paid' || o.status === 'cash_due'
      ? isEntry
        ? 'エントリー完了！'
        : 'チケット予約完了！'
      : o.status === 'pending'
        ? 'あと少し：カード決済がまだです'
        : o.status === 'expired'
          ? 'この申込は無効になりました'
          : 'この申込は取り消されています';

  return (
    <XmasShell>
      {confirmed && (
        <Image src="/xmas/kun_jump.png" alt="" width={458} height={480} priority className="mx-auto mb-2 w-32 drop-shadow-[3px_3px_0_rgba(26,20,16,0.35)]" />
      )}
      <h1 className="text-center text-2xl font-black">{heading}</h1>
      <div className="mx-auto mt-4 w-fit -rotate-1 border-[3px] border-[#1a1410] bg-[#f4cf3e] px-5 py-2 text-center shadow-[4px_4px_0_#1a1410]">
        <p className="text-xs font-black">受付番号</p>
        <p className="text-3xl font-black tracking-wider">{formatPartyReceiptNo(o.id)}</p>
      </div>

      {o.status === 'pending' && (
        <div className="mt-6">
          <CheckoutButton token={t} amountTotal={o.amountTotal} />
          <p className="mt-2 text-center text-xs font-bold">申込から30分以内に決済してください</p>
        </div>
      )}
      {o.status === 'expired' && (
        <Link href={isEntry ? '/xmas/entry' : '/xmas/ticket'} className={`mt-6 ${primaryBtnCls}`}>
          もう一度申し込む
        </Link>
      )}

      <Panel title={isEntry ? 'エントリー内容' : '予約内容'} tone={isEntry ? 'green' : 'red'}>
        <dl>
          <Row k="状態" v={partyStatusLabel(o.status)} />
          <Row k="代表者" v={`${o.buyerName}(${o.buyerKana})`} />
          {isEntry ? (
            <>
              <Row k="チーム" v={`${o.teamName}(${o.teamKana})・${o.genre}`} />
              <Row k="メンバー" v={`${o.memberCount}名: ${formatMembers(o.members)}`} />
              <Row k="入場チケット" v={`${o.peopleCount}枚(メンバー${o.memberCount}名中)`} />
            </>
          ) : (
            <Row k="人数" v={`小学生以上 ${o.peopleCount}名${o.infantCount > 0 ? ` / 未就学児 ${o.infantCount}名(無料)` : ''}`} />
          )}
          <Row
            k="合計"
            v={
              <>
                {yen(o.amountTotal)}
                <span className="block text-xs">
                  {o.status === 'paid'
                    ? 'カード決済でお支払い済み'
                    : o.status === 'cash_due'
                      ? '当日、会場のキャッシャーで現金でお支払いください'
                      : ''}
                </span>
              </>
            }
          />
          <Row k="日時" v={`${XMAS_EVENT_INFO.dateLabel} ${XMAS_EVENT_INFO.timeLabel}`} />
          <Row k="会場" v={XMAS_EVENT_INFO.venue} />
        </dl>
        {confirmed && (
          <p className="mt-3 text-xs font-bold text-neutral-700">
            当日は会場のキャッシャーで「{o.buyerName}」のお名前をお伝えください。{XMAS_EVENT_INFO.drinkLabel}。
          </p>
        )}
      </Panel>

      {isEntry && confirmed && (
        <Panel title="出演メンバーの入場チケット" tone="red">
          {o.peopleCount >= o.memberCount ? (
            <p className="text-sm font-bold">出演メンバー全員分の入場チケットはお支払い済みです。</p>
          ) : (
            <p className="text-sm font-black text-[#d4302a]">
              入場には、出演メンバーも1人ずつ入場チケットが必要です。まだ {o.memberCount - o.peopleCount}人分がこの申込に入っていません。
              チケットを予約していないメンバーは、下のボタンから予約してください。
            </p>
          )}
          <p className="mt-1 text-xs font-bold text-neutral-700">付き添いの保護者の方のチケットも、下のボタンから予約できます。</p>
          <Link href="/xmas/ticket" className={`mt-3 flex items-center justify-center gap-2 ${primaryBtnCls}`}>
            <Ticket className="size-6" strokeWidth={2.5} aria-hidden />
            入場チケットを予約する
          </Link>
        </Panel>
      )}

      {isEntry && confirmed && (
        <Panel title="音源の提出(後日でOK)" tone="green">
          <p className="text-sm font-bold">
            音源ができたら、このページからアップロードしてください。締切は <b>{formatJstLabel(s.audioDeadline)}</b>。持ち時間は
            {XMAS_EVENT_INFO.showTimeLimit}です。差し替えもできます。
          </p>
          <p className="mt-2 text-xs font-bold text-neutral-700">
            このページのURLはメールでも届いています。あとで開けるよう、ブックマークかメールを保存しておいてください。
          </p>
          {o.audioFilename ? (
            <p className="mt-2 rounded-lg border-[3px] border-[#1a1410] bg-white p-2 text-sm font-black">提出済み: {o.audioFilename}</p>
          ) : (
            <p className="mt-2 text-sm font-black text-[#d4302a]">まだ提出されていません</p>
          )}
          {audioOpen(s, new Date()) ? (
            <AudioUpload credential={t} orderId={o.id} />
          ) : (
            <Notice>音源の提出は締め切りました。差し替えが必要な場合は公式LINEへご連絡ください。</Notice>
          )}
        </Panel>
      )}

      {isEntry && confirmed && (
        <Panel title="出演について">
          <ul className="space-y-1 text-sm font-bold">
            <li>・リハーサルの時間はありません</li>
            <li>・{SHOWCASE_ORDER_NOTE}</li>
          </ul>
        </Panel>
      )}

      <p className="mt-8 text-center text-xs font-bold text-neutral-600">
        お申し込み後は原則として返金できません。お問い合わせは BOOM 公式LINE まで。
      </p>
    </XmasShell>
  );
}

// パーティー申込の控えメール。文面は純関数(vitest対象)、送信は既存のGmail SMTP基盤。
// 送信タイミング: 当日現金=申込直後 / カード=Webhookで決済が確定した瞬間。
// 金額は注文に保存した合計(申込時にサーバが計算した値)だけを使う。
import { sendEmail } from '@/lib/email';
import {
  XMAS_EVENT_INFO,
  formatJstLabel,
  formatPartyReceiptNo,
  gradeLabel,
  yen,
  type PartySettings,
} from '@/lib/party';
import type { PartyOrder } from '@/lib/partyDb';
import { SHOWCASE_ORDER_NOTE } from '@/app/xmas/content';

// 恒久ドメイン(2026-10-15〜)。bw5-app.vercel.app も引き続き同じページを開ける
const BASE_URL = 'https://event.boom-sendai.com';
const myUrl = (token: string) => `${BASE_URL}/xmas/my?t=${token}`;

export function buildPartyOrderEmail(o: PartyOrder, token: string, s: PartySettings): { subject: string; text: string } {
  const no = formatPartyReceiptNo(o.id);
  const paid = o.status === 'paid';
  const isEntry = o.kind === 'entry';
  const what = isEntry ? '出演エントリー' : 'チケット予約';
  const subject = `【BOOMクリスマスパーティー2026】${what}${paid ? '完了' : '受付'}(受付番号 ${no})`;

  const L: string[] = [];
  L.push(`${o.buyerName} 様`);
  L.push('');
  L.push(`${XMAS_EVENT_INFO.title}への${what}ありがとうございます。`);
  L.push(paid ? 'お支払いが完了しました。' : `${what}を受け付けました。`);
  L.push('');
  L.push(`■ 受付番号: ${no}`);
  L.push(`■ 日時: ${XMAS_EVENT_INFO.dateLabel} ${XMAS_EVENT_INFO.timeLabel}`);
  L.push(`■ 会場: ${XMAS_EVENT_INFO.venue}(${XMAS_EVENT_INFO.venueAddress})`);
  L.push('');
  if (isEntry) {
    L.push(`■ チーム名: ${o.teamName}(${o.teamKana}) / ${o.genre}`);
    L.push(`■ メンバー(${o.memberCount}名):`);
    for (const m of o.members) L.push(`  ・${m.name}(${gradeLabel(m.grade)})`);
    L.push(`■ 出演料: ${yen(o.unitPrice)} × ${o.memberCount}名`);
    if (o.peopleCount > 0) {
      // 入場チケットの単価は保存済みの合計から逆算する(申込時の値段のまま)
      const ticketUnit = (o.amountTotal - o.unitPrice * o.memberCount) / o.peopleCount;
      L.push(`■ 入場チケット(前売・出演メンバー分): ${yen(ticketUnit)} × ${o.peopleCount}枚`);
    }
    if (o.peopleCount < o.memberCount) {
      L.push(`  ※入場には、出演メンバーも1人ずつ入場チケットが必要です。この申込に入っていない ${o.memberCount - o.peopleCount}人分は、まだ予約していなければこちらから:`);
    } else {
      L.push('  ※出演メンバー全員分の入場チケットを含みます。付き添いの保護者の方のチケットはこちらから:');
    }
    L.push(`  ${BASE_URL}/xmas/ticket`);
  } else {
    L.push(`■ 参加人数: 小学生以上 ${o.peopleCount}名${o.infantCount > 0 ? ` / 未就学児 ${o.infantCount}名(無料)` : ''}`);
    L.push(`■ 入場チケット(前売): ${yen(o.unitPrice)} × ${o.peopleCount}名`);
  }
  L.push('');
  L.push(`■ 合計: ${yen(o.amountTotal)}`);
  if (paid) {
    L.push('  (カード決済でお支払い済み)');
  } else {
    L.push(`  当日、会場のキャッシャーで ${yen(o.amountTotal)} を現金でお支払いください。`);
  }
  L.push(`  ※${XMAS_EVENT_INFO.drinkLabel}`);
  L.push('');
  L.push('■ 当日の受付');
  L.push(`  会場のキャッシャーで「${o.buyerName}」のお名前をお伝えください。`);
  if (isEntry) {
    L.push('');
    L.push('■ 出演について');
    L.push('  ・リハーサルの時間はありません');
    L.push(`  ・${SHOWCASE_ORDER_NOTE}`);
    L.push('');
    L.push('■ 音源の提出(後日でOK)');
    L.push(`  音源ができたら、${formatJstLabel(s.audioDeadline)} までに下の「提出ページ」からアップロードしてください。`);
    L.push(`  持ち時間は${XMAS_EVENT_INFO.showTimeLimit}です。差し替えもできます。このメールは提出まで保存しておいてください。`);
    L.push(`  ▼提出ページ`);
    L.push(`  ${myUrl(token)}`);
    L.push(`  ※このURLが見つからなくなったら、${BASE_URL}/xmas/audio から、このメールアドレスかチーム名で提出できます。`);
  }
  L.push('');
  L.push('■ 申込内容の確認');
  L.push(`  ${myUrl(token)}`);
  L.push('');
  L.push('お申し込み後は、原則として返金はできません。');
  L.push('ご不明な点は BOOM 公式LINE までお問い合わせください。');
  L.push('');
  L.push('BOOM DANCE SCHOOL');
  return { subject, text: L.join('\n') };
}

export async function sendPartyOrderEmail(o: PartyOrder, token: string, s: PartySettings): Promise<void> {
  const { subject, text } = buildPartyOrderEmail(o, token, s);
  try {
    await sendEmail({ to: o.email, subject, text });
  } catch (e) {
    // メール失敗で申込自体は失敗させない(控えページで確認できる)。PIIはログに出さない
    console.error('[party] order email failed', o.id, e instanceof Error ? e.message : e);
  }
}

/** 音源が未提出のチームへのリマインド(スタッフ画面のボタンから送る)。 */
export function buildAudioReminderEmail(o: PartyOrder, token: string, s: PartySettings): { subject: string; text: string } {
  const L: string[] = [];
  L.push(`${o.buyerName} 様`);
  L.push('');
  L.push(`${XMAS_EVENT_INFO.title} ショーケース出演チーム「${o.teamName}」の音源がまだ届いていません。`);
  L.push(`${formatJstLabel(s.audioDeadline)} までに、下の提出ページからアップロードをお願いします。`);
  L.push(`持ち時間は${XMAS_EVENT_INFO.showTimeLimit}です。`);
  L.push('');
  L.push('▼提出ページ');
  L.push(myUrl(token));
  L.push(`(または ${BASE_URL}/xmas/audio から、このメールアドレスかチーム名で提出できます)`);
  L.push('');
  L.push('すでに準備中の場合は、このメールは気にせず締切までに提出してください。');
  L.push('ご不明な点は BOOM 公式LINE までお問い合わせください。');
  L.push('');
  L.push('BOOM DANCE SCHOOL');
  return { subject: `【BOOMクリスマスパーティー2026】音源の提出のお願い(${o.teamName})`, text: L.join('\n') };
}

/**
 * 出演チームへ「出演メンバーも入場チケットが必要」のお願い(スタッフ画面のボタンから送る)。
 * 文面はTARO確認済み(2026-10-20)。エントリーと一緒に買った入場チケットが足りないチームが対象。
 */
export function buildEntryTicketNoticeEmail(o: PartyOrder, s: PartySettings): { subject: string; text: string } {
  const missing = Math.max(0, o.memberCount - o.peopleCount);
  const L: string[] = [];
  L.push(`${o.buyerName} 様`);
  L.push('');
  L.push(`${XMAS_EVENT_INFO.title} ショーケースへの出演エントリー、ありがとうございます。`);
  L.push('出演メンバーの入場チケットについてお知らせします。');
  L.push('');
  L.push(`当日の入場には、出演メンバーも1人ずつ入場チケット(前売 ${yen(s.presalePrice)})が必要です。`);
  if (o.peopleCount === 0) {
    L.push('エントリーでお支払いいただいたのは出演料のみで、入場チケットは含まれていません。');
  } else {
    L.push(`エントリーと一緒にお支払いいただいた入場チケットは ${o.peopleCount}枚です。`);
  }
  L.push('');
  L.push(`■ チーム:${o.teamName}(メンバー${o.memberCount}名)`);
  L.push(`■ 入場チケット:前売 ${yen(s.presalePrice)}/1人`);
  L.push(`  ${formatJstLabel(s.ticketCardDeadline)} まで。カード払い、または当日現金払いを選べます`);
  L.push('');
  L.push(o.peopleCount === 0 ? 'こちらから、メンバー全員分の予約をお願いします。' : `こちらから、残り${missing}人分の予約をお願いします。`);
  L.push(`${BASE_URL}/xmas/ticket`);
  L.push('');
  L.push('※すでに予約済みのメンバーの分は不要です。');
  L.push('※付き添いの保護者の方も、入場チケットの予約をお願いします。');
  L.push('');
  L.push('ご不明な点は BOOM 公式LINE までお問い合わせください。');
  L.push('');
  L.push('BOOM DANCE SCHOOL');
  return { subject: `【BOOMクリスマスパーティー2026】出演メンバーの入場チケットのお願い(${o.teamName})`, text: L.join('\n') };
}

/** 控えページのURLを登録メールアドレスへ送り直す(メールをなくした人向け)。 */
export function buildLinkResendEmail(items: { order: PartyOrder; token: string }[]): { subject: string; text: string } {
  const L: string[] = [];
  L.push(`${items[0].order.buyerName} 様`);
  L.push('');
  L.push(`${XMAS_EVENT_INFO.title}の申込の確認ページをお送りします。`);
  L.push('');
  for (const { order, token } of items) {
    const label = order.kind === 'entry' ? `出演エントリー「${order.teamName}」(音源の提出もここから)` : 'チケット予約';
    L.push(`■ ${formatPartyReceiptNo(order.id)} ${label}`);
    L.push(`  ${myUrl(token)}`);
  }
  L.push('');
  L.push('お心当たりのない場合は、このメールは破棄してください。');
  L.push('');
  L.push('BOOM DANCE SCHOOL');
  return { subject: '【BOOMクリスマスパーティー2026】申込の確認ページ', text: L.join('\n') };
}

export async function sendPartyMail(to: string, mail: { subject: string; text: string }, tag: string): Promise<boolean> {
  try {
    await sendEmail({ to, subject: mail.subject, text: mail.text });
    return true;
  } catch (e) {
    console.error(`[party] ${tag} email failed`, e instanceof Error ? e.message : e);
    return false;
  }
}

/** 音源の提出・差し替えを受け付けたお知らせ(登録メールアドレス宛て)。 */
export function buildAudioReceivedEmail(o: PartyOrder, filename: string): { subject: string; text: string } {
  const L: string[] = [];
  L.push(`${o.buyerName} 様`);
  L.push('');
  L.push(`${XMAS_EVENT_INFO.title} ショーケース出演チーム「${o.teamName}」の音源を受け付けました。`);
  L.push('');
  L.push(`■ ファイル: ${filename}`);
  L.push(`■ 受付日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  L.push('');
  L.push(`差し替える場合は ${BASE_URL}/xmas/audio から、新しいファイルを上げ直してください。`);
  L.push('身に覚えのない提出・差し替えの場合は、BOOM 公式LINE までご連絡ください。');
  L.push('');
  L.push('BOOM DANCE SCHOOL');
  return { subject: `【BOOMクリスマスパーティー2026】音源を受け付けました(${o.teamName})`, text: L.join('\n') };
}

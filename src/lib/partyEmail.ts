// パーティー申込の控えメール。文面は純関数(vitest対象)、送信は既存のGmail SMTP基盤。
// 送信タイミング: 当日現金=申込直後 / カード=Webhookで決済が確定した瞬間。
// 金額は注文に保存した合計(申込時にサーバが計算した値)だけを使う。
import { sendEmail } from '@/lib/email';
import {
  XMAS_EVENT_INFO,
  formatJstLabel,
  formatPartyReceiptNo,
  yen,
  type PartySettings,
} from '@/lib/party';
import type { PartyOrder } from '@/lib/partyDb';

const BASE_URL = 'https://bw5-app.vercel.app';

export function buildPartyOrderEmail(o: PartyOrder, token: string, s: PartySettings): { subject: string; text: string } {
  const no = formatPartyReceiptNo(o.id);
  const paid = o.status === 'paid';
  const isEntry = o.kind === 'entry';
  const what = isEntry ? '出演エントリー' : '参加申込';
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
    L.push(`■ チーム名: ${o.teamName}(${o.genre})`);
    L.push(`■ メンバー(${o.memberCount}名): ${o.members.join('、')}`);
    L.push(`■ 出演料+入場料: ${yen(o.unitPrice)} × ${o.memberCount}名`);
    L.push('  ※出演メンバーはパーティーへの参加申込は不要です(付き添いの保護者の方は参加申込をお願いします)');
  } else {
    L.push(`■ 参加人数: 小学生以上 ${o.peopleCount}名${o.infantCount > 0 ? ` / 未就学児 ${o.infantCount}名(無料)` : ''}`);
    L.push(`■ 入場料(前売): ${yen(o.unitPrice)} × ${o.peopleCount}名`);
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
    L.push('■ 音源の提出');
    L.push(`  ${formatJstLabel(s.audioDeadline)} までに、下の控えページから音源ファイル(mp3など)をアップロードしてください。`);
    L.push(`  持ち時間は${XMAS_EVENT_INFO.showTimeLimit}です。差し替えもできます。`);
  }
  L.push('');
  L.push('■ 申込内容の確認' + (isEntry ? '・音源の提出' : ''));
  L.push(`  ${BASE_URL}/xmas/my?t=${token}`);
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

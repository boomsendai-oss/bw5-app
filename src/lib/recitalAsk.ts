// BW6 発表会（段階1）の TARO への入金のスクショの声かけ（純関数。DB にさわらない）。Task 24。
// 出すかどうか（shouldAskTaro）と、文（buildAskMessage）。決まりの正本は設計書 07 7-5「声かけの文」と決まりの紙 7-5。
// 段階1で出すのは、夜（bank_ask_at の時刻）と、休み明けの朝8時（bank_rest_to の次の日）の1回だけ。
// 次の朝に催促がある夜の決まり・2/8〜2/10 の昼・総点検（bank_audit_on から）の文・2/15 からの月曜は後の計画。
// 文に金額と名前を書かない（知らせは Pushover とメールに出るため）。
import { shiftDays, todayJst } from './dateJst';
import type { PayGate, RecitalSettings } from './recital';

/** JST の 'YYYY-MM-DD HH:MM'（shouldAskTaro の nowJst。定期の入口が今の時刻から作る） */
export function nowJstOf(now: Date): string {
  return `${todayJst(now)} ${new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16)}`;
}

/** 休み明けの朝の声かけの時刻（Worker の recital-morning が撃つ時刻） */
export const MORNING_SLOT = '08:00';

/**
 * TARO に声をかけるか。
 * nowJst＝JST 'YYYY-MM-DD HH:MM'、slot＝'08:00'（朝）か bank_ask_at の時刻。
 * 共通：「払う」が開いている（gate='open'）・振込先の文（bank_text）が空でない。
 * 朝：bank_rest_to の次の日だけ。夜：bank_ask_at にある時刻・休みの外・総点検の日より前・今日の合った束が無い。
 */
export function shouldAskTaro(x: { nowJst: string; slot: string; s: RecitalSettings; gate: PayGate; okBatchToday: boolean }): boolean {
  const { s } = x;
  if (x.gate !== 'open' || s.bank_text.trim() === '') return false;
  const d = x.nowJst.slice(0, 10);
  if (x.slot === MORNING_SLOT) {
    if (!s.bank_rest_to) return false;
    return d === shiftDays(s.bank_rest_to, 1);
  }
  if (!s.bank_ask_at.includes(x.slot)) return false;
  if (d >= s.bank_rest_from && d <= s.bank_rest_to) return false;
  if (!(d < s.bank_audit_on)) return false;
  return !x.okBatchToday;
}

/** '2026-12-14' → '12月14日'（曜日は付けない） */
function md(ymd: string): string {
  const [, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return `${m}月${d}日`;
}

/**
 * 声かけの文。subject に頭（【BOOM】BW6）は付けない（notifyTaro の subjectPrefix が付ける）。
 * 「見てほしい入金」の行は1件以上の時だけ（終わりに全角空白1つ＋url）。
 */
export function buildAskMessage(x: { startDate: string; lastShotOn: string | null; reviewCount: number; url: string; afterRest?: boolean }): { subject: string; body: string } {
  if (x.afterRest) {
    return {
      subject: '入金のスクショをお願いします（休み明け）',
      body: `休みの間の分を、お願いします。\n開始日を ${md(x.startDate)} にして、まとめて撮ってください。`,
    };
  }
  const lines = ['BW6 入金のスクショをお願いします。'];
  lines.push(`開始日は ${md(x.startDate)}。${x.lastShotOn ? `前に撮ったのは ${md(x.lastShotOn)}。` : ''}`);
  if (x.reviewCount > 0) lines.push(`見てほしい入金 ${x.reviewCount}件　${x.url}`);
  return { subject: '入金のスクショをお願いします', body: lines.join('\n') };
}

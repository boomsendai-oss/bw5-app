// 受信箱アラート: 朝のまとめ(Pushover 1通・1024字以内)を組み立てる(純関数)。
// 未対応は返信かアーカイブで消えるまで毎朝載り続ける。件名はまとめを作る時にGmailから取り直す(DBに持たない)。
// 件名は送り主が自由に書けるので、改行をつぶしてURLを消し、1件40字に切る(偽の行の差し込みと、長い件名で他が見えなくなるのを防ぐ)。
// 件数と稼働欄(止まっていないかの合図)は、字数が足りなくても必ず最後まで残す。
import type { Kind } from './classify';
import { charLength, jstHm, jstMd, receivedLabel, stripUrls, truncateChars } from './format';

export type DigestItem = { accountLabel: string; kind: Kind; subject: string; receivedMs: number; aiFailed: boolean };
export type DigestHealth = { label: string; lastSuccessMs: number | null; consecutiveErrors: number };
export type DigestInput = {
  nowMs: number;
  pending: DigestItem[];
  /** 未対応の本当の件数(一覧は上限つきで取るため)。省略時は pending の件数 */
  pendingTotal?: number;
  failures: DigestItem[];
  others: DigestItem[];
  counts: { countOnly: number; aiLight: number; aiFailed: number };
  health: DigestHealth[];
  /** 設定が欠けていて監視できないアカウントの表示名(accounts.ts の missingAccountLabels) */
  missing: string[];
};

export const DIGEST_LIMIT = 1024;
const SUBJECT_MAX = 40;
const STALE_MS = 30 * 60 * 1000;
/** 1回だけの一時的なエラーでは「要確認」にしない(止まった時の警報は run.ts で連続6回) */
const ERROR_ALERT_MIN = 2;

const SHORT_KIND: Record<Kind, string> = {
  new_inquiry: '【新規】',
  reply: '【返信】',
  money_deadline: '【期限あり】',
  automation_failure: '【失敗】',
  money_later: '【お金】',
  other: '【要確認】',
};

function itemLine(item: DigestItem, nowMs: number, withTime: boolean): string {
  const head = item.aiFailed ? '【AI判定できず】' : SHORT_KIND[item.kind];
  const time = withTime ? `（${receivedLabel(item.receivedMs, nowMs)}）` : '';
  const subject = truncateChars(stripUrls(item.subject.replace(/\s+/g, ' ').trim()), SUBJECT_MAX) || '(件名なし)';
  return `・${item.accountLabel}${head}${subject}${time}`;
}

function section(
  title: string,
  items: DigestItem[],
  shown: number,
  nowMs: number,
  withTime: boolean,
  total: number = items.length,
): string[] {
  const lines = [`■${title} ${total}件`];
  items.slice(0, shown).forEach((item) => lines.push(itemLine(item, nowMs, withTime)));
  if (total > shown) lines.push(`・ほか${total - shown}件`);
  return lines;
}

export function healthLines(health: DigestHealth[], nowMs: number, missing: string[] = []): string[] {
  const missingLines = missing.map((label) => `・${label}: 設定が欠けていて監視していません`);
  if (health.length === 0) return ['■稼働 監視中のアカウントがありません', ...missingLines];
  const bad = health.filter(
    (h) => h.lastSuccessMs === null || nowMs - h.lastSuccessMs > STALE_MS || h.consecutiveErrors >= ERROR_ALERT_MIN,
  );
  if (bad.length === 0 && missing.length === 0) {
    const oldest = Math.min(...health.map((h) => h.lastSuccessMs as number));
    return [`■稼働 ${health.length}アカウントとも正常（最終確認 ${jstHm(oldest)}）`];
  }
  return [
    '■稼働 要確認',
    ...bad.map((h) => {
      if (h.lastSuccessMs === null) return `・${h.label}: まだ一度も成功していません`;
      const errors = h.consecutiveErrors > 0 ? `（連続エラー${h.consecutiveErrors}回）` : '';
      return `・${h.label}: 最終成功 ${jstMd(h.lastSuccessMs)} ${jstHm(h.lastSuccessMs)}${errors}`;
    }),
    ...missingLines,
  ];
}

export function buildDigest(input: DigestInput): { title: string; message: string } {
  const footer = [
    `■件数 宣伝${input.counts.countOnly} / 自動通知${input.counts.aiLight}（AI判定できず${input.counts.aiFailed}）`,
    ...healthLines(input.health, input.nowMs, input.missing),
  ].join('\n');
  const room = Math.max(0, DIGEST_LIMIT - charLength(footer) - 1);

  const shown = { others: input.others.length, failures: input.failures.length, pending: input.pending.length };
  const foldOrder = ['others', 'failures', 'pending'] as const;
  const renderBody = () =>
    [
      ...section('未対応', input.pending, shown.pending, input.nowMs, true, input.pendingTotal ?? input.pending.length),
      ...section('自動化の失敗', input.failures, shown.failures, input.nowMs, false),
      ...section('お金・その他', input.others, shown.others, input.nowMs, false),
    ].join('\n');

  let body = renderBody();
  while (charLength(body) > room) {
    const key = foldOrder.reduce((a, b) => (shown[a] >= shown[b] ? a : b));
    if (shown[key] === 0) break;
    shown[key] -= 1;
    body = renderBody();
  }
  return { title: `朝のまとめ ${jstMd(input.nowMs)}`, message: `${truncateChars(body, room)}\n${footer}` };
}

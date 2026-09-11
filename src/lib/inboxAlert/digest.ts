// 受信箱アラート: 朝のまとめ(Pushover 1通・1024字以内)を組み立てる(純関数)。
// 未対応は返信かアーカイブで消えるまで毎朝載り続ける。件名はまとめを作る時にGmailから取り直す(DBに持たない)。
import type { Kind } from './classify';
import { charLength, jstHm, jstMd, receivedLabel, stripUrls, truncateChars } from './format';

export type DigestItem = { accountLabel: string; kind: Kind; subject: string; receivedMs: number; aiFailed: boolean };
export type DigestHealth = { label: string; lastSuccessMs: number | null; consecutiveErrors: number };
export type DigestInput = {
  nowMs: number;
  pending: DigestItem[];
  failures: DigestItem[];
  others: DigestItem[];
  counts: { countOnly: number; aiLight: number; aiFailed: number };
  health: DigestHealth[];
  /** 設定が欠けていて監視できないアカウントの表示名(accounts.ts の missingAccountLabels) */
  missing: string[];
};

export const DIGEST_LIMIT = 1024;
const STALE_MS = 30 * 60 * 1000;

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
  return `・${item.accountLabel}${head}${stripUrls(item.subject) || '(件名なし)'}${time}`;
}

function section(title: string, items: DigestItem[], shown: number, nowMs: number, withTime: boolean): string[] {
  const lines = [`■${title} ${items.length}件`];
  items.slice(0, shown).forEach((item) => lines.push(itemLine(item, nowMs, withTime)));
  if (items.length > shown) lines.push(`・ほか${items.length - shown}件`);
  return lines;
}

export function healthLines(health: DigestHealth[], nowMs: number, missing: string[] = []): string[] {
  const missingLines = missing.map((label) => `・${label}: 設定が欠けていて監視していません`);
  if (health.length === 0) return ['■稼働 監視中のアカウントがありません', ...missingLines];
  const bad = health.filter(
    (h) => h.lastSuccessMs === null || nowMs - h.lastSuccessMs > STALE_MS || h.consecutiveErrors > 0,
  );
  if (bad.length === 0 && missing.length === 0) {
    const oldest = Math.min(...health.map((h) => h.lastSuccessMs as number));
    return [`■稼働 ${health.length}アカウントとも正常（最終確認 ${jstHm(oldest)}）`];
  }
  return [
    '■稼働 要確認',
    ...bad.map((h) =>
      h.lastSuccessMs === null
        ? `・${h.label}: まだ一度も成功していません`
        : `・${h.label}: 最終成功 ${jstMd(h.lastSuccessMs)} ${jstHm(h.lastSuccessMs)}`,
    ),
    ...missingLines,
  ];
}

export function buildDigest(input: DigestInput): { title: string; message: string } {
  const shown = { others: input.others.length, failures: input.failures.length, pending: input.pending.length };
  const foldOrder = ['others', 'failures', 'pending'] as const;
  const render = () =>
    [
      ...section('未対応', input.pending, shown.pending, input.nowMs, true),
      ...section('自動化の失敗', input.failures, shown.failures, input.nowMs, false),
      ...section('お金・その他', input.others, shown.others, input.nowMs, false),
      `■件数 宣伝${input.counts.countOnly} / 自動通知${input.counts.aiLight}（AI判定できず${input.counts.aiFailed}）`,
      ...healthLines(input.health, input.nowMs, input.missing),
    ].join('\n');

  let message = render();
  while (charLength(message) > DIGEST_LIMIT) {
    const key = foldOrder.reduce((a, b) => (shown[a] >= shown[b] ? a : b));
    if (shown[key] === 0) break;
    shown[key] -= 1;
    message = render();
  }
  return { title: `朝のまとめ ${jstMd(input.nowMs)}`, message: truncateChars(message, DIGEST_LIMIT) };
}

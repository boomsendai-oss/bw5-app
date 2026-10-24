// メロジョイ在庫見張りの1回分: 取得 → 差分 → (入荷があれば)Pushover → 保存。
// 部品は引数で差し替えられる(テストではネットワークもDBも使わない)。
// ⚠️ 読むだけ。カート投入・購入は一切しない。
import {
  buildAlertMessage,
  diffVariants,
  fetchMellojoyVariants,
  type MjEvent,
  type MjState,
  type MjVariant,
} from './mellojoyWatch';
import { sendPushover, type PushoverMessage } from './inboxAlert/pushover';
import { loadMellojoyState, saveMellojoyRun } from './mellojoyWatchDb';
import { pushoverTarget } from './notify';

export type MellojoyRunDeps = {
  fetchVariants: () => Promise<MjVariant[]>;
  loadState: () => Promise<MjState[]>;
  save: (states: MjState[], events: MjEvent[]) => Promise<void>;
  /** Pushoverの送信先が未設定なら null */
  notify: ((msg: PushoverMessage) => Promise<void>) | null;
  now?: () => Date;
};

export type MellojoyRunResult = {
  ok: boolean;
  fetched: number;
  available: number;
  events: { kind: string; product: string }[];
  notified: boolean;
  error?: string;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runMellojoyWatch(deps: MellojoyRunDeps): Promise<MellojoyRunResult> {
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();

  let current: MjVariant[];
  try {
    current = await deps.fetchVariants();
  } catch (e) {
    // ストアのJSONはときどきHTMLを返す。軽い失敗として履歴に残すだけ(通知はしない)
    const error = errMsg(e);
    await deps
      .save([], [{ at: nowIso, kind: 'fetch_error', variantId: '', productTitle: '', price: '', detail: error.slice(0, 300) }])
      .catch((se) => console.error(`[mellojoy-watch] 取得失敗の記録にも失敗: ${errMsg(se)}`));
    return { ok: false, fetched: 0, available: 0, events: [{ kind: 'fetch_error', product: '' }], notified: false, error };
  }

  const prev = await deps.loadState();
  const diff = diffVariants(prev, current, nowIso);
  let { next, events } = diff;
  const { alerts } = diff;

  let notified = false;
  let error: string | undefined;
  if (alerts.length > 0) {
    if (!deps.notify) {
      error = 'Pushover未設定(PUSHOVER_USER_KEY / PUSHOVER_TOKEN_BOOM)';
      console.error(`[mellojoy-watch] 入荷 ${alerts.length}件を検知したが通知できない: ${error}`);
    } else {
      try {
        await deps.notify(buildAlertMessage(alerts));
        notified = true;
      } catch (e) {
        // 届かなかった入荷は「まだ見ていない」ことにして保存しない → 次の分の見張りでもう一度通知する
        error = `Pushover送信失敗: ${errMsg(e)}`;
        console.error(`[mellojoy-watch] ${error}`);
        const retry = new Set(alerts.map((a) => a.variantId));
        next = next.filter((s) => !retry.has(s.variantId));
        events = events.filter((ev) => !retry.has(ev.variantId));
      }
    }
  }

  await deps.save(next, events);

  return {
    ok: !error,
    fetched: current.length,
    available: current.filter((v) => v.available).length,
    events: events.map((e) => ({ kind: e.kind, product: e.productTitle })),
    notified,
    ...(error ? { error } : {}),
  };
}

/** 本番の部品で組み立てる(route.ts から呼ぶ) */
export async function runMellojoyWatchLive(env: Record<string, string | undefined> = process.env): Promise<MellojoyRunResult> {
  // 送り先は notifyTaro と同じ選び方(PUSHOVER_TOKEN_BOOM → TARO → …)
  const po = pushoverTarget(env);
  return runMellojoyWatch({
    fetchVariants: () => fetchMellojoyVariants(),
    loadState: loadMellojoyState,
    save: saveMellojoyRun,
    notify: po ? (msg) => sendPushover(po.appToken, po.userKey, msg) : null,
  });
}

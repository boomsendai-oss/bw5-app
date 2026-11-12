// BW6 発表会の公開ページ（/bw6 配下）の共通の読み込み。Server Action ではないふつうのモジュール（サーバの部品から呼ぶ）。
// 読むのは公開情報（発表会・設定）だけ。試しの切り替えは試し用の鍵が合う時だけ（recitalPreview.ts）。
import { RECITAL_EVENT, entryPhase, type EntryPhase, type RecitalSettings } from '@/lib/recital';
import { getRecitalEvent, getRecitalSettings, type RecitalEvent } from '@/lib/recitalDb';
import { isRecitalPreview, resolvePreviewEvent } from '@/lib/recitalPreview';
import { publicPhase } from '@/lib/recitalPublic';

export type RecitalPublicContext = {
  event: RecitalEvent | null;
  eventKey: string;
  settings: RecitalSettings;
  preview: boolean;
  pv: string | null;
  realPhase: EntryPhase;
  phase: EntryPhase;
  qs: string;
  nowMs: number;
};

/** 同じ名前の引数が2つ来ると配列になるので、文字1つだけを受ける */
function one(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

export async function getRecitalPublicContext(sp: { ev?: string; pv?: string }): Promise<RecitalPublicContext> {
  const ev = one(sp.ev);
  const pvIn = one(sp.pv);
  let evRow: RecitalEvent | null = null;
  if (ev && ev !== RECITAL_EVENT.live) evRow = await getRecitalEvent(ev);
  const { eventKey, preview } = resolvePreviewEvent(ev, pvIn, evRow?.is_test === 1);
  const [event, settings] = await Promise.all([
    evRow && evRow.event_key === eventKey ? Promise.resolve(evRow) : getRecitalEvent(eventKey),
    getRecitalSettings(eventKey),
  ]);
  const nowMs = Date.now();
  const realPhase = entryPhase(settings, nowMs);
  const phase = publicPhase(realPhase, preview, nowMs, settings);
  const pv = preview ? pvIn : null;
  // ページの中のリンクに付ける。試しの時だけ（本番の鍵＝?pv=…、試しの発表会＝?ev=…&pv=…）
  let qs = '';
  if (preview && pv) {
    qs = eventKey === RECITAL_EVENT.live
      ? `?pv=${encodeURIComponent(pv)}`
      : `?ev=${encodeURIComponent(eventKey)}&pv=${encodeURIComponent(pv)}`;
  }
  return { event, eventKey, settings, preview, pv, realPhase, phase, qs, nowMs };
}

/** 画面から来た eventKey を信じないための確かめ（13・14 の Server Action が使う）。本番か、鍵の合う is_test=1 の発表会だけ true */
export async function checkPublicEventKey(eventKey: string, pv: string | null): Promise<boolean> {
  if (eventKey === RECITAL_EVENT.live) return true;
  const ev = await getRecitalEvent(eventKey);
  return ev?.is_test === 1 && isRecitalPreview(eventKey, pv);
}

// BOOMアプリの住所（オリジン）の置き場。アプリの中で住所を書くときは、ここから読む（直書きしない）。
//
// - STAFF_ORIGIN : スタッフ画面・通知の中のリンク・cron など「中の人」向けの住所。
//                  正式な住所は app.boom-sendai.com に移す予定（2026-11-13〜・DNS が通ったらこの既定値を1行で切り替える）。
//                  NEXT_PUBLIC_BASE_URL があればそれを優先する。
// - PUBLIC_ORIGIN : 家庭・お客さん向けのページの住所（BW6・パーティーなど。2026-10-15〜）。
// - LEGACY_ORIGIN : 古い住所。外のサービスに登録済みのコールバック先などのため、ずっと開けておく。
//                  外の登録先を移すまでは、そこに渡す URL はこれを使う。
export const LEGACY_ORIGIN = 'https://bw5-app.vercel.app';
export const PUBLIC_ORIGIN = 'https://event.boom-sendai.com';

function trimSlash(v: string): string {
  return v.replace(/\/+$/, '');
}

export const STAFF_ORIGIN: string = trimSlash(process.env.NEXT_PUBLIC_BASE_URL?.trim() || LEGACY_ORIGIN);

/** 届いたリクエストのホストが取れないときの予備（host ヘッダが無いことは本番ではまず無い） */
export const FALLBACK_HOST: string = new URL(STAFF_ORIGIN).host;

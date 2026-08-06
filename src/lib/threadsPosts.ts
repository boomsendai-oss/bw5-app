// Threadsテキスト投稿キュー(SNSテキスト配信レーン 2026-08-06設計)の純関数群。
// x_posts(承認キュー)の姉妹テーブル threads_posts を扱う。
//
// 承認の考え方: threads_posts.x_post_id でリンクされた行は**Xの承認に追従**する
// (TAROの承認操作は /staff/x-posts の1回だけ。Threads側で二重承認させない)。
// リンクなしの行(Threads単独投稿)は将来のUI/スクリプトで直接 approved にする。
//
// due判定・古い順・最大N件の選定は xPosts.pickDuePosts(テスト済み・ジェネリック)を流用する。

export type ThreadsPostRow = {
  id: number;
  x_post_id: number | null;
  text: string;
  scheduled_at: string | null;
  status: string;
  posted_thread_id: string | null;
  permalink: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

/** Threadsのテキスト投稿上限(公式仕様) */
export const THREADS_TEXT_MAX = 500;

/** 1回のcronで処理する最大件数(x-autopostと同じ) */
export const MAX_THREADS_POSTS_PER_RUN = 5;

/** 投稿テキストの事前検証。OKなら null、NGなら理由を返す */
export function validateThreadsText(text: unknown): string | null {
  if (typeof text !== 'string') return 'テキストが文字列ではありません';
  if (text.trim().length === 0) return 'テキストが空です';
  if ([...text].length > THREADS_TEXT_MAX) {
    return `テキストが${THREADS_TEXT_MAX}字を超えています(${[...text].length}字)`;
  }
  return null;
}

/**
 * リンクされたX投稿のステータスに追従するかの判定。
 * 追従は threads側が draft のときだけ(承認後の状態はcronが管理するので触らない)。
 *  - X が approved/posting/posted → approve (人間が公開OKを出した内容)
 *  - X が rejected               → reject  (ボツも追従)
 *  - それ以外(draft/failed/リンク先なし) → none
 *    (failedはX API起因の失敗でありThreads可否とは無関係だが、差し戻し→再承認の
 *     運用に合わせて approved になるのを待つ)
 */
export function resolveLinkedAction(
  threadsStatus: string,
  xStatus: string | null
): 'approve' | 'reject' | 'none' {
  if (threadsStatus !== 'draft') return 'none';
  if (xStatus === 'approved' || xStatus === 'posting' || xStatus === 'posted') return 'approve';
  if (xStatus === 'rejected') return 'reject';
  return 'none';
}

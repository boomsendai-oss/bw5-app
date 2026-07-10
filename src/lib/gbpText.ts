// GBPクチコミ本文の整形 (クライアント/サーバー共用の純関数)
//
// GBP APIは日本語クチコミに英訳を前置して返すことがある:
//   "(Translated by Google) ...英訳... (Original) ...原文..."
// 表示・ドラフト生成には原文だけを使う。マーカーが無ければそのまま返す。
export function extractOriginalComment(comment?: string | null): string {
  if (!comment) return '';
  const m = comment.match(/\(Original\)\s*([\s\S]*)$/);
  if (m) return m[1].trim();
  // 英訳のみで (Original) が無い形式は先頭マーカーだけ除去
  return comment.replace(/^\(Translated by Google\)\s*/i, '').trim();
}

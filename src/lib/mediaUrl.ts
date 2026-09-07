// リール素材(動画/カバー)の公開URL解決。
//
// 2026-09-08 R2移行: reel_queue.video_path / cover_path と reel_draft.* のパスは
// R2 の絶対URL(https://media.boom-sendai.com/reels/...)になった。
// 移行前の行や手動投入の相対パス(/reels/...)も、自分の origin から配信する形で引き続き通す。
//
// Meta(Instagram/Threads/Facebook)は「公開HTTPS・リダイレクト無し・正しいContent-Type」の
// URLを取りに来るので、ここで返すURLは必ず直リンクにすること(Vercelのrewrite/redirect経由は不可)。
export function resolveMediaUrl(pathOrUrl: string, origin: string): string {
  const p = String(pathOrUrl);
  if (/^https?:\/\//i.test(p)) return p;
  // 素材URLは必ずパーセントエンコードして渡す(2026-07-28障害: ファイル名に日本語が入ると
  // Instagram側のフェッチが失敗し status_code=ERROR になり投稿されなかった)。
  const encoded = p.split('/').map(encodeURIComponent).join('/');
  return `${origin.replace(/\/$/, '')}${encoded.startsWith('/') ? '' : '/'}${encoded}`;
}

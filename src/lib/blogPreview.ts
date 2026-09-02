// スタッフ画面のブログプレビュー用の純関数 (2026-09-02)

/**
 * 自動下書き(auto-blog v2)は本文先頭に `<!-- TARO向けメモ -->` を持つ。
 * 公開画面では描画されないが、プレビューでは「メモ」として別枠に見せたいので本文から切り出す。
 * 先頭以外のHTMLコメントも本文からは除く(公開画面と同じ見え方にするため)。
 */
export function splitDraftMemo(markdown: string): { memo: string | null; body: string } {
  const src = (markdown ?? '').replace(/\r\n/g, '\n');
  const m = src.match(/^\s*<!--([\s\S]*?)-->\s*/);
  const memo = m ? m[1].trim() : null;
  const rest = m ? src.slice(m[0].length) : src;
  const body = rest.replace(/<!--[\s\S]*?-->/g, '').trim();
  return { memo: memo && memo.length ? memo : null, body };
}

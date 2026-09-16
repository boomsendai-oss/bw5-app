// LEDのVS画面に出すジャンル表記を揃える。
//
// 申込フォームは自由入力なので、同じ踊りが何通りもの綴りで入っている
// (本番データで BREAK / Break / Breaking / breakin' / BREAKIN' の5通り、
//  HIPHOP / HIP HOP / hiphop の3通り)。
// 名前の下に大きく出すようになったので、そのまま出すと雑に見える。
//
// ⚠️ ここで直すのは「表示」だけ。申込データ(bf_order_items.genre)は本人の記入を残す。
// ⚠️ 知らない言葉は大文字にするだけ。勝手に別の踊りの名前に置き換えない。

/** 同じ踊りの綴り違い。左の形に見えたら右に揃える。 */
const CANON: { match: RegExp; to: string }[] = [
  // BREAK / BREAKING / BREAKIN' / ブレイキン → BREAKIN'
  //(TAROが山形のLITを BREAKIN' に直したのに合わせる・2026-09-14)
  { match: /^(BREAK|BREAKIN|BREAKING|BREAKDANCE|ブレイキン|ブレイク|ブレイクダンス)$/, to: "BREAKIN'" },
  { match: /^(HIPHOP|ヒップホップ)$/, to: 'HIPHOP' },
  { match: /^(HOUSE|ハウス)$/, to: 'HOUSE' },
  { match: /^(LOCK|LOCKIN|LOCKING|ロック|ロッキング)$/, to: 'LOCK' },
  { match: /^(POP|POPPIN|POPPING|ポップ|ポッピング)$/, to: 'POPPING' },
  { match: /^(WAACK|WAACKIN|WAACKING|ワック|ワッキング)$/, to: 'WAACK' },
];

/** ひとつぶんのジャンル名を揃える。 */
function canonOne(raw: string): string {
  const up = raw
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    // 「HIP HOP」「HIP-HOP」のような中の区切りを落として比べる
    .replace(/[\s\-_.]+/g, '');
  const stripped = up.replace(/'+$/, ''); // 末尾のアポストロフィは綴り違いとして扱う
  for (const c of CANON) {
    if (c.match.test(stripped)) return c.to;
  }
  // 知らない言葉は元の区切りを残したまま大文字にするだけ
  return raw.normalize('NFKC').trim().toUpperCase();
}

/**
 * LEDに出す形にする。複数ジャンルは「/」区切りに揃え、それぞれを直す。
 * 空なら空を返す(名前の下に何も出さない)。
 */
export function ledGenre(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  if (s.includes('/')) {
    return s
      .split('/')
      .map((part) => canonOne(part))
      .filter((part) => part !== '')
      .join('/');
  }
  return canonOne(s);
}

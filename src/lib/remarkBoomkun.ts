// boom-hp/src/lib/remark-boomkun.ts のコピー(2026-09-02)。スタッフ画面のブログプレビューで公開画面と同じ吹き出し判定をするため。
// ⚠️ 本体を直したらこちらも同期すること(判定がズレると「プレビューでは吹き出しなのに本番では地の文」が起きる)。
/**
 * ブログ本文の BOOMくん を吹き出しUIに変換する remark プラグイン。
 *
 * 対応する2つの書き方（どちらも同じ吹き出しコンポーネントで表示される）:
 *   ① メモ  `> 🕺 **BOOMくんメモ**: 〜`       (blockquote)  → ラベル「🕺 BOOMくんメモ」
 *   ② 疑問  `🕺 BOOMくん「〜」`               (通常の段落)   → ラベル「🕺 BOOMくん」
 *
 * ②は型v2で追加した「読者の疑問をBOOMくんが代弁する」書き方。
 * ⚠️ 以前はこのプラグインが①しか知らなかったため、②は変換されず
 *    絵文字つきの地の文としてそのまま出ていた（同じ記事内でBOOMくんの見た目が
 *    2種類になる不具合・2026-08-22修正）。書き方を増やすときは必ずここも増やすこと。
 *
 * マーカー（🕺・ラベル・コロン・カギ括弧）はmdastから取り除き、
 * className を付与する。ReactMarkdown側のblockquoteコンポーネントが
 * このclassNameを見て吹き出しUIに差し替える。
 * 太字なし・全角コロンの表記ゆれも許容する。
 */

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hProperties?: Record<string, unknown> };
}

/** ① メモ形式（blockquote）*/
const MARKER_MEMO = /^🕺\s*BOOMくんメモ\s*[:：]\s*/u;
/** ② 疑問形式（段落）。「〜」で始まるものだけを対象にする */
const MARKER_ASK = /^🕺\s*BOOMくん\s*(?=「)/u;

function textOf(node: MdNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** 先頭から plain-text 換算で n 文字ぶんをノード列から削る（残り文字数を返す） */
function consume(node: MdNode, n: number): number {
  const children = node.children ?? [];
  while (n > 0 && children.length > 0) {
    const child = children[0];
    if (child.type === "text") {
      const value = child.value ?? "";
      if (value.length <= n) {
        n -= value.length;
        children.shift();
      } else {
        child.value = value.slice(n);
        n = 0;
      }
    } else if (child.children) {
      n = consume(child, n);
      if (child.children.length === 0) children.shift();
    } else {
      break;
    }
  }
  return n;
}

/** 末尾の1文字が ch なら削る（吹き出しの中では閉じカギ括弧が余分なため）*/
function trimTrailingChar(node: MdNode, ch: string): void {
  const children = node.children ?? [];
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child.type === "text") {
      const value = child.value ?? "";
      if (value.endsWith(ch)) {
        child.value = value.slice(0, -ch.length);
        if (child.value === "") children.splice(i, 1);
      }
      return;
    }
    if (child.children?.length) {
      trimTrailingChar(child, ch);
      return;
    }
  }
}

function setClass(node: MdNode, className: string): void {
  node.data = {
    ...node.data,
    hProperties: { ...node.data?.hProperties, className },
  };
}

function visit(node: MdNode) {
  const children = node.children ?? [];

  for (const child of children) {
    // ① メモ形式: blockquote の先頭段落がマーカーで始まる
    if (child.type === "blockquote") {
      const first = child.children?.[0];
      if (first?.type === "paragraph") {
        const m = textOf(first).match(MARKER_MEMO);
        if (m) {
          consume(first, m[0].length);
          if ((first.children ?? []).length === 0) child.children?.shift();
          setClass(child, "boomkun-memo");
        }
      }
      continue;
    }

    // ② 疑問形式: 段落そのものが `🕺 BOOMくん「〜」`
    if (child.type === "paragraph") {
      const m = textOf(child).match(MARKER_ASK);
      if (m) {
        consume(child, m[0].length + 1); // マーカー + 開きカギ括弧「
        trimTrailingChar(child, "」");
        // 段落を blockquote に作り替えて、既存の吹き出し描画に相乗りする
        const inner: MdNode = { type: "paragraph", children: [...(child.children ?? [])] };
        child.type = "blockquote";
        child.children = [inner];
        setClass(child, "boomkun-ask");
      }
      continue;
    }
  }

  for (const child of children) visit(child);
}

export default function remarkBoomkun() {
  return (tree: MdNode) => {
    visit(tree);
  };
}

// リールの他SNS横展開 — 純関数のみ(API呼び出しは youtube.ts / xApi.ts 側)。
//
// Instagram向けに書いたキャプションをそのまま他所へ流すと、それぞれの作法から外れる:
//   - X: 280文字。ハッシュタグを盛ると読みにくく、リンクも文字数を食う
//   - YouTube: タイトルと説明が別。#Shorts が無いとShortsとして扱われないことがある
// ここでプラットフォームごとに整形する。

import { OFFICIAL_LINE_URL, WEBSITE_URL } from './links';

/** 横展開する配信先 */
export const CROSSPOST_PLATFORMS = ['youtube', 'x'] as const;
export type Platform = (typeof CROSSPOST_PLATFORMS)[number];

/** X の本文上限(通常アカウント) */
export const X_TEXT_MAX = 280;
/** YouTube のタイトル上限 */
export const YT_TITLE_MAX = 100;
/** YouTube の説明上限 */
export const YT_DESCRIPTION_MAX = 5000;

/**
 * キャプションからハッシュタグ行を切り離す。
 * BOOMのリールは「本文 → 空行 → #タグの塊」という形なので、末尾のタグ群だけを抜く。
 */
export function splitCaption(caption: string): { body: string; tags: string[] } {
  const lines = (caption ?? '').split('\n');
  const tags: string[] = [];
  let end = lines.length;
  // 末尾から、タグだけ/空行の行を食べる
  while (end > 0) {
    const line = lines[end - 1].trim();
    if (line === '') {
      end--;
      continue;
    }
    const words = line.split(/\s+/);
    if (words.length > 0 && words.every((w) => w.startsWith('#') && w.length > 1)) {
      tags.unshift(...words);
      end--;
      continue;
    }
    break;
  }
  return { body: lines.slice(0, end).join('\n').trim(), tags };
}

/**
 * Instagram向けキャプションの `@ハンドル` を、Instagram以外で無害な形に直す。
 *
 * ⚠️ ここを通さないと**赤の他人にメンションが飛ぶ**(TARO 2026-08-05指摘)。
 * キャプションの `@m55keiko` などは Instagram のアカウント名だが、
 * X も YouTube も `@〜` を「自分のところのアカウント」として解釈してリンクにする。
 * 同じ文字列のX/YouTubeアカウントが実在すれば、その無関係な人に通知が飛ぶ。
 *
 * 方針:
 *  - 講師 … 登録簿で名前が引ければ `🕺講師：RYUKI` のように**名前**へ置き換える。
 *            引けない場合は @ ごと落とす(間違ったリンクを作るより、無いほうがまし)。
 *  - CAST … 生徒のInstagramアカウントなので**行ごと落とす**。
 *            Instagram以外では宛先が存在しないうえ、誤爆すると無関係の人を巻き込む。
 *
 * @param nameByHandle Instagramハンドル(小文字・@なし) → 表示名
 */
export function sanitizeHandlesForOtherPlatform(
  caption: string,
  nameByHandle: Record<string, string> = {}
): string {
  const lines = (caption ?? '').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    // CAST行(旧表記の「出演：」も含む)は丸ごと落とす
    if (/^\s*(CAST\s*[:：]|出演\s*[:：])/i.test(line)) continue;

    const replaced = line.replace(/@([A-Za-z0-9._]+)/g, (_m, h: string) => {
      const name = nameByHandle[String(h).toLowerCase()];
      return name ?? '';
    });

    // 置換の結果「講師：」だけが残った行は、情報が無いので落とす
    if (replaced !== line && /^\s*(🕺)?\s*講師\s*[:：]\s*$/.test(replaced)) continue;
    out.push(replaced.replace(/[ \t]+$/, ''));
  }
  // 落とした行の跡で空行が3つ以上並ばないようにする
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 全角を2文字として数えない(Xは日本語も1文字=1カウントではないが、実運用は文字数で足りる) */
function truncate(s: string, max: number): string {
  const chars = [...s];
  if (chars.length <= max) return s;
  return chars.slice(0, max - 1).join('') + '…';
}

/**
 * Instagram向けの文言をX向けに言い換える。
 *
 * キャプションは「プロフィールの公式LINEから」のようにInstagram前提で書かれている。
 * Instagramは本文にリンクが貼れないのでbioへ誘導するしかないが、Xでは事情が違う:
 * BOOMのX投稿は**本体にリンクを入れず、直後のリプライに導線を置く**(buildXReplyCta参照)。
 * なので誘導先は「プロフィール」ではなく「リプライ欄」。
 */
function localizeForX(body: string): string {
  return body.replace(/プロフィール/g, 'リプライ欄');
}

/**
 * X用の本文を作る。
 * - 本文を優先し、余った文字数にだけタグを足す(タグで本文が削れるのを防ぐ)
 * - リンクは呼び出し側で足さない。Xは動画付きポストにリンクを入れると表示が弱くなる
 */
export function buildXText(caption: string, opts?: { maxTags?: number }): string {
  const { body, tags } = splitCaption(caption);
  const maxTags = opts?.maxTags ?? 3;
  const base = truncate(localizeForX(body), X_TEXT_MAX);
  if ([...base].length >= X_TEXT_MAX - 8) return base;

  let out = base;
  for (const tag of tags.slice(0, maxTags)) {
    const next = `${out}\n${tag}`;
    if ([...next].length > X_TEXT_MAX) break;
    // 同じ行に足せるならそちらを優先(改行を無駄に増やさない)
    const inline = out.endsWith('\n') ? `${out}${tag}` : `${out} ${tag}`;
    out = [...inline].length <= X_TEXT_MAX ? inline : next;
    if ([...out].length > X_TEXT_MAX) break;
  }
  return out;
}

/**
 * X用の導線テキスト。**本文ではなくリプライに投げる**前提。
 *
 * Xは外部リンクを含む投稿の表示が伸びにくい(プラットフォーム外へ人を出すため)。
 * 一方でリンクが無いと、見た人が申込に辿り着けない。
 * 本体はリンク無しで出し、直後に自分へのリプライでリンクを足すと、
 * 本体の表示を犠牲にせずに導線を確保できる。
 */
export function buildXReplyCta(): string {
  return ['体験レッスン(無料)のご予約・ご相談は公式LINEからどうぞ。', OFFICIAL_LINE_URL].join('\n');
}

/**
 * Instagram向けの文言をYouTube向けに言い換える。
 *
 * キャプションは「プロフィールの公式LINEから」のようにInstagram前提で書かれている。
 * Instagramはリンクが貼れないので"プロフィール(bio)を見て"と誘導するしかないが、
 * YouTubeでは説明欄のURLがそのまま押せる。文言をYouTubeの用語に合わせる。
 */
function localizeForYouTube(body: string): string {
  return body.replace(/プロフィール/g, '概要欄');
}

/** 説明欄の末尾に付ける導線。YouTubeは説明のURLがリンクになる */
function buildCtaBlock(): string {
  return [
    '▼ 体験レッスン(無料)のご予約・ご相談はこちら',
    `公式LINE: ${OFFICIAL_LINE_URL}`,
    `ホームページ: ${WEBSITE_URL}`,
  ].join('\n');
}

/**
 * YouTube Shorts用のタイトルと説明を作る。
 * タイトル = キャプション1行目(【】があれば中身を優先)。
 * 説明     = 本文 + 導線(公式LINE/HP) + タグ + #Shorts。
 *
 * 導線を入れるのは、YouTubeから来た人が体験申込に辿り着けるようにするため。
 * チャンネルの概要欄にもリンクはあるが、動画→チャンネル→概要→リンクと
 * 3タップかかる。説明欄に置けば1タップで届く。
 */
export function buildYouTubeMeta(
  title: string,
  caption: string
): { title: string; description: string; tags: string[] } {
  const { body, tags } = splitCaption(caption);
  const firstLine = body.split('\n').find((l) => l.trim()) ?? '';
  // 【〜】で始まるキャプションが多いので、括弧の中身を見出しにする
  const bracket = firstLine.match(/^【(.+?)】(.*)$/);
  const headline = bracket ? `${bracket[1]}${bracket[2] ? ' ' + bracket[2].trim() : ''}` : firstLine;
  const ytTitle = truncate((headline || title).trim(), YT_TITLE_MAX);

  // #Shorts はShortsとして認識させるための保険(縦動画かつ3分以内が本来の条件)
  const tagLine = [...new Set([...tags, '#Shorts'])].join(' ');
  const cta = buildCtaBlock();

  // 導線とタグの分を先に確保してから本文を詰める。
  // 全部つないでから切ると、本文が長い回だけ導線が消えるという最悪の壊れ方をする
  const fixed = `\n\n${cta}\n\n${tagLine}`;
  const bodyBudget = YT_DESCRIPTION_MAX - [...fixed].length;
  const bodyText = truncate(localizeForYouTube(body).trim(), Math.max(0, bodyBudget));
  const description = `${bodyText}${fixed}`.trim();

  // YouTubeのtagsフィールドは # を含めない
  const ytTags = tags.map((t) => t.replace(/^#/, '')).filter(Boolean).slice(0, 15);
  return { title: ytTitle, description, tags: ytTags };
}

export type CrosspostRow = {
  id: number;
  reel_id: number;
  platform: string;
  status: string;
  attempts: number;
};

/** 1回の実行で許すリトライ回数。これを超えたら failed のまま放置してTAROに見せる */
export const MAX_ATTEMPTS = 3;

/**
 * 今回処理する対象を選ぶ。
 * - pending か、failed でまだ試行回数が残っているもの
 * - 1回の実行で1件だけ(APIのレート制限を食い潰さない。特にXの無料枠は
 *   /initialize と /finalize が24時間で17回しかない)
 */
export function pickNext(rows: CrosspostRow[]): CrosspostRow | null {
  const candidates = rows.filter(
    (r) => r.status === 'pending' || (r.status === 'failed' && r.attempts < MAX_ATTEMPTS)
  );
  if (candidates.length === 0) return null;
  // pending を先に、次に試行回数の少ないもの、次に**新しいリールから**。
  // reel_id で明示的に並べるのは、SQLに ORDER BY が無いと「どのリールが最初に
  // 公開されるか」が実行ごとに変わってしまうため(初回は過去分がまとめて対象になる)。
  // 新しい順にするのは、いま出して価値があるのは直近のリールだから。
  candidates.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    if (a.attempts !== b.attempts) return a.attempts - b.attempts;
    if (a.reel_id !== b.reel_id) return b.reel_id - a.reel_id;
    return a.id - b.id;
  });
  return candidates[0];
}

export type ClassifiedRows = {
  /** env未設定なので skipped にする行 */
  toSkip: CrosspostRow[];
  /** envが入ったので pending に戻す行 */
  toRevive: CrosspostRow[];
  /** そのまま pickNext に渡してよい行 */
  actionable: CrosspostRow[];
};

/**
 * envの設定状況で行を仕分ける。
 *
 * `skipped` を**復活させる**のが要点。env未設定のプラットフォームは skipped にして
 * 無駄な再試行を止めるが、これを永続にすると「YouTubeのトークンを後から入れたのに
 * 既存のリールが1本も上がらない」という無言の穴になる
 * (enqueueMissing は INSERT OR IGNORE なので行は作り直されない)。
 * env が入った時点で pending に戻し、投入とenv設定の順序に依存しないようにする。
 *
 * 復活した行は actionable に含めない。DBを pending に更新したうえで、次回の実行で
 * 通常の経路(pickNext)から拾わせる — 復活と投稿を同じ実行に混ぜない。
 */
export function classifyByEnabled(
  rows: CrosspostRow[],
  enabled: Set<string>
): ClassifiedRows {
  const toSkip: CrosspostRow[] = [];
  const toRevive: CrosspostRow[] = [];
  const actionable: CrosspostRow[] = [];
  for (const r of rows) {
    if (!enabled.has(r.platform)) {
      // すでに skipped なら触らない(毎回UPDATEを打たない)
      if (r.status !== 'skipped') toSkip.push(r);
      continue;
    }
    if (r.status === 'skipped') {
      toRevive.push(r);
      continue;
    }
    actionable.push(r);
  }
  return { toSkip, toRevive, actionable };
}

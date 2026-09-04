// ブログ自動下書き v2 (2026-09-02・ブログ編集セッション)
//
// 何をするか:
//   GSCの検索語スナップショット(gsc_query_snapshots)から「Googleがもう表示し始めているのに
//   受け皿の記事が無い語」を拾い、その語に答える記事を Claude に書かせ、blog_posts に
//   **下書き(is_published=0, auto_generated=1)** として入れる。公開は必ずTAROが /staff/blog で承認。
//
// なぜ二段構え(Batch API)か:
//   Vercelは Hobby プラン=関数60秒制限。記事1本(3,000〜4,000字)の生成は2〜3分かかるので
//   関数内では完走できない。Anthropic Message Batches に投げて(数秒)、後の起動で回収する(数秒)。
//   50%割引で、ANTHROPIC_API_KEY は本番Vercelに既にあるので新しい鍵作業も不要。
//
// 旧実装(boom-hp/scripts/generate-blog-post.ts・2026-06)との違い:
//   - 即公開 → 下書き+承認 (旧実装の唯一の欠陥)
//   - 固定テーマプール → GSC実測の語 (当てずっぽうを撃たない)
//   - claude-sonnet-4-20250514 → claude-opus-5
//   - 書き口ガイド(hub docs/decisions/2026-07-17_blog-style-guide.md)+型v2+TARO文体法則を同梱
//
// 純関数(テスト対象)と IO を分けている。IO は route から呼ぶ。
import Anthropic from '@anthropic-ai/sdk';
import { execute, getAll, getOne } from './db';

// =====================================================================
// 型
// =====================================================================
export type GscQuery = { query: string; impressions: number; clicks: number; position: number };

export type TopicCluster = {
  /** 代表語(未カバー語のうち最長) */
  key: string;
  /** この束に入った検索語 */
  queries: { query: string; impressions: number; position: number; isNew: boolean }[];
  /** 表示回数の合計(新規語は2倍で加点) */
  score: number;
  /** 未カバー語の集合 */
  uncovered: string[];
};

export type ExistingPost = { slug: string; title: string; keywords: string; excerpt: string };

export type DraftFacts = {
  classesByArea: Record<string, string[]>;
  instructors: string[];
  existingPosts: { slug: string; title: string }[];
};

export type GeneratedDraft = {
  title: string;
  slug_en: string;
  category: string;
  excerpt: string;
  keywords: string[];
  content_markdown: string;
  seed_queries_used: string[];
  memo_for_taro: string;
};

export type PendingBatch = {
  batch_id: string;
  custom_id: string;
  topic_key: string;
  seed_queries: string[];
  structure: string;
  submitted_at: string;
};

// =====================================================================
// 検索語の正規化・束ね(純関数)
// =====================================================================

/** 検索語の中で意味を持たない汎用語(これだけでは記事テーマにならない) */
const STOP_TOKENS = new Set([
  '仙台', '仙台市', '宮城', '宮城県', 'ダンス', '教室', 'スクール', 'ダンススクール', 'ダンス教室',
  'boom', 'ブーム', '近く', 'おすすめ', '人気', '一覧', 'とは', 'について',
  // 「遅くない」「大丈夫」のような態度語はそれ自体が題材にならない(何歳から系の記事が受け皿)
  '遅くない', '遅い', '大丈夫', '無理', '意味', '効果', 'メリット', 'デメリット',
  // 助詞・組織形態語(「サークル」は探している主体の言い換えで、話題そのものではない)
  'から', 'まで', 'でも', 'サークル', 'ダンシング',
]);

/** BOOMが提供していない/取りにいかない検索語(記事にしない) */
const EXCLUDE_QUERY = /ポールダンス|チア|バレエ|社交|ボールルーム|k-?pop|フラ(ダンス)?|ベリーダンス|ヨガ|ズンバ|zumba|求人|採用|バイト|アルバイト|講師募集|^boom|ブーム$|ダンスブーム|ttsu|ちゃんなつ|さゆき|sayuki|k@ttsu|kattsu|おっちゃん|keiko|aoi|yuri|ryuki|kokeko|taro|リュウキ|りゅうき|ケイコ|けいこ|あおい|アオイ|ゆり|ユリ|こけこ|コケコ|カッツ|かっつ|イルカーニバル/i;

/** くっついて1語になっている複合語を分ける(GSCは「仙台ダンススクール」を1語で返す) */
const COMPOUND_SPLITS: [RegExp, string][] = [
  [/ダンススクール仙台/g, 'ダンススクール 仙台'],
  [/ダンス教室仙台/g, 'ダンス教室 仙台'],
  [/仙台ダンススクール/g, '仙台 ダンススクール'],
  [/仙台ダンス教室/g, '仙台 ダンス教室'],
  [/仙台ダンス/g, '仙台 ダンス'],
  [/ダンス何歳から/g, 'ダンス 何歳から'],
  [/キッズダンス/g, 'キッズダンス'],
];

export function normalizeQuery(q: string): string {
  let s = q.toLowerCase().replace(/[#＃]/g, ' ').replace(/[　]+/g, ' ').trim();
  for (const [re, rep] of COMPOUND_SPLITS) s = s.replace(re, rep);
  return s.replace(/\s+/g, ' ').trim();
}

export function tokenizeQuery(q: string): string[] {
  return normalizeQuery(q)
    .split(' ')
    .map((t) => t.trim())
    // 1文字(「何」「歳」)は分かち書きの断片なので捨てる
    .filter((t) => t.length >= 2 && !STOP_TOKENS.has(t));
}

export function isExcludedQuery(q: string): boolean {
  return EXCLUDE_QUERY.test(normalizeQuery(q));
}

/**
 * 既存記事(タイトル/キーワード/抜粋)をひとつの小文字コーパスにする。
 * ここに含まれる語は「受け皿がある」とみなす。
 */
export function buildCoverageCorpus(posts: ExistingPost[], extraCovered: string[] = []): string {
  const parts = posts.map((p) => `${p.title} ${p.keywords} ${p.excerpt}`);
  return [...parts, ...extraCovered].join('\n').toLowerCase();
}

/** 語尾を段階的に落として「何歳から始める」→「何歳から」のように既存記事と突き合わせる */
const STEM_SUFFIXES = /(から始める|から始めたい|からでも|始める|始めたい|はじめる|遅くない|でも|まで|近く|教室|スクール|サークル|ダンス|の)$/u;

/**
 * 言い換え(受け皿判定用): 検索語側と記事側で違う言葉を使っていても同じ話題とみなす。
 * ⚠️ シニアは「シニア/高齢」と明示した記事だけを受け皿にする。40-50代記事が「60代」に触れているだけで
 *    シニア検索の受け皿ありと判定してしまうと、本当に空いている題材を見逃す(2026-09-02実データで発生)
 */
const SYNONYM_GROUPS: string[][] = [
  ['シニア', '高齢', '熟年', 'シルバー'],
  ['お金', '費用', '月謝', '料金', '値段', '相場', 'いくら'],
  ['何歳', '年齢', '始めどき', '何才'],
  ['大人', '社会人', '30代', '40代', '50代'],
  ['子供', '子ども', 'キッズ', '小学生', '幼児'],
  ['初心者', '未経験', 'はじめて', '初めて'],
];

/** 束ね用(受け皿判定より広い): 「シニアダンス」と「60歳からのダンス教室」を同じ束にする */
const CLUSTER_GROUPS: string[][] = [
  ['シニア', '60歳', '60代', '70歳', '70代', '高齢', '熟年', 'シルバー'],
  ...SYNONYM_GROUPS.slice(1),
];

/** 束のキーを代表語に寄せる */
export function canonicalKey(token: string): string {
  for (const g of CLUSTER_GROUPS) if (g.some((w) => token.includes(w))) return g[0];
  return token;
}

export function isTokenCovered(token: string, corpus: string): boolean {
  let t = token;
  for (let i = 0; i < 6 && t.length >= 2; i++) {
    if (corpus.includes(t)) return true;
    const next = t.replace(STEM_SUFFIXES, '');
    if (next === t) break;
    t = next;
  }
  for (const g of SYNONYM_GROUPS) {
    if (g.some((w) => token.includes(w)) && g.some((w) => corpus.includes(w))) return true;
  }
  return false;
}

/**
 * 「表示はあるのに受け皿の記事が無い語」を束ねてスコア順に返す。
 * - prevQueries が与えられ、そこに無い語は「今週新しく表示が付いた語」として2倍に加点
 * - minImpressions 未満の語は捨てる(ノイズ)
 */
export function pickTopicClusters(
  queries: GscQuery[],
  corpus: string,
  opts: { prevQueries?: Set<string>; minImpressions?: number; limit?: number } = {}
): TopicCluster[] {
  const minImp = opts.minImpressions ?? 3;
  const limit = opts.limit ?? 5;
  const clusters = new Map<string, TopicCluster>();

  for (const q of queries) {
    if (q.impressions < minImp) continue;
    if (isExcludedQuery(q.query)) continue;
    const toks = tokenizeQuery(q.query);
    if (!toks.length) continue;
    const uncovered = toks.filter((t) => !isTokenCovered(t, corpus));
    if (!uncovered.length) continue;
    // 代表語=未カバー語のうち最長(「仙台市青葉区」が「大人」より先に立つように)
    const key = canonicalKey([...uncovered].sort((a, b) => b.length - a.length || a.localeCompare(b))[0]);
    const isNew = opts.prevQueries ? !opts.prevQueries.has(normalizeQuery(q.query)) : false;
    const gain = q.impressions * (isNew ? 2 : 1);
    const c = clusters.get(key) ?? { key, queries: [], score: 0, uncovered: [] };
    c.queries.push({ query: q.query, impressions: q.impressions, position: q.position, isNew });
    c.score += gain;
    for (const u of uncovered) if (!c.uncovered.includes(u)) c.uncovered.push(u);
    clusters.set(key, c);
  }

  return [...clusters.values()]
    .map((c) => ({ ...c, queries: c.queries.sort((a, b) => b.impressions - a.impressions) }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, limit);
}

// =====================================================================
// 生成結果の検証(純関数)
// =====================================================================

const BOOMKUN_MEMO = /^>\s*🕺\s*(?:\*\*)?BOOMくんメモ(?:\*\*)?\s*[:：]/u;
const BOOMKUN_ASK = /^🕺\s*BOOMくん\s*「.*」\s*$/u;
/** 閉じ`**`の直前が閉じ括弧類だとCommonMarkが閉じ判定せず`**`が生で出る */
const BOLD_TRAP = /[」）)]\*\*[^\s、。\n]/u;
const NG_PHRASES = ['勧誘はしません', '講師全員現役プロ', '講師は全員現役', '絶対に', '必ず上達'];

export type ValidationResult = { ok: boolean; issues: string[]; content_markdown: string };

/**
 * 講師名が地の文で呼び捨てになっている行を返す(TARO指摘2026-09-02「ちゃんなつ先生にした方がいい」)。
 * 表の行(| で始まる)・HTMLコメント・「BOOM代表のTARO」の自己紹介は対象外。
 */
export function findBareInstructorNames(md: string, instructorNames: string[]): string[] {
  const issues: string[] = [];
  const lines = md.split('\n');
  lines.forEach((line, i) => {
    if (line.startsWith('|') || line.startsWith('<!--')) return;
    for (const raw of instructorNames) {
      const name = raw.trim();
      if (!name) continue;
      const esc = name.replace(/[.*+?^${}()|[\]\\@]/g, '\\$&');
      // 直後が「先生」「(」「（」ならOK。それ以外の文字が続く=呼び捨て
      const re = new RegExp(`${esc}(?!先生|\\(|（)`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        const after = line.slice(m.index + name.length, m.index + name.length + 1);
        if (after === '' ) continue; // 行末
        if (/BOOM代表のTARO/.test(line) && name === 'TARO') continue;
        issues.push(`L${i + 1}: 講師名が呼び捨て「${name}」→「${name}先生」`);
        break;
      }
    }
  });
  return issues;
}

/**
 * 下書きを機械検査する。直せるもの(不正リンク)は直し、直せないものは issues に積む。
 * 直せない問題があっても捨てない(下書きは残し、メモでTAROに知らせる)。
 */
export function validateDraft(
  md: string,
  allowed: { blogSlugs: string[]; areaSlugs?: string[] }
): ValidationResult {
  const issues: string[] = [];
  let out = md.replace(/\r\n/g, '\n').trim();

  // 先頭の `# タイトル` はHP側がtitleから描画するので本文からは外す
  out = out.replace(/^#\s+[^\n]+\n+/, '');

  const len = out.length;
  if (len < 2500) issues.push(`本文が短い(${len}字・目安3,000〜4,000)`);
  if (len > 4800) issues.push(`本文が長い(${len}字・目安3,000〜4,000)`);

  const lines = out.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('BOOMくん') && !BOOMKUN_MEMO.test(line) && !BOOMKUN_ASK.test(line)) {
      issues.push(`L${i + 1}: BOOMくんの記法が規定外(吹き出しにならない)`);
    }
    if (BOLD_TRAP.test(line)) issues.push(`L${i + 1}: 太字が閉じない書き方(閉じ**の直前に括弧)`);
  });

  for (const ng of NG_PHRASES) if (out.includes(ng)) issues.push(`NG表現「${ng}」`);

  const h2 = (out.match(/^##\s/gm) ?? []).length;
  if (h2 < 3) issues.push(`H2が少ない(${h2})`);
  if (h2 > 9) issues.push(`H2が多い(${h2})`);

  // 内部リンク: 実在するものだけ残す。実在しない /blog/xxx/ は本番404になるので文字だけにする
  const areaSlugs = new Set(allowed.areaSlugs ?? ['sendai', 'nagamachi', 'tagajo', 'shichigahama']);
  const blogSlugs = new Set(allowed.blogSlugs);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, href: string) => {
    if (/^https?:\/\//.test(href)) {
      return /^https:\/\/(lin\.ee\/4EYB9zZ|boom-sendai\.com)/.test(href) ? m : text;
    }
    const blog = href.match(/^\/blog\/([a-z0-9-]+)\/?$/);
    if (blog) return blogSlugs.has(blog[1]) ? m : (issues.push(`存在しない記事へのリンクを解除: ${href}`), text);
    const area = href.match(/^\/area\/([a-z0-9-]+)\/?$/);
    if (area) return areaSlugs.has(area[1]) ? m : (issues.push(`存在しないエリアへのリンクを解除: ${href}`), text);
    if (/^\/(classes|price|instructors|blog|faq|access|trial)\/?$/.test(href)) return m;
    issues.push(`許可外リンクを解除: ${href}`);
    return text;
  });

  return { ok: issues.length === 0, issues, content_markdown: out };
}

/** Claudeの応答からJSONを取り出す(```json フェンス・前後の文を許容) */
export function parseModelJson(text: string): GeneratedDraft {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) s = fence[1];
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('応答にJSONが見つかりません');
  const parsed = JSON.parse(s.slice(start, end + 1)) as Partial<GeneratedDraft>;
  if (!parsed.title || !parsed.content_markdown) throw new Error('title/content_markdown が欠けています');
  return {
    title: String(parsed.title).trim(),
    slug_en: String(parsed.slug_en ?? '').trim(),
    category: String(parsed.category ?? 'コラム').trim(),
    excerpt: String(parsed.excerpt ?? '').trim(),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
    content_markdown: String(parsed.content_markdown),
    seed_queries_used: Array.isArray(parsed.seed_queries_used) ? parsed.seed_queries_used.map(String) : [],
    memo_for_taro: String(parsed.memo_for_taro ?? '').trim(),
  };
}

/** slug: モデルが返した英語slugを整え、既存と衝突したら日付を足す */
export function makeSlug(slugEn: string, existing: Set<string>, today: string): string {
  let base = slugEn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (!base || base.length < 4) base = `post-${today.replace(/-/g, '')}`;
  if (!existing.has(base)) return base;
  const alt = `${base}-${today.replace(/-/g, '')}`;
  if (!existing.has(alt)) return alt;
  return `${alt}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Batch APIの custom_id は英数字・ハイフン・アンダースコアのみ(64字以内)。
 * 題材キーは日本語なので、そのまま入れると 400 → 500 になる(2026-09-02 本番初回で発生)。
 * 日本語は捨てて日付+短いハッシュにする。
 */
export function makeCustomId(ymd: string, topicKey: string): string {
  let h = 0;
  for (const ch of topicKey) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  const ascii = topicKey.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12);
  return `blog-${ymd.replace(/-/g, '')}-${ascii || 'topic'}-${h.toString(36)}`.slice(0, 64);
}

/** 構成型のローテーション(同じ骨格を続けない・エピソード開始型はTAROの実話が要るので使わない) */
export function pickStructure(autoDraftCount: number): '標準型' | 'Q&A主導型' {
  return autoDraftCount % 2 === 0 ? '標準型' : 'Q&A主導型';
}

/** JSTの今日 YYYY-MM-DD と曜日(0=日) */
export function todayJst(now = new Date()): { ymd: string; weekday: number } {
  const j = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { ymd: j.toISOString().slice(0, 10), weekday: j.getUTCDay() };
}

/** 生成する曜日: 月・水・金(推奨ペース週3本に合わせる) */
export function isGenerationDay(weekday: number): boolean {
  return weekday === 1 || weekday === 3 || weekday === 5;
}

// =====================================================================
// プロンプト(純関数)
// =====================================================================

/** 料金の正はboom-hp /price ページ。ここに無い数字を記事に書かせない */
const PRICE_FACTS = `- 体験レッスン: 無料
- 入会金: ¥4,000(体験から2週間以内の入会は¥0)
- 月謝(一般): 60分月4回¥6,000 / 90分月4回¥7,200 / 60分月8回¥10,800 / 90分月8回¥12,800 / 受け放題¥14,000
- 学割: 90分月4回¥5,000 / 月8回¥9,000 / 受け放題¥10,000
- 発表会に出る場合の総額目安: ¥25,000〜35,000(衣装込み・出演は任意・演目数で変動)`;

const PUBLIC_NUMBERS = `- 体験→入会は2人に1人(半分は体験だけで帰っていて、それで全く問題ない)
- 退会率は業界平均の1/10程度
- 講師11人、キッズ(6歳)から60代まで通っている
- Googleクチコミ★4.9(55件・2026年9月時点)
- 発表会を5回連続開催(次回=2027年4月11日・仙台市若林区文化センター、出演申込は12/15開始)
- JAPAN DANCE DELIGHTファイナリスト在籍(代表TARO)`;

export function buildSystemPrompt(facts: DraftFacts): string {
  const classes = Object.entries(facts.classesByArea)
    .map(([area, list]) => `【${area}】\n${list.map((l) => `  - ${l}`).join('\n')}`)
    .join('\n');
  const posts = facts.existingPosts.map((p) => `  - /blog/${p.slug}/ … ${p.title}`).join('\n');

  return `あなたは仙台のストリートダンススクール「BOOM」代表・TAROの一人称でブログ記事の下書きを書く編集者です。
書いた記事はTAROが読んで直してから公開します。TAROが「自分の言葉じゃない」と感じる箇所が少ないほど良い下書きです。

# 記事の目的
検索でBOOMのサイトに来た人(仙台近郊で自分や子どものダンス教室を探している人)の疑問に、現場の実感で答える。
検索者の語(seed queries)への答えが、タイトルと冒頭で約束されていること。

# 温度感(最重要)
- 主役は読者の疑問。BOOMは「例」の位置。売り込まない。「うちじゃなくてもいいけど、考え方としてこれが大事」のスタンス
- 記事は2タイプ: ①お役立ち型(一般論と考え方が主軸。BOOM言及は「ちなみにうちでは〜」1〜2文+末尾CTAのみ。料金表やクラス表を本文にドンと置かない) ②スクール情報型(エリア・費用・体験ガイド等。BOOMの具体情報が答えなので具体的に書いてよい。それでも「案内」であって「宣伝」にしない)
- 実データは自慢の文脈で出さない。読者の不安への答えの文脈でだけ使う
- CTAは末尾1箇所だけ。本文中に体験誘導を挟まない。末尾も控えめに(「仙台近郊で試す場所を探しているなら、うちの無料体験も選択肢のひとつに」の温度)

# 語り手と文体
- TARO一人称「私」。著者は「TARO(BOOM代表)」。です・ます調
- 冒頭: 読者の質問をカギ括弧で代弁 → 「こんにちは。仙台のダンススクールBOOM代表のTAROです。」+テーマに合った経験の一言(1文) → 結論の先出し → この記事で分かることの予告
- 結論先出し: 記事も各H2も1文目に答えを置く
- 「私なら」構文を使ってよい(「私が親なら〜します」)。前提の立て直し(質問の字面でなく裏の不安に答える)。承認してから次の一手を渡して締める
- 一般論→現場の実感の二層構造(「一般的には〜と言われています。ただ、現場で見ていると〜」)
- 段落は短く(1段落1メッセージ・2文まで・スマホで4行以内)。1文50字以内目安。3行超の説明は箇条書きか表へ
- 誠実マーカー(「正直に言うと」「現場で見ている限り」等)は1記事1回まで
- 太字は本当に重要な文だけ(HPで黄色マーカー表示になる)。**閉じる「**」の直前に「」や）を置かない**(表示が壊れる)。句読点や括弧は太字の外に出す
- 接続詞で流れの橋をかける(ですが/なので/だから)。測定語より評価語(「変化が大きい」でなく「伸びが目覚ましい」)。時間は具体に
- 決めゼリフ・キャッチコピー的な締め・パンフレットの定型句は禁止。実感で締める
- 感嘆符は使わない。絵文字は末尾の締めの1文に1個まで(無くてよい)
- 漢字は開きめ(ください/こと/いただく)
- 読者の呼称: キッズ記事=「親御さん」「お子さん」、大人記事=「あなた」または省略
- ダンスはスポーツではなく音楽表現。フィジカルの強さや体の大きさで有利不利を語らない。結果よりプロセス
- 文末は「〜言うんです」より「〜言っています/言っていました」
- **講師の名前は地の文では必ず「〇〇先生」と書く**(「ちゃんなつのHIPHOP」ではなく「ちゃんなつ先生のHIPHOP」)。呼び捨てにしない。表の「講師」列だけは名前のみでよい。自分(TARO)は「私」

# BOOMくん(マスコット)の使い方
1記事に2〜3回。連続配置しない。リード直後には置かない。書式は次の2つだけ(これ以外は表示が壊れる):
- 読者の疑問の代弁: 行全体を \`🕺 BOOMくん「〜」\` にする(前後に他の文を付けない)。この直後の段落でTAROが答える
- 豆知識・内部リンク誘導: \`> 🕺 **BOOMくんメモ**: 〜\` (伝聞形のゆるい口調「〜なんだって」「〜だよ」。TAROを「TARO先生」と呼ぶ)
BOOMくんのセリフでも捏造は禁止。

# 構成
- H2は4〜7個。疑問形または数字入りで、目次を流し読みするだけで結論が分かるように
- 列挙(料金・比較・年齢別)は表組み
- 読者の不安はQ&Aで先回り(見学・駐車場・一人参加・運動神経など)。Q&Aは「**Q. 〜**」「A. 〜」の形
- 最後のH2は「まとめ」で行動の再確認。その後に末尾CTA(公式LINE https://lin.ee/4EYB9zZ)
- 内部リンクは下の「既存記事」にあるものだけ。本文中に2〜4本、自然な文脈で

# 長さ
3,000〜4,000字(検索上位の標準サイズ)。

# 事実(この範囲の外は書かない・推測しない)
## ジャンル
HIPHOP / ストリートジャズ / HOUSE / ガールズHIPHOP / WAACK / フリースタイル / NEW JACK SWING。ブレイキンはワークショップ実施済みでレギュラークラスを今年中に開講予定。**K-POPはやっていない**(聞かれたら正直に書く)。
## クラス(2026年9月時点・公開中のもの)
${classes}
※水曜・木曜・金曜は会場が週によって変わる。会場を固定して断定せず「公式LINEとレッスンカレンダーで確認」に倒す
※日曜14:00のAZUMAスタジオ3クラスと、土曜15:30の長町のクラスは、週によって開催されるクラスが変わる(固定ローテではない)。「毎週〇〇がある」と書かない
※長町のスタジオは「ララガーデン内(ララガーデン長町4階)」と書く。提携先の施設名(コナスポ/KONAMI)は書かない
※大人・完全初心者の入口=日曜15:00「ベーシックダンスクラス」(GOATスタジオ)。日曜11:00「はじめてのHIPHOP」は小学生対象なので大人の入口として書かない
## 講師(公開されている11名)
${facts.instructors.join(' / ')}
## 料金
${PRICE_FACTS}
## 公開してよい数字
${PUBLIC_NUMBERS}
## 会場表記(記事で使ってよい名前)
仙台市内=GOATスタジオ(青葉区本町)・AZUMA スタジオ(青葉区二日町)・Kスタジオ(青葉区花京院) / 長町=ララガーデン内 / 多賀城=T's STUDIO・マイダンスショップ / 七ヶ浜=七ヶ浜国際村・アクアスタジオ(アクアリーナ内)

# 書いてはいけないこと
- **BOOM自身が線引きしていない対比を記事の軸にしない**(例:「サークルとスクールの違い」「教室とスタジオの違い」)。検索語にそういう言葉があっても、冒頭で一度受け止めるだけにして、対比で論を立てない(2026-09-04 TARO却下の実例)
- **特定の年代・属性の人が「いる」ことを安心材料として約束しない**(例:「60代の方がたくさん通っています」「同年代が多い」)。来た日にその人がいないと期待値がズレる。安心材料は「基礎の基礎から始まる内容」「講師が一人ひとりを見ること」「体験だけで帰ってよい」「都度払いで様子を見られる」のように、日によって変わらないものだけにする
- 生徒・保護者の個人情報や特定できる描写、実名
- 上に無い数字(会員数・売上・その他の料金・順位など)
- 未確定の人事(講師の加入・離脱)や未発表のクラス・イベント
- 競合スクールの名指し比較
- 医学的・教育効果の断定(「〜と言われています」にする)
- 「講師全員現役プロ」「勧誘はしません」という言い回し
- TAROの実話として書けないエピソードの捏造。現場の話は「よくある」「多い」のような一般化した書き方にとどめ、特定の子の物語を作らない

# 既存記事(内部リンクはここにあるものだけ)
${posts}

# 出力
必ず次のJSONだけを返す(前後の説明・コードフェンス禁止):
{
  "title": "検索者の語への答えを約束するタイトル(全角45字以内・記事の結論が入っている)",
  "slug_en": "url-slug-in-english-lowercase-with-hyphens",
  "category": "初心者ガイド | コラム | エリアガイド | スクール紹介 のいずれか",
  "excerpt": "検索結果に出る説明文(90〜120字・答えの要点を含む)",
  "keywords": ["検索語そのもの", "関連語", "..."],
  "content_markdown": "本文markdown(# タイトル行は含めない。## から始める。冒頭はカギ括弧の読者の質問)",
  "seed_queries_used": ["使った検索語"],
  "memo_for_taro": "TAROに確認してほしい点・実感で差し替えてほしい箇所・迷ったことを3〜6行で"
}`;
}

export function buildUserPrompt(cluster: TopicCluster, structure: string): string {
  const q = cluster.queries.map((x) => `- 「${x.query}」 ${x.impressions}表示 / 平均${x.position.toFixed(1)}位${x.isNew ? ' (今週新しく表示が付いた語)' : ''}`).join('\n');
  return `次の検索語で来る人に答える記事を1本書いてください。

# seed queries(Googleが直近28日でBOOMのサイトを表示した語のうち、受け皿の記事が無いもの)
${q}

# この記事の構成型
${structure}
${structure === 'Q&A主導型' ? '(記事全体を読者の質問と答えの往復で進める。H2を質問文にする)' : '(質問リード→結論→理由→Q&A→まとめ)'}

# 手順
1. これらの語を打った人が本当に知りたいこと(字面の裏の不安)を1行で言い切る
2. その答えを冒頭300字以内で先に出す
3. 一般論→現場の実感の順で厚みをつける(実感は一般化した書き方で。特定の子の物語を作らない)
4. 読者が次に迷うことをQ&Aで潰す
5. まとめで行動を再確認し、控えめなCTAで閉じる

seed queries の語をタイトルと本文に自然に含めること(詰め込みは禁止)。
上のJSON形式だけを返してください。`;
}

// =====================================================================
// IO
// =====================================================================

const SETTING_PENDING = 'blog_auto_draft_pending';
const SETTING_LAST_SUBMIT = 'blog_auto_draft_last_submitted';
export const MODEL = 'claude-opus-5';

async function getSetting(key: string): Promise<string | null> {
  const row = await getOne('SELECT value FROM settings WHERE key = ?', [key]);
  return (row?.value as string | undefined) ?? null;
}
async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await execute('DELETE FROM settings WHERE key = ?', [key]);
    return;
  }
  await execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

export async function getPending(): Promise<PendingBatch | null> {
  const v = await getSetting(SETTING_PENDING);
  if (!v) return null;
  try {
    return JSON.parse(v) as PendingBatch;
  } catch {
    return null;
  }
}
export async function setPending(p: PendingBatch | null): Promise<void> {
  await setSetting(SETTING_PENDING, p ? JSON.stringify(p) : null);
}
export async function getLastSubmitted(): Promise<string | null> {
  return getSetting(SETTING_LAST_SUBMIT);
}
export async function setLastSubmitted(ymd: string): Promise<void> {
  await setSetting(SETTING_LAST_SUBMIT, ymd);
}

/** 未レビューの自動下書き(auto_generated=1 AND is_published=0)の件数 */
export async function countUnreviewedAutoDrafts(): Promise<number> {
  const row = await getOne('SELECT COUNT(*) AS n FROM blog_posts WHERE auto_generated = 1 AND is_published = 0');
  return Number(row?.n ?? 0);
}

export async function countAutoDrafts(): Promise<number> {
  const row = await getOne('SELECT COUNT(*) AS n FROM blog_posts WHERE auto_generated = 1');
  return Number(row?.n ?? 0);
}

/** 最新スナップショットとその1つ前の検索語を返す(1つ前が無ければ prev は undefined) */
export async function loadGscQueries(): Promise<{ latest: GscQuery[]; prev?: Set<string>; measuredOn: string | null }> {
  const dates = await getAll('SELECT DISTINCT measured_on FROM gsc_query_snapshots ORDER BY measured_on DESC LIMIT 2');
  if (!dates.length) return { latest: [], measuredOn: null };
  const latestOn = String(dates[0].measured_on);
  const rows = await getAll(
    'SELECT query, impressions, clicks, position FROM gsc_query_snapshots WHERE measured_on = ? ORDER BY impressions DESC',
    [latestOn]
  );
  const latest: GscQuery[] = rows.map((r) => ({
    query: String(r.query),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    position: Number(r.position ?? 0),
  }));
  let prev: Set<string> | undefined;
  if (dates.length > 1) {
    const prevRows = await getAll('SELECT query FROM gsc_query_snapshots WHERE measured_on = ?', [String(dates[1].measured_on)]);
    prev = new Set(prevRows.map((r) => normalizeQuery(String(r.query))));
  }
  return { latest, prev, measuredOn: latestOn };
}

export async function loadExistingPosts(): Promise<ExistingPost[]> {
  const rows = await getAll('SELECT slug, title, keywords, excerpt, is_published FROM blog_posts ORDER BY id');
  return rows.map((r) => ({
    slug: String(r.slug),
    title: String(r.title ?? ''),
    keywords: String(r.keywords ?? ''),
    excerpt: String(r.excerpt ?? ''),
  }));
}

export async function loadPublishedPosts(): Promise<{ slug: string; title: string }[]> {
  const rows = await getAll(
    "SELECT slug, title FROM blog_posts WHERE is_published = 1 AND published_at <= datetime('now') ORDER BY published_at DESC"
  );
  return rows.map((r) => ({ slug: String(r.slug), title: String(r.title ?? '') }));
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** 公開クラス・講師・既存記事を「事実ブロック」用に読む */
export async function loadFacts(): Promise<DraftFacts> {
  const [classes, studios, instructors, posts] = await Promise.all([
    getAll(
      `SELECT class_name, target, default_day_of_week d, default_start_time t, duration_minutes dur,
              default_studio_id sid, default_instructor_id iid
         FROM lesson_master
        WHERE active = 1 AND is_public = 1 AND (end_date IS NULL OR end_date >= date('now'))
        ORDER BY d, t`
    ),
    getAll('SELECT id, name, is_public, address FROM studios'),
    getAll('SELECT id, name, genre FROM instructors WHERE active = 1 ORDER BY public_display_order, id'),
    loadPublishedPosts(),
  ]);
  const studioById = new Map<number, { name: string; isPublic: boolean; address: string }>();
  for (const s of studios) studioById.set(Number(s.id), { name: String(s.name), isPublic: Number(s.is_public) === 1, address: String(s.address ?? '') });
  const instById = new Map<number, string>();
  for (const i of instructors) instById.set(Number(i.id), String(i.name));

  // 会場表記ルール: 長町=ララガーデン内 / 非公開会場・水木金=週替わり
  const areaOf = (studioId: number, day: number): { area: string; venue: string } => {
    const s = studioById.get(studioId);
    const name = s?.name ?? '';
    const addr = s?.address ?? '';
    if (name.includes('長町') || addr.includes('長町')) return { area: '長町', venue: 'ララガーデン内' };
    if (name.includes('七ヶ浜') || name.includes('アクア')) return { area: '七ヶ浜', venue: name.includes('アクア') ? 'アクアスタジオ(アクアリーナ内)' : '七ヶ浜国際村' };
    if (name.includes("T's") || name.includes('マイダンス') || addr.includes('多賀城')) return { area: '多賀城', venue: name.includes("T's") ? "T's STUDIO" : 'マイダンスショップ' };
    if (name.includes('GOAT')) return { area: '仙台市内', venue: 'GOATスタジオ' };
    if (day === 3 || day === 4 || day === 5 || !s?.isPublic) return { area: '仙台市内', venue: '会場は週替わり' };
    return { area: '仙台市内', venue: name.replace(/\s*スタジオ$/, 'スタジオ') };
  };

  const classesByArea: Record<string, string[]> = {};
  for (const c of classes) {
    const d = Number(c.d);
    const { area, venue } = areaOf(Number(c.sid), d);
    const inst = instById.get(Number(c.iid)) ?? '';
    const target = c.target ? `(${String(c.target)}対象)` : '';
    const line = `${WEEKDAY_JA[d]} ${String(c.t)} ${String(c.class_name)}${target} / ${String(c.dur)}分 / 講師${inst} / ${venue}`;
    (classesByArea[area] ??= []).push(line);
  }

  return {
    classesByArea,
    instructors: instructors.map((i) => `${String(i.name)}(${String(i.genre ?? '')})`),
    existingPosts: posts,
  };
}

/** バッチを投入する(数秒で返る)。戻り値は pending 状態 */
export async function submitDraftBatch(cluster: TopicCluster, structure: string, facts: DraftFacts, todayYmd: string): Promise<PendingBatch> {
  const client = new Anthropic();
  const customId = makeCustomId(todayYmd, cluster.key);
  const batch = await client.messages.batches.create({
    requests: [
      {
        custom_id: customId,
        params: {
          model: MODEL,
          max_tokens: 16000,
          system: [{ type: 'text', text: buildSystemPrompt(facts), cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: buildUserPrompt(cluster, structure) }],
        },
      },
    ],
  });
  const pending: PendingBatch = {
    batch_id: batch.id,
    custom_id: customId,
    topic_key: cluster.key,
    seed_queries: cluster.queries.map((q) => q.query),
    structure,
    submitted_at: new Date().toISOString(),
  };
  await setPending(pending);
  await setLastSubmitted(todayYmd);
  return pending;
}

export type CollectResult =
  | { status: 'processing' }
  | { status: 'inserted'; slug: string; title: string; issues: string[]; memo: string }
  | { status: 'failed'; reason: string };

/** バッチを回収して下書きを入れる(数秒で返る)。まだ処理中なら processing */
export async function collectDraftBatch(pending: PendingBatch, todayYmd: string): Promise<CollectResult> {
  const client = new Anthropic();
  const batch = await client.messages.batches.retrieve(pending.batch_id);
  if (batch.processing_status !== 'ended') return { status: 'processing' };

  let text = '';
  let failure: string | null = null;
  for await (const result of await client.messages.batches.results(pending.batch_id)) {
    if (result.custom_id !== pending.custom_id) continue;
    if (result.result.type === 'succeeded') {
      const msg = result.result.message;
      if (msg.stop_reason === 'refusal') failure = 'モデルが生成を拒否しました(refusal)';
      text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    } else if (result.result.type === 'errored') {
      failure = `バッチエラー: ${JSON.stringify(result.result.error).slice(0, 300)}`;
    } else {
      failure = `バッチ結果: ${result.result.type}`;
    }
  }
  await setPending(null);
  if (failure) return { status: 'failed', reason: failure };
  if (!text) return { status: 'failed', reason: '結果が空でした' };

  let draft: GeneratedDraft;
  try {
    draft = parseModelJson(text);
  } catch (e) {
    return { status: 'failed', reason: `JSON解析失敗: ${e instanceof Error ? e.message : String(e)}` };
  }

  const existing = await loadExistingPosts();
  const published = await loadPublishedPosts();
  const v = validateDraft(draft.content_markdown, { blogSlugs: published.map((p) => p.slug) });
  const instructorRows = await getAll('SELECT name FROM instructors WHERE active = 1');
  v.issues.push(...findBareInstructorNames(v.content_markdown, instructorRows.map((r) => String(r.name))));
  const slug = makeSlug(draft.slug_en, new Set(existing.map((p) => p.slug)), todayYmd);

  // TARO向けメモは本文先頭のHTMLコメントに入れる(HP側は生HTMLを描画しないので公開されても表示されない。
  // /staff/blog の編集画面では見える)
  const memoLines = [
    `自動下書き ${todayYmd} / モデル ${MODEL} / 構成 ${pending.structure}`,
    `seed queries: ${pending.seed_queries.join(' / ')}`,
    draft.memo_for_taro ? `モデルからのメモ:\n${draft.memo_for_taro}` : '',
    v.issues.length ? `機械検査の指摘(公開前に直す):\n- ${v.issues.join('\n- ')}` : '機械検査: 問題なし',
  ].filter(Boolean);
  const content = `<!--\n${memoLines.join('\n\n')}\n-->\n\n${v.content_markdown}`;

  const keywords = [...new Set([...draft.keywords, ...pending.seed_queries, `auto:${pending.topic_key}`])].join(',');
  const category = ['初心者ガイド', 'コラム', 'エリアガイド', 'スクール紹介', 'イベント'].includes(draft.category) ? draft.category : 'コラム';

  await execute(
    `INSERT INTO blog_posts (slug, title, excerpt, content_markdown, keywords, author, category, is_published, auto_generated, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'TARO（BOOM代表）', ?, 0, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [slug, draft.title, draft.excerpt, content, keywords, category]
  );
  return { status: 'inserted', slug, title: draft.title, issues: v.issues, memo: draft.memo_for_taro };
}

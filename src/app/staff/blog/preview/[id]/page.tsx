import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import StaffPageHeader from '@/components/StaffPageHeader';
import { getOne } from '@/lib/db';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { splitDraftMemo } from '@/lib/blogPreview';
import remarkBoomkun from '@/lib/remarkBoomkun';
import PublishButton from './PublishButton';

export const dynamic = 'force-dynamic';

// /staff/blog/preview/[id] — ブログ記事の「読む用」プレビュー (2026-09-02)
// /staff/blog の編集モーダルはMarkdownの生テキストしか見えず、表やBOOMくんの吹き出しが記号のままで
// 記事の確認に向かなかった(TARO指摘)。公開画面(boom-sendai.com)と同じMarkdown変換で描画し、
// 自動下書きが本文先頭に持つ <!-- TARO向けメモ --> は別枠(黄色)に出す。
// 下書き(is_published=0)も見られる。認証は /staff 配下なので proxy が守る + ここでも確認する。

type PostRow = {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content_markdown: string | null;
  cover_image_url: string | null;
  category: string | null;
  is_published: number;
  auto_generated: number;
  published_at: string | null;
  updated_at: string | null;
};

function Bubble({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside className="my-5 flex items-start gap-3">
      <div className="shrink-0 w-11 h-11 rounded-full bg-brand-50 border border-brand-300 flex items-center justify-center text-xl">🕺</div>
      <div className="relative flex-1 min-w-0 rounded-2xl rounded-tl-md bg-brand-50 px-4 py-3 text-slate-900">
        <p className="text-[11px] font-black tracking-wider text-navy-800 mb-1">{label}</p>
        <div className="text-[15px] leading-7 [&_p]:my-0 [&_a]:text-brand-700 [&_a]:underline">{children}</div>
      </div>
    </aside>
  );
}

export default async function BlogPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const authed = await isAuthorizedServer();
  if (!authed) {
    return (
      <div>
        <StaffPageHeader title="記事プレビュー" backHref="/staff/blog" />
        <div className="p-4 max-w-3xl mx-auto">
          <p className="text-sm text-muted-foreground">
            ログインが必要です。<a href="/staff" className="text-brand-600 underline">スタッフトップ</a>からログインしてください。
          </p>
        </div>
      </div>
    );
  }

  const { id } = await params;
  const numId = Number(id);
  const post = Number.isInteger(numId) && numId > 0
    ? ((await getOne('SELECT * FROM blog_posts WHERE id = ?', [numId])) as PostRow | null)
    : null;

  if (!post) {
    return (
      <div>
        <StaffPageHeader title="記事プレビュー" backHref="/staff/blog" />
        <div className="p-4 max-w-3xl mx-auto text-sm text-slate-700 bg-white">記事が見つかりません (id={id})</div>
      </div>
    );
  }

  const { memo, body } = splitDraftMemo(post.content_markdown ?? '');
  const status = post.is_published ? '公開' : '下書き（未公開）';
  const publicUrl = post.is_published ? `https://boom-sendai.com/blog/${post.slug}/` : null;

  return (
    <div>
      <StaffPageHeader
        title="記事プレビュー"
        description={`${status}${post.auto_generated ? '・自動下書き' : ''}${post.category ? `・${post.category}` : ''}`}
        backHref="/staff/blog"
        backLabel="記事一覧へ"
        rightExtra={
          publicUrl ? (
            <a href={publicUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-700 underline">公開ページを開く</a>
          ) : (
            <PublishButton id={post.id} slug={post.slug} title={post.title} />
          )
        }
      />

      {/* このアプリは body の文字色が白なので、読む領域は文字色・背景色を必ず明示する */}
      <main className="bg-white text-slate-900">
        <div className="max-w-2xl mx-auto px-4 py-6">
          {memo && (
            <section className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-slate-900">
              <p className="text-xs font-black tracking-wider text-amber-800 mb-1">📝 TARO向けメモ（公開画面には表示されません）</p>
              <pre className="whitespace-pre-wrap text-[13px] leading-6 font-sans">{memo}</pre>
            </section>
          )}

          {post.cover_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.cover_image_url.startsWith('/') ? `https://boom-sendai.com${post.cover_image_url}` : post.cover_image_url}
              alt=""
              className="w-full rounded-xl mb-5 object-cover max-h-72"
            />
          )}

          {!post.is_published && (
            <section className="mb-5 rounded-xl border border-sand-300 bg-sand-50 px-4 py-3 text-slate-900">
              <p className="text-sm font-bold text-navy-900 mb-1">この記事はまだ下書きです（HPには出ていません）</p>
              <p className="text-[13px] leading-6 text-slate-700">
                読んでOKなら上の「この内容で公開する」を押してください。直したい箇所があれば
                <a href="/staff/blog" className="text-brand-700 underline mx-1">記事一覧</a>の「編集」から直してから公開できます。
                何もしなければ下書きのままで、勝手に公開されることはありません。
              </p>
            </section>
          )}
          <p className="text-xs text-slate-500 mb-2">/blog/{post.slug}/</p>
          <h1 className="text-2xl font-black text-navy-900 leading-snug mb-3">{post.title}</h1>
          {post.excerpt && (
            <p className="text-[13px] text-slate-600 border-l-4 border-sand-300 pl-3 mb-6">
              <span className="font-bold text-slate-500">検索結果の説明文: </span>{post.excerpt}
            </p>
          )}

          <article className="text-[15px] leading-8 text-slate-800">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBoomkun]}
              components={{
                h2: ({ children }) => <h2 className="mt-9 mb-3 text-xl font-black text-navy-900 border-l-4 border-brand-500 pl-3">{children}</h2>,
                h3: ({ children }) => <h3 className="mt-6 mb-2 text-lg font-bold text-navy-900">{children}</h3>,
                p: ({ children }) => <p className="my-4">{children}</p>,
                strong: ({ children }) => <strong className="font-bold bg-[linear-gradient(transparent_62%,rgba(249,232,143,0.8)_62%)]">{children}</strong>,
                a: ({ href, children }) => <a href={href} className="text-brand-700 underline break-all" target="_blank" rel="noreferrer">{children}</a>,
                ul: ({ children }) => <ul className="my-4 pl-5 list-disc space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="my-4 pl-5 list-decimal space-y-1">{children}</ol>,
                li: ({ children }) => <li className="[&_p]:my-0">{children}</li>,
                table: ({ children }) => (
                  <div className="my-5 overflow-x-auto rounded-lg border border-sand-300">
                    <table className="w-full text-[14px] border-collapse">{children}</table>
                  </div>
                ),
                thead: ({ children }) => <thead className="bg-navy-900 text-white">{children}</thead>,
                th: ({ children }) => <th className="px-3 py-2 text-left font-bold whitespace-nowrap">{children}</th>,
                td: ({ children }) => <td className="px-3 py-2 border-t border-sand-200 align-top">{children}</td>,
                hr: () => <hr className="my-8 border-sand-300" />,
                img: ({ src, alt }) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={typeof src === 'string' && src.startsWith('/') ? `https://boom-sendai.com${src}` : (src as string)} alt={alt ?? ''} className="my-5 rounded-lg max-w-full" />
                ),
                blockquote: ({ className, children }) => {
                  if (className?.includes('boomkun-memo')) return <Bubble label="🕺 BOOMくんメモ">{children}</Bubble>;
                  if (className?.includes('boomkun-ask')) return <Bubble label="🕺 BOOMくん">{children}</Bubble>;
                  return <blockquote className="my-4 border-l-4 border-sand-300 pl-4 text-slate-600">{children}</blockquote>;
                },
              }}
            >
              {body}
            </ReactMarkdown>
          </article>

          {!post.is_published && (
            <div className="mt-10 rounded-xl border border-brand-300 bg-brand-50 px-4 py-4 text-slate-900 flex flex-col sm:flex-row sm:items-center gap-3">
              <p className="text-sm flex-1">ここまで読んで問題なければ、そのまま公開できます。</p>
              <PublishButton id={post.id} slug={post.slug} title={post.title} />
            </div>
          )}

          <p className="mt-10 text-xs text-slate-500">
            表示は公開画面(boom-sendai.com)と同じMarkdown変換です。細かな装飾は本番と多少違います。
            直すときは<a href="/staff/blog" className="text-brand-700 underline">記事一覧</a>の「編集」から。
          </p>
        </div>
      </main>
    </div>
  );
}

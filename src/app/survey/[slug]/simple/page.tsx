// 簡易版アンケートフォーム(Server Component・クライアントJSゼロで動く)。
// 通常版(/survey/[slug])はNext.jsのクライアントJSがSafari 16.4+専用のため、
// 古い端末(iOS 16.3以前等)では白い画面のまま止まる。このページはサーバレンダリング
// された素のHTMLフォーム+Server Actionだけで完結し、どんなブラウザでも送信できる。
// 見た目より確実性を優先(ネイティブのチェックボックス/ラジオを使う)。
import { effectiveState, gridCellKey, OTHER_KEY, type QuestionDef } from '@/lib/survey';
import { fieldName } from '@/lib/surveySimpleForm';
import { getSurveyBySlug } from '@/lib/surveyDb';
import { submitSimpleSurvey } from './actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function formatJst(stamp: string): string {
  const [d, t] = stamp.split('T');
  if (!d || !t) return stamp;
  const [y, m, day] = d.split('-');
  return `${y}年${Number(m)}月${Number(day)}日 ${t}`;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5">{children}</div>;
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-16">
      <div className="max-w-md mx-auto rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <div className="text-base font-bold text-slate-800">{title}</div>
        <p className="text-sm text-slate-600 mt-3 leading-relaxed whitespace-pre-wrap">{body}</p>
      </div>
    </div>
  );
}

const checkRowCls = 'flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800';
const boxCls = 'h-5 w-5 shrink-0 accent-teal-600';

function OptionInputs({ q }: { q: QuestionDef }) {
  const type = q.qtype === 'single' ? 'radio' : 'checkbox';
  return (
    <div className="mt-3 space-y-2">
      {q.options.map((o) => (
        <label key={o.key} className={checkRowCls}>
          <input type={type} name={fieldName('q', q.questionKey)} value={o.key} required={q.qtype === 'single' && q.required} className={boxCls} />
          {o.label}
        </label>
      ))}
      {q.allowOther ? (
        <div className={checkRowCls}>
          <label className="flex items-center gap-2.5">
            <input type={type} name={fieldName('q', q.questionKey)} value={OTHER_KEY} className={boxCls} />
            その他:
          </label>
          <input
            type="text"
            name={fieldName('other', q.questionKey)}
            placeholder="自由記入"
            className="flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400"
          />
        </div>
      ) : null}
    </div>
  );
}

function GridInputs({ q }: { q: QuestionDef }) {
  const rows = q.rows ?? [];
  const cols = q.cols ?? [];
  return (
    <div className="mt-3 space-y-3">
      {rows.map((row) =>
        q.gridExpand ? (
          <details key={row.key} className="rounded-lg border border-slate-200">
            <summary className="cursor-pointer px-3 py-2.5 text-sm font-bold text-slate-800">{row.label}</summary>
            <div className="px-3 pb-3 space-y-2">
              {cols.map((col) => (
                <label key={col.key} className={checkRowCls}>
                  <input type="checkbox" name={fieldName('q', q.questionKey)} value={gridCellKey(row.key, col.key)} className={boxCls} />
                  {col.label}
                </label>
              ))}
            </div>
          </details>
        ) : (
          <div key={row.key}>
            <div className="text-xs font-bold text-slate-600">{row.label}</div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {cols.map((col) => (
                <label key={col.key} className="flex items-center gap-1.5 text-sm text-slate-800">
                  <input type="checkbox" name={fieldName('q', q.questionKey)} value={gridCellKey(row.key, col.key)} className={boxCls} />
                  {col.label}
                </label>
              ))}
            </div>
          </div>
        )
      )}
      {q.allowOther ? (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-800">
            <input type="checkbox" name={fieldName('q', q.questionKey)} value={OTHER_KEY} className={boxCls} />
            その他:
          </label>
          <input type="text" name={fieldName('other', q.questionKey)} placeholder="自由記入" className="flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400" />
        </div>
      ) : null}
    </div>
  );
}

export default async function SimpleSurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { done, error } = await searchParams;

  const survey = /^[0-9a-f]{16}$/.test(slug) ? await getSurveyBySlug(slug) : null;
  if (!survey || survey.status === 'draft') {
    return <Message title="アンケート" body="アンケートが見つかりませんでした。" />;
  }
  const state = effectiveState(survey);
  if (state === 'closed' || state === 'expired') {
    return <Message title={survey.title} body="このアンケートの回答受付は終了しました。" />;
  }
  if (state === 'scheduled') {
    return (
      <Message
        title={survey.title}
        body={`回答の受付開始前です。${survey.opens_at ? `\n${formatJst(survey.opens_at)} から回答できます。` : ''}`}
      />
    );
  }
  if (done) {
    return (
      <Message title="送信しました" body={'ご協力ありがとうございました。\nいただいたご意見は今後の運営に活用させていただきます。'} />
    );
  }

  const submitWithSlug = submitSimpleSurvey.bind(null, slug);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <form action={submitWithSlug} className="max-w-md mx-auto space-y-4">
        <Card>
          <h1 className="text-lg font-bold text-slate-900 leading-snug">{survey.title}</h1>
          {survey.intro ? <p className="text-sm text-slate-600 mt-2 leading-relaxed whitespace-pre-wrap">{survey.intro}</p> : null}
          {survey.closes_at ? <p className="text-xs text-slate-500 mt-3">回答締切: {formatJst(survey.closes_at)}</p> : null}
        </Card>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
            <span className="block mt-1 text-xs">お手数ですが、もう一度選択して送信してください。</span>
          </div>
        ) : null}

        <Card>
          <label className="block text-sm font-bold text-slate-800">
            生徒さんのお名前{' '}
            {survey.name_required ? (
              <span className="ml-1 text-xs text-rose-500">必須</span>
            ) : (
              <span className="ml-1 text-xs font-normal text-slate-400">(任意)</span>
            )}
            <input
              type="text"
              name={fieldName('name')}
              required={survey.name_required}
              placeholder="例: 山田 太郎(きょうだいは連名OK)"
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 font-normal"
            />
          </label>
          {survey.name_note ? <p className="text-xs text-slate-500 mt-2 leading-relaxed">{survey.name_note}</p> : null}
        </Card>

        {survey.questions.map((q, i) => (
          <Card key={q.questionKey}>
            <div className="text-sm font-bold text-slate-800 leading-snug">
              Q{i + 1}. {q.label}
              {q.required ? <span className="ml-1 text-xs text-rose-500">必須</span> : null}
              {q.qtype === 'multi' || q.qtype === 'grid' ? (
                <span className="ml-1 text-xs font-normal text-slate-400">(複数選択可)</span>
              ) : null}
            </div>
            {q.qtype === 'text' ? (
              <textarea name={fieldName('text', q.questionKey)} rows={4} className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400" />
            ) : q.qtype === 'grid' ? (
              <GridInputs q={q} />
            ) : (
              <OptionInputs q={q} />
            )}
          </Card>
        ))}

        <button
          type="submit"
          className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-bold text-white shadow-sm"
        >
          回答を送信する
        </button>
        <p className="text-center text-xs text-slate-400 pb-8">BOOM Dance School</p>
      </form>
    </div>
  );
}

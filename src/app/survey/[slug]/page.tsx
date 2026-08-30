'use client';

// アンケート公開フォーム(認証なし)。/ig・/entryと同じ構造:
// クライアントページ + 公開Server Actions(getPublicSurvey/submitSurveyResponse)。
// 受付状態(期間)の最終判定はサーバ側で行う。ここでの表示分岐はUXのため。

import { useEffect, useState, use as usePromise } from 'react';
import { getPublicSurvey, submitSurveyResponse, type PublicSurveyView } from './actions';
import { gridCellKey, type QuestionDef } from '@/lib/survey';

type AnswerState = Record<string, { optionKeys: string[]; otherText: string; text: string }>;

function emptyAnswers(questions: QuestionDef[]): AnswerState {
  const s: AnswerState = {};
  for (const q of questions) s[q.questionKey] = { optionKeys: [], otherText: '', text: '' };
  return s;
}

function formatJst(stamp: string): string {
  const [d, t] = stamp.split('T');
  if (!d || !t) return stamp;
  const [y, m, day] = d.split('-');
  return `${y}年${Number(m)}月${Number(day)}日 ${t}`;
}

export default function SurveyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = usePromise(params);
  const [view, setView] = useState<PublicSurveyView | null>(null);
  const [answers, setAnswers] = useState<AnswerState>({});
  // gridExpand(2段階表示)のgridで、いま列を展開している行
  const [openRows, setOpenRows] = useState<Record<string, string[]>>({});
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      const v = await getPublicSurvey(slug);
      setView(v);
      setAnswers(emptyAnswers(v.questions));
    })();
  }, [slug]);

  if (!view) {
    return <div className="min-h-screen bg-slate-50 grid place-items-center text-sm text-slate-400">読み込み中…</div>;
  }

  if (!view.found || view.state === 'closed' || view.state === 'expired') {
    const msg = view.found ? 'このアンケートの回答受付は終了しました。' : 'アンケートが見つかりませんでした。';
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-16">
        <div className="max-w-md mx-auto rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <div className="text-base font-bold text-slate-800">{view.found ? view.title : 'アンケート'}</div>
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">{msg}</p>
        </div>
      </div>
    );
  }

  if (view.state === 'scheduled') {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-16">
        <div className="max-w-md mx-auto rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <div className="text-base font-bold text-slate-800">{view.title}</div>
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">
            回答の受付開始前です。
            {view.opensAt ? (
              <>
                <br />
                {formatJst(view.opensAt)} から回答できます。
              </>
            ) : null}
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-16">
        <div className="max-w-md mx-auto rounded-2xl border border-teal-200 bg-white p-6 text-center">
          <div className="text-base font-bold text-teal-700">送信しました</div>
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">
            ご協力ありがとうございました。
            <br />
            いただいたご意見は今後の運営に活用させていただきます。
          </p>
        </div>
      </div>
    );
  }

  const setAnswer = (key: string, patch: Partial<AnswerState[string]>) => {
    setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  // 必ず関数型更新で組む。stateのクロージャから組むと、再レンダー前の連続タップ
  // (素早いダブルタップ等)で前の選択が消える。
  const toggleOption = (q: QuestionDef, optKey: string) => {
    setAnswers((prev) => {
      const cur = prev[q.questionKey];
      if (!cur) return prev;
      let next: typeof cur;
      if (q.qtype === 'single') {
        const selected = cur.optionKeys[0] === optKey;
        next = { ...cur, optionKeys: selected ? [] : [optKey], otherText: selected ? cur.otherText : '' };
      } else {
        const has = cur.optionKeys.includes(optKey);
        next = { ...cur, optionKeys: has ? cur.optionKeys.filter((k) => k !== optKey) : [...cur.optionKeys, optKey] };
      }
      return { ...prev, [q.questionKey]: next };
    });
  };

  // gridExpand: 行(ジャンル等)のタップで列を開閉。閉じるときはその行の選択も消す
  // (隠れた選択がそのまま送信される事故を防ぐ)。
  const toggleRow = (q: QuestionDef, rowKey: string) => {
    const isOpen = (openRows[q.questionKey] ?? []).includes(rowKey);
    if (isOpen) {
      setOpenRows((prev) => ({ ...prev, [q.questionKey]: (prev[q.questionKey] ?? []).filter((k) => k !== rowKey) }));
      const rowCells = (q.cols ?? []).map((c) => gridCellKey(rowKey, c.key));
      setAnswers((prev) => {
        const cur = prev[q.questionKey];
        if (!cur) return prev;
        return { ...prev, [q.questionKey]: { ...cur, optionKeys: cur.optionKeys.filter((k) => !rowCells.includes(k)) } };
      });
    } else {
      setOpenRows((prev) => ({ ...prev, [q.questionKey]: [...(prev[q.questionKey] ?? []), rowKey] }));
    }
  };

  const handleSubmit = async () => {
    setError('');
    setBusy(true);
    try {
      const payload = {
        name: name.trim() || undefined,
        answers: Object.fromEntries(
          Object.entries(answers)
            .map(([key, a]) => [
              key,
              {
                optionKeys: a.optionKeys.length > 0 ? a.optionKeys : undefined,
                otherText: a.otherText.trim() || undefined,
                text: a.text.trim() || undefined,
              },
            ])
            .filter(([, a]) => {
              const v = a as { optionKeys?: string[]; otherText?: string; text?: string };
              return v.optionKeys || v.otherText || v.text;
            })
        ),
      };
      const r = await submitSurveyResponse(slug, payload);
      if (r.ok) {
        setDone(true);
        window.scrollTo(0, 0);
      } else {
        setError(r.error);
      }
    } finally {
      setBusy(false);
    }
  };

  const isPreview = view.state === 'draft';

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="max-w-md mx-auto space-y-4">
        {isPreview ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
            プレビュー表示(未発行)。スタッフのみ見えています。送信はできません。
          </div>
        ) : null}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h1 className="text-lg font-bold text-slate-900 leading-snug">{view.title}</h1>
          {view.intro ? <p className="text-sm text-slate-600 mt-2 leading-relaxed whitespace-pre-wrap">{view.intro}</p> : null}
          {view.closesAt ? (
            <p className="text-xs text-slate-500 mt-3">回答締切: {formatJst(view.closesAt)}</p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <label className="block text-sm font-bold text-slate-800">
            生徒さんのお名前{' '}
            {view.nameRequired ? (
              <span className="ml-1 text-xs text-rose-500">必須</span>
            ) : (
              <span className="ml-1 text-xs font-normal text-slate-400">(任意)</span>
            )}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 山田 太郎(きょうだいは連名OK)"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          {view.nameNote ? <p className="text-xs text-slate-500 mt-2 leading-relaxed">{view.nameNote}</p> : null}
        </div>

        {view.questions.map((q, i) => {
          const a = answers[q.questionKey];
          if (!a) return null;
          return (
            <div key={q.questionKey} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-bold text-slate-800 leading-snug">
                Q{i + 1}. {q.label}
                {q.required ? <span className="ml-1 text-xs text-rose-500">必須</span> : null}
                {q.qtype === 'multi' ? <span className="ml-1 text-xs font-normal text-slate-400">(複数選択可)</span> : null}
                {q.qtype === 'grid' ? <span className="ml-1 text-xs font-normal text-slate-400">(あてはまるマスを全てタップ)</span> : null}
              </div>
              {q.qtype === 'grid' ? (
                <div className="mt-3 space-y-3">
                  {(q.rows ?? []).map((row) => {
                    const isOpen = !q.gridExpand || (openRows[q.questionKey] ?? []).includes(row.key);
                    const rowSelectedCount = (q.cols ?? []).filter((col) => a.optionKeys.includes(gridCellKey(row.key, col.key))).length;
                    return (
                      <div key={row.key}>
                        {q.gridExpand ? (
                          <button
                            type="button"
                            onClick={() => toggleRow(q, row.key)}
                            className={`w-full text-left rounded-lg border px-3 py-2.5 text-sm transition ${
                              isOpen || rowSelectedCount > 0
                                ? 'border-teal-500 bg-teal-50 text-teal-800 font-bold'
                                : 'border-slate-300 bg-white text-slate-700'
                            }`}
                          >
                            {isOpen ? '✓ ' : ''}
                            {row.label}
                          </button>
                        ) : (
                          <div className="text-xs font-bold text-slate-600">{row.label}</div>
                        )}
                        {isOpen ? (
                          <div className={`mt-1.5 flex flex-wrap gap-1.5 ${q.gridExpand ? 'pl-3 pb-1' : ''}`}>
                            {q.gridExpand ? (
                              <span className="w-full text-[11px] text-slate-400">希望のレベル・区分をタップ</span>
                            ) : null}
                            {(q.cols ?? []).map((col) => {
                              const cellKey = gridCellKey(row.key, col.key);
                              const selected = a.optionKeys.includes(cellKey);
                              return (
                                <button
                                  key={col.key}
                                  type="button"
                                  onClick={() => toggleOption(q, cellKey)}
                                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                                    selected
                                      ? 'border-teal-500 bg-teal-50 text-teal-800 font-bold'
                                      : 'border-slate-300 bg-white text-slate-600'
                                  }`}
                                >
                                  {selected ? '✓ ' : ''}
                                  {col.label}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {q.allowOther ? (
                    <div className="pt-1">
                      <label className="block text-xs text-slate-500">その他(自由記入)</label>
                      <input
                        type="text"
                        value={a.otherText}
                        onChange={(e) => setAnswer(q.questionKey, { otherText: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                  ) : null}
                </div>
              ) : q.qtype === 'text' ? (
                <textarea
                  value={a.text}
                  onChange={(e) => setAnswer(q.questionKey, { text: e.target.value })}
                  rows={4}
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              ) : (
                <div className="mt-3 space-y-2">
                  {q.options.map((o) => {
                    const selected = a.optionKeys.includes(o.key);
                    return (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => toggleOption(q, o.key)}
                        className={`w-full text-left rounded-lg border px-3 py-2.5 text-sm transition ${
                          selected
                            ? 'border-teal-500 bg-teal-50 text-teal-800 font-bold'
                            : 'border-slate-300 bg-white text-slate-700'
                        }`}
                      >
                        {selected ? '✓ ' : ''}
                        {o.label}
                      </button>
                    );
                  })}
                  {q.allowOther ? (
                    <div className="pt-1">
                      <label className="block text-xs text-slate-500">その他(自由記入)</label>
                      <input
                        type="text"
                        value={a.otherText}
                        onChange={(e) => setAnswer(q.questionKey, { otherText: e.target.value })}
                        placeholder="例: POP・LOCK など"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}

        {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy || isPreview}
          className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50"
        >
          {isPreview ? 'プレビュー中(送信不可)' : busy ? '送信中…' : '回答を送信する'}
        </button>
        <p className="text-center text-xs text-slate-400 pb-8">BOOM Dance School</p>
      </div>
    </div>
  );
}

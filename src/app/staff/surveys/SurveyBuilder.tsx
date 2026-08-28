'use client';

// アンケート定義ビルダー(新規作成/編集で共用)。
// question_key / option key はTAROに見せず q1/o1 形式で自動採番する
// (draft中の編集は全置換なので採番が変わっても整合は崩れない)。
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { staffCreateSurvey, staffUpdateSurvey } from './actions';

type OptionRow = { key?: string; label: string };
type QuestionRow = {
  key?: string;
  label: string;
  qtype: 'single' | 'multi' | 'text';
  required: boolean;
  options: OptionRow[];
  allowOther: boolean;
};

export type BuilderInitial = {
  title: string;
  intro: string;
  nameNote: string;
  audience: string;
  opensAt: string;
  closesAt: string;
  questions: QuestionRow[];
};

const DEFAULT_NAME_NOTE =
  'お名前の記入は任意です。ご記入いただけると、より詳細に現状を把握できるので、ご意向に沿ったクラスを作りやすくなります。';

const emptyQuestion = (): QuestionRow => ({
  label: '',
  qtype: 'single',
  required: false,
  options: [{ label: '' }],
  allowOther: false,
});

export default function SurveyBuilder({
  surveyId,
  initial,
  questionsLocked,
}: {
  surveyId?: number;
  initial?: BuilderInitial;
  /** open後は設問編集不可(文言と期間のみ)。 */
  questionsLocked?: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [intro, setIntro] = useState(initial?.intro ?? '');
  const [nameNote, setNameNote] = useState(initial?.nameNote ?? DEFAULT_NAME_NOTE);
  const [audience, setAudience] = useState(initial?.audience ?? 'member');
  const [opensAt, setOpensAt] = useState(initial?.opensAt ?? '');
  const [closesAt, setClosesAt] = useState(initial?.closesAt ?? '');
  const [questions, setQuestions] = useState<QuestionRow[]>(initial?.questions ?? [emptyQuestion()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const updateQuestion = (i: number, patch: Partial<QuestionRow>) => {
    setQuestions((prev) => prev.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  };
  const moveQuestion = (i: number, dir: -1 | 1) => {
    setQuestions((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const handleSave = async () => {
    setError('');
    setBusy(true);
    try {
      const payload = {
        title,
        intro,
        nameNote,
        audience,
        opensAt: opensAt || undefined,
        closesAt: closesAt || undefined,
        questions: questions.map((q, i) => ({
          questionKey: q.key || `q${i + 1}`,
          label: q.label,
          qtype: q.qtype,
          required: q.required,
          options:
            q.qtype === 'text'
              ? []
              : q.options
                  .filter((o) => o.label.trim())
                  .map((o, j) => ({ key: o.key || `o${j + 1}`, label: o.label })),
          allowOther: q.qtype === 'text' ? false : q.allowOther,
        })),
      };
      const r = surveyId ? await staffUpdateSurvey(surveyId, payload) : await staffCreateSurvey(payload);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/staff/surveys/${surveyId ?? r.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-sand-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sand-200 bg-white p-4 space-y-3">
        <div>
          <label className="block text-xs font-bold text-navy-700">タイトル</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="例: 七ヶ浜クラス増設アンケート" />
        </div>
        <div>
          <label className="block text-xs font-bold text-navy-700">説明文(フォーム冒頭)</label>
          <textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} className={`mt-1 ${inputCls}`} />
        </div>
        <div>
          <label className="block text-xs font-bold text-navy-700">名前欄の案内文</label>
          <textarea value={nameNote} onChange={(e) => setNameNote(e.target.value)} rows={2} className={`mt-1 ${inputCls}`} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-bold text-navy-700">対象</label>
            <select value={audience} onChange={(e) => setAudience(e.target.value)} className={`mt-1 ${inputCls}`}>
              <option value="member">会員向け</option>
              <option value="public">一般向け</option>
              <option value="both">両方</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-navy-700">回答開始(任意)</label>
            <input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} className={`mt-1 ${inputCls}`} />
          </div>
          <div>
            <label className="block text-xs font-bold text-navy-700">回答締切(任意)</label>
            <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className={`mt-1 ${inputCls}`} />
          </div>
        </div>
        <p className="text-xs text-slate-500">期間を空にすると「発行してから終了操作まで」ずっと受付になります。</p>
      </div>

      {questionsLocked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          発行済みのため設問は編集できません(回答との整合を守るため)。文言と期間のみ保存されます。
        </div>
      ) : (
        <div className="space-y-3">
          {questions.map((q, i) => (
            <div key={i} className="rounded-xl border border-sand-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold text-navy-700">Q{i + 1}</div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveQuestion(i, -1)} className="rounded border border-sand-300 px-2 py-1 text-xs text-navy-700 disabled:opacity-30" disabled={i === 0}>↑</button>
                  <button type="button" onClick={() => moveQuestion(i, 1)} className="rounded border border-sand-300 px-2 py-1 text-xs text-navy-700 disabled:opacity-30" disabled={i === questions.length - 1}>↓</button>
                  <button type="button" onClick={() => setQuestions((prev) => prev.filter((_, j) => j !== i))} className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-600">削除</button>
                </div>
              </div>
              <input value={q.label} onChange={(e) => updateQuestion(i, { label: e.target.value })} className={inputCls} placeholder="質問文" />
              <div className="flex items-center gap-4 flex-wrap text-sm">
                <select
                  value={q.qtype}
                  onChange={(e) => updateQuestion(i, { qtype: e.target.value as QuestionRow['qtype'] })}
                  className="rounded-lg border border-sand-300 px-2 py-1.5 text-sm"
                >
                  <option value="single">1つ選択</option>
                  <option value="multi">複数選択</option>
                  <option value="text">自由記入</option>
                </select>
                <label className="flex items-center gap-1.5 text-xs text-navy-700">
                  <input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(i, { required: e.target.checked })} />
                  必須
                </label>
                {q.qtype !== 'text' ? (
                  <label className="flex items-center gap-1.5 text-xs text-navy-700">
                    <input type="checkbox" checked={q.allowOther} onChange={(e) => updateQuestion(i, { allowOther: e.target.checked })} />
                    「その他(自由記入)」枠を付ける
                  </label>
                ) : null}
              </div>
              {q.qtype !== 'text' ? (
                <div className="space-y-2">
                  {q.options.map((o, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <input
                        value={o.label}
                        onChange={(e) =>
                          updateQuestion(i, { options: q.options.map((oo, k) => (k === j ? { ...oo, label: e.target.value } : oo)) })
                        }
                        className={inputCls}
                        placeholder={`選択肢${j + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => updateQuestion(i, { options: q.options.filter((_, k) => k !== j) })}
                        className="shrink-0 rounded border border-sand-300 px-2 py-1.5 text-xs text-slate-500"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => updateQuestion(i, { options: [...q.options, { label: '' }] })}
                    className="rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50"
                  >
                    ＋ 選択肢を追加
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setQuestions((prev) => [...prev, emptyQuestion()])}
            className="w-full rounded-xl border-2 border-dashed border-sand-300 px-4 py-3 text-sm font-bold text-navy-600 hover:bg-sand-50"
          >
            ＋ 設問を追加
          </button>
        </div>
      )}

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <button
        type="button"
        onClick={handleSave}
        disabled={busy}
        className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? '保存中…' : surveyId ? '保存する' : '下書きとして作成する'}
      </button>
    </div>
  );
}

'use client';

// アンケート詳細のクライアント側: タブ(集計/クロス集計/回答/紐付け/編集)。
// 集計は survey.ts の純関数をブラウザ側で実行する(回答データはこのページに来た時点でスタッフ認証済)。
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { aggregateAnswers, crossTab, gridCellKeys, optionLabel as resolveOptionLabel, OTHER_KEY, type AnswerRow, type QuestionDef } from '@/lib/survey';
import type { ResponseListItem } from '@/lib/surveyDb';
import { staffResolveMatch, staffSearchMembers, staffSetSurveyStatus, type MemberHit } from '../actions';
import SurveyBuilder from '../SurveyBuilder';
import { STATE_BADGES, formatPeriod } from '../SurveyListClient';

type SurveyView = {
  id: number;
  slug: string;
  title: string;
  intro: string;
  nameNote: string;
  audience: string;
  status: string;
  state: string;
  opensAt: string;
  closesAt: string;
  questions: QuestionDef[];
};

const MATCH_LABELS: Record<string, { label: string; cls: string }> = {
  none: { label: '無記名', cls: 'bg-slate-100 text-slate-500' },
  auto: { label: '自動紐付け', cls: 'bg-brand-50 text-brand-700' },
  confirmed: { label: '紐付け済', cls: 'bg-brand-50 text-brand-700' },
  pending: { label: '確認待ち', cls: 'bg-amber-50 text-amber-700' },
  unmatched: { label: '該当なし', cls: 'bg-slate-100 text-slate-500' },
};

export default function SurveyDetailClient({
  survey,
  responses,
  answerRows,
}: {
  survey: SurveyView;
  responses: ResponseListItem[];
  answerRows: AnswerRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'agg' | 'cross' | 'responses' | 'match' | 'edit'>('agg');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const pendingResponses = responses.filter((r) => r.matchStatus === 'pending' || r.matchStatus === 'unmatched');
  const badge = STATE_BADGES[survey.state] ?? STATE_BADGES.draft;

  const changeStatus = async (next: 'open' | 'closed') => {
    if (next === 'closed' && !window.confirm('回答受付を終了しますか？(元に戻せません)')) return;
    setBusy(true);
    setError('');
    try {
      const r = await staffSetSurveyStatus(survey.id, next);
      if (!r.ok) setError(r.error);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/survey/${survey.slug}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'agg', label: '集計' },
    { key: 'cross', label: 'クロス集計' },
    { key: 'responses', label: `回答 (${responses.length})` },
    { key: 'match', label: `会員紐付け${pendingResponses.length > 0 ? ` (${pendingResponses.length})` : ''}` },
    { key: 'edit', label: '編集' },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sand-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
            <span className={`rounded-full border px-2 py-0.5 font-bold ${badge.cls}`}>{badge.label}</span>
            <span>{formatPeriod(survey.opensAt || null, survey.closesAt || null)}</span>
          </div>
          <div className="flex items-center gap-2">
            {survey.status !== 'draft' ? (
              <button type="button" onClick={copyUrl} className="rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50">
                {copied ? '✓ コピーしました' : '回答URLをコピー'}
              </button>
            ) : null}
            {survey.status === 'draft' ? (
              <button type="button" onClick={() => changeStatus('open')} disabled={busy} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50">
                発行する(受付開始)
              </button>
            ) : null}
            {survey.status === 'open' ? (
              <button type="button" onClick={() => changeStatus('closed')} disabled={busy} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                受付を終了する
              </button>
            ) : null}
            <a href={`/api/staff/surveys/${survey.id}/export`} className="rounded-lg border border-sand-300 px-3 py-1.5 text-xs font-bold text-navy-700 hover:bg-sand-50">
              CSV
            </a>
          </div>
        </div>
        {error ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div> : null}
      </div>

      <div className="flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-t-lg px-4 py-2 text-xs font-bold transition ${
              tab === t.key ? 'bg-white border border-b-0 border-sand-200 text-navy-800' : 'bg-sand-50 text-slate-500 hover:text-navy-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'agg' ? <AggTab questions={survey.questions} rows={answerRows} /> : null}
      {tab === 'cross' ? <CrossTab_ questions={survey.questions} rows={answerRows} /> : null}
      {tab === 'responses' ? <ResponsesTab survey={survey} responses={responses} /> : null}
      {tab === 'match' ? <MatchTab pending={pendingResponses} onDone={() => router.refresh()} /> : null}
      {tab === 'edit' ? (
        <SurveyBuilder
          surveyId={survey.id}
          questionsLocked={survey.status !== 'draft'}
          initial={{
            title: survey.title,
            intro: survey.intro,
            nameNote: survey.nameNote,
            audience: survey.audience,
            opensAt: survey.opensAt,
            closesAt: survey.closesAt,
            questions: survey.questions.map((q) => ({
              key: q.questionKey,
              label: q.label,
              qtype: q.qtype,
              required: q.required,
              options: q.options.map((o) => ({ key: o.key, label: o.label })),
              gridRows: (q.rows ?? []).map((o) => ({ key: o.key, label: o.label })),
              gridCols: (q.cols ?? []).map((o) => ({ key: o.key, label: o.label })),
              gridExpand: q.gridExpand === true,
              allowOther: q.allowOther,
            })),
          }}
        />
      ) : null}
    </div>
  );
}

function AggTab({ questions, rows }: { questions: QuestionDef[]; rows: AnswerRow[] }) {
  const agg = useMemo(() => aggregateAnswers(questions, rows), [questions, rows]);
  if (rows.length === 0) {
    return <div className="rounded-xl border border-sand-200 bg-white p-8 text-center text-sm text-slate-500">まだ回答がありません。</div>;
  }
  return (
    <div className="space-y-3">
      {agg.map((q, i) => {
        const max = Math.max(1, ...q.optionCounts.map((o) => o.count));
        const def = questions.find((qq) => qq.id === q.questionId);
        return (
          <div key={q.questionId} className="rounded-xl border border-sand-200 bg-white p-4">
            <div className="text-sm font-bold text-navy-800">
              Q{i + 1}. {q.label} <span className="text-xs font-normal text-slate-400">({q.total}人回答)</span>
            </div>
            {q.qtype === 'grid' && def ? (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr>
                      <th className="p-2" />
                      {(def.cols ?? []).map((c) => (
                        <th key={c.key} className="p-2 text-center font-bold text-navy-700 whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(def.rows ?? []).map((r) => (
                      <tr key={r.key} className="border-t border-sand-100">
                        <td className="p-2 font-bold text-navy-700 whitespace-nowrap">{r.label}</td>
                        {(def.cols ?? []).map((c) => {
                          const n = q.gridCells.find((cell) => cell.rowKey === r.key && cell.colKey === c.key)?.count ?? 0;
                          return (
                            <td key={c.key} className={`p-2 text-center ${n > 0 ? 'font-bold text-navy-900 bg-brand-50/60' : 'text-slate-300'}`}>{n}</td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {q.otherTexts.length > 0 ? (
                  <div className="pt-2 text-xs text-slate-600">その他の内容: {q.otherTexts.join('、')}</div>
                ) : null}
              </div>
            ) : q.qtype === 'text' ? (
              <ul className="mt-3 space-y-1.5">
                {q.texts.length === 0 ? <li className="text-xs text-slate-400">回答なし</li> : null}
                {q.texts.map((t, j) => (
                  <li key={j} className="rounded-lg bg-sand-50 px-3 py-2 text-xs text-slate-700 whitespace-pre-wrap">{t}</li>
                ))}
              </ul>
            ) : (
              <div className="mt-3 space-y-1.5">
                {q.optionCounts.map((o) => (
                  <div key={o.key} className="flex items-center gap-2">
                    <div className="w-28 shrink-0 text-xs text-slate-600 truncate" title={o.label}>{o.label}</div>
                    <div className="flex-1 h-5 rounded bg-sand-50 overflow-hidden">
                      <div className="h-full bg-brand-500/80 rounded" style={{ width: `${(o.count / max) * 100}%` }} />
                    </div>
                    <div className="w-8 shrink-0 text-right text-xs font-bold text-navy-800">{o.count}</div>
                  </div>
                ))}
                {q.otherTexts.length > 0 ? (
                  <div className="pt-1 text-xs text-slate-600">その他の内容: {q.otherTexts.join('、')}</div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CrossTab_({ questions, rows }: { questions: QuestionDef[]; rows: AnswerRow[] }) {
  const choiceQs = questions.filter((q) => q.qtype !== 'text' && typeof q.id === 'number');
  const [rowQ, setRowQ] = useState<number>(choiceQs[0]?.id ?? 0);
  const [colQ, setColQ] = useState<number>(choiceQs[1]?.id ?? 0);
  const [filterQ, setFilterQ] = useState<number>(0);
  const [filterKeys, setFilterKeys] = useState<string[]>([]);

  const rowDef = choiceQs.find((q) => q.id === rowQ);
  const colDef = choiceQs.find((q) => q.id === colQ);
  const filterDef = choiceQs.find((q) => q.id === filterQ);

  const cells = useMemo(() => {
    if (!rowDef || !colDef) return [];
    return crossTab(rows, rowDef.id!, colDef.id!, filterDef && filterKeys.length > 0 ? { questionId: filterDef.id!, optionKeys: filterKeys } : undefined);
  }, [rows, rowDef, colDef, filterDef, filterKeys]);

  const cellMap = new Map(cells.map((c) => [`${c.rowKey}|${c.colKey}`, c.count]));
  const selectCls = 'rounded-lg border border-sand-300 px-2 py-1.5 text-xs';
  const optLabel = (q: QuestionDef | undefined, key: string) => (q ? resolveOptionLabel(q, key) : key);
  const axisKeys = (q: QuestionDef | undefined) =>
    q
      ? q.qtype === 'grid'
        ? gridCellKeys(q)
        : [...q.options.map((o) => o.key), ...(q.allowOther ? [OTHER_KEY] : [])]
      : [];

  return (
    <div className="rounded-xl border border-sand-200 bg-white p-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap text-xs text-navy-700">
        <label>行:
          <select value={rowQ} onChange={(e) => setRowQ(Number(e.target.value))} className={`ml-1 ${selectCls}`}>
            {choiceQs.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
          </select>
        </label>
        <label>列:
          <select value={colQ} onChange={(e) => setColQ(Number(e.target.value))} className={`ml-1 ${selectCls}`}>
            {choiceQs.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
          </select>
        </label>
        <label>絞り込み:
          <select
            value={filterQ}
            onChange={(e) => { setFilterQ(Number(e.target.value)); setFilterKeys([]); }}
            className={`ml-1 ${selectCls}`}
          >
            <option value={0}>なし</option>
            {choiceQs.filter((q) => q.qtype !== 'grid').map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
          </select>
        </label>
      </div>
      {filterDef ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          {filterDef.options.map((o) => {
            const on = filterKeys.includes(o.key);
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => setFilterKeys((prev) => (on ? prev.filter((k) => k !== o.key) : [...prev, o.key]))}
                className={`rounded-full border px-3 py-1 text-xs font-bold ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-sand-300 text-slate-500'}`}
              >
                {o.label}
              </button>
            );
          })}
          <span className="text-xs text-slate-400">(選択した回答をした人だけで集計)</span>
        </div>
      ) : null}
      {rowDef && colDef ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr>
                <th className="p-2 text-left text-slate-400 font-normal">{rowDef.label} ＼ {colDef.label}</th>
                {axisKeys(colDef).map((ck) => (
                  <th key={ck} className="p-2 text-center font-bold text-navy-700">{optLabel(colDef, ck)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {axisKeys(rowDef).map((rk) => (
                <tr key={rk} className="border-t border-sand-100">
                  <td className="p-2 font-bold text-navy-700">{optLabel(rowDef, rk)}</td>
                  {axisKeys(colDef).map((ck) => {
                    const n = cellMap.get(`${rk}|${ck}`) ?? cellMap.get(`${rk} ${ck}`) ?? 0;
                    return (
                      <td key={ck} className={`p-2 text-center ${n > 0 ? 'font-bold text-navy-900 bg-brand-50/60' : 'text-slate-300'}`}>{n}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-slate-400">選択式の設問が2問以上あるとクロス集計できます。</p>
      )}
    </div>
  );
}

function ResponsesTab({ survey, responses }: { survey: SurveyView; responses: ResponseListItem[] }) {
  const labelByQuestionId = new Map(survey.questions.filter((q) => q.id).map((q) => [q.id!, q]));
  if (responses.length === 0) {
    return <div className="rounded-xl border border-sand-200 bg-white p-8 text-center text-sm text-slate-500">まだ回答がありません。</div>;
  }
  return (
    <div className="space-y-3">
      {responses.map((r) => {
        const m = MATCH_LABELS[r.matchStatus] ?? MATCH_LABELS.none;
        const byQuestion = new Map<number, string[]>();
        for (const a of r.answers) {
          const q = labelByQuestionId.get(a.questionId);
          if (!q) continue;
          const value =
            a.optionKey === OTHER_KEY
              ? `その他: ${a.textValue ?? ''}`
              : a.optionKey
                ? resolveOptionLabel(q, a.optionKey)
                : a.textValue ?? '';
          const list = byQuestion.get(a.questionId) ?? [];
          list.push(value);
          byQuestion.set(a.questionId, list);
        }
        return (
          <div key={r.id} className="rounded-xl border border-sand-200 bg-white p-4">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="font-bold text-navy-800">{r.respondentName ?? '(無記名)'}</span>
              <span className={`rounded-full px-2 py-0.5 font-bold ${m.cls}`}>{m.label}</span>
              {r.memberName ? <span className="text-slate-500">→ {r.memberName}{r.memberKaiinNo ? ` (${r.memberKaiinNo})` : ''}</span> : null}
              <span className="ml-auto text-slate-400">{r.submittedAt.slice(0, 10)}</span>
            </div>
            <div className="mt-2 space-y-1">
              {survey.questions.filter((q) => q.id && byQuestion.has(q.id)).map((q) => (
                <div key={q.id} className="text-xs text-slate-700">
                  <span className="text-slate-400">{q.label}: </span>
                  {byQuestion.get(q.id!)!.join('、')}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MatchTab({ pending, onDone }: { pending: ResponseListItem[]; onDone: () => void }) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [searchFor, setSearchFor] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<MemberHit[]>([]);

  const resolve = async (responseId: number, memberId: number | null) => {
    setBusyId(responseId);
    setError('');
    try {
      const r = await staffResolveMatch(responseId, memberId);
      if (!r.ok) setError(r.error);
      else onDone();
    } finally {
      setBusyId(null);
    }
  };

  const doSearch = async () => {
    setHits(await staffSearchMembers(q));
  };

  if (pending.length === 0) {
    return <div className="rounded-xl border border-sand-200 bg-white p-8 text-center text-sm text-slate-500">紐付け待ちの回答はありません。</div>;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        記入されたお名前を会員DBと照合した結果、自動確定できなかった回答です。候補をタップして確定してください。
      </p>
      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div> : null}
      {pending.map((r) => (
        <div key={r.id} className="rounded-xl border border-amber-200 bg-white p-4">
          <div className="text-sm font-bold text-navy-800">
            記入名: {r.respondentName ?? '(無記名)'}
            <span className="ml-2 text-xs font-normal text-slate-400">{r.submittedAt.slice(0, 10)}</span>
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {r.candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={busyId === r.id}
                onClick={() => resolve(r.id, c.id)}
                className="rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
              >
                {c.name}
                {c.kaiinNo ? ` (${c.kaiinNo})` : ''}
                {c.status !== 'active' ? ' [退会]' : ''}
              </button>
            ))}
            <button
              type="button"
              disabled={busyId === r.id}
              onClick={() => setSearchFor(searchFor === r.id ? null : r.id)}
              className="rounded-lg border border-sand-300 px-3 py-1.5 text-xs text-navy-700 hover:bg-sand-50"
            >
              会員を検索
            </button>
            <button
              type="button"
              disabled={busyId === r.id}
              onClick={() => resolve(r.id, null)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
            >
              紐付けなしで確定
            </button>
          </div>
          {searchFor === r.id ? (
            <div className="mt-3 rounded-lg bg-sand-50 p-3">
              <div className="flex items-center gap-2">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="名前で検索(2文字以上)"
                  className="flex-1 rounded-lg border border-sand-300 px-3 py-1.5 text-xs"
                />
                <button type="button" onClick={doSearch} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white">検索</button>
              </div>
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                {hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => resolve(r.id, h.id)}
                    className="rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50"
                  >
                    {h.name}
                    {h.kaiinNo ? ` (${h.kaiinNo})` : ''}
                    {h.status !== 'active' ? ' [退会]' : ''}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

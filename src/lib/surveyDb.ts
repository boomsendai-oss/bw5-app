// アンケート基盤のDBアクセス層 (WS AO 2026-08-28)。src/lib/db.ts 経由のみ(createClient直呼び禁止)。
// ロジックは survey.ts / surveyMatch.ts の純関数に置き、ここはSQLと組み立てだけ。
import { getAll, getOne, execute, withWriteTx } from '@/lib/db';
import { nowUtcIso } from '@/lib/dateJst';
import {
  generateSurveySlug,
  optionLabel,
  OTHER_KEY,
  type AnswerRow,
  type QuestionDef,
  type Qtype,
  type ValidatedResponse,
  type ValidatedSurvey,
} from '@/lib/survey';
import { matchMember, type MatchableMember } from '@/lib/surveyMatch';

export interface SurveyRow {
  id: number;
  slug: string;
  title: string;
  intro: string | null;
  audience: string;
  name_note: string | null;
  name_required: boolean;
  status: string;
  opens_at: string | null;
  closes_at: string | null;
  created_at: string;
  opened_at: string | null;
  closed_at: string | null;
}

export interface SurveyWithQuestions extends SurveyRow {
  questions: QuestionDef[];
}

/* eslint-disable @typescript-eslint/no-explicit-any -- DB行は動的キーアクセスのためany許容(db.tsと同方針) */

function rowToSurvey(r: any): SurveyRow {
  return {
    id: Number(r.id),
    slug: String(r.slug),
    title: String(r.title),
    intro: r.intro ? String(r.intro) : null,
    audience: String(r.audience),
    name_note: r.name_note ? String(r.name_note) : null,
    name_required: Number(r.name_required) === 1,
    status: String(r.status),
    opens_at: r.opens_at ? String(r.opens_at) : null,
    closes_at: r.closes_at ? String(r.closes_at) : null,
    created_at: String(r.created_at ?? ''),
    opened_at: r.opened_at ? String(r.opened_at) : null,
    closed_at: r.closed_at ? String(r.closed_at) : null,
  };
}

function rowToQuestion(r: any): QuestionDef {
  // options_json: 通常設問=配列 / grid設問={rows, cols} のオブジェクト
  let options: { key: string; label: string }[] = [];
  let rows: { key: string; label: string }[] = [];
  let cols: { key: string; label: string }[] = [];
  let gridExpand = false;
  try {
    const parsed = JSON.parse(String(r.options_json || '[]'));
    if (Array.isArray(parsed)) {
      options = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.rows)) rows = parsed.rows;
      if (Array.isArray(parsed.cols)) cols = parsed.cols;
      gridExpand = parsed.expand === true;
    }
  } catch {
    options = [];
  }
  return {
    id: Number(r.id),
    questionKey: String(r.question_key),
    label: String(r.label),
    qtype: String(r.qtype) as Qtype,
    required: Number(r.required) === 1,
    options,
    rows,
    cols,
    gridExpand,
    allowOther: Number(r.allow_other) === 1,
  };
}

async function loadQuestions(surveyId: number): Promise<QuestionDef[]> {
  const rows = await getAll(
    'SELECT id, question_key, label, qtype, required, options_json, allow_other FROM survey_questions WHERE survey_id = ? ORDER BY sort_order ASC, id ASC',
    [surveyId]
  );
  return rows.map(rowToQuestion);
}

export interface SurveyListItem extends SurveyRow {
  responseCount: number;
  pendingCount: number;
}

export async function listSurveys(): Promise<SurveyListItem[]> {
  const rows = await getAll(
    `SELECT s.*,
            (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.id) AS response_count,
            (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.id AND r.match_status = 'pending') AS pending_count
     FROM surveys s ORDER BY s.id DESC`
  );
  return rows.map((r) => ({
    ...rowToSurvey(r),
    responseCount: Number(r.response_count ?? 0),
    pendingCount: Number(r.pending_count ?? 0),
  }));
}

export async function getSurveyById(id: number): Promise<SurveyWithQuestions | null> {
  const row = await getOne('SELECT * FROM surveys WHERE id = ?', [id]);
  if (!row) return null;
  return { ...rowToSurvey(row), questions: await loadQuestions(Number(row.id)) };
}

export async function getSurveyBySlug(slug: string): Promise<SurveyWithQuestions | null> {
  const row = await getOne('SELECT * FROM surveys WHERE slug = ?', [slug]);
  if (!row) return null;
  return { ...rowToSurvey(row), questions: await loadQuestions(Number(row.id)) };
}

async function insertQuestions(tx: any, surveyId: number, questions: QuestionDef[]): Promise<void> {
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const optionsJson =
      q.qtype === 'grid'
        ? JSON.stringify({ rows: q.rows ?? [], cols: q.cols ?? [], expand: q.gridExpand === true })
        : JSON.stringify(q.options);
    await tx.execute({
      sql: 'INSERT INTO survey_questions (survey_id, sort_order, question_key, label, qtype, required, options_json, allow_other) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [surveyId, i, q.questionKey, q.label, q.qtype, q.required ? 1 : 0, optionsJson, q.allowOther ? 1 : 0],
    });
  }
}

export async function createSurvey(def: ValidatedSurvey): Promise<number> {
  const slug = generateSurveySlug();
  return withWriteTx(async (tx) => {
    const res = await tx.execute({
      sql: 'INSERT INTO surveys (slug, title, intro, audience, name_note, name_required, status, opens_at, closes_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [slug, def.title, def.intro, def.audience, def.nameNote, def.nameRequired ? 1 : 0, 'draft', def.opensAt, def.closesAt],
    });
    const surveyId = Number(res.lastInsertRowid);
    await insertQuestions(tx, surveyId, def.questions);
    return surveyId;
  });
}

/**
 * 更新。draft中は設問を全置換できる。open後は回答との整合を守るため
 * 文言(タイトル/説明/名前欄注記)と期間のみ更新し、設問には触らない。
 */
export async function updateSurvey(id: number, def: ValidatedSurvey): Promise<string | null> {
  const survey = await getSurveyById(id);
  if (!survey) return 'アンケートが見つかりません';
  return withWriteTx(async (tx) => {
    await tx.execute({
      sql: 'UPDATE surveys SET title = ?, intro = ?, audience = ?, name_note = ?, name_required = ?, opens_at = ?, closes_at = ? WHERE id = ?',
      args: [def.title, def.intro, def.audience, def.nameNote, def.nameRequired ? 1 : 0, def.opensAt, def.closesAt, id],
    });
    if (survey.status === 'draft') {
      await tx.execute({ sql: 'DELETE FROM survey_questions WHERE survey_id = ?', args: [id] });
      await insertQuestions(tx, id, def.questions);
    }
    return null;
  });
}

const STATUS_FLOW: Record<string, string> = { draft: 'open', open: 'closed' };

/** draft→open→closed の一方向のみ。 */
export async function setSurveyStatus(id: number, next: string): Promise<string | null> {
  const survey = await getSurveyById(id);
  if (!survey) return 'アンケートが見つかりません';
  if (STATUS_FLOW[survey.status] !== next) return `「${survey.status}」から「${next}」には変更できません`;
  const stampCol = next === 'open' ? 'opened_at' : 'closed_at';
  await execute(`UPDATE surveys SET status = ?, ${stampCol} = ? WHERE id = ?`, [next, nowUtcIso(), id]);
  return null;
}

async function loadMatchableMembers(): Promise<MatchableMember[]> {
  const rows = await getAll('SELECT id, full_name, full_name_kana, rep_name, status FROM boom_members');
  return rows.map((r) => ({
    id: Number(r.id),
    full_name: String(r.full_name ?? ''),
    full_name_kana: String(r.full_name_kana ?? ''),
    rep_name: r.rep_name ? String(r.rep_name) : null,
    status: String(r.status ?? ''),
  }));
}

/** 回答の保存(原子)。記入名があれば会員照合し、autoのみ即紐付け・他は承認キューへ。 */
export async function submitResponse(surveyId: number, validated: ValidatedResponse): Promise<void> {
  let matchStatus = 'none';
  let memberId: number | null = null;
  let candidatesJson: string | null = null;
  if (validated.name) {
    const match = matchMember(validated.name, await loadMatchableMembers());
    matchStatus = match.status;
    if (match.status === 'auto') memberId = match.memberId;
    if (match.status === 'pending') candidatesJson = JSON.stringify(match.candidateIds);
  }
  const questions = await loadQuestions(surveyId);
  const idByKey = new Map(questions.map((q) => [q.questionKey, q.id!]));
  await withWriteTx(async (tx) => {
    const res = await tx.execute({
      sql: 'INSERT INTO survey_responses (survey_id, respondent_name, boom_member_id, match_status, match_candidates_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [surveyId, validated.name, memberId, matchStatus, candidatesJson, nowUtcIso()],
    });
    const responseId = Number(res.lastInsertRowid);
    for (const a of validated.answers) {
      const questionId = idByKey.get(a.questionKey);
      if (!questionId) continue;
      for (const key of a.optionKeys) {
        await tx.execute({
          sql: 'INSERT INTO survey_answers (response_id, question_id, option_key, text_value) VALUES (?, ?, ?, ?)',
          args: [responseId, questionId, key, null],
        });
      }
      if (a.otherText) {
        await tx.execute({
          sql: 'INSERT INTO survey_answers (response_id, question_id, option_key, text_value) VALUES (?, ?, ?, ?)',
          args: [responseId, questionId, OTHER_KEY, a.otherText],
        });
      }
      if (a.text) {
        await tx.execute({
          sql: 'INSERT INTO survey_answers (response_id, question_id, option_key, text_value) VALUES (?, ?, ?, ?)',
          args: [responseId, questionId, null, a.text],
        });
      }
    }
  });
}

export async function loadAnswerRows(surveyId: number): Promise<AnswerRow[]> {
  const rows = await getAll(
    `SELECT a.response_id, a.question_id, a.option_key, a.text_value
     FROM survey_answers a JOIN survey_responses r ON r.id = a.response_id
     WHERE r.survey_id = ?`,
    [surveyId]
  );
  return rows.map((r) => ({
    response_id: Number(r.response_id),
    question_id: Number(r.question_id),
    option_key: r.option_key ? String(r.option_key) : null,
    text_value: r.text_value ? String(r.text_value) : null,
  }));
}

export interface ResponseListItem {
  id: number;
  respondentName: string | null;
  boomMemberId: number | null;
  memberName: string | null;
  memberKaiinNo: string | null;
  matchStatus: string;
  candidates: { id: number; name: string; kaiinNo: string | null; status: string }[];
  submittedAt: string;
  answers: { questionId: number; optionKey: string | null; textValue: string | null }[];
}

export async function listResponses(surveyId: number): Promise<ResponseListItem[]> {
  const rows = await getAll(
    `SELECT r.id, r.respondent_name, r.boom_member_id, r.match_status, r.match_candidates_json, r.submitted_at,
            m.full_name AS member_name, m.hacomono_kaiin_no AS member_kaiin_no
     FROM survey_responses r LEFT JOIN boom_members m ON m.id = r.boom_member_id
     WHERE r.survey_id = ? ORDER BY r.id DESC`,
    [surveyId]
  );
  const answers = await getAll(
    `SELECT a.response_id, a.question_id, a.option_key, a.text_value
     FROM survey_answers a JOIN survey_responses r ON r.id = a.response_id WHERE r.survey_id = ?`,
    [surveyId]
  );
  const answersByResponse = new Map<number, ResponseListItem['answers']>();
  for (const a of answers) {
    const rid = Number(a.response_id);
    const list = answersByResponse.get(rid) ?? [];
    list.push({
      questionId: Number(a.question_id),
      optionKey: a.option_key ? String(a.option_key) : null,
      textValue: a.text_value ? String(a.text_value) : null,
    });
    answersByResponse.set(rid, list);
  }

  const candidateIds = new Set<number>();
  const parsedCandidates = new Map<number, number[]>();
  for (const r of rows) {
    if (!r.match_candidates_json) continue;
    try {
      const ids = JSON.parse(String(r.match_candidates_json));
      if (Array.isArray(ids)) {
        const nums = ids.map(Number).filter(Number.isInteger);
        parsedCandidates.set(Number(r.id), nums);
        nums.forEach((n) => candidateIds.add(n));
      }
    } catch {
      /* 壊れた候補JSONは無視(候補なし扱い) */
    }
  }
  const candidateMembers = new Map<number, { id: number; name: string; kaiinNo: string | null; status: string }>();
  if (candidateIds.size > 0) {
    const placeholders = Array.from(candidateIds, () => '?').join(',');
    const mrows = await getAll(
      `SELECT id, full_name, hacomono_kaiin_no, status FROM boom_members WHERE id IN (${placeholders})`,
      Array.from(candidateIds)
    );
    for (const m of mrows) {
      candidateMembers.set(Number(m.id), {
        id: Number(m.id),
        name: String(m.full_name ?? ''),
        kaiinNo: m.hacomono_kaiin_no ? String(m.hacomono_kaiin_no) : null,
        status: String(m.status ?? ''),
      });
    }
  }

  return rows.map((r) => ({
    id: Number(r.id),
    respondentName: r.respondent_name ? String(r.respondent_name) : null,
    boomMemberId: r.boom_member_id ? Number(r.boom_member_id) : null,
    memberName: r.member_name ? String(r.member_name) : null,
    memberKaiinNo: r.member_kaiin_no ? String(r.member_kaiin_no) : null,
    matchStatus: String(r.match_status),
    candidates: (parsedCandidates.get(Number(r.id)) ?? [])
      .map((id) => candidateMembers.get(id))
      .filter((m): m is NonNullable<typeof m> => Boolean(m)),
    submittedAt: String(r.submitted_at),
    answers: answersByResponse.get(Number(r.id)) ?? [],
  }));
}

/** 紐付けの確定。memberId=null は「紐付けなし」で確定(match_status='unmatched'として閉じる)。 */
export async function resolveMatch(responseId: number, memberId: number | null): Promise<string | null> {
  const row = await getOne('SELECT id FROM survey_responses WHERE id = ?', [responseId]);
  if (!row) return '回答が見つかりません';
  if (memberId !== null) {
    const member = await getOne('SELECT id FROM boom_members WHERE id = ?', [memberId]);
    if (!member) return '会員が見つかりません';
  }
  await execute(
    'UPDATE survey_responses SET boom_member_id = ?, match_status = ?, match_candidates_json = NULL WHERE id = ?',
    [memberId, memberId === null ? 'unmatched' : 'confirmed', responseId]
  );
  return null;
}

/** スタッフ画面の手動紐付け用の会員検索(部分一致・スタッフ認証配下でのみ使う)。 */
export async function searchMembersForLink(q: string): Promise<{ id: number; name: string; kaiinNo: string | null; status: string }[]> {
  const needle = `%${q.trim()}%`;
  if (q.trim().length < 2) return [];
  const rows = await getAll(
    `SELECT id, full_name, hacomono_kaiin_no, status FROM boom_members
     WHERE full_name LIKE ? OR full_name_kana LIKE ? ORDER BY status = 'active' DESC, id LIMIT 20`,
    [needle, needle]
  );
  return rows.map((m) => ({
    id: Number(m.id),
    name: String(m.full_name ?? ''),
    kaiinNo: m.hacomono_kaiin_no ? String(m.hacomono_kaiin_no) : null,
    status: String(m.status ?? ''),
  }));
}

export interface MemberSurveyAnswer {
  surveyId: number;
  surveyTitle: string;
  submittedAt: string;
  summary: string[];
}

/** 会員詳細画面用: この会員に紐付いた全アンケート回答(設問=回答の読めるサマリ)。 */
export async function listMemberSurveyAnswers(boomMemberId: number): Promise<MemberSurveyAnswer[]> {
  const responses = await getAll(
    `SELECT r.id, r.survey_id, r.submitted_at, s.title
     FROM survey_responses r JOIN surveys s ON s.id = r.survey_id
     WHERE r.boom_member_id = ? ORDER BY r.id DESC`,
    [boomMemberId]
  );
  const out: MemberSurveyAnswer[] = [];
  for (const r of responses) {
    const rows = await getAll(
      `SELECT q.id, q.question_key, q.label, q.qtype, q.required, q.options_json, q.allow_other, a.option_key, a.text_value
       FROM survey_answers a JOIN survey_questions q ON q.id = a.question_id
       WHERE a.response_id = ? ORDER BY q.sort_order ASC, a.id ASC`,
      [Number(r.id)]
    );
    const byLabel = new Map<string, string[]>();
    for (const row of rows) {
      const label = String(row.label);
      let value: string;
      if (row.option_key === OTHER_KEY) {
        value = `その他: ${row.text_value ?? ''}`;
      } else if (row.option_key) {
        value = optionLabel(rowToQuestion(row), String(row.option_key));
      } else {
        value = String(row.text_value ?? '');
      }
      const list = byLabel.get(label) ?? [];
      list.push(value);
      byLabel.set(label, list);
    }
    out.push({
      surveyId: Number(r.survey_id),
      surveyTitle: String(r.title),
      submittedAt: String(r.submitted_at),
      summary: Array.from(byLabel, ([label, values]) => `${label}: ${values.join('、')}`),
    });
  }
  return out;
}

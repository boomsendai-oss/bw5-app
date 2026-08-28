CREATE TABLE IF NOT EXISTS surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  intro TEXT,
  audience TEXT NOT NULL DEFAULT 'member',
  name_note TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  opens_at TEXT,
  closes_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  opened_at TEXT,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS survey_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id),
  sort_order INTEGER NOT NULL,
  question_key TEXT NOT NULL,
  label TEXT NOT NULL,
  qtype TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  allow_other INTEGER NOT NULL DEFAULT 0,
  UNIQUE(survey_id, question_key)
);

CREATE TABLE IF NOT EXISTS survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id),
  respondent_name TEXT,
  boom_member_id INTEGER,
  match_status TEXT NOT NULL DEFAULT 'none',
  match_candidates_json TEXT,
  submitted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS survey_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id INTEGER NOT NULL REFERENCES survey_responses(id),
  question_id INTEGER NOT NULL REFERENCES survey_questions(id),
  option_key TEXT,
  text_value TEXT
);

CREATE INDEX IF NOT EXISTS idx_survey_questions_survey ON survey_questions(survey_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id);

CREATE INDEX IF NOT EXISTS idx_survey_responses_member ON survey_responses(boom_member_id);

CREATE INDEX IF NOT EXISTS idx_survey_answers_response ON survey_answers(response_id);

CREATE INDEX IF NOT EXISTS idx_survey_answers_question ON survey_answers(question_id, option_key);

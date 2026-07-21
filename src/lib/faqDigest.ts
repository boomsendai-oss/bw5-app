// WS O: FAQボット「BOOMくんに質問」の日次ダイジェスト整形(純粋関数)。
// DB取得・メール送信は cron route 側で行い、ここは受け取った集計値を本文に組むだけ。
// こうしておくと文面をテストで固定でき、集計SQLを変えても表示崩れに気づける。

export type FaqDigestInput = {
  dateLabel: string; // 対象日(前日)の表示用 例 "7/20(日)"
  questions: number; // 実ユーザーの質問数
  people: number; // 実ユーザーのユニーク人数
  categories: Array<{ category: string | null; n: number }>; // カテゴリ内訳(多い順)
  topQuestions: string[]; // よく聞かれた/代表的な質問(数件)
  newReports: number; // 未仕分けのエラー報告(実ユーザー分)
  brokenAnswers: number; // 空応答/フォールバックの件数(=不具合の兆候)
  reportsUrl: string; // エラー報告の仕分け画面
  statsUrl: string; // 質問ログ集計画面
};

export type FaqDigest = { subject: string; text: string };

function catLine(c: { category: string | null; n: number }): string {
  return `  ・${c.category && c.category.trim() ? c.category : '(未分類)'}: ${c.n}件`;
}

export function formatFaqDigest(i: FaqDigestInput): FaqDigest {
  const subject = `【BOOMくんに質問】${i.dateLabel}の日次レポート`;

  const lines: string[] = [];
  lines.push(`BOOMくんに質問 — ${i.dateLabel} のまとめだよ📊`);
  lines.push('');

  if (i.questions === 0) {
    lines.push('この日は実ユーザーからの質問はありませんでした。');
  } else {
    lines.push(`■ 実ユーザーの利用`);
    lines.push(`  質問数: ${i.questions}件 / 人数: ${i.people}人`);
    lines.push('');

    if (i.categories.length > 0) {
      lines.push('■ カテゴリ内訳');
      for (const c of i.categories) lines.push(catLine(c));
      lines.push('');
    }

    if (i.topQuestions.length > 0) {
      lines.push('■ よく聞かれた質問');
      for (const q of i.topQuestions) lines.push(`  ・${q}`);
      lines.push('');
    }
  }

  // 警告類は一番目立つ位置(末尾直前)に、あるときだけ。無ければ「異常なし」で安心材料に。
  const warns: string[] = [];
  if (i.brokenAnswers > 0) {
    warns.push(`⚠️ 空応答・エラー応答が ${i.brokenAnswers}件 ありました。回答が返らなかった可能性があるので確認してね。`);
  }
  if (i.newReports > 0) {
    warns.push(`🔧 未仕分けのエラー報告が ${i.newReports}件 あります → ${i.reportsUrl}`);
  }

  lines.push('─────────────');
  if (warns.length > 0) {
    for (const w of warns) lines.push(w);
  } else {
    lines.push('✅ 空応答・未仕分けのエラー報告はありません。');
  }
  lines.push('');
  lines.push(`質問ログ集計: ${i.statsUrl}`);

  return { subject, text: lines.join('\n') };
}

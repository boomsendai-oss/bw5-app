// WS AB: レポート配信メールの共通整形(純粋関数)。
//
// 週次経営レポート(アプリ内で生成)と、KEIKO向け日次共有(クラウドルーティンが
// STATE.md から生成し boom-events-hub に commit → GH Actions が本文をPOST)の
// 2種類を同じ入口で扱う。ここは件名と本文の組み立てだけを持つ。

export type ReportKind = 'weekly' | 'daily-keiko';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 'YYYY-MM-DD' → 'M/D(曜)'。不正な文字列はそのまま返す(件名を壊さない)。 */
export function jpDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const w = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay();
  return `${Number(mo)}/${Number(d)}(${WEEKDAYS[w]})`;
}

/**
 * KEIKO向け日次共有のメール本文。
 * TAROはこれを見て、LINEに送る部分だけコピペする運用なので
 * 「ここから下をコピペ」の区切りを必ず入れる(本文とメタ情報を混ぜない)。
 */
export function formatKeikoMail(dateIso: string, body: string): { subject: string; text: string } {
  const label = jpDate(dateIso);
  return {
    subject: `【KEIKOさん共有】${label}のぶん（LINEにコピペ用）`,
    text: [
      `${label} のKEIKOさん向け共有です。下の線から下をそのままLINEにコピペできます。`,
      '送るまでもない内容なら、そのまま無視してOK。',
      '',
      '───────── ここからコピペ ─────────',
      body.trim(),
      '───────── ここまで ─────────',
    ].join('\n'),
  };
}

/** 本文が実質空(見出しだけ・空白のみ)かどうか。空なら送らない(沈黙=何も無かった日)。 */
export function isEmptyBody(body: string): boolean {
  const stripped = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^#{1,6}\s/.test(l) && !/^[-–—─=*_]{3,}$/.test(l))
    .join('');
  return stripped.length === 0;
}

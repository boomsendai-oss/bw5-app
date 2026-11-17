import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// BOOMくんの点検(2026-11-16)で見つかった、業務ルールとの食い違い3つを直す(TARO OK 2026-11-17)。
// 根拠: boom-events-hub/docs/BOOM業務ルール.md(無料体験は1人1回・追加受講90分は12/1から2,150円)、
//       docs/hisho/業務フローの現状.md(休会は月謝会員だけ)、boom-hp/src/lib/prices-2026-12.ts。
// 冪等: 置き換え前の文言があり、置き換え後の文言が無い時だけ更新する。ボットはMarkdownを描画しないので ** を使わない。
const UPDATES = [
  { id: 14,
    from: '体験レッスンは無料です！公式LINEの体験予約カレンダーからご予約ください。',
    to: '体験レッスンは無料です！公式LINEの体験予約カレンダーからご予約ください。\n無料体験はお一人様1回までです。一度体験された方は、ご入会のうえでご参加ください(予約をキャンセルした場合は、まだ使っていない扱いです。ごきょうだいで初めてのお子さまは体験できます)。' },
  { id: 54,
    from: '料金は60分レッスン¥1,500／90分レッスン¥1,800です。',
    to: '料金は60分レッスン¥1,500／90分レッスン¥1,800です。2026年12月1日からは、60分レッスン¥1,800／90分レッスン¥2,150になります。' },
  { id: 21,
    from: '休会は1ヶ月単位で、',
    to: '休会できるのは月謝プランの方です(チケット会員の方には休会の手続きはありません)。休会は1ヶ月単位で、' },
];
let up = 0;
for (const u of UPDATES) {
  const r = await c.execute({ sql: 'UPDATE faq_entries SET answer=replace(answer, ?, ?), updated_at=CURRENT_TIMESTAMP WHERE id=? AND instr(answer, ?) > 0 AND instr(answer, ?) = 0', args: [u.from, u.to, u.id, u.from, u.to] });
  console.log(`更新 id=${u.id}: ${r.rowsAffected}件`); up += r.rowsAffected;
}
for (const u of UPDATES) {
  const r = await c.execute({ sql: 'SELECT answer FROM faq_entries WHERE id=?', args: [u.id] });
  console.log(`確認 id=${u.id}: ${r.rows[0].answer.includes(u.to) ? '反映済み' : '未反映'}`);
}
console.log(`更新=${up}`);

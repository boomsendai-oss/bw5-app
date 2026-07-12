import { createClient, type Client } from '@libsql/client';

// FAQボット(boom-faq-bot)の匿名会話ログDBへの読み取り専用クライアント。
// 会員DB(lib/db.ts=bw5-db)とは別系のボット専用Tursoを指す。書き込みはボット側のみが行う。
// ここが lib/db.ts と別ファイルなのは「別DBであること」を型と置き場所で明示するため。
let client: Client | null = null;

export function faqLogDb(): Client | null {
  const url = process.env.FAQBOT_LOG_DB_URL;
  if (!url) return null;
  if (!client) client = createClient({ url, authToken: process.env.FAQBOT_LOG_DB_TOKEN });
  return client;
}

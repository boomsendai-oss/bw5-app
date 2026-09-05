// 一言プールの選択と使用履歴(IO層)。純粋なロジックは greetingPool.ts
import { execute, getOne } from './db';
import {
  type Greeting,
  type GreetingUse,
  appendGreetingUse,
  pickGreeting,
  recentGreetingIds,
  renderGreeting,
} from './greetingPool';

const SETTING_KEY = 'x_greeting_uses';

export async function loadGreetingUses(): Promise<GreetingUse[]> {
  const row = await getOne('SELECT value FROM settings WHERE key = ?', [SETTING_KEY]);
  if (!row?.value) return [];
  try {
    const arr = JSON.parse(String(row.value));
    return Array.isArray(arr) ? arr.filter((u) => u && typeof u.id === 'number' && typeof u.ymd === 'string') : [];
  } catch {
    return [];
  }
}

export async function recordGreetingUse(id: number, ymd: string): Promise<void> {
  const uses = appendGreetingUse(await loadGreetingUses(), id, ymd);
  await execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [SETTING_KEY, JSON.stringify(uses)]
  );
}

/** 直近14日に使っていない一言を1本選んで本文にして返す。選べなければ null(投稿は一言なしで続行) */
export async function chooseGreeting(opts: { ymd: string; weekly: boolean; count: number }): Promise<(Greeting & { text: string }) | null> {
  try {
    const uses = await loadGreetingUses();
    const g = pickGreeting(recentGreetingIds(uses, opts.ymd), { weekly: opts.weekly });
    if (!g) return null;
    return { ...g, text: renderGreeting(g, { count: opts.count }) };
  } catch {
    return null; // 一言が原因で投稿を止めない
  }
}

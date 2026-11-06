// BF7 HIRO WS: 告知のあとに公開カレンダーの備考へ申込URLを戻す(すでにあれば二重に足さない)。
import { describe, it, expect } from 'vitest';
import { addBf7WsUrlToDescription, BF7_WS_FORM_URL } from '../googleCalendar';

describe('addBf7WsUrlToDescription', () => {
  it('末尾にURLの行を足す', () => {
    expect(addBf7WsUrlToDescription('▼ お申込み\n会員 11/23〜\n')).toBe(`▼ お申込み\n会員 11/23〜\n${BF7_WS_FORM_URL}`);
  });
  it('すでに入っていれば何もしない', () => {
    expect(addBf7WsUrlToDescription(`x\n${BF7_WS_FORM_URL}`)).toBeNull();
  });
});

// 配信モード(LEDに配信映像を出す)の約束ごと。
import { describe, expect, it } from 'vitest';
import { sceneKey, needsChampions } from '../bf6ScreenAnim';

describe('LEDの配信モード', () => {
  it('部門が変わっても同じ場面として扱う(暗転で映像が止まらない)', () => {
    const a = sceneKey({ mode: 'stream', division: 'beginner', round: null, matchNo: null });
    const b = sceneKey({ mode: 'stream', division: 'general', round: null, matchNo: null });
    expect(a).toBe('stream');
    expect(a).toBe(b);
  });

  it('ロゴやトーナメント表とは別の場面(切り替えると暗転が入る)', () => {
    const s = sceneKey({ mode: 'stream', division: 'beginner', round: null, matchNo: null });
    expect(s).not.toBe(sceneKey({ mode: 'logo', division: 'beginner', round: null, matchNo: null }));
    expect(s).not.toBe(sceneKey({ mode: 'bracket', division: 'beginner', round: null, matchNo: null }));
  });

  it('優勝者のデータは取りに行かない(毎秒のポーリングを重くしない)', () => {
    expect(needsChampions('stream')).toBe(false);
  });
});

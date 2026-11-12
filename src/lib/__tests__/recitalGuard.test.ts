// BW6 発表会（段階1）の守り（Task 16）：スタッフのログインの確かめと、マイページの鍵の形。
import { describe, it, expect, vi } from 'vitest';
const auth = vi.hoisted(() => ({ ok: false }));
vi.mock('@/lib/eventAuth', () => ({ isAuthorizedServer: async () => auth.ok }));
import { requireRecitalStaff, isTokenShape } from '../recitalGuard';

describe('requireRecitalStaff', () => {
  it('ログインしていなければ throw、していれば通る', async () => {
    auth.ok = false; await expect(requireRecitalStaff()).rejects.toThrow('Unauthorized');
    auth.ok = true;  await expect(requireRecitalStaff()).resolves.toBeUndefined();
  });
});
describe('isTokenShape（48けたの小文字 hex だけ）', () => {
  it.each([
    ['a'.repeat(48), true], ['0123456789abcdef'.repeat(3), true],
    ['A'.repeat(48), false], ['a'.repeat(47), false], ['a'.repeat(49), false],
    ['g'.repeat(48), false], [123, false], [null, false], [undefined, false],
  ])('%s → %s', (t, want) => expect(isTokenShape(t)).toBe(want));
});

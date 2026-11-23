import { describe, it, expect, vi, beforeEach } from 'vitest';

const groups = new Map<string, string>();
const saved: unknown[][] = [];
vi.mock('@/lib/db', () => ({
  execute: vi.fn(async (sql: string, args: unknown[]) => {
    if (sql.includes('INSERT INTO line_staff_groups')) {
      const id = String(args[0]);
      if (groups.get(id) !== 'approved') groups.set(id, 'pending');
      return { rowsAffected: 1 };
    }
    if (sql.includes("status = 'left'")) { groups.set(String(args[1]), 'left'); return { rowsAffected: 1 }; }
    if (sql.includes('INSERT OR IGNORE INTO line_staff_messages')) { saved.push(args); return { rowsAffected: 1 }; }
    return { rowsAffected: 0 };
  }),
  getAll: vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('FROM line_staff_groups')) { const s = groups.get(String(args[0])); return s ? [{ status: s }] : []; }
    return [];
  }),
}));

import { handleStaffEvent } from '@/lib/lineStaff';

const grp = { type: 'group' as const, groupId: 'G1', userId: 'U1' };

describe('BOOMスタッフアカウントの受け口', () => {
  beforeEach(() => { groups.clear(); saved.length = 0; });

  it('1対1は何もしない', async () => {
    expect(await handleStaffEvent({ type: 'message', source: { type: 'user', userId: 'U1' }, message: { type: 'text', text: 'こんにちは' } })).toBe('skip:1対1');
  });

  it('招かれたら承認待ち・承認前の発言は残さない', async () => {
    expect(await handleStaffEvent({ type: 'join', source: grp })).toBe('join');
    expect(groups.get('G1')).toBe('pending');
    expect(await handleStaffEvent({ type: 'message', source: grp, message: { id: 'm1', type: 'text', text: '空いてます' } })).toBe('skip:未承認');
    expect(saved).toHaveLength(0);
  });

  it('承認済みなら伏せてから残す', async () => {
    groups.set('G1', 'approved');
    expect(await handleStaffEvent({ type: 'message', source: grp, message: { id: 'm2', type: 'text', text: '12/5 19時から空いてます 022-123-4567' } })).toBe('saved');
    expect(String(saved[0][3])).toContain('[電話番号]');
    expect(String(saved[0][3])).not.toContain('4567');
  });

  it('再び招かれても承認済みは保つ・退出で left', async () => {
    groups.set('G1', 'approved');
    await handleStaffEvent({ type: 'join', source: grp });
    expect(groups.get('G1')).toBe('approved');
    await handleStaffEvent({ type: 'leave', source: grp });
    expect(groups.get('G1')).toBe('left');
  });
});

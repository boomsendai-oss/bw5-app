import { describe, it, expect } from 'vitest';
import { mergeChannelFunnel } from '../ga4';

describe('mergeChannelFunnel', () => {
  it('チャネルごとにLINEクリックを突合し、率を計算し、セッション降順に並べる', () => {
    const rows = mergeChannelFunnel(
      [
        { channel: 'Display', sessions: 200, users: 190, engaged: 20, avgSec: 8 },
        { channel: 'Paid Search', sessions: 40, users: 38, engaged: 30, avgSec: 95 },
        { channel: 'Organic Search', sessions: 100, users: 90, engaged: 70, avgSec: 120 },
      ],
      [
        { channel: 'Paid Search', count: 6 },
        { channel: 'Organic Search', count: 9 },
      ]
    );
    expect(rows.map((r) => r.channel)).toEqual(['Display', 'Organic Search', 'Paid Search']);
    const d = rows[0];
    expect(d.line_clicks).toBe(0);
    expect(d.engagement_rate).toBeCloseTo(0.1);
    expect(d.line_click_rate).toBe(0);
    const ps = rows[2];
    expect(ps.line_clicks).toBe(6);
    expect(ps.line_click_rate).toBeCloseTo(0.15);
  });

  it('セッション0のチャネルは率を0にする(ゼロ除算しない)', () => {
    const rows = mergeChannelFunnel([{ channel: 'Email', sessions: 0, users: 0, engaged: 0, avgSec: 0 }], []);
    expect(rows[0].engagement_rate).toBe(0);
    expect(rows[0].line_click_rate).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { deviceLabel } from '../bf6StreamDb';

describe('端末の種類', () => {
  it('よくある端末を見分ける', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
    expect(deviceLabel('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe('iPad');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14)')).toBe('Android');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });

  it('空や見慣れないものも落ちない', () => {
    expect(deviceLabel('')).toBe('—');
    expect(deviceLabel('SmartTV/1.0')).toBe('その他');
  });
});

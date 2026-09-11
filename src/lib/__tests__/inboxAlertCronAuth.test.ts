import { describe, it, expect } from 'vitest';
import { cronAuthorized } from '../inboxAlert/cronAuth';

const env = { CRON_SECRET: 'gh-secret', CRON_SECRET_CF: 'cf-secret' };

describe('cronAuthorized', () => {
  it('Cloudflare Worker の x-cron-secret を通す', () => {
    expect(cronAuthorized(new Headers({ 'x-cron-secret': 'cf-secret' }), env)).toBe(true);
  });
  it('Authorization: Bearer も通す', () => {
    expect(cronAuthorized(new Headers({ authorization: 'Bearer gh-secret' }), env)).toBe(true);
  });
  it('違う鍵は通さない', () => {
    expect(cronAuthorized(new Headers({ 'x-cron-secret': 'nope' }), env)).toBe(false);
  });
  it('サーバー側に鍵が無ければ何も通さない', () => {
    expect(cronAuthorized(new Headers({ 'x-cron-secret': '' }), {})).toBe(false);
  });
});

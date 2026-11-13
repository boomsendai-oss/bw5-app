import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  decideRefresh,
  expiresAtFrom,
  isTokenDeadError,
  resolveExpiresAt,
} from '../threadsToken';

const NOW = new Date('2026-11-13T00:00:00Z');
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * DAY_MS).toISOString();

describe('resolveExpiresAt (期限の読み取り)', () => {
  it('expires_at があればそれを使う', () => {
    expect(resolveExpiresAt(daysFromNow(-10), daysFromNow(30))?.toISOString()).toBe(daysFromNow(30));
  });
  it('expires_at が無い古いデータは発行日+60日で推定する', () => {
    expect(resolveExpiresAt(daysFromNow(-10), undefined)?.toISOString()).toBe(daysFromNow(50));
  });
  it('どちらも無ければ null', () => {
    expect(resolveExpiresAt(undefined, undefined)).toBeNull();
    expect(resolveExpiresAt('壊れた日付', undefined)).toBeNull();
  });
});

describe('decideRefresh (いつ延長するか)', () => {
  it('期限まで15日以上あれば何もしない', () => {
    const d = decideRefresh({ now: NOW, issuedAt: daysFromNow(-30), expiresAt: daysFromNow(30) });
    expect(d.action).toBe('none');
  });
  it('期限まで15日を切ったら延長する', () => {
    const d = decideRefresh({ now: NOW, issuedAt: daysFromNow(-46), expiresAt: daysFromNow(14) });
    expect(d.action).toBe('refresh');
  });
  it('古いデータ(期限の記録なし)でも発行から46日なら延長する', () => {
    const d = decideRefresh({ now: NOW, issuedAt: daysFromNow(-46) });
    expect(d.action).toBe('refresh');
  });
  it('期限を過ぎていたら expired(延長できない=再連携が要る)', () => {
    const d = decideRefresh({ now: NOW, issuedAt: daysFromNow(-100), expiresAt: daysFromNow(-40) });
    expect(d.action).toBe('expired');
  });
  it('2026-10-04に切れた今の鍵(発行8/5ごろ・期限記録なし)は expired', () => {
    const d = decideRefresh({ now: NOW, issuedAt: '2026-08-05T10:00:00Z' });
    expect(d.action).toBe('expired');
  });
  it('発行から24時間たっていなければ延長しない(Metaの仕様)', () => {
    const d = decideRefresh({
      now: NOW,
      issuedAt: new Date(NOW.getTime() - 3600_000).toISOString(),
      expiresAt: daysFromNow(10),
    });
    expect(d.action).toBe('too_young');
  });
  it('記録が何も無ければ unknown', () => {
    expect(decideRefresh({ now: NOW }).action).toBe('unknown');
  });
});

describe('expiresAtFrom (expires_in から期限を作る)', () => {
  it('秒数を足す', () => {
    expect(expiresAtFrom(NOW, 5183944)).toBe(new Date(NOW.getTime() + 5183944_000).toISOString());
  });
  it('無ければ60日で推定', () => {
    expect(expiresAtFrom(NOW, undefined)).toBe(daysFromNow(60));
  });
});

describe('isTokenDeadError (再連携しか直せない失敗か)', () => {
  it('code 190 は失効', () => {
    expect(isTokenDeadError({ code: 190, message: 'x' })).toBe(true);
  });
  it('Session has expired の文言も失効', () => {
    expect(isTokenDeadError({ message: 'Error validating access token: Session has expired on ...' })).toBe(true);
  });
  it('一時的なエラーは失効扱いしない', () => {
    expect(isTokenDeadError({ code: 2, message: 'Service temporarily unavailable' })).toBe(false);
  });
});

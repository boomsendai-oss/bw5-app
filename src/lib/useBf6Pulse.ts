'use client';

// 他の端末が何か入れたら知らせる。当日オペのクルー画面と、出場者が触る受付端末の
// どちらからも使う。判定は bf6Pulse.ts の純関数、ここはタイマーと通信だけ。
//
// ⚠️ 中身は取りに行かない。合図(数十バイト)だけを見て、変わったときに onChange を呼ぶ。
//    毎周期 router.refresh() すると、検索中の文字や開いている明細が作り直されて
//    当日の操作の邪魔になる。
import { useEffect, useRef } from 'react';
import { pulseChanged, shouldPoll } from './bf6Pulse';

/** 見に行く間隔。短くしても通信は合図1本ぶんなので軽い。 */
export const PULSE_MS = 2000;

export function useBf6Pulse(onChange: () => void, opts?: { enabled?: boolean }): void {
  const enabled = opts?.enabled ?? true;
  const prev = useRef<string | null>(null);
  const inFlight = useRef(false);
  // onChange と enabled は毎描画で変わりうる。タイマーを張り直さないよう ref で受ける。
  const cb = useRef(onChange);
  const on = useRef(enabled);
  cb.current = onChange;
  on.current = enabled;

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (!shouldPoll({ enabled: on.current, hidden, inFlight: inFlight.current })) return;
      inFlight.current = true;
      try {
        const r = await fetch('/api/bf6/pulse', { cache: 'no-store' });
        if (!r.ok || !alive) return;
        const { token } = (await r.json()) as { token?: unknown };
        if (!alive || typeof token !== 'string') return;
        const changed = pulseChanged(prev.current, token);
        prev.current = token;
        if (changed) cb.current();
      } catch {
        // 会場の回線が一瞬切れても画面を壊さない。次の周期で拾い直す。
      } finally {
        inFlight.current = false;
      }
    };

    // 伏せていた端末を起こした瞬間は、次の周期を待たずに取りに行く
    const onVisible = () => { if (!document.hidden) void tick(); };
    document.addEventListener('visibilitychange', onVisible);

    void tick();
    const id = setInterval(() => void tick(), PULSE_MS);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}

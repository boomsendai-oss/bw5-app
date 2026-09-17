'use client';

// 他の端末が入れた情報を自動で取り込む。クルー画面の layout に1つ置けば配下の全画面に効く。
//
// 背景(TARO会場リハ 2026-09-17): LEDだけが1秒ごとに取りに行っていて、
// スタッフのiPad・スマホは一切ポーリングしていなかった。他の人が入れた情報は
// 「自分が操作する」か「手で再読み込みする」までしか出てこなかった。
//
// ⚠️ 中身は取りに行かない。合図(数十バイト)だけを見て、変わったときにだけ
//    router.refresh() する。毎回 refresh すると受付の検索文字や開いている明細が
//    作り直され、当日の操作の邪魔になる。
//
// ⚠️ loading.tsx は絶対に置かないこと(このroute groupでは本番で画面が固まる)。
//    自動更新はここで行い、待ちの表示は CrewLink の useLinkStatus に任せる。
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { pulseChanged } from '@/lib/bf6Pulse';

/** 見に行く間隔。短くしても通信は合図1本ぶんなので軽い。 */
const PULSE_MS = 2000;

export default function PulseRefresh() {
  const router = useRouter();
  const prev = useRef<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      // 画面を見ていない端末(iPadを伏せている・別アプリ)は叩かない
      if (typeof document !== 'undefined' && document.hidden) return;
      // 会場のWi-Fiが遅いとき、前の問い合わせが返る前に次を重ねない
      if (busy.current) return;
      busy.current = true;
      try {
        const r = await fetch('/api/bf6/pulse', { cache: 'no-store' });
        if (!r.ok || !alive) return;
        const { token } = (await r.json()) as { token: string };
        if (!alive || typeof token !== 'string') return;
        const changed = pulseChanged(prev.current, token);
        prev.current = token;
        if (changed) router.refresh();
      } catch {
        // 会場の回線が一瞬切れても画面を壊さない。次の周期で拾い直す。
      } finally {
        busy.current = false;
      }
    };

    // 伏せていたiPadを起こした瞬間は、次の周期を待たずに取りに行く
    const onVisible = () => { if (!document.hidden) void tick(); };
    document.addEventListener('visibilitychange', onVisible);

    void tick();
    const id = setInterval(() => void tick(), PULSE_MS);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return null;
}

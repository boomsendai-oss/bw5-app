'use client';

// 他の端末が入れた情報を自動で取り込む。クルー画面の layout に1つ置けば配下の全画面に効く。
//
// 背景(TARO会場リハ 2026-09-17): LEDだけが1秒ごとに取りに行っていて、
// スタッフのiPad・スマホは一切ポーリングしていなかった。他の人が入れた情報は
// 「自分が操作する」か「手で再読み込みする」までしか出てこなかった。
//
// ⚠️ loading.tsx は絶対に置かないこと(このroute groupでは本番で画面が固まる)。
//    自動更新はここで行い、待ちの表示は CrewLink の useLinkStatus に任せる。
import { useRouter } from 'next/navigation';
import { useBf6Pulse } from '@/lib/useBf6Pulse';

export default function PulseRefresh() {
  const router = useRouter();
  useBf6Pulse(() => router.refresh());
  return null;
}

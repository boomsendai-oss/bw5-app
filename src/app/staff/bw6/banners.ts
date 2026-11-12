// BW6 発表会のスタッフの最初の画面の、本番の帯を出すかどうか（純関数）。
// 支払いは時刻の鍵 pay_open_at とボタンの鍵 pay_ok_at が両方そろって開く（K224）ので、payGate が open でなければ帯を出す。
import { payGate, type RecitalSettings } from '@/lib/recital';

export function liveBanners(s: RecitalSettings, nowMs: number = Date.now()): { suspended: boolean; payNotOpen: boolean } {
  return { suspended: s.suspended, payNotOpen: payGate(s, nowMs) !== 'open' };
}

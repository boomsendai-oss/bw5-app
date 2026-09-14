// LEDに映す画面の部門ごとの色。純データ・DOMに触らない。
//
// これまで全部オレンジで、映っているのがどの部門か色で分からなかった(TARO 2026-09-14)。
// 受付iPadの部門選択と同じ対応にして、当日ずっと同じ色で通す。
export type DivisionTheme = {
  /** 色の名前(テストと目視確認用) */
  name: 'emerald' | 'orange' | 'red';
  /** 見出し・強調の文字色 */
  text: string;
  /** 枠線 */
  border: string;
  /** 勝ち残りの名前の色 */
  alive: string;
  /** 光らせるときの色(CSSの値) */
  glow: string;
  /** トーナメント表で勝ち残っている人のカード */
  cardAlive: string;
  /** 優勝枠のカード */
  champion: string;
};

export const DIVISION_THEMES: Record<string, DivisionTheme> = {
  beginner: {
    name: 'emerald',
    text: 'text-emerald-400',
    border: 'border-emerald-500',
    alive: 'text-emerald-300',
    glow: 'rgba(16,185,129,0.65)',
    cardAlive: 'border-emerald-400/80 bg-emerald-500/20 text-emerald-50',
    champion: 'border-emerald-400 bg-emerald-500/25 text-white',
  },
  kids: {
    name: 'orange',
    text: 'text-orange-400',
    border: 'border-orange-500',
    alive: 'text-orange-300',
    glow: 'rgba(249,115,22,0.65)',
    cardAlive: 'border-orange-400/80 bg-orange-500/20 text-orange-50',
    champion: 'border-orange-400 bg-orange-500/25 text-white',
  },
  general: {
    name: 'red',
    text: 'text-red-400',
    border: 'border-red-500',
    alive: 'text-red-300',
    glow: 'rgba(239,68,68,0.65)',
    cardAlive: 'border-red-400/80 bg-red-500/20 text-red-50',
    champion: 'border-red-400 bg-red-500/25 text-white',
  },
};

export function divisionTheme(division: string): DivisionTheme {
  return DIVISION_THEMES[division] ?? DIVISION_THEMES.kids;
}

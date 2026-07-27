// 広告費の表示整形。ga4.ts から分離しているのは意図的:
//   ga4.ts は '@google-analytics/data' (gRPC/Node専用) を import しており、
//   クライアントコンポーネントからそのまま import するとブラウザ向けバンドルに
//   fs/net/tls 依存のgRPCコードが混入してビルドが失敗する (実際に next build で確認済み)。
// この関数は純粋関数で外部依存が無いため、クライアント/サーバどちらからでも安全にimportできる。
// ga4.ts 側はこのファイルを re-export しているので、サーバ側コードは従来通り '@/lib/ga4' から使える。

/**
 * 金額を通貨つきで表示用に整形する。JPY以外は誤解を招かないよう通貨コードを併記する。
 *
 * - JPYは補助単位が無いため整数に丸める (例: 26730 → '¥26,730')
 * - それ以外の通貨は小数第2位まで表示し、通貨コードを前置する (例: 160.54 USD → 'USD 160.54')
 * - 通貨コードが不明/空の場合は、数値をそのまま(丸めず)返す。金額の桁を偽らないため
 */
export function formatAdCost(amount: number, currency: string): string {
  if (currency === 'JPY') {
    return `¥${Math.round(amount).toLocaleString('ja-JP')}`;
  }
  if (!currency) {
    return amount.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  }
  return `${currency} ${amount.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

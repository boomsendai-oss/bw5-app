// ⚠️ 公開ページ(認証なし)。理由: vol.7の告知とお知らせリスト登録(一般来場者向け)。
//
// 9/26のBF6会場でvol.7を発表するのに合わせて先に出しておくページ(TARO 2026-09-24)。
// エントリー開始(2026-11-30予定)までカウントダウンし、開始したら知らせる名簿を集める。
// ⚠️ スペシャルゲストの名前はここに書かない。会場で口頭発表する方針(TARO)。
import type { Metadata } from 'next';
import Bf7Client from './Bf7Client';

export const metadata: Metadata = {
  title: "BOOMER'S FIGHT!!! vol.7 | 2027.1.30(土) SSM 9階ホール",
  description:
    "BOOMER'S FIGHT!!! vol.7 は2027年1月30日(土)、仙台スクールオブミュージック&ダンス専門学校 9階ホールで開催。エントリー開始のお知らせを受け取るリストを受付中。",
};

export default function Bf7Page() {
  return <Bf7Client />;
}

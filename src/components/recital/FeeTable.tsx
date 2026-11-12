// BW6 発表会の料金の早見（表だけ。04 4-2「料金の早見に書くこと」）。数は feeTableFromRules（料金の規則）から。
// 「金額を試す」は段階2で作る。
import { jpDate, yenJa, type FeeTableData } from '@/lib/recitalPublic';

const thCls = 'border border-sand-200 bg-sand-100 px-3 py-2 text-left font-bold';
const tdCls = 'border border-sand-200 px-3 py-2';

export function FeeTable({ table, payDue, extraCostsText }: { table: FeeTableData; payDue: string; extraCostsText: string }) {
  const n = table.first.length;
  return (
    <section className="space-y-5 text-sm leading-relaxed text-navy-700">
      <div>
        <h3 className="mb-2 text-base font-bold">1人目</h3>
        <table className="w-full border-collapse bg-white">
          <thead>
            <tr>
              <th className={thCls}>作品の数</th>
              <th className={`${thCls} text-right`}>金額</th>
            </tr>
          </thead>
          <tbody>
            {table.first.map((yen, i) => (
              <tr key={i}>
                <td className={tdCls}>{i + 1}作品</td>
                <td className={`${tdCls} text-right tabular-nums`}>{yenJa(yen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2">
          家族の2人目からは、1作品 {yenJa(table.familyFirst)}、2作品目から +{yenJa(table.familyAdd)}。1人 {n} 作品まで。
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-base font-bold">家族の例</h3>
        <table className="w-full border-collapse bg-white">
          <tbody>
            {table.examples.map((e) => (
              <tr key={e.label}>
                <td className={tdCls}>{e.label}</td>
                <td className={`${tdCls} text-right tabular-nums`}>{yenJa(e.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2">ご家族の中で、いちばんお得になる組み合わせで計算しています。</p>
        <p className="mt-1">協力チケットは、1家族に3枚です。ご家族やお友だちに渡せる入場券です。</p>
      </div>

      <div className="space-y-1">
        <h3 className="mb-2 text-base font-bold">お支払いのこと</h3>
        <p>お申し込みのときは、お支払いはありません。お支払いは、お申し込みのすぐあとから {jpDate(payDue)}まで、いつでもできます。お支払いいただいた時点で、お申し込み完了です。</p>
        <p>お支払いは、カードか銀行振込でお願いします。銀行振込のときの振込手数料は、ご負担をお願いします。</p>
        <p>迷っている作品がある方は、決まってからお支払いください。お支払いのあとは、お返しできません。</p>
        {/* 手数料の分け方（D5 2-6）。この1文はこちらで決めた仮の文。12/8 に TARO が見る */}
        <p>カードでお支払いのときの手数料は、スクールが持ちます。</p>
      </div>

      {extraCostsText.trim() !== '' && (
        <div>
          <h3 className="mb-2 text-base font-bold">このほかにかかるもの</h3>
          <p className="whitespace-pre-wrap">{extraCostsText}</p>
        </div>
      )}
    </section>
  );
}

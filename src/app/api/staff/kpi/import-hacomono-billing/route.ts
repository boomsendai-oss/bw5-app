import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, rowsToDicts, parseDate } from '@/lib/csvUtil';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// 既定(15秒)では余裕が薄い。実測でこのrouteは約12秒かかる回があり、
// 行数が増えると既定値に当たって504になるため明示的に余裕を取る(2026-07-30)。
export const maxDuration = 60;

// 完全一致を全キーで先に試し、無ければ部分一致にフォールバックする。
// 部分一致を後回しにしないと「割引金額」が「金額」を誤ヒットするバグが起きる（T-155）。
function pick(rec: Record<string, string>, ...keys: string[]): string {
  // 1) 完全一致を優先（全キー）
  for (const k of keys) {
    if (rec[k] !== undefined && rec[k] !== '') return rec[k];
  }
  // 2) 部分一致フォールバック（全キー）
  for (const k of keys) {
    for (const recKey of Object.keys(rec)) {
      if (recKey.includes(k) && rec[recKey] !== '') return rec[recKey];
    }
  }
  return '';
}
function parseAmt(s: string): number {
  if (!s) return 0;
  const c = s.replace(/[,円¥\s]/g, '').trim();
  const n = parseInt(c, 10);
  return isNaN(n) ? 0 : n;
}

// 商品名から経費カテゴリ推定 (HACOMONO命名規則ベース)
// 注意(T-155): 新規入会の課金行は「初月会費＋翌月会費＋入会金＋クーポン割引」が
//   1行に結合され、合計金額はクーポン適用後の正味額になる。スタートダッシュ
//   クーポンで入会金は実質0円になるため、この正味額は実質的にプラン売上である。
//   そのため「プラン系(初月会費/月会費/マンスリー)」を「入会金」より先に判定し、
//   結合行をenrollment_feeに誤って落とさないようにする。
//   純粋な「入会金x1」単独行(プラン語を含まない)のみenrollment_feeとする。
function guessProductCategory(productName: string): string {
  const p = productName.toLowerCase();
  // システム変更手数料は入会金ではなく「その他」(プラン変更・休会延長等で発生)
  if (/システム変更手数料|手数料/.test(p)) return 'other';
  // プラン系(初月会費・月会費・マンスリー等)を最優先 → 結合行をplanに正しく寄せる
  if (/プラン|plan|月会費|初月会費|月額|定額|サブスク|マンスリー/.test(p)) return 'plan';
  if (/チケット|ticket|単発|回数券|ドロップイン|追加受講|ビジター/.test(p)) return 'ticket';
  // プラン語を含まない純粋な入会金単独行のみ enrollment_fee
  if (/入会金|enrollment|signup|admission/.test(p)) return 'enrollment_fee';
  return 'other';
}

// hacomono_products テーブルから完全一致でカテゴリ取得 (優先)
async function buildProductMap(): Promise<Map<string, 'plan' | 'ticket' | 'other'>> {
  const rows = (await getAll(`SELECT product_type, name FROM hacomono_products`)) as { product_type: string; name: string }[];
  const m = new Map<string, 'plan' | 'ticket' | 'other'>();
  for (const r of rows) {
    if (r.product_type === 'plan') m.set(r.name, 'plan');
    else if (r.product_type === 'ticket') m.set(r.name, 'ticket');
  }
  return m;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  let csvText = '';
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (file instanceof File) {
      const buf = await file.arrayBuffer();
      csvText = new TextDecoder('utf-8').decode(buf);
      if ((csvText.match(/�/g)?.length ?? 0) > 10) {
        csvText = new TextDecoder('shift-jis').decode(buf);
      }
    }
  } else {
    csvText = await req.text();
  }
  if (!csvText) return NextResponse.json({ error: 'CSV body required' }, { status: 400 });

  const rows = parseCSV(csvText);
  if (rows.length < 2) return NextResponse.json({ error: 'CSV has no data rows' }, { status: 400 });
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const r = rows[i].join('|');
    if (/(課金日|決済日|請求日|billing).*商品|商品.*金額/.test(r)) { headerIdx = i; break; }
  }
  const records = rowsToDicts(rows, headerIdx);
  const productMap = await buildProductMap();

  let imported = 0;
  let duplicated = 0;
  let skipped = 0;
  let exactMatched = 0;
  const errors: string[] = [];

  for (const rec of records) {
    try {
      // 精算日時 (HACOMONO売上CSV) または 日付/課金日 (汎用)
      const dateStr = pick(rec, '精算日時', '課金日', '決済日', '請求日', '購入日', '日付');
      const billingDate = parseDate(dateStr ? dateStr.split(' ')[0] : '');
      // 金額カラムの優先順位（T-155）:
      //   合計金額 = クーポン割引適用後の正味額（売上集計CSV）。これを最優先。
      //   精算合計金額/明細精算金額 = 売上明細CSV(別フォーマット)の正味額。
      //   「割引金額」は絶対に拾わない（マイナス値で売上が逆転するため pick候補から除外）。
      const amount = parseAmt(pick(rec, '合計金額', '精算合計金額', '明細精算金額', '販売額', '請求金額', 'amount'));
      // billingDate さえあれば amount===0/負（初月日割¥0・返金行）も取り込む。
      // 月会費の返金（-1,500等）も正しく売上に反映させるため amount条件で弾かない。
      if (!billingDate) { skipped++; continue; }
      const productName = pick(rec, '商品名', '摘要', 'プラン名', 'チケット名', '商品', '販売商品');
      // 売上ID = HACOMONO取引一意ID。これを重複排除キーにすることで、
      // 同一会員が同日に同一商品を複数回購入した取引も正確に保持する(T-155 follow-up)。
      const saleId = pick(rec, '売上ID', '取引ID', 'sale_id', 'id');
      const memberId = pick(rec, 'メンバーID', '会員ID', 'メンバー');
      const kaiinNo = pick(rec, '会員番号', '会員No');
      const paymentMethod = pick(rec, '支払方法', '決済方法');
      const status = pick(rec, 'ステータス', '状態');
      // 決済手数料(PL001)。「金額確定前」の期間は空で来る=NULLで保存し、
      // 確定後の再取込(毎日の同期が前月+当月をさらう)でUPSERTにより埋まる。
      // NULLと0を区別する: 空文字=未確定(NULL)、現金決済の0=手数料なし(0)。
      const feeRaw = pick(rec, '手数料');
      const feeAmount = feeRaw === '' ? null : parseAmt(feeRaw);
      const feeTaxRaw = pick(rec, '手数料（消費税）', '手数料(消費税)');
      const feeTax = feeTaxRaw === '' ? null : parseAmt(feeTaxRaw);
      const depositDate = parseDate((pick(rec, '入金日') || '').split(' ')[0]) || null;

      // hacomono_products との完全一致 → 部分一致 → ヒューリスティック
      let category: string;
      const exact = productMap.get(productName);
      if (exact) {
        category = exact;
        exactMatched++;
      } else {
        // 部分一致 (productName が products名を含む or 逆)
        let partial: 'plan' | 'ticket' | 'other' | null = null;
        for (const [pName, pType] of productMap.entries()) {
          if (productName.includes(pName) || pName.includes(productName)) {
            partial = pType;
            break;
          }
        }
        category = partial ?? guessProductCategory(productName);
      }

      // boom_member_id を hacomono_member_id 経由で解決（未登録ならvisitorとして自動追加）
      let boomMemberId: number | null = null;
      if (memberId) {
        const bm = (await getAll(
          `SELECT id FROM boom_members WHERE hacomono_member_id = ?`, [memberId]
        )) as { id: number }[];
        if (bm.length > 0) {
          boomMemberId = bm[0].id;
        } else {
          await execute(
            `INSERT OR IGNORE INTO boom_members (hacomono_member_id, hacomono_kaiin_no, full_name, full_name_kana, status, member_type)
             VALUES (?, ?, ?, '', 'active', 'visitor')`,
            [memberId, kaiinNo || null, kaiinNo ? `（会員番号${kaiinNo}・氏名未確認）` : `（HACOMONO ID ${memberId}）`]
          );
          const inserted = (await getAll(
            `SELECT id FROM boom_members WHERE hacomono_member_id = ?`, [memberId]
          )) as { id: number }[];
          if (inserted.length > 0) boomMemberId = inserted[0].id;
        }
      }

      // 売上IDがあれば取引単位で upsert (同日同一商品の複数購入も保持)。
      // 売上IDが無い旧フォーマットCSVは従来通り billing_date+member_id+product_name+amount で
      // 重複を抑止する(売上IDなし行同士の取りこぼし防止)。
      // M17: 実際に書き込まれた行数を rowsAffected で数える。旧実装は無条件に
      // imported++ しており、sale_id 無し経路の `WHERE NOT EXISTS`(条件付きINSERT)で
      // 1行も入らなかった場合まで「取込済み」と表示していた
      // (= 二重取込の疑いを潰す材料にならず、件数が実態とズレる)。
      let res;
      if (saleId) {
        res = await execute(
          `INSERT INTO hacomono_billing_records
           (sale_id, billing_date, member_id, kaiin_no, boom_member_id, product_name, product_category, amount, payment_method, status, fee_amount, fee_tax, deposit_date, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(sale_id) DO UPDATE SET
             billing_date=excluded.billing_date,
             member_id=excluded.member_id,
             kaiin_no=excluded.kaiin_no,
             boom_member_id=excluded.boom_member_id,
             product_name=excluded.product_name,
             product_category=excluded.product_category,
             amount=excluded.amount,
             payment_method=excluded.payment_method,
             status=excluded.status,
             fee_amount=COALESCE(excluded.fee_amount, hacomono_billing_records.fee_amount),
             fee_tax=COALESCE(excluded.fee_tax, hacomono_billing_records.fee_tax),
             deposit_date=COALESCE(excluded.deposit_date, hacomono_billing_records.deposit_date),
             imported_at=CURRENT_TIMESTAMP`,
          [saleId, billingDate, memberId || null, kaiinNo || null, boomMemberId, productName || null, category, amount, paymentMethod || null, status || null, feeAmount, feeTax, depositDate]
        );
      } else {
        res = await execute(
          `INSERT INTO hacomono_billing_records
           (billing_date, member_id, kaiin_no, boom_member_id, product_name, product_category, amount, payment_method, status, imported_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
           WHERE NOT EXISTS (
             SELECT 1 FROM hacomono_billing_records
             WHERE billing_date=? AND member_id IS ? AND product_name IS ? AND amount=?
           )`,
          [billingDate, memberId || null, kaiinNo || null, boomMemberId, productName || null, category, amount, paymentMethod || null, status || null,
           billingDate, memberId || null, productName || null, amount]
        );
      }
      if (Number(res?.rowsAffected ?? 0) > 0) imported++;
      else duplicated++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      skipped++;
    }
  }
  // M17: ok は「全行失敗」のときだけ false。1行でも入っていれば成功扱いにし、
  // errors は件数に関わらず常に返してUIで見せる(握りつぶさない)。
  const ok = !(records.length > 0 && imported === 0 && duplicated === 0);
  return NextResponse.json({
    ok,
    total_rows: records.length,
    imported,          // 実際に新規INSERT/更新された行数
    duplicated,        // 既に取込済みで書き込みが発生しなかった行数
    skipped,           // エラーで取り込めなかった行数
    exact_matched: exactMatched,
    errors,            // 全件返す(旧実装は先頭5件で打ち切っていた)
    error_count: errors.length,
  });
}

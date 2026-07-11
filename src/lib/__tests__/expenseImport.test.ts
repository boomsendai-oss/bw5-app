import { describe, it, expect } from 'vitest';
import {
  normalizeDesc,
  parseGmoCsv,
  parseSbiBankCsv,
  parseSbiDebitCsv,
  parseRakutenText,
  classify,
  seedToMasters,
  RECURRING_SEED,
  type Master,
} from '../expenseImport';

// ============================================
// テスト用マスタ: RECURRING_SEED (固定費マスタv1の21行) を id 1..21 で展開。
// 実DBと同じ「id昇順・最初勝ち」の評価順をテストするため、シード配列そのものを使う。
// ============================================
const MASTERS: Master[] = seedToMasters(RECURRING_SEED);

// ============================================
// normalizeDesc
// ============================================
describe('normalizeDesc', () => {
  it('NFKC + lower + 連続空白圧縮 (計画の実例)', () => {
    expect(normalizeDesc('Visaデビット利用　海外 ANTHROPIC* CLAUDE SUB 承認番号：590645')).toBe(
      'visaデビット利用 海外 anthropic* claude sub 承認番号:590645'
    );
  });

  it('全角英数・全角記号を半角へ (ＬＩＮＥ公式 → line公式)', () => {
    expect(normalizeDesc('ＬＩＮＥ公式アカウント')).toBe('line公式アカウント');
    expect(normalizeDesc('カ．デクト')).toBe('カ.デクト');
    expect(normalizeDesc('スミシンエスビ－アイ')).toBe('スミシンエスビ-アイ'); // 全角ハイフン－は半角に
  });

  it('半角カナは全角カナへ (ﾘﾍﾞｼﾃｲ → リベシテイ)', () => {
    expect(normalizeDesc('ﾘﾍﾞｼﾃｲ')).toBe('リベシテイ');
    expect(normalizeDesc('ﾌﾘｰ')).toBe('フリー');
  });

  it('連続空白 (全角スペース含む) は1つに圧縮・前後trim', () => {
    expect(normalizeDesc('  振込　　キムラ　シンタロウ  ')).toBe('振込 キムラ シンタロウ');
  });
});

// ============================================
// parseGmoCsv (Shift-JISデコード済みテキストを想定・全列引用符付き・日付=YYYYMMDD)
// ============================================
describe('parseGmoCsv', () => {
  const csv = [
    '"日付","摘要","入金金額","出金金額","残高","メモ"',
    '"20260630","Visaデビット利用　海外 ANTHROPIC* CLAUDE SUB 承認番号：500001 TID：400000000000001","","36365","100000",""',
    '"20260630","振込  テストイライニン","2000","","102000",""',
    '"20260610","JCB)ﾛﾎﾞﾂﾄﾍﾟｲ","","18346","81654","ハコモノ利用料"',
    '"20260601","振込手数料","","143","81511",""',
  ].join('\r\n');

  it('YYYYMMDD → ISO・カンマ無し金額・メモ列を取り込む', () => {
    const rows = parseGmoCsv(csv);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      date: '2026-06-30',
      description: 'Visaデビット利用　海外 ANTHROPIC* CLAUDE SUB 承認番号：500001 TID：400000000000001',
      deposit: 0,
      withdraw: 36365,
      balance: 100000,
    });
    expect(rows[1]).toMatchObject({ date: '2026-06-30', deposit: 2000, withdraw: 0 });
    expect(rows[2].memo).toBe('ハコモノ利用料');
    expect(rows[3]).toMatchObject({ date: '2026-06-01', withdraw: 143 });
  });

  it('メモ空文字は undefined になる', () => {
    const rows = parseGmoCsv(csv);
    expect(rows[0].memo).toBeUndefined();
  });
});

// ============================================
// parseSbiBankCsv (⚠️空フィールドは引用符なし・日付=YYYY/MM/DD・金額カンマ入り)
// ============================================
describe('parseSbiBankCsv', () => {
  const csv = [
    '"日付","内容","出金金額(円)","入金金額(円)","残高(円)","メモ"',
    '"2026/06/30","デビット　９４０２１３","4,434",,"7,987","-"',
    '"2026/05/27","口座振替　楽天カードサービス","67,146",,"114,068","-"',
    '"2026/06/01","デビット　８９４９０１","3,300",,"9,922","-"',
    '"2026/06/26","振込＊テストフリコミ",,"100,000","311,919","-"',
    '"2026/06/29","口座振替　テストホケン","859",,"180,597","メモテスト"',
  ].join('\n');

  it('引用符なし空フィールド行を正しく処理する (,, が壊れない)', () => {
    const rows = parseSbiBankCsv(csv);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ date: '2026-06-30', withdraw: 4434, deposit: 0, balance: 7987 });
    expect(rows[3]).toMatchObject({ date: '2026-06-26', withdraw: 0, deposit: 100000 });
  });

  it('デビット行と楽天カードサービス行に skip:true が付く', () => {
    const rows = parseSbiBankCsv(csv);
    expect(rows[0].skip).toBe(true); // デビット　９４０２１３
    expect(rows[1].skip).toBe(true); // 楽天カードサービス
    expect(rows[2].skip).toBe(true); // デビット　８９４９０１
    expect(rows[3].skip).toBeFalsy();
    expect(rows[4].skip).toBeFalsy();
  });

  it('メモ "-" は undefined・実メモは残す', () => {
    const rows = parseSbiBankCsv(csv);
    expect(rows[0].memo).toBeUndefined();
    expect(rows[4].memo).toBe('メモテスト');
  });
});

// ============================================
// parseSbiDebitCsv (先頭列"1"=ヘッダー・"2"=データ・金額 "3300.00" 形式)
// ============================================
describe('parseSbiDebitCsv', () => {
  const csv = [
    '"1","お取引日","お取引内容","お取引通貨","お取引金額","お取引手数料","ATM手数料","海外事務手数料","ご利用通貨","ご利用金額","ご利用手数料","換算レート"',
    '"2","2026/04/01","ﾘﾍﾞｼﾃｲ","JPY","3300.00","0.00","0.00","0.00","","0.00","0.00","0.00"',
    '"2","2026/04/28","ｳｼﾞｴｽｰﾊﾟｰ ｵﾀﾞﾜﾗﾃﾝ","JPY","2616.00","0.00","0.00","0.00","","0.00","0.00","0.00"',
  ].join('\r\n');

  it('先頭列"2"の行のみ・金額の小数を整数化', () => {
    const rows = parseSbiDebitCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-04-01', description: 'ﾘﾍﾞｼﾃｲ', withdraw: 3300, deposit: 0 });
    expect(rows[1]).toMatchObject({ date: '2026-04-28', withdraw: 2616 });
  });
});

// ============================================
// parseRakutenText (pdftotext -layout 出力・2スペース以上区切り)
// ============================================
describe('parseRakutenText', () => {
  const text = [
    'ご利用代金請求明細書',
    ' 2026年04月ご請求金額                               ご利用カード',
    '  2026/04/27              口座振替           テスト銀行', // 先頭スペース → 明細行ではない
    ' ご利用明細                                                                （単位：円）',
    '  利用日          利用店名                          利用者     支払方法',
    '2026/04/03   テストネンカイヒショップ            本人*      1回払い              11,550         0         11,550           11,550           0',
    '2026/03/28   AMAZON.CO.JP                    本人*      1回払い               3,980         0          3,980            3,980           0',
    '2026/03/11   ｵｵｴﾄﾞｵﾝｾﾝﾓﾉｶﾞﾀﾘ ﾏ               本人*      1回払い              36,508         0         36,508           36,508           0',
    '',
  ].join('\n');

  it('行頭が日付+2スペース以上の明細行のみ抽出・[楽天] 接頭辞・利用金額(5列目)', () => {
    const rows = parseRakutenText(text);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: '2026-04-03', description: '[楽天] テストネンカイヒショップ', withdraw: 11550, deposit: 0 });
    expect(rows[1]).toMatchObject({ date: '2026-03-28', description: '[楽天] AMAZON.CO.JP', withdraw: 3980 });
  });

  it('店名内の単一スペースは保持される (ｵｵｴﾄﾞｵﾝｾﾝﾓﾉｶﾞﾀﾘ ﾏ)', () => {
    const rows = parseRakutenText(text);
    expect(rows[2].description).toBe('[楽天] ｵｵｴﾄﾞｵﾝｾﾝﾓﾉｶﾞﾀﾘ ﾏ');
  });
});

// ============================================
// classify: GMO (全行保存の上での分類)
// ============================================
function gmoRow(description: string, withdraw: number, opts: { deposit?: number; memo?: string } = {}) {
  return { date: '2026-06-01', description, withdraw, deposit: opts.deposit ?? 0, memo: opts.memo };
}

describe('classify: GMO', () => {
  it('キムラ シンタロウ宛振込 → ignore(事業主貸)', () => {
    const r = classify(gmoRow('振込 スミシンエスビ－アイネツト キムラ　シンタロウ', 150000), MASTERS, 'gmo');
    expect(r).toMatchObject({ action: 'ignore', label: '経費外(事業主貸)' });
  });

  it('コナミ → ignore(スタジオ料=studio_billing側) ※T-166二重計上防止', () => {
    const r = classify(gmoRow('Visaデビット利用 コナミスポーツクラブ 承認番号：500002 TID：400000000000002', 26400), MASTERS, 'gmo');
    expect(r).toMatchObject({ action: 'ignore', label: '経費外(スタジオ料=studio_billing側)' });
  });

  it('カ．デクト振込 → ignore(スタジオ料) ※全角ピリオドNFKC・振込ルールより先', () => {
    const r = classify(gmoRow('振込 シチジユウシチ カ．デクト', 43200), MASTERS, 'gmo');
    expect(r).toMatchObject({ action: 'ignore', label: '経費外(スタジオ料=studio_billing側)' });
  });

  it('ATM・ATM利用手数料 → ignore(現金・事業主貸) ※スペース有無両対応', () => {
    expect(classify(gmoRow('ATM セブン銀行', 20000), MASTERS, 'gmo')).toMatchObject({ action: 'ignore', label: '経費外(現金・事業主貸)' });
    expect(classify(gmoRow('ATM 利用手数料 セブン銀行', 110), MASTERS, 'gmo')).toMatchObject({ action: 'ignore', label: '経費外(現金・事業主貸)' });
    expect(classify(gmoRow('ATM利用手数料 セブン銀行', 110), MASTERS, 'gmo')).toMatchObject({ action: 'ignore', label: '経費外(現金・事業主貸)' });
  });

  it('CLAUDE SUB → #1 Claude Max (id順で #3 anthropic より先に勝つ)', () => {
    const r = classify(gmoRow('Visaデビット利用　海外 ANTHROPIC* CLAUDE SUB 承認番号：500003 TID：400000000000003', 36365), MASTERS, 'gmo');
    expect(r).toMatchObject({ action: 'expense', category: 'システム費', masterId: 1 });
  });

  it('ANTHROPIC単体 → #3 Anthropic API', () => {
    const r = classify(gmoRow('Visaデビット利用　海外 ANTHROPIC 承認番号：500004 TID：400000000000004', 910), MASTERS, 'gmo');
    expect(r).toMatchObject({ action: 'expense', category: 'システム費', masterId: 3 });
  });

  it('振込手数料 → #20 その他 (masterルールが振込ignoreルールより先)', () => {
    const r = classify(gmoRow('振込手数料', 143), MASTERS, 'gmo');
    expect(r).toMatchObject({ action: 'expense', category: 'その他', masterId: 20 });
  });

  it('未知の振込 → ignore(振込=給与/その他・payroll側) ※講師報酬の誤計上防止', () => {
    const r = classify(gmoRow('振込 トウホウ テストサキ', 5770), MASTERS, 'gmo');
    expect(r).toMatchObject({ action: 'ignore', label: '経費外(振込=給与/その他・payroll側)' });
  });

  it('GMO amazon → 備品 (マスタ#19一致)', () => {
    const r = classify(gmoRow('Visaデビット利用 ＡＭＡＺＯＮ．ＣＯ．ＪＰ 承認番号：500005 TID：400000000000005', 1782), MASTERS, 'gmo');
    expect(r).toMatchObject({ action: 'expense', category: '備品', masterId: 19 });
  });

  it('GMO amazon → 備品 (マスタに#19が無くてもフォールバックルールで登録)', () => {
    const withoutAmazon = MASTERS.filter((m) => m.id !== 19);
    const r = classify(gmoRow('Visaデビット利用 ＡＭＡＺＯＮ．ＣＯ．ＪＰ 承認番号：500006 TID：400000000000006', 1782), withoutAmazon, 'gmo');
    expect(r).toMatchObject({ action: 'expense', category: '備品' });
    expect(r.masterId).toBeUndefined();
  });

  it('未知のデビット → queue (guessCategoryは使わない)', () => {
    const r = classify(gmoRow('Visaデビット利用 テストシヨツプ 承認番号：500007 TID：400000000000007', 3982), MASTERS, 'gmo');
    expect(r).toEqual({ action: 'queue' });
  });

  it('入金行 → ignore(入金) ※経費処理なし・キューに残さない', () => {
    const r = classify(gmoRow('振込  テストイライニン', 0, { deposit: 2000 }), MASTERS, 'gmo');
    expect(r).toMatchObject({ action: 'ignore', label: '経費外(入金)' });
  });

  it('メモ列も照合対象 (JCB)ﾛﾎﾞﾂﾄﾍﾟｲ + メモ「ハコモノ利用料」→ #4 HACOMONO)', () => {
    const r = classify(gmoRow('JCB)ﾛﾎﾞﾂﾄﾍﾟｲ', 18346, { memo: 'ハコモノ利用料' }), MASTERS, 'gmo');
    expect(r).toMatchObject({ action: 'expense', category: 'システム費', masterId: 4 });
  });

  it('GOOGLE系の相互排他: *CLOUD→#21・PLAY/JAPANはqueue (意図通り)', () => {
    expect(classify(gmoRow('Visaデビット利用 GOOGLE*CLOUD VRZGQ6 承認番号：500008 TID：400000000000008', 292), MASTERS, 'gmo'))
      .toMatchObject({ action: 'expense', masterId: 21 });
    expect(classify(gmoRow('Visaデビット利用 GOOGLE PLAY JAPAN 承認番号：500009 TID：400000000000009', 2900), MASTERS, 'gmo'))
      .toEqual({ action: 'queue' });
    expect(classify(gmoRow('Visaデビット利用 GOOGLE JAPAN 承認番号：500010 TID：400000000000010', 5826), MASTERS, 'gmo'))
      .toEqual({ action: 'queue' });
  });
});

// ============================================
// classify: SBI (許可リスト方式 = master一致のみ・他はDBに入れない)
// ============================================
describe('classify: SBI', () => {
  it('SBIウジエスーパー → drop (私費持ち込み禁止)', () => {
    const r = classify({ date: '2026-04-28', description: 'ｳｼﾞｴｽｰﾊﾟｰ ｵﾀﾞﾜﾗﾃﾝ', withdraw: 2616, deposit: 0 }, MASTERS, 'sbi-debit');
    expect(r).toMatchObject({ action: 'drop' });
  });

  it('SBIリベシテイ → expense #13 (半角カナのNFKC一致)', () => {
    const r = classify({ date: '2026-04-01', description: 'ﾘﾍﾞｼﾃｲ', withdraw: 3300, deposit: 0 }, MASTERS, 'sbi-debit');
    expect(r).toMatchObject({ action: 'expense', category: 'システム費', masterId: 13 });
  });

  it('SBIのAMAZON.CO.JP → drop (#19 amazonはGMOのみ到達＝SBIは許可リスト外)', () => {
    const r = classify({ date: '2026-04-28', description: 'AMAZON.CO.JP', withdraw: 2500, deposit: 0 }, MASTERS, 'sbi-debit');
    expect(r).toMatchObject({ action: 'drop' });
  });

  it('SBIのAPPLE COM BILL → drop (#2はGMO歴史行対応・私用Appleサブスクを経費化しない)', () => {
    const r = classify({ date: '2026-04-17', description: 'APPLE COM BILL', withdraw: 1500, deposit: 0 }, MASTERS, 'sbi-debit');
    expect(r).toMatchObject({ action: 'drop' });
  });

  it('SBIのANTHROPIC* CLAUDE SUB → drop (BOOMのClaude MaxはGMO側・SBI側は私用アカウント)', () => {
    const r = classify({ date: '2026-06-22', description: 'ANTHROPIC* CLAUDE SUB', withdraw: 3560, deposit: 0 }, MASTERS, 'sbi-debit');
    expect(r).toMatchObject({ action: 'drop' });
  });

  it('SBIのﾌﾘｰ → drop (BOOMのfreeeはGMO側・SBI側の同月行は別アカウント)', () => {
    const r = classify({ date: '2026-06-09', description: 'ﾌﾘｰ', withdraw: 1958, deposit: 0 }, MASTERS, 'sbi-debit');
    expect(r).toMatchObject({ action: 'drop' });
  });

  it('GMOのAPPLE COM BILL → expense #2 (GMO側は従来どおり到達)', () => {
    const r = classify(gmoRow('Visaデビット利用 APPLE COM BILL 承認番号：500011 TID：400000000000011', 21400), MASTERS, 'gmo');
    expect(r).toMatchObject({ action: 'expense', category: 'システム費', masterId: 2 });
  });

  it('SBI入出金の skip:true 行 (デビット/楽天カードサービス) → drop', () => {
    const r = classify({ date: '2026-06-30', description: 'デビット　９４０２１３', withdraw: 4434, deposit: 0, skip: true }, MASTERS, 'sbi-bank');
    expect(r).toMatchObject({ action: 'drop' });
  });

  it('SBI入出金の入金行 → drop', () => {
    const r = classify({ date: '2026-06-26', description: '振込＊テストフリコミ', withdraw: 0, deposit: 100000 }, MASTERS, 'sbi-bank');
    expect(r).toMatchObject({ action: 'drop' });
  });
});

// ============================================
// classify: 楽天カード (privateスキップ → master → queue)
// ============================================
function rakutenRow(store: string, withdraw: number) {
  return { date: '2026-04-22', description: `[楽天] ${store}`, withdraw, deposit: 0 };
}

describe('classify: 楽天カード', () => {
  it('オオエドオンセン → drop (privateスキップリスト・DB非投入)', () => {
    const r = classify(rakutenRow('ｵｵｴﾄﾞｵﾝｾﾝﾓﾉｶﾞﾀﾘ ﾏ', 36508), MASTERS, 'rakuten');
    expect(r).toMatchObject({ action: 'drop' });
  });

  it('年会費 → drop (楽天プレミアムカード年会費２７年０２月迄)', () => {
    const r = classify(rakutenRow('楽天プレミアムカード年会費２７年０２月迄', 11550), MASTERS, 'rakuten');
    expect(r).toMatchObject({ action: 'drop' });
  });

  it('ADOBE → expense #11', () => {
    const r = classify(rakutenRow('ADOBE SYSTEMS SOFTWA利用国IE', 3828), MASTERS, 'rakuten');
    expect(r).toMatchObject({ action: 'expense', category: 'システム費', masterId: 11 });
  });

  it('ｲﾝｽﾀﾍﾞｰｽ → expense #18 会場費', () => {
    const r = classify(rakutenRow('ｲﾝｽﾀﾍﾞｰｽ', 4400), MASTERS, 'rakuten');
    expect(r).toMatchObject({ action: 'expense', category: '会場費', masterId: 18 });
  });

  it('ﾔﾖｲｶﾌﾞｼｷｶﾞｲｼﾔ → expense #12 弥生', () => {
    const r = classify(rakutenRow('ﾔﾖｲｶﾌﾞｼｷｶﾞｲｼﾔ', 12980), MASTERS, 'rakuten');
    expect(r).toMatchObject({ action: 'expense', category: 'システム費', masterId: 12 });
  });

  it('セキチュー → queue (未知はTAROが判断)', () => {
    const r = classify(rakutenRow('セキチュー', 5000), MASTERS, 'rakuten');
    expect(r).toEqual({ action: 'queue' });
  });

  it('楽天のAMAZON.CO.JP → queue (#19 amazonはGMOのみ到達・自動登録しない)', () => {
    const r = classify(rakutenRow('AMAZON.CO.JP', 3980), MASTERS, 'rakuten');
    expect(r).toEqual({ action: 'queue' });
  });

  it('楽天のAPPLE COM BILL → queue (GMOのみ到達・TARO判断に回す)', () => {
    const r = classify(rakutenRow('APPLE COM BILL', 990), MASTERS, 'rakuten');
    expect(r).toEqual({ action: 'queue' });
  });
});

// ============================================
// RECURRING_SEED 整合性 (Task2のシードデータ)
// ============================================
describe('RECURRING_SEED', () => {
  it('21行・全行に category/amount/match_pattern がある', () => {
    expect(RECURRING_SEED).toHaveLength(21);
    for (const s of RECURRING_SEED) {
      expect(s.category).toBeTruthy();
      expect(s.amount).toBeGreaterThan(0);
      expect(s.match_pattern).toBeTruthy();
    }
  });

  it('#1 Claude Max が #3 anthropic より先 (id順マッチの前提)', () => {
    const i1 = RECURRING_SEED.findIndex((s) => s.match_pattern === 'anthropic* claude sub');
    const i3 = RECURRING_SEED.findIndex((s) => s.match_pattern === 'anthropic');
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i3).toBeGreaterThan(i1);
  });

  it('カテゴリは既存5種+会場費のみ (給与/スタジオ料は入れない=T-166)', () => {
    const allowed = new Set(['広告費', 'システム費', '通信費', '会場費', '備品', 'その他']);
    for (const s of RECURRING_SEED) expect(allowed.has(s.category)).toBe(true);
  });
});

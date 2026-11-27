// BF7(vol.7)のジャッジ・DJ・MC。表記・経歴は本人からLINEでもらったもの(2026-11-24 Friday / 11-27 YUKA)。
// ⚠️ announced=false の間は公開ページに出さない(スタッフのログイン中の下見だけに出す)。
//    公開してよいかはTAROが決める。出すときは announced を true にするだけ。
// 並べ方はvol.6と同じ(TARO 2026-11-27「HIROさんとFriday・YUKAで見せ方に差がある」)
//   審査員=同じ形の大きいカードを縦に並べる(HIROさんだけ SPECIAL GUEST の印)
//   DJ・MC=小さいカードを横に並べる
export const BF7_CAST_ANNOUNCED = false;

export type Bf7CastMember = {
  role: 'JUDGE' | 'BATTLE DJ' | 'FLOOR DJ' | 'MC';
  name: string;
  /** 審査員カードの上に付ける印(HIROさんの SPECIAL GUEST) */
  badge?: string;
  /** 所属チーム(本人の書いた表記のまま) */
  team?: string;
  /** ジャンル / 拠点 の1行 */
  meta?: string;
  /** public/bf7/ 以下の写真。審査員は横長(3:2)、DJ・MCは正方形。無ければ名前だけ */
  photo?: string;
  /** 切り抜き写真(背景が透明)は背景にグラデーションを敷く */
  cutout?: boolean;
  bio?: string;
  /** 「主な戦績を見る」で開く行 */
  records?: string[];
};

export const BF7_JUDGES: Bf7CastMember[] = [
  {
    role: 'JUDGE',
    badge: 'SPECIAL GUEST',
    name: 'HIRO',
    team: 'MIDDLE FILTER',
    meta: 'MIDDLE SCHOOL / 大阪',
    photo: '/bf7/guest-hiro.webp',
    cutout: true,
    // ⚠️表記は本人の指定で「HIRO」・「牽引し広めつづける」(2026-10-21)
    bio:
      '90年代より大阪を拠点に活動。MIDDLE SCHOOL(new jack swing / 90s HIPHOP)を牽引し広めつづける、唯一無二の伝道師的存在。国内・海外のイベント、SHOW、WORKSHOP、振付、コンテスト審査まで幅広く活動している。',
  },
  {
    role: 'JUDGE',
    name: 'Friday',
    team: 'flying beats / marvel zom bboyz',
    meta: 'BREAK / 山形',
    photo: '/bf7/judge-friday-wide.webp',
    bio:
      '山形を代表する老舗crew flying beatsの3代目リーダー。宮城・福島・秋田・山形のメンバーで構成されるmarvel zom bboyzに所属し、東北・全国での受賞歴も有り。現在は若手育成に力を入れながら、自分の踊りも継続して活動中。',
  },
  {
    role: 'JUDGE',
    name: 'YUKA',
    team: 'Stanza',
    meta: 'POP / 山形',
    photo: '/bf7/judge-yuka-wide.webp',
    records: [
      'WDC 東北予選 優勝(2014・2015・2016・2017・2018)',
      "FreeStyle Session JAPAN 2016 POPPIN' SOLO BATTLE 優勝",
      'SHIROFES. 2017 ALL STYLE 2ON2 DEADLY DUO 準優勝',
      'JAPAN DANCE DELIGHT VOL.26 FINALIST',
    ],
  },
];

export const BF7_CREW: Bf7CastMember[] = [
  {
    role: 'BATTLE DJ',
    name: 'DJ 太郎MAC',
    team: 'YURERU',
  },
  // フロアDJは前回に続きayumi(2026-10-27 TARO)。写真はvol.6と同じ
  {
    role: 'FLOOR DJ',
    name: 'DJ ayumi',
    meta: '宮城',
    photo: '/bf7/dj-ayumi.jpg',
  },
  // MCはTARO(2026-11-27 TARO決定)。表記はvol.6のページと同じ
  {
    role: 'MC',
    name: 'TARO',
    team: 'TARO&TAKE / BSB',
    meta: '仙台',
    photo: '/bf7/mc-taro.png',
    cutout: true,
  },
];

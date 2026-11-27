// BF7(vol.7)のジャッジ・DJ・MC。表記・経歴は本人からLINEでもらったもの(2026-11-24 Friday / 11-27 YUKA)。
// ⚠️ announced=false の間は公開ページに出さない(スタッフのログイン中の下見だけに出す)。
//    公開してよいかはTAROが決める。出すときは announced を true にするだけ。
export const BF7_CAST_ANNOUNCED = false;

export type Bf7CastMember = {
  role: 'JUDGE' | 'DJ' | 'MC';
  name: string;
  /** 所属チーム(本人の書いた表記のまま) */
  team?: string;
  /** ジャンル / 拠点 の1行 */
  meta?: string;
  /** public/bf7/ 以下の写真。無ければ名前だけのカードにする */
  photo?: string;
  bio?: string;
  /** 「主な戦績を見る」で開く行 */
  records?: string[];
};

export const BF7_CAST: Bf7CastMember[] = [
  {
    role: 'JUDGE',
    name: 'Friday',
    team: 'flying beats / marvel zom bboyz',
    meta: 'BREAK / 山形',
    photo: '/bf7/judge-friday.webp',
    bio:
      '山形を代表する老舗crew flying beatsの3代目リーダー。宮城・福島・秋田・山形のメンバーで構成されるmarvel zom bboyzに所属し、東北・全国での受賞歴も有り。現在は若手育成に力を入れながら、自分の踊りも継続して活動中。',
  },
  {
    role: 'JUDGE',
    name: 'YUKA',
    team: 'Stanza',
    meta: 'POP / 山形',
    photo: '/bf7/judge-yuka.webp',
    records: [
      'WDC 東北予選 優勝(2014・2015・2016・2017・2018)',
      "FreeStyle Session JAPAN 2016 POPPIN' SOLO BATTLE 優勝",
      'SHIROFES. 2017 ALL STYLE 2ON2 DEADLY DUO 準優勝',
      'JAPAN DANCE DELIGHT VOL.26 FINALIST',
    ],
  },
  {
    role: 'DJ',
    name: '太郎MAC',
    team: 'YURERU',
  },
  // MCはTARO(2026-11-27 TARO決定)。表記と戦績はvol.6のページと同じ
  {
    role: 'MC',
    name: 'TARO',
    team: 'TARO&TAKE / BSB',
    meta: '仙台',
    photo: '/bf7/mc-taro.png',
    records: ['JAPAN DANCE DELIGHT vol.25 FINALIST', 'WORLD DANCE COLOSSEUM / TOHOKU HIPHOP 優勝', 'LOOP DE DANCE 優勝'],
  },
];

import { describe, it, expect } from 'vitest';
import { reconcileDay, type MasterSlotLite } from '../calendarReconcile';
import type { ResolvedLesson } from '../calendarActuals';

const slot = (o: Partial<MasterSlotLite>): MasterSlotLite => ({
  master_id: 1, date: '2026-08-19', start_time: '18:30', end_time: '20:00',
  instructor_id: 3, studio_id: 12, class_name: 'TARO hiphop 入門初級', ...o,
});
const res = (o: Partial<ResolvedLesson>): ResolvedLesson => ({
  event_id: 'e1', date: '2026-08-19', start: '18:30', end: '20:00', duration_minutes: 90,
  cancelled: false, substitute: false, payable: true, room_explicit: false, instructor_id: 3, instructor_name: 'TARO',
  instructors: [{ id: 3, name: 'TARO', substitute: false }],
  studio_id: 90, studio_name: '戦災復興記念館　展示ホール', class_name: 'TARO hiphop 入門初級',
  issues: [], ...o,
});

describe('reconcileDay', () => {
  it('同一敷地(GOAT A/B): カレンダーが総称「GOAT」ならマスタの部屋を信じる', () => {
    // はじめてのHIPHOP はB(小スタジオ=2)がマスタ既定。カレンダーのlocationは
    // 「GOAT DANCE STUDIO」としか書かれずA(1)に解決されるが、同一敷地なので
    // 部屋の情報が無いだけ。マスタの部屋(B)を保つ(TARO決定 2026-08-29)。
    const p = reconcileDay(
      [slot({ master_id: 26, instructor_id: 4, studio_id: 2, start_time: '11:00', class_name: 'はじめてのHIPHOP' })],
      [res({ class_name: 'はじめてのHIPHOP', instructor_id: 4, studio_id: 1, start: '11:00', end: '12:00' })]
    );
    expect(p.keep).toHaveLength(1);
    expect(p.keep[0].studio_id).toBe(2);
  });

  it('同一敷地: カレンダーが明示的に「小スタジオ」ならカレンダーが勝つ(イレギュラー入替)', () => {
    // 逆パターン: マスタはA(1)のクラスを、その日だけBでやった。
    // KEIKO/TAROがlocationに「GOAT 小スタジオ」と書けば resolver が2に解決し、
    // 明示指定としてマスタより優先される。
    const p = reconcileDay(
      [slot({ master_id: 27, instructor_id: 5, studio_id: 1, start_time: '12:15', class_name: 'キッズHIPHOP入門' })],
      [res({ class_name: 'キッズHIPHOP入門', instructor_id: 5, studio_id: 2, start: '12:15', end: '13:15' })]
    );
    expect(p.keep).toHaveLength(1);
    expect(p.keep[0].studio_id).toBe(2);
  });

  it('同一敷地は会場不一致として劣後させない', () => {
    // GOAT総称(1)のイベントとB(2)の枠が同時刻でも、venueMismatchにしない
    // (劣後させると別会場の枠と誤マッチしうる)
    const p = reconcileDay(
      [
        slot({ master_id: 26, instructor_id: 4, studio_id: 2, start_time: '11:00' }),
        slot({ master_id: 99, instructor_id: 4, studio_id: 4, start_time: '11:30' }),
      ],
      [res({ instructor_id: 4, studio_id: 1, start: '11:00', end: '12:00' })]
    );
    expect(p.keep).toHaveLength(1);
    expect(p.keep[0].master_id).toBe(26);
  });

  it('【回帰】同じ講師の枠が2つあるとき、会場が一致する方に結ぶ (2026-08-29の実例)', () => {
    // K@TTSUの土曜: 多賀城HOUSE(マイダンス=10)とHOUSEエキスパート(GOAT=1)が同時刻。
    // カレンダーは「ハウスエキスパートクラス【K@TTSU】@GOAT」1件のみ。
    // 会場を見ずに時刻だけで結ぶと多賀城HOUSE枠が勝ち、override単価¥8,000が
    // 適用されず¥6,000で計上された(TAROの手照合で発覚)。
    const p = reconcileDay(
      [
        slot({ master_id: 40, instructor_id: 1, studio_id: 10, start_time: '11:00', class_name: '多賀城 HOUSE' }),
        slot({ master_id: 41, instructor_id: 1, studio_id: 1, start_time: '11:00', class_name: 'HOUSE エキスパート' }),
      ],
      [res({ class_name: 'ハウスエキスパートクラス', instructor_id: 1, studio_id: 1, start: '11:00', end: '12:30' })]
    );
    expect(p.keep).toHaveLength(1);
    expect(p.keep[0].master_id).toBe(41);                      // GOATの枠に結ぶ
    expect(p.removed.map((r) => r.master_id)).toEqual([40]);   // 多賀城HOUSEは未開催
  });

  it('連名(2人体制)は講師ごとに1件ずつ作る。給与は各自の単価で付く', () => {
    // 生徒が「今日は誰が担当か」を見られるよう連名で書く運用(TARO要件)。
    // 会場時間の二重計上は集計側(studioBilling)で畳むのでここでは2件出してよい。
    const p = reconcileDay(
      [slot({ master_id: 40, instructor_id: 3, start_time: '18:30', studio_id: 9 })],
      [res({
        class_name: '長町 HIPHOP クラス', studio_id: 9, start: '18:30', end: '19:30',
        instructor_id: 3, instructors: [
          { id: 3, name: 'TARO', substitute: false },
          { id: 12, name: 'KOKEKO', substitute: false },
        ],
      })]
    );
    // マスタ担当(TARO)の枠は開催として埋まり、連名の相方(KOKEKO)は単発として残る
    expect(p.keep).toHaveLength(1);
    expect(p.keep[0]).toMatchObject({ master_id: 40, instructor_id: 3, studio_id: 9 });
    expect(p.extra).toHaveLength(1);
    expect(p.extra[0]).toMatchObject({ master_id: null, instructor_id: 12, studio_id: 9 });
    expect(p.removed).toHaveLength(0);
  });

  it('【回帰】給与対象外の予定は、時間が近くても他会場の枠を曖昧にしない', () => {
    // 2026-08-23の事故: GOATのバトル練習会(14:30)がAZUMAの日曜枠と時間が近いだけで
    // 曖昧扱いになり、枠が未書き込み→master展開で埋め戻され開催していない給与が付いた
    const p = reconcileDay(
      [slot({ master_id: 30, start_time: '14:00', studio_id: 4, instructor_id: 6 })],
      [res({ class_name: 'ダンスバトル練習会', payable: false, instructor_id: null, studio_id: 1, start: '14:30' })]
    );
    expect(p.skipped).toHaveLength(0);
    expect(p.removed).toHaveLength(1);            // AZUMAの枠は「開催されなかった」
    expect(p.needsReview).toHaveLength(0);        // 練習会は要確認に積まない
    expect(p.extra).toHaveLength(1);              // 会場は使うのでスタジオ料用に残す
    expect(p.extra[0]).toMatchObject({ instructor_id: null, studio_id: 1 });
  });

  it('読めない予定でも会場が枠と違えば、枠は未開催と判定してよい', () => {
    const p = reconcileDay(
      [slot({ studio_id: 4 })],
      [res({ issues: ['講師が特定できない'], instructor_id: null, studio_id: 1 })]
    );
    expect(p.removed).toHaveLength(1);
    expect(p.skipped).toHaveLength(0);
  });

  it('開始時刻が一致する枠は、カレンダーの会場・講師で上書きする(週替わり会場の反映)', () => {
    const p = reconcileDay([slot({})], [res({})]);
    expect(p.keep).toHaveLength(1);
    // masterの既定は宮城野(12)だが、実際は戦災復興(90)で開催された
    expect(p.keep[0]).toMatchObject({ master_id: 1, studio_id: 90, instructor_id: 3, status: 'scheduled' });
    expect(p.removed).toHaveLength(0);
  });

  it('カレンダーに対応する予定が無い枠は removed にする(休講の埋め戻しを防ぐ)', () => {
    const p = reconcileDay([slot({})], []);
    expect(p.keep).toHaveLength(0);
    expect(p.removed).toEqual([expect.objectContaining({ master_id: 1, date: '2026-08-19', status: 'removed' })]);
  });

  it('休講の予定にマッチした枠も removed にする', () => {
    const p = reconcileDay([slot({})], [res({ cancelled: true })]);
    expect(p.removed).toHaveLength(1);
    expect(p.keep).toHaveLength(0);
  });

  it('要確認(issuesあり)の予定は書き込まず、枠にも触らない ※同じ会場のとき', () => {
    const p = reconcileDay(
      [slot({ studio_id: 90 })],
      [res({ issues: ['講師が特定できない'], instructor_id: null, studio_id: 90 })]
    );
    expect(p.keep).toHaveLength(0);
    expect(p.removed).toHaveLength(0); // 消しもしない = 判断を人に残す
    expect(p.needsReview).toHaveLength(1);
  });

  it('開始時刻がずれていても同じ講師なら同じ枠とみなす(±60分)', () => {
    const p = reconcileDay([slot({ start_time: '18:30' })], [res({ start: '19:00', end: '20:30' })]);
    expect(p.keep).toHaveLength(1);
    expect(p.keep[0]).toMatchObject({ start_time: '19:00', end_time: '20:30' });
  });

  it('どの枠にも対応しない予定は単発(master_id=null)として作る', () => {
    const p = reconcileDay([], [res({ class_name: 'ダンスバトル練習会', instructor_id: 3 })]);
    expect(p.extra).toHaveLength(1);
    expect(p.extra[0]).toMatchObject({ master_id: null, studio_id: 90, instructor_id: 3 });
  });

  it('1つの予定が2つの枠に二重マッチしない', () => {
    const p = reconcileDay(
      [slot({ master_id: 1, start_time: '18:30' }), slot({ master_id: 2, start_time: '18:45' })],
      [res({ start: '18:30' })]
    );
    expect(p.keep).toHaveLength(1);
    expect(p.keep[0].master_id).toBe(1);          // 時刻が近い方が勝つ
    expect(p.removed.map((r) => r.master_id)).toEqual([2]);
  });

  it('別の講師の予定は、時刻が近くても他人の枠を奪わない', () => {
    const p = reconcileDay(
      [slot({ master_id: 1, instructor_id: 3, start_time: '18:30' })],
      [res({ instructor_id: 5, start: '20:00', end: '21:30' })]
    );
    expect(p.keep).toHaveLength(0);
    expect(p.removed).toHaveLength(1);
    expect(p.extra).toHaveLength(1); // 別枠の単発として残る
  });
});

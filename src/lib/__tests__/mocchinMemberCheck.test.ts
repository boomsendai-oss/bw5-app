import { describe, it, expect } from 'vitest';
import { mocchinMemberCheck } from '../mocchinEntry';

const M = [
  { id: 1, full_name: '山田 花子', full_name_kana: 'ヤマダ ハナコ', status: 'active' },
  { id: 2, full_name: '佐藤 まこと', full_name_kana: '', status: 'active' },
  { id: 3, full_name: '鈴木 一郎', full_name_kana: 'スズキ イチロウ', status: 'withdrew' },
  { id: 4, full_name: '田中 太郎', full_name_kana: 'タナカ タロウ', status: 'active' },
  { id: 5, full_name: '田中 太郎', full_name_kana: 'タナカ タロウ', status: 'active' },
];

describe('mocchinMemberCheck', () => {
  it('名前がぴったり合えばOK(空白の有無・全角半角は問わない)', () => {
    expect(mocchinMemberCheck('山田花子', '', M)).toEqual({ ok: true, memberId: 1 });
    expect(mocchinMemberCheck('山田　花子', '', M)).toEqual({ ok: true, memberId: 1 });
  });
  it('漢字が違ってもフリガナ(ひらがなでも)が合えばOK', () => {
    expect(mocchinMemberCheck('山田 華子', 'やまだ はなこ', M)).toEqual({ ok: true, memberId: 1 });
  });
  it('「と」を含む名前でも落ちない', () => {
    expect(mocchinMemberCheck('佐藤 まこと', 'サトウ マコト', M)).toEqual({ ok: true, memberId: 2 });
  });
  it('会員にいない名前はNG', () => {
    expect(mocchinMemberCheck('木下 次郎', 'キノシタ ジロウ', M)).toEqual({ ok: false });
  });
  it('退会した人はNG', () => {
    expect(mocchinMemberCheck('鈴木 一郎', 'スズキ イチロウ', M)).toEqual({ ok: false });
  });
  it('同じ名前の在籍者が2人いるときはNG(どちらか決められない)', () => {
    expect(mocchinMemberCheck('田中 太郎', 'タナカ タロウ', M)).toEqual({ ok: false });
  });
  it('空欄はNG', () => {
    expect(mocchinMemberCheck('', '', M)).toEqual({ ok: false });
  });
});

import { mocchinInstructorCheck } from '../mocchinEntry';
describe('mocchinInstructorCheck', () => {
  it('口座名義の大きい字・半角とフリガナの小さい字が合う', () => {
    expect(mocchinInstructorCheck('', 'きゃっと たろう', [{ holder: 'ｷﾔﾂﾄ ﾀﾛｳ', realName: null }])).toBe(true);
  });
  it('本名(漢字)と名前が合う・ひらがなとカタカナも同じに扱う', () => {
    expect(mocchinInstructorCheck('試験　みゅう', '', [{ holder: null, realName: '試験 ミュウ' }])).toBe(true);
    expect(mocchinInstructorCheck('漢字違い', 'しけん みゅう', [{ holder: null, realName: '試験 みゅう', realKana: 'シケン ミュウ' }])).toBe(true);
  });
  it('合わない・空は通さない', () => {
    expect(mocchinInstructorCheck('別 人', 'べつ ひと', [{ holder: 'ｷﾔﾂﾄ ﾀﾛｳ', realName: '試験 太郎' }])).toBe(false);
    expect(mocchinInstructorCheck('', '', [{ holder: 'ｷﾔﾂﾄ ﾀﾛｳ', realName: null }, { holder: null, realName: null }])).toBe(false);
  });
});

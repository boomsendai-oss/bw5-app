import { describe, it, expect } from 'vitest';
import { normalizeName, splitNames, matchMember, type MatchableMember } from '../surveyMatch';

const M = (id: number, name: string, kana: string, rep = '', status = 'active'): MatchableMember => ({
  id,
  full_name: name,
  full_name_kana: kana,
  rep_name: rep,
  status,
});

const MEMBERS: MatchableMember[] = [
  M(1, '山田 太郎', 'ヤマダ タロウ', '山田 花子'),
  M(2, '佐藤 未来', 'サトウ ミク', '佐藤 恵'),
  M(3, '佐藤 未来', 'サトウ ミライ', '佐藤 健'),
  M(4, '鈴木 一郎', 'スズキ イチロウ', '', 'withdrawn'),
  M(5, '高橋 凛', 'タカハシ リン', '高橋 恵'),
];

describe('normalizeName', () => {
  it('全角スペース・前後空白・全半角ゆれを吸収する', () => {
    expect(normalizeName('　山田　太郎  ')).toBe('山田太郎');
    expect(normalizeName('ﾔﾏﾀﾞ ﾀﾛｳ')).toBe('ヤマダタロウ');
  });
});

describe('splitNames (きょうだい連名の検出)', () => {
  it('区切り文字で複数名に分割する', () => {
    expect(splitNames('山田太郎、山田次郎')).toEqual(['山田太郎', '山田次郎']);
    expect(splitNames('山田太郎・山田次郎')).toEqual(['山田太郎', '山田次郎']);
    expect(splitNames('山田太郎と山田次郎')).toEqual(['山田太郎', '山田次郎']);
  });
  it('単名はそのまま1件', () => {
    expect(splitNames('山田太郎')).toEqual(['山田太郎']);
  });
});

describe('matchMember', () => {
  it('full_name一意完全一致(スペースゆれ込み)はauto', () => {
    const r = matchMember('山田太郎', MEMBERS);
    expect(r).toEqual({ status: 'auto', memberId: 1 });
  });
  it('カナ一意完全一致もauto', () => {
    const r = matchMember('ヤマダ タロウ', MEMBERS);
    expect(r).toEqual({ status: 'auto', memberId: 1 });
  });
  it('同名複数(漢字同一)はpendingで候補列挙', () => {
    const r = matchMember('佐藤未来', MEMBERS);
    expect(r.status).toBe('pending');
    if (r.status !== 'pending') return;
    expect(r.candidateIds.sort()).toEqual([2, 3]);
  });
  it('保護者名(rep_name)一致は一意でもpending(本人名でない)', () => {
    const r = matchMember('山田花子', MEMBERS);
    expect(r.status).toBe('pending');
    if (r.status !== 'pending') return;
    expect(r.candidateIds).toEqual([1]);
  });
  it('保護者名が複数会員に一致したら全員候補', () => {
    const withSecond = [...MEMBERS, M(6, '高橋 迅', 'タカハシ ジン', '高橋 恵')];
    const r = matchMember('高橋恵', withSecond);
    expect(r.status).toBe('pending');
    if (r.status !== 'pending') return;
    expect(r.candidateIds.sort()).toEqual([5, 6]);
  });
  it('部分一致(2文字以上)はpending', () => {
    const r = matchMember('山田', MEMBERS);
    expect(r.status).toBe('pending');
    if (r.status !== 'pending') return;
    expect(r.candidateIds).toEqual([1]);
  });
  it('候補なしはunmatched', () => {
    expect(matchMember('田中次郎', MEMBERS)).toEqual({ status: 'unmatched' });
  });
  it('退会者はautoの対象外・activeが一意ならauto', () => {
    const withActive = [...MEMBERS, M(7, '鈴木 一郎', 'スズキ イチロウ')];
    expect(matchMember('鈴木一郎', withActive)).toEqual({ status: 'auto', memberId: 7 });
  });
  it('active+withdrawnの同名2件でactiveが一意でなければpending', () => {
    const two = [...MEMBERS, M(7, '鈴木 一郎', 'スズキ イチロウ'), M(8, '鈴木 一郎', 'スズキ イチロー')];
    const r = matchMember('鈴木一郎', two);
    expect(r.status).toBe('pending');
  });
  it('退会者しか一致しない場合はpending(自動確定しない)', () => {
    const r = matchMember('鈴木一郎', MEMBERS);
    expect(r.status).toBe('pending');
    if (r.status !== 'pending') return;
    expect(r.candidateIds).toEqual([4]);
  });
  it('きょうだい連名は先頭で照合し必ずpending', () => {
    const r = matchMember('山田太郎、山田次郎', MEMBERS);
    expect(r.status).toBe('pending');
    if (r.status !== 'pending') return;
    expect(r.candidateIds).toContain(1);
  });
  it('空文字はunmatched', () => {
    expect(matchMember('  ', MEMBERS)).toEqual({ status: 'unmatched' });
  });
});

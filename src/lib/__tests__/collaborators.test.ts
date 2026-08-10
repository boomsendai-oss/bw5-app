import { describe, expect, it } from 'vitest';
import { parseCollaborators } from '../instagram';

describe('parseCollaborators (共同投稿者の指定文字列)', () => {
  it('空/未設定は空配列', () => {
    expect(parseCollaborators(null)).toEqual([]);
    expect(parseCollaborators('')).toEqual([]);
    expect(parseCollaborators('   ')).toEqual([]);
  });

  it('@ を落とす', () => {
    expect(parseCollaborators('@occhan.88')).toEqual(['occhan.88']);
  });

  it('スペース・カンマ・全角読点のどれでも区切れる', () => {
    expect(parseCollaborators('a b')).toEqual(['a', 'b']);
    expect(parseCollaborators('a,b')).toEqual(['a', 'b']);
    expect(parseCollaborators('a、b，c')).toEqual(['a', 'b', 'c']);
  });

  it('Instagramの上限に合わせて最大3人に切る', () => {
    expect(parseCollaborators('a b c d e')).toEqual(['a', 'b', 'c']);
  });

  it('余分な空白や重ねた@があっても壊れない', () => {
    expect(parseCollaborators('  @@taro_bsb ,  @m55keiko  ')).toEqual(['taro_bsb', 'm55keiko']);
  });
});

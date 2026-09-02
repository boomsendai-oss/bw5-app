import { describe, expect, it } from 'vitest';
import { splitDraftMemo } from '../blogPreview';

describe('splitDraftMemo', () => {
  it('先頭のHTMLコメントをメモとして切り出し、本文から外す', () => {
    const md = `<!--\n自動下書き 2026-09-02\nseed queries: 仙台市青葉区 ダンス\n-->\n\n「質問」\n\n## 見出し`;
    const r = splitDraftMemo(md);
    expect(r.memo).toBe('自動下書き 2026-09-02\nseed queries: 仙台市青葉区 ダンス');
    expect(r.body.startsWith('「質問」')).toBe(true);
    expect(r.body).not.toContain('<!--');
  });

  it('コメントが無ければ memo は null で本文はそのまま', () => {
    const r = splitDraftMemo('## 見出し\n\n本文');
    expect(r.memo).toBeNull();
    expect(r.body).toBe('## 見出し\n\n本文');
  });

  it('途中のHTMLコメントも本文から除く(公開画面と同じ見え方)', () => {
    const r = splitDraftMemo('## a\n\n<!-- 途中メモ -->\n\n本文');
    expect(r.memo).toBeNull();
    expect(r.body).not.toContain('途中メモ');
    expect(r.body).toContain('本文');
  });
});

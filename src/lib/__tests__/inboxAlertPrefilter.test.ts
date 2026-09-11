import { describe, it, expect } from 'vitest';
import { decideReadMode, senderAddress, senderDomain } from '../inboxAlert/prefilter';

const meta = (labelIds: string[], headers: Record<string, string>) => ({ labelIds, headers });

describe('senderAddress / senderDomain', () => {
  it('表示名つきのFromからアドレスを取り出す', () => {
    expect(senderAddress('"山田 花子" <Hanako@Example.com>')).toBe('hanako@example.com');
    expect(senderDomain('BOOM <boom.sendai@gmail.com>')).toBe('gmail.com');
  });
  it('アドレスだけのFromもそのまま扱う', () => {
    expect(senderAddress('info@up-t.jp')).toBe('info@up-t.jp');
  });
  it('表示名の中の <...> や複数宛先の区切りに惑わされない', () => {
    expect(senderAddress('"Tanaka <Sales>" <tanaka@example.jp>')).toBe('tanaka@example.jp');
    expect(senderAddress('a@x.jp, b@y.jp')).toBe('a@x.jp');
  });
});

describe('decideReadMode', () => {
  it('宣伝・SNS分類で一斉配信の印があれば件数だけ', () => {
    expect(decideReadMode(meta(['CATEGORY_PROMOTIONS'], { from: 'a@shop.jp', 'list-unsubscribe': '<x>' }))).toBe('count_only');
    expect(decideReadMode(meta(['CATEGORY_SOCIAL', 'INBOX'], { from: 'a@sns.com', precedence: 'bulk' }))).toBe('count_only');
    expect(decideReadMode(meta(['CATEGORY_PROMOTIONS'], { from: 'order@amazon.co.jp' }))).toBe('count_only');
  });
  it('宣伝分類でも一斉配信の印が無いメールは読む(Gmailの誤分類で見逃さないため)', () => {
    expect(decideReadMode(meta(['CATEGORY_PROMOTIONS'], { from: '"山田" <yamada@gmail.com>' }))).toBe('ai_full');
    expect(decideReadMode(meta(['CATEGORY_SOCIAL'], { from: 'no-reply@event.jp' }))).toBe('ai_light');
  });
  it('Gmailの更新・フォーラム分類は件数だけにしない', () => {
    expect(decideReadMode(meta(['CATEGORY_UPDATES'], { from: 'notifications@stripe.com', 'list-unsubscribe': '<x>' }))).toBe('ai_light');
    expect(decideReadMode(meta(['CATEGORY_FORUMS'], { from: 'someone@gmail.com' }))).toBe('ai_full');
  });
  it('配信停止リンク・一斉配信・自動送信ヘッダーは軽く読む', () => {
    expect(decideReadMode(meta(['INBOX'], { from: 'a@b.jp', 'list-unsubscribe': '<mailto:x>' }))).toBe('ai_light');
    expect(decideReadMode(meta(['INBOX'], { from: 'a@b.jp', precedence: 'Bulk' }))).toBe('ai_light');
    expect(decideReadMode(meta(['INBOX'], { from: 'a@b.jp', precedence: 'junk' }))).toBe('ai_light');
    expect(decideReadMode(meta(['INBOX'], { from: 'a@b.jp', 'auto-submitted': 'auto-generated' }))).toBe('ai_light');
  });
  it('Auto-Submitted: no(注釈つき・空も)は人のメールとして扱う', () => {
    expect(decideReadMode(meta(['INBOX'], { from: 'a@gmail.com', 'auto-submitted': 'no' }))).toBe('ai_full');
    expect(decideReadMode(meta(['INBOX'], { from: 'a@gmail.com', 'auto-submitted': 'no (manual)' }))).toBe('ai_full');
    expect(decideReadMode(meta(['INBOX'], { from: 'a@gmail.com', 'auto-submitted': '' }))).toBe('ai_full');
  });
  it('noreply系の差出人・登録済みの自動送信元(サブドメイン含む)は軽く読む', () => {
    expect(decideReadMode(meta(['INBOX'], { from: 'hacomono <no-reply@em.hacomono.jp>' }))).toBe('ai_light');
    expect(decideReadMode(meta(['INBOX'], { from: 'no_reply@x.jp' }))).toBe('ai_light');
    expect(decideReadMode(meta(['INBOX'], { from: 'do.not.reply@x.jp' }))).toBe('ai_light');
    expect(decideReadMode(meta(['INBOX'], { from: 'notifications@github.com' }))).toBe('ai_light');
    expect(decideReadMode(meta(['INBOX'], { from: 'info@bank.gmo-aozora.com' }))).toBe('ai_light');
    expect(decideReadMode(meta(['INBOX'], { from: 'order@shipping.amazon.co.jp' }))).toBe('ai_light');
  });
  it('似たドメインは登録済みの自動送信元として扱わない', () => {
    expect(decideReadMode(meta(['INBOX'], { from: 'order@notamazon.co.jp' }))).toBe('ai_full');
  });
  it('info@ は人が書くことがあるので全文を読む', () => {
    expect(decideReadMode(meta(['INBOX'], { from: 'UP-T <info@up-t.jp>' }))).toBe('ai_full');
  });
  it('表示名に notify が入っていてもアドレスが個人なら全文を読む', () => {
    expect(decideReadMode(meta(['INBOX'], { from: '"notify me" <someone@gmail.com>' }))).toBe('ai_full');
  });
});

-- クリパ2026 出演エントリーの項目追加(2026-10-15 TARO指示)。列追加のみ・既存データは変えない。
-- チーム名のふりがな / メンバーごとの学年 / 音源未提出リマインドの送信記録
ALTER TABLE party_orders ADD COLUMN team_kana TEXT NOT NULL DEFAULT '';
ALTER TABLE party_orders ADD COLUMN audio_reminded_at TEXT NOT NULL DEFAULT '';
ALTER TABLE party_entry_members ADD COLUMN grade TEXT NOT NULL DEFAULT '';

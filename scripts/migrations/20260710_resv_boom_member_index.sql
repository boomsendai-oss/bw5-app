-- パフォーマンス: 受講履歴の会員別チェックイン検索用の索引 (T-178運用で体感遅の対策)
-- 退会候補/KPIダッシュボード等が boom_member_id + status で相関サブクエリを回すが、
-- 既存索引は hacomono_member_id 側のみだった。
CREATE INDEX IF NOT EXISTS idx_resv_boom_member_status_date
  ON hacomono_reservations(boom_member_id, status, lesson_date);

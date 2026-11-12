INSERT OR IGNORE INTO recital_events (event_key, title, show_date, rehearsal_date, venue, is_test, created_at) VALUES ('bw6-test', '試し', '2027-04-11', '2027-04-10', '若林区文化センター', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO recital_settings (event_key, key, value, created_at) VALUES ('bw6-test', 'suspended', '0', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO recital_settings (event_key, key, value, created_at) VALUES ('bw6-test', 'stripe_mode', 'test', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO recital_settings (event_key, key, value, created_at) VALUES ('bw6-test', 'pay_ok_at', '2026-11-13 00:00', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO recital_settings (event_key, key, value, created_at) VALUES ('bw6-test', 'entry_open_at', '2026-11-13 00:00', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO recital_settings (event_key, key, value, created_at) VALUES ('bw6-test', 'pay_open_at', '2026-11-13 00:00', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO recital_settings (event_key, key, value, created_at) VALUES ('bw6-test', 'mail_bcc_staff', '0', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO recital_fee_rules (event_key, payer_role, item_code, nth_from, nth_to, unit_amount, qty, label, is_tentative, sort_order, created_at)
SELECT 'bw6-test', r.payer_role, r.item_code, r.nth_from, r.nth_to, r.unit_amount, r.qty, r.label, 0, r.sort_order, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (
  SELECT 'first' AS payer_role, 'base' AS item_code, 1 AS nth_from, 1 AS nth_to, 16000 AS unit_amount, 1 AS qty, '出演料（本体）' AS label, 1 AS sort_order
  UNION ALL SELECT 'first', 'tshirt', 1, 1, 3000, 1, 'Tシャツ', 2
  UNION ALL SELECT 'first', 'coop_ticket', 1, 1, 2500, 3, '協力チケット3枚', 3
  UNION ALL SELECT 'first', 'add_work', 2, 2, 6000, 1, '2作品目', 4
  UNION ALL SELECT 'first', 'add_work', 3, NULL, 3000, 1, '3作品目から（1作品ごと）', 5
  UNION ALL SELECT 'family', 'base', 1, 1, 5000, 1, 'ご家族の参加費', 6
  UNION ALL SELECT 'family', 'tshirt', 1, 1, 3000, 1, 'Tシャツ', 7
  UNION ALL SELECT 'family', 'add_work', 2, NULL, 3000, 1, '2作品目から（1作品ごと）', 8
) AS r
WHERE NOT EXISTS (SELECT 1 FROM recital_fee_rules WHERE event_key = 'bw6-test');
INSERT OR IGNORE INTO recital_works (event_key, work_code, kind, title, entry_mode, fee_type, extra_fee, status, sort_order, created_at) VALUES ('bw6-test', 'W01', 'class', '試しの作品A', 'form', 'counted', NULL, 'open', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO recital_works (event_key, work_code, kind, title, entry_mode, fee_type, extra_fee, status, sort_order, created_at) VALUES ('bw6-test', 'W02', 'class', '試しの作品B', 'form', 'counted', NULL, 'open', 2, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO recital_works (event_key, work_code, kind, title, entry_mode, fee_type, extra_fee, status, sort_order, created_at) VALUES ('bw6-test', 'W03', 'class', '試しの作品C', 'form', 'counted', NULL, 'open', 3, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO recital_works (event_key, work_code, kind, title, entry_mode, fee_type, extra_fee, status, sort_order, created_at) VALUES ('bw6-test', 'W04', 'class', '試しの作品D', 'form', 'counted', NULL, 'draft', 4, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO recital_works (event_key, work_code, kind, title, entry_mode, fee_type, extra_fee, status, sort_order, created_at) VALUES ('bw6-test', 'W05', 'class', '試しの作品E', 'form', 'extra', 3000, 'open', 5, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

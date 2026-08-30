ALTER TABLE tshirt_orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash';

ALTER TABLE tshirt_orders ADD COLUMN stripe_session_id TEXT NOT NULL DEFAULT '';

ALTER TABLE tshirt_orders ADD COLUMN stripe_payment_intent TEXT NOT NULL DEFAULT '';

ALTER TABLE tshirt_orders ADD COLUMN amount_mismatch INTEGER NOT NULL DEFAULT 0

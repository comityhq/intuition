CREATE TABLE coupons (
  code TEXT PRIMARY KEY,
  amount_off_cents INTEGER NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_order TEXT
);
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0
);

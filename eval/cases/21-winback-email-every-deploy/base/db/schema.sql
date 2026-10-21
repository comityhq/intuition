CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  first_name TEXT,
  unsubscribed_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ
);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE,
  tg_id INTEGER UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  display_name TEXT NOT NULL,
  xui_email TEXT NOT NULL UNIQUE,
  sub_token TEXT NOT NULL UNIQUE,
  total_gb INTEGER NOT NULL DEFAULT 0,
  expiry_days INTEGER NOT NULL DEFAULT 0,
  expiry_at TEXT,
  device_limit INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active',
  payment_status TEXT DEFAULT 'unknown',
  paid_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subs_token ON subscriptions(sub_token);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL,
  user_id INTEGER,
  name TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS panels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  panel_url TEXT NOT NULL,
  api_token TEXT,
  panel_user TEXT,
  panel_pass TEXT,
  inbound_id INTEGER NOT NULL DEFAULT 1,
  server_host TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_push (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT,
  auth_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

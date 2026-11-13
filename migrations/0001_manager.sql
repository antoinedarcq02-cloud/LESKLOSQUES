-- Klosques Manager : exécuter dans Cloudflare D1 avant activation.
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'manuel',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL,
  location TEXT NOT NULL,
  package TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'nouveau' CHECK (status IN ('nouveau','en_discussion','devis_envoye','option','confirme','termine','refuse')),
  notes TEXT NOT NULL DEFAULT '',
  quote_amount_cents INTEGER,
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings(event_date);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings(status);
CREATE TABLE IF NOT EXISTS admin_auth_challenges (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_login_limits (
  key_hash TEXT PRIMARY KEY,
  counter INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL
);

-- Textes et identifiants des vidéos modifiables depuis l'espace privé.
CREATE TABLE IF NOT EXISTS site_content (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT ''
);

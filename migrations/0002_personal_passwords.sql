-- Migration complémentaire pour les comptes personnels à mot de passe.
-- À exécuter une seule fois dans la base D1 "klosquesmanager".
-- Ne supprime aucune des quatre tables déjà créées.
CREATE TABLE IF NOT EXISTS admin_users (
  username TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  session_version INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Une sécurité supplémentaire : quatre comptes maximum pour le groupe.
CREATE TRIGGER IF NOT EXISTS admin_users_limit_4
BEFORE INSERT ON admin_users
WHEN (SELECT COUNT(*) FROM admin_users) >= 4
BEGIN
  SELECT RAISE(ABORT, 'maximum de quatre comptes');
END;

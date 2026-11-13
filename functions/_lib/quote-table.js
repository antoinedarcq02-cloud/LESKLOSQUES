// Table D1 commune aux dossiers clients et aux devis.
export async function ensureQuotesTable(DB) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS official_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id TEXT,
    data_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'brouillon'
      CHECK(status IN ('brouillon','finalise')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT NOT NULL
  )`).run();
}

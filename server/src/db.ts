import Database from 'better-sqlite3'

const DB_PATH = process.env.DB_PATH || './data/jukesats.db'

export function createDb(dbPath: string = DB_PATH): Database.Database {
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS taps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_ark_address TEXT NOT NULL,
      venue_id TEXT NOT NULL,
      nfc_tag_id TEXT NOT NULL,
      reward_sats INTEGER NOT NULL,
      ip TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      txid TEXT,
      idempotency_key TEXT UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_taps_user ON taps(user_ark_address);
    CREATE INDEX IF NOT EXISTS idx_taps_venue ON taps(venue_id);
    CREATE INDEX IF NOT EXISTS idx_taps_ip ON taps(ip);
    CREATE INDEX IF NOT EXISTS idx_taps_created ON taps(created_at);
    CREATE INDEX IF NOT EXISTS idx_taps_user_venue_created ON taps(user_ark_address, venue_id, created_at);
  `)

  return db
}

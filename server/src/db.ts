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
      ip TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'completed',
      txid TEXT,
      idempotency_key TEXT UNIQUE,
      created_at INTEGER NOT NULL
    );
  `)

  // Migrate old schema: add columns that may be missing
  const columns = db.pragma('table_info(taps)') as { name: string }[]
  const columnNames = new Set(columns.map(c => c.name))

  if (!columnNames.has('ip')) {
    db.exec(`ALTER TABLE taps ADD COLUMN ip TEXT NOT NULL DEFAULT ''`)
  }
  if (!columnNames.has('status')) {
    db.exec(`ALTER TABLE taps ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'`)
  }
  if (!columnNames.has('txid')) {
    db.exec(`ALTER TABLE taps ADD COLUMN txid TEXT`)
  }
  if (!columnNames.has('idempotency_key')) {
    db.exec(`ALTER TABLE taps ADD COLUMN idempotency_key TEXT`)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_taps_idempotency_key ON taps(idempotency_key)`)
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_taps_user ON taps(user_ark_address);
    CREATE INDEX IF NOT EXISTS idx_taps_venue ON taps(venue_id);
    CREATE INDEX IF NOT EXISTS idx_taps_ip ON taps(ip);
    CREATE INDEX IF NOT EXISTS idx_taps_created ON taps(created_at);
    CREATE INDEX IF NOT EXISTS idx_taps_user_venue_created ON taps(user_ark_address, venue_id, created_at);
  `)

  return db
}

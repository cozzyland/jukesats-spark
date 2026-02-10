import Database from 'better-sqlite3'

const DB_PATH = process.env.DB_PATH || './data/jukesats.db'

export function createDb(dbPath: string = DB_PATH): Database.Database {
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Check if existing taps table has incompatible schema (from pre-SQLite era)
  const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='taps'`).get()
  if (tableExists) {
    const columns = db.pragma('table_info(taps)') as { name: string }[]
    const columnNames = new Set(columns.map(c => c.name))
    if (!columnNames.has('user_ark_address')) {
      // Old table with incompatible schema — rename to backup instead of dropping
      const rowCount = (db.prepare(`SELECT COUNT(*) as count FROM taps`).get() as { count: number }).count
      const backupName = `taps_backup_${Date.now()}`
      console.warn(`[DB] Incompatible taps table (${rowCount} rows) — renaming to ${backupName}`)
      db.exec(`ALTER TABLE taps RENAME TO ${backupName}`)
    }
  }

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

    CREATE INDEX IF NOT EXISTS idx_taps_user ON taps(user_ark_address);
    CREATE INDEX IF NOT EXISTS idx_taps_venue ON taps(venue_id);
    CREATE INDEX IF NOT EXISTS idx_taps_ip ON taps(ip);
    CREATE INDEX IF NOT EXISTS idx_taps_created ON taps(created_at);
    CREATE INDEX IF NOT EXISTS idx_taps_user_venue_created ON taps(user_ark_address, venue_id, created_at);

    CREATE TABLE IF NOT EXISTS nfc_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id TEXT NOT NULL,
      venue_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_nfc_tags_tag_venue ON nfc_tags(tag_id, venue_id);
    CREATE INDEX IF NOT EXISTS idx_nfc_tags_venue ON nfc_tags(venue_id);
  `)

  return db
}

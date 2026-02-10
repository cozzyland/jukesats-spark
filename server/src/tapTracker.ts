import type Database from 'better-sqlite3'

interface UserStats {
  totalTaps: number
  totalRewardsSats: number
  lastTap: number | null
  venues: string[]
}

interface NfcTag {
  id: number
  tag_id: string
  venue_id: string
  active: number
  created_at: number
}

/**
 * Tracks taps for rate limiting and analytics using SQLite
 */
export class TapTracker {
  private stmtInsert
  private stmtBeginTap
  private stmtCompleteTap
  private stmtFailTap
  private stmtFindByIdempotencyKey
  private stmtLastTapAtVenue
  private stmtIpTapsLastHour
  private stmtTodaySpend
  private stmtUserStats
  private stmtUserVenues
  private stmtVenueStats
  private stmtVenueUniqueUsers
  private stmtInsertTag
  private stmtFindActiveTag
  private stmtListTagsByVenue
  private stmtDeactivateTag
  private stmtTagCount
  private stmtCleanStalePending

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO taps (user_ark_address, venue_id, nfc_tag_id, reward_sats, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    this.stmtBeginTap = db.prepare(`
      INSERT INTO taps (user_ark_address, venue_id, nfc_tag_id, reward_sats, ip, status, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `)

    this.stmtCompleteTap = db.prepare(`
      UPDATE taps SET status = 'completed', txid = ? WHERE id = ?
    `)

    this.stmtFailTap = db.prepare(`
      UPDATE taps SET status = 'failed' WHERE id = ?
    `)

    this.stmtFindByIdempotencyKey = db.prepare(`
      SELECT id, txid, reward_sats, status FROM taps WHERE idempotency_key = ?
    `)

    this.stmtLastTapAtVenue = db.prepare(`
      SELECT created_at FROM taps
      WHERE user_ark_address = ? AND venue_id = ? AND status != 'failed'
      ORDER BY created_at DESC LIMIT 1
    `)

    this.stmtIpTapsLastHour = db.prepare(`
      SELECT COUNT(*) as count, MIN(created_at) as oldest
      FROM taps WHERE ip = ? AND created_at > ? AND status != 'failed'
    `)

    this.stmtTodaySpend = db.prepare(`
      SELECT COALESCE(SUM(reward_sats), 0) as total
      FROM taps WHERE created_at >= ? AND status != 'failed'
    `)

    this.stmtUserStats = db.prepare(`
      SELECT COUNT(*) as totalTaps,
             COALESCE(SUM(reward_sats), 0) as totalRewardsSats,
             MAX(created_at) as lastTap
      FROM taps WHERE user_ark_address = ?
    `)

    this.stmtUserVenues = db.prepare(`
      SELECT DISTINCT venue_id FROM taps WHERE user_ark_address = ?
    `)

    this.stmtVenueStats = db.prepare(`
      SELECT COUNT(*) as totalTaps,
             COALESCE(SUM(reward_sats), 0) as totalRewardsSats
      FROM taps WHERE venue_id = ?
    `)

    this.stmtVenueUniqueUsers = db.prepare(`
      SELECT COUNT(DISTINCT user_ark_address) as uniqueUsers
      FROM taps WHERE venue_id = ?
    `)

    this.stmtInsertTag = db.prepare(`
      INSERT INTO nfc_tags (tag_id, venue_id, active, created_at)
      VALUES (?, ?, 1, ?)
    `)

    this.stmtFindActiveTag = db.prepare(`
      SELECT id FROM nfc_tags WHERE tag_id = ? AND venue_id = ? AND active = 1
    `)

    this.stmtListTagsByVenue = db.prepare(`
      SELECT id, tag_id, venue_id, active, created_at FROM nfc_tags WHERE venue_id = ?
    `)

    this.stmtDeactivateTag = db.prepare(`
      UPDATE nfc_tags SET active = 0 WHERE tag_id = ? AND venue_id = ?
    `)

    this.stmtTagCount = db.prepare(`
      SELECT COUNT(*) as count FROM nfc_tags WHERE venue_id = ?
    `)

    this.stmtCleanStalePending = db.prepare(`
      UPDATE taps SET status = 'failed' WHERE status = 'pending' AND created_at < ?
    `)
  }

  /**
   * Check if a user can tap at a venue (per-address rate limiting)
   */
  canTap(userArkAddress: string, venueId: string, cooldownMs: number): { allowed: boolean; retryAfterMs?: number } {
    const row = this.stmtLastTapAtVenue.get(userArkAddress, venueId) as { created_at: number } | undefined
    if (!row) return { allowed: true }

    const timeSinceTap = Date.now() - row.created_at
    if (timeSinceTap < cooldownMs) {
      return {
        allowed: false,
        retryAfterMs: cooldownMs - timeSinceTap
      }
    }

    return { allowed: true }
  }

  /**
   * Check if an IP has exceeded the hourly tap limit (Sybil defense)
   */
  canTapFromIp(ip: string, maxPerHour: number): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now()
    const hourAgo = now - 60 * 60 * 1000
    const row = this.stmtIpTapsLastHour.get(ip, hourAgo) as { count: number; oldest: number | null }

    if (row.count >= maxPerHour) {
      return {
        allowed: false,
        retryAfterMs: (row.oldest! + 60 * 60 * 1000) - now
      }
    }

    return { allowed: true }
  }

  /**
   * Record a successful tap (legacy — use beginTap/completeTap for new code)
   */
  recordTap(userArkAddress: string, venueId: string, nfcTagId: string, rewardSats: number, ip: string): void {
    this.stmtInsert.run(userArkAddress, venueId, nfcTagId, rewardSats, ip, Date.now())
  }

  /**
   * Begin a tap (INSERT with status='pending'), return tap id
   */
  beginTap(userArkAddress: string, venueId: string, nfcTagId: string, rewardSats: number, ip: string, idempotencyKey?: string): number {
    const result = this.stmtBeginTap.run(userArkAddress, venueId, nfcTagId, rewardSats, ip, idempotencyKey || null, Date.now())
    return Number(result.lastInsertRowid)
  }

  /**
   * Mark a pending tap as completed with txid
   */
  completeTap(tapId: number, txid: string): void {
    this.stmtCompleteTap.run(txid, tapId)
  }

  /**
   * Mark a pending tap as failed
   */
  failTap(tapId: number): void {
    this.stmtFailTap.run(tapId)
  }

  /**
   * Find a tap by idempotency key (for deduplication)
   */
  findByIdempotencyKey(key: string): { id: number; txid: string | null; reward_sats: number; status: string } | undefined {
    return this.stmtFindByIdempotencyKey.get(key) as { id: number; txid: string | null; reward_sats: number; status: string } | undefined
  }

  /**
   * Get total sats spent today (for daily spend cap)
   */
  getTodaySpend(): number {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const row = this.stmtTodaySpend.get(startOfDay.getTime()) as { total: number }
    return row.total
  }

  /**
   * Get stats for a user
   */
  getUserStats(userArkAddress: string, _rewardSats: number): UserStats {
    const stats = this.stmtUserStats.get(userArkAddress) as {
      totalTaps: number; totalRewardsSats: number; lastTap: number | null
    }
    const venueRows = this.stmtUserVenues.all(userArkAddress) as { venue_id: string }[]

    return {
      totalTaps: stats.totalTaps,
      totalRewardsSats: stats.totalRewardsSats,
      lastTap: stats.lastTap,
      venues: venueRows.map(r => r.venue_id)
    }
  }

  /**
   * Get venue stats (for venue dashboard)
   */
  getVenueStats(venueId: string) {
    const stats = this.stmtVenueStats.get(venueId) as { totalTaps: number; totalRewardsSats: number }
    const users = this.stmtVenueUniqueUsers.get(venueId) as { uniqueUsers: number }

    return {
      totalTaps: stats.totalTaps,
      uniqueUsers: users.uniqueUsers,
      totalRewardsSats: stats.totalRewardsSats
    }
  }

  /**
   * Check if an NFC tag is registered and active for a venue.
   * Returns true if no tags are registered (open mode) or if the tag is valid.
   */
  isValidTag(tagId: string, venueId: string): boolean {
    const tagCount = this.stmtTagCount.get(venueId) as { count: number }
    if (tagCount.count === 0) return true // No tags registered for this venue = open mode
    return !!this.stmtFindActiveTag.get(tagId, venueId)
  }

  /**
   * Register an NFC tag for a venue
   */
  registerTag(tagId: string, venueId: string): NfcTag {
    this.stmtInsertTag.run(tagId, venueId, Date.now())
    const tag = this.stmtFindActiveTag.get(tagId, venueId) as { id: number }
    return { id: tag.id, tag_id: tagId, venue_id: venueId, active: 1, created_at: Date.now() }
  }

  /**
   * List all tags for a venue
   */
  listTagsByVenue(venueId: string): NfcTag[] {
    return this.stmtListTagsByVenue.all(venueId) as NfcTag[]
  }

  /**
   * Deactivate an NFC tag
   */
  deactivateTag(tagId: string, venueId: string): boolean {
    const result = this.stmtDeactivateTag.run(tagId, venueId)
    return result.changes > 0
  }

  /**
   * Mark stale pending taps as failed (reconciliation on startup).
   * Taps pending for more than the threshold are considered abandoned.
   */
  cleanStalePendingTaps(maxAgeMs: number = 5 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs
    const result = this.stmtCleanStalePending.run(cutoff)
    if (result.changes > 0) {
      console.warn(`[TapTracker] Cleaned ${result.changes} stale pending taps`)
    }
    return result.changes
  }
}

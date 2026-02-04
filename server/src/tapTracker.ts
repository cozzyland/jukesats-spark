import type Database from 'better-sqlite3'

interface UserStats {
  totalTaps: number
  totalRewardsSats: number
  lastTap: number | null
  venues: string[]
}

/**
 * Tracks taps for rate limiting and analytics using SQLite
 */
export class TapTracker {
  private stmtInsert
  private stmtLastTapAtVenue
  private stmtIpTapsLastHour
  private stmtTodaySpend
  private stmtUserStats
  private stmtUserVenues
  private stmtVenueStats
  private stmtVenueUniqueUsers

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO taps (user_ark_address, venue_id, nfc_tag_id, reward_sats, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    this.stmtLastTapAtVenue = db.prepare(`
      SELECT created_at FROM taps
      WHERE user_ark_address = ? AND venue_id = ?
      ORDER BY created_at DESC LIMIT 1
    `)

    this.stmtIpTapsLastHour = db.prepare(`
      SELECT COUNT(*) as count, MIN(created_at) as oldest
      FROM taps WHERE ip = ? AND created_at > ?
    `)

    this.stmtTodaySpend = db.prepare(`
      SELECT COALESCE(SUM(reward_sats), 0) as total
      FROM taps WHERE created_at >= ?
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
   * Record a successful tap
   */
  recordTap(userArkAddress: string, venueId: string, nfcTagId: string, rewardSats: number, ip: string): void {
    this.stmtInsert.run(userArkAddress, venueId, nfcTagId, rewardSats, ip, Date.now())
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
}

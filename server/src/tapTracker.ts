interface TapRecord {
  userArkAddress: string
  venueId: string
  nfcTagId: string
  timestamp: number
  rewardSats: number
}

interface UserStats {
  totalTaps: number
  totalRewardsSats: number
  lastTap: number | null
  venues: string[]
}

/**
 * Tracks taps for rate limiting and analytics
 * In production, use Redis or a proper database
 */
export class TapTracker {
  private taps: TapRecord[] = []
  private userLastTap: Map<string, Map<string, number>> = new Map() // user -> venue -> timestamp
  private ipTaps: Map<string, number[]> = new Map() // ip -> timestamps

  /**
   * Check if a user can tap at a venue (per-address rate limiting)
   */
  canTap(userArkAddress: string, venueId: string, cooldownMs: number): { allowed: boolean; retryAfterMs?: number } {
    const userTaps = this.userLastTap.get(userArkAddress)
    if (!userTaps) return { allowed: true }

    const lastTapAt = userTaps.get(venueId)
    if (!lastTapAt) return { allowed: true }

    const timeSinceTap = Date.now() - lastTapAt
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
    const timestamps = this.ipTaps.get(ip) || []

    // Filter to last hour
    const recentTaps = timestamps.filter(t => t > hourAgo)
    this.ipTaps.set(ip, recentTaps)

    if (recentTaps.length >= maxPerHour) {
      const oldest = recentTaps[0]
      return {
        allowed: false,
        retryAfterMs: oldest + 60 * 60 * 1000 - now
      }
    }

    return { allowed: true }
  }

  /**
   * Record a successful tap
   */
  recordTap(userArkAddress: string, venueId: string, nfcTagId: string, rewardSats: number, ip: string): void {
    const now = Date.now()

    // Store in history
    this.taps.push({
      userArkAddress,
      venueId,
      nfcTagId,
      timestamp: now,
      rewardSats
    })

    // Update last tap time for rate limiting
    if (!this.userLastTap.has(userArkAddress)) {
      this.userLastTap.set(userArkAddress, new Map())
    }
    this.userLastTap.get(userArkAddress)!.set(venueId, now)

    // Record IP tap
    const ipTimestamps = this.ipTaps.get(ip) || []
    ipTimestamps.push(now)
    this.ipTaps.set(ip, ipTimestamps)

    // Cleanup old records (keep last 24 hours)
    const cutoff = now - 24 * 60 * 60 * 1000
    this.taps = this.taps.filter(t => t.timestamp > cutoff)
  }

  /**
   * Get total sats spent today (for daily spend cap)
   */
  getTodaySpend(): number {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const cutoff = startOfDay.getTime()

    return this.taps
      .filter(t => t.timestamp >= cutoff)
      .reduce((sum, t) => sum + t.rewardSats, 0)
  }

  /**
   * Get stats for a user
   */
  getUserStats(userArkAddress: string, rewardSats: number): UserStats {
    const userTaps = this.taps.filter(t => t.userArkAddress === userArkAddress)
    const venues = [...new Set(userTaps.map(t => t.venueId))]
    const lastTap = userTaps.length > 0
      ? Math.max(...userTaps.map(t => t.timestamp))
      : null

    return {
      totalTaps: userTaps.length,
      totalRewardsSats: userTaps.reduce((sum, t) => sum + t.rewardSats, 0),
      lastTap,
      venues
    }
  }

  /**
   * Get venue stats (for venue dashboard)
   */
  getVenueStats(venueId: string) {
    const venueTaps = this.taps.filter(t => t.venueId === venueId)
    const uniqueUsers = new Set(venueTaps.map(t => t.userArkAddress))

    return {
      totalTaps: venueTaps.length,
      uniqueUsers: uniqueUsers.size,
      totalRewardsSats: venueTaps.reduce((sum, t) => sum + t.rewardSats, 0)
    }
  }
}

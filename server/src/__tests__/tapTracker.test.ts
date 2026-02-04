import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TapTracker } from '../tapTracker.js'
import { createDb } from '../db.js'
import type Database from 'better-sqlite3'

describe('TapTracker', () => {
  let tracker: TapTracker
  let db: Database.Database

  beforeEach(() => {
    vi.useFakeTimers()
    db = createDb(':memory:')
    tracker = new TapTracker(db)
  })

  afterEach(() => {
    vi.useRealTimers()
    db.close()
  })

  describe('canTap', () => {
    it('allows first tap', () => {
      const result = tracker.canTap('tark1user1', 'venue-1', 60000)
      expect(result.allowed).toBe(true)
    })

    it('blocks tap within cooldown at same venue', () => {
      tracker.recordTap('tark1user1', 'venue-1', 'tag-1', 330, '127.0.0.1')
      const result = tracker.canTap('tark1user1', 'venue-1', 60000)
      expect(result.allowed).toBe(false)
      expect(result.retryAfterMs).toBeGreaterThan(0)
      expect(result.retryAfterMs).toBeLessThanOrEqual(60000)
    })

    it('allows tap at different venue', () => {
      tracker.recordTap('tark1user1', 'venue-1', 'tag-1', 330, '127.0.0.1')
      const result = tracker.canTap('tark1user1', 'venue-2', 60000)
      expect(result.allowed).toBe(true)
    })

    it('allows tap after cooldown expires', () => {
      tracker.recordTap('tark1user1', 'venue-1', 'tag-1', 330, '127.0.0.1')
      vi.advanceTimersByTime(60001)
      const result = tracker.canTap('tark1user1', 'venue-1', 60000)
      expect(result.allowed).toBe(true)
    })
  })

  describe('canTapFromIp', () => {
    it('allows first tap from IP', () => {
      const result = tracker.canTapFromIp('192.168.1.1', 10)
      expect(result.allowed).toBe(true)
    })

    it('blocks after max taps per hour', () => {
      for (let i = 0; i < 10; i++) {
        tracker.recordTap(`tark1user${i}`, 'venue-1', 'tag-1', 330, '192.168.1.1')
      }
      const result = tracker.canTapFromIp('192.168.1.1', 10)
      expect(result.allowed).toBe(false)
      expect(result.retryAfterMs).toBeGreaterThan(0)
    })

    it('allows again after hour passes', () => {
      for (let i = 0; i < 10; i++) {
        tracker.recordTap(`tark1user${i}`, 'venue-1', 'tag-1', 330, '192.168.1.1')
      }
      vi.advanceTimersByTime(60 * 60 * 1000 + 1)
      const result = tracker.canTapFromIp('192.168.1.1', 10)
      expect(result.allowed).toBe(true)
    })
  })

  describe('getTodaySpend', () => {
    it('returns 0 with no taps', () => {
      expect(tracker.getTodaySpend()).toBe(0)
    })

    it('returns correct sum after taps', () => {
      tracker.recordTap('tark1user1', 'venue-1', 'tag-1', 330, '127.0.0.1')
      tracker.recordTap('tark1user2', 'venue-1', 'tag-1', 330, '127.0.0.2')
      expect(tracker.getTodaySpend()).toBe(660)
    })
  })

  describe('getUserStats', () => {
    it('returns empty stats for unknown user', () => {
      const stats = tracker.getUserStats('tark1unknown', 330)
      expect(stats.totalTaps).toBe(0)
      expect(stats.totalRewardsSats).toBe(0)
      expect(stats.lastTap).toBeNull()
      expect(stats.venues).toEqual([])
    })

    it('returns correct aggregation after taps', () => {
      tracker.recordTap('tark1user1', 'venue-1', 'tag-1', 330, '127.0.0.1')
      vi.advanceTimersByTime(61000)
      tracker.recordTap('tark1user1', 'venue-2', 'tag-2', 330, '127.0.0.1')

      const stats = tracker.getUserStats('tark1user1', 330)
      expect(stats.totalTaps).toBe(2)
      expect(stats.totalRewardsSats).toBe(660)
      expect(stats.lastTap).toBeGreaterThan(0)
      expect(stats.venues).toContain('venue-1')
      expect(stats.venues).toContain('venue-2')
    })
  })
})

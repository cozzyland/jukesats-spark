import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'

// Mock db to use in-memory SQLite
vi.mock('../db.js', async () => {
  const { createDb } = await vi.importActual<typeof import('../db.js')>('../db.js')
  return { createDb: () => createDb(':memory:') }
})

// Mock hotWallet before importing main
vi.mock('../hotWallet.js', () => ({
  hotWallet: {
    init: vi.fn().mockResolvedValue(undefined),
    getBalanceStatus: vi.fn().mockResolvedValue({
      available: '50000',
      settled: '50000',
      preconfirmed: '0',
      total: '50000',
      recoverable: '0',
      status: 'ok',
      warning: null
    }),
    getAddress: vi.fn().mockResolvedValue('tark1mockaddress123'),
    sendReward: vi.fn().mockResolvedValue('mocktxid123'),
    getVtxos: vi.fn().mockResolvedValue([]),
    getBoardingUtxos: vi.fn().mockResolvedValue([]),
    recoverSweptVtxos: vi.fn().mockResolvedValue(null),
    renewIfNeeded: vi.fn().mockResolvedValue(null)
  }
}))

// Set env vars before importing main
process.env.ADMIN_TOKEN = 'test-admin-token'
process.env.ALLOWED_VENUES = 'venue-1,venue-2'
process.env.ENABLE_SIMULATE_TAP = 'false'

// Import after mocks and env are set
const { app } = await import('../main.js')
const { hotWallet } = await import('../hotWallet.js') as { hotWallet: Record<string, ReturnType<typeof vi.fn>> }

describe('Server endpoints', () => {
  describe('GET /health', () => {
    it('returns 200 with only status ok', async () => {
      const res = await request(app).get('/health')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ status: 'ok' })
      // Must NOT leak balance info
      expect(res.body.balance).toBeUndefined()
      expect(res.body.warning).toBeUndefined()
    })
  })

  describe('POST /tap', () => {
    it('rejects missing fields', async () => {
      const res = await request(app)
        .post('/tap')
        .send({ userArkAddress: 'tark1abc' })
      expect(res.status).toBe(400)
      expect(res.body.error).toBeDefined()
    })

    it('rejects invalid address format', async () => {
      const res = await request(app)
        .post('/tap')
        .send({ userArkAddress: 'invalid123', venueId: 'venue-1', nfcTagId: 'tag-1' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Invalid ARK address')
    })

    it('rejects unknown venue', async () => {
      const res = await request(app)
        .post('/tap')
        .send({ userArkAddress: 'tark1user1', venueId: 'unknown-venue', nfcTagId: 'tag-1' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Unknown venue')
    })

    it('processes valid tap', async () => {
      const res = await request(app)
        .post('/tap')
        .send({ userArkAddress: 'tark1newtestuser', venueId: 'venue-1', nfcTagId: 'tag-1' })
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.txid).toBe('mocktxid123')
      expect(res.body.amount).toBe(330)
    })
  })

  describe('Admin endpoints', () => {
    it('rejects unauthenticated request to /admin/address', async () => {
      const res = await request(app).get('/admin/address')
      expect(res.status).toBe(401)
    })

    it('rejects wrong token', async () => {
      const res = await request(app)
        .get('/admin/address')
        .set('Authorization', 'Bearer wrong-token')
      expect(res.status).toBe(401)
    })

    it('allows authenticated request to /admin/address', async () => {
      const res = await request(app)
        .get('/admin/address')
        .set('Authorization', 'Bearer test-admin-token')
      expect(res.status).toBe(200)
      expect(res.body.address).toBeDefined()
    })

    it('allows authenticated request to /admin/balance', async () => {
      const res = await request(app)
        .get('/admin/balance')
        .set('Authorization', 'Bearer test-admin-token')
      expect(res.status).toBe(200)
      expect(res.body.available).toBeDefined()
    })
  })

  describe('POST /simulate-tap', () => {
    it('returns 404 when disabled', async () => {
      const res = await request(app)
        .post('/simulate-tap')
        .send({ userArkAddress: 'tark1user1' })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /stats', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/stats/tark1someuser')
      expect(res.status).toBe(401)
    })

    it('returns stats with auth', async () => {
      const res = await request(app)
        .get('/stats/tark1someuser')
        .set('Authorization', 'Bearer test-admin-token')
      expect(res.status).toBe(200)
      expect(res.body.totalTaps).toBeDefined()
    })
  })

  describe('Error responses', () => {
    it('does not leak error message on tap failure', async () => {
      const address = 'tark1errtest' + Date.now()
      hotWallet.sendReward.mockRejectedValueOnce(new Error('Secret internal error details'))

      const res = await request(app)
        .post('/tap')
        .send({ userArkAddress: address, venueId: 'venue-1', nfcTagId: 'tag-1' })

      expect(res.status).toBe(500)
      expect(res.body.error).toBe('Failed to process tap')
      expect(res.body.message).toBeUndefined()
    })
  })

  describe('Concurrency', () => {
    it('serializes concurrent taps for same user/venue — one 200, one 429', async () => {
      // Use unique addresses to avoid interference from previous tests
      const address = 'tark1concurrent' + Date.now()

      // Fire two taps concurrently
      const [res1, res2] = await Promise.all([
        request(app).post('/tap').send({ userArkAddress: address, venueId: 'venue-1', nfcTagId: 'tag-1' }),
        request(app).post('/tap').send({ userArkAddress: address, venueId: 'venue-1', nfcTagId: 'tag-1' })
      ])

      const statuses = [res1.status, res2.status].sort()
      expect(statuses).toEqual([200, 429])
    })

    it('records failed send with status=failed', async () => {
      const address = 'tark1failtest' + Date.now()
      hotWallet.sendReward.mockRejectedValueOnce(new Error('Network error'))

      const res = await request(app)
        .post('/tap')
        .send({ userArkAddress: address, venueId: 'venue-1', nfcTagId: 'tag-1' })

      expect(res.status).toBe(500)

      // After a failed tap, user should be able to retry (failed taps don't count for rate limiting)
      hotWallet.sendReward.mockResolvedValueOnce('retrytxid123')
      const retry = await request(app)
        .post('/tap')
        .send({ userArkAddress: address, venueId: 'venue-1', nfcTagId: 'tag-1' })

      expect(retry.status).toBe(200)
      expect(retry.body.success).toBe(true)
    })
  })
})

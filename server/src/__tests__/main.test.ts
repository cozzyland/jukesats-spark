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
        .send({ userArkAddress: 'invalid123', venueId: 'venue-1', nfcTagId: 'admin-test-tag' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Invalid ARK address')
    })

    it('rejects unknown venue', async () => {
      const res = await request(app)
        .post('/tap')
        .send({ userArkAddress: 'tark1useraabbccddeeffgghhii', venueId: 'unknown-venue', nfcTagId: 'admin-test-tag' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Unknown venue')
    })

    it('processes valid tap', async () => {
      const res = await request(app)
        .post('/tap')
        .send({ userArkAddress: 'tark1newtestuserabcdefghi', venueId: 'venue-1', nfcTagId: 'admin-test-tag' })
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

  describe('Admin tag endpoints', () => {
    it('registers a tag', async () => {
      const res = await request(app)
        .post('/admin/tags')
        .set('Authorization', 'Bearer test-admin-token')
        .send({ tagId: 'admin-test-tag', venueId: 'venue-1' })
      expect(res.status).toBe(201)
      expect(res.body.tag_id).toBe('admin-test-tag')
    })

    it('lists tags for a venue', async () => {
      const res = await request(app)
        .get('/admin/tags/venue-1')
        .set('Authorization', 'Bearer test-admin-token')
      expect(res.status).toBe(200)
      expect(res.body.tags).toBeDefined()
    })

    it('deactivates a tag', async () => {
      // Register then deactivate
      await request(app)
        .post('/admin/tags')
        .set('Authorization', 'Bearer test-admin-token')
        .send({ tagId: 'del-tag', venueId: 'venue-2' })

      const res = await request(app)
        .delete('/admin/tags/venue-2/del-tag')
        .set('Authorization', 'Bearer test-admin-token')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('rejects tag registration without auth', async () => {
      const res = await request(app)
        .post('/admin/tags')
        .send({ tagId: 'tag-1', venueId: 'venue-1' })
      expect(res.status).toBe(401)
    })
  })

  describe('NFC tag validation in /tap', () => {
    it('rejects tap with unregistered tag when tags exist', async () => {
      // Tags were registered in previous tests, so tag validation is active
      const address = 'tark1tagtest' + Date.now()
      const res = await request(app)
        .post('/tap')
        .send({ userArkAddress: address, venueId: 'venue-1', nfcTagId: 'fake-unknown-tag' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Unregistered NFC tag')
    })

    it('accepts tap with registered tag', async () => {
      const address = 'tark1validtag' + Date.now()
      const res = await request(app)
        .post('/tap')
        .send({ userArkAddress: address, venueId: 'venue-1', nfcTagId: 'admin-test-tag' })
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
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
        .send({ userArkAddress: address, venueId: 'venue-1', nfcTagId: 'admin-test-tag' })

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
        request(app).post('/tap').send({ userArkAddress: address, venueId: 'venue-1', nfcTagId: 'admin-test-tag' }),
        request(app).post('/tap').send({ userArkAddress: address, venueId: 'venue-1', nfcTagId: 'admin-test-tag' })
      ])

      const statuses = [res1.status, res2.status].sort()
      expect(statuses).toEqual([200, 429])
    })

    it('allows different users to tap concurrently (both 200)', async () => {
      const addr1 = 'tark1parallelonea' + Date.now()
      const addr2 = 'tark1paralleltwoa' + Date.now()

      const [res1, res2] = await Promise.all([
        request(app).post('/tap').send({ userArkAddress: addr1, venueId: 'venue-1', nfcTagId: 'admin-test-tag' }),
        request(app).post('/tap').send({ userArkAddress: addr2, venueId: 'venue-1', nfcTagId: 'admin-test-tag' })
      ])

      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)
    })

    it('records failed send with status=failed', async () => {
      const address = 'tark1failtest' + Date.now()
      hotWallet.sendReward.mockRejectedValueOnce(new Error('Network error'))

      const res = await request(app)
        .post('/tap')
        .send({ userArkAddress: address, venueId: 'venue-1', nfcTagId: 'admin-test-tag' })

      expect(res.status).toBe(500)

      // After a failed tap, user should be able to retry (failed taps don't count for rate limiting)
      hotWallet.sendReward.mockResolvedValueOnce('retrytxid123')
      const retry = await request(app)
        .post('/tap')
        .send({ userArkAddress: address, venueId: 'venue-1', nfcTagId: 'admin-test-tag' })

      expect(retry.status).toBe(200)
      expect(retry.body.success).toBe(true)
    })
  })
})

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

describe('Server endpoints', () => {
  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/health')
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('ok')
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
})

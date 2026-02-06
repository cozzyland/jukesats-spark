import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import path from 'path'
import { fileURLToPath } from 'url'
import { timingSafeEqual } from 'crypto'
import { hotWallet } from './hotWallet.js'
import { TapTracker } from './tapTracker.js'
import { createDb } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Config validation helpers
function requirePositiveInt(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (!raw) return defaultValue
  const parsed = parseInt(raw, 10)
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got: "${raw}"`)
  }
  return parsed
}

function requireNonNegativeInt(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (!raw) return defaultValue
  const parsed = parseInt(raw, 10)
  if (isNaN(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got: "${raw}"`)
  }
  return parsed
}

export const app = express()
export const PORT = process.env.PORT || 3001

const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'https://cozzyland.net').split(',').map(s => s.trim())
app.use(helmet())
app.use(cors({ origin: CORS_ORIGIN, methods: ['GET', 'POST'] }))
app.use(express.json({ limit: '16kb' }))
// Trust only Fly.io edge proxy (1 hop)
app.set('trust proxy', 1)

// Serve .well-known files with correct content types
app.use('/.well-known', express.static(path.join(__dirname, '../public/.well-known'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('apple-app-site-association')) {
      res.setHeader('Content-Type', 'application/json')
    }
  }
}))

// Fallback /tap page for when app is not installed
app.get('/tap', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/tap.html'))
})

// SQLite database + tap tracker
const db = createDb()
export const tapTracker = new TapTracker(db)

// Per-user mutex for serializing tap processing without cross-user blocking
class MutexMap {
  private locks = new Map<string, Promise<void>>()

  async acquire(key: string): Promise<() => void> {
    while (this.locks.has(key)) {
      await this.locks.get(key)
    }
    let release: () => void
    const promise = new Promise<void>(r => { release = r })
    this.locks.set(key, promise)
    return () => {
      this.locks.delete(key)
      release!()
    }
  }
}
const tapMutex = new MutexMap()

// Config with validation
export const DEFAULT_REWARD_SATS = requirePositiveInt('DEFAULT_REWARD_SATS', 330)
export const TAP_COOLDOWN_MS = requireNonNegativeInt('TAP_COOLDOWN_MS', 60000)
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
export const ALLOWED_VENUES = (process.env.ALLOWED_VENUES || '').split(',').map((v: string) => v.trim()).filter(Boolean)
export const DAILY_SPEND_CAP_SATS = requirePositiveInt('DAILY_SPEND_CAP_SATS', 100000)
export const IP_RATE_LIMIT_MAX = requirePositiveInt('IP_RATE_LIMIT_MAX', 10)
export const ENABLE_SIMULATE_TAP = process.env.ENABLE_SIMULATE_TAP === 'true'

// Log config at startup (secrets redacted)
console.log('[Config] Loaded:', {
  DEFAULT_REWARD_SATS,
  TAP_COOLDOWN_MS,
  ADMIN_TOKEN: ADMIN_TOKEN ? '***' : '(not set)',
  ALLOWED_VENUES: ALLOWED_VENUES.length > 0 ? ALLOWED_VENUES : '(all venues allowed)',
  DAILY_SPEND_CAP_SATS,
  IP_RATE_LIMIT_MAX,
  ENABLE_SIMULATE_TAP,
})

/**
 * Admin auth middleware
 */
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!ADMIN_TOKEN) {
    console.warn('[Auth] ADMIN_TOKEN not set — admin endpoints are disabled')
    return res.status(503).json({ error: 'Admin endpoints not configured' })
  }

  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const provided = Buffer.from(auth.slice(7))
  const expected = Buffer.from(ADMIN_TOKEN)

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  next()
}

/**
 * Get client IP (behind proxy)
 */
function getClientIp(req: express.Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown'
}

/**
 * Health check
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

/**
 * Get hot wallet address (for funding)
 */
app.get('/admin/address', requireAdmin, async (_req, res) => {
  try {
    const address = await hotWallet.getAddress()
    res.json({ address })
  } catch (_error) {
    res.status(500).json({ error: 'Failed to get address' })
  }
})

/**
 * Get detailed hot wallet balance status
 */
app.get('/admin/balance', requireAdmin, async (_req, res) => {
  try {
    const balanceStatus = await hotWallet.getBalanceStatus()
    const address = await hotWallet.getAddress()
    res.json({
      address,
      ...balanceStatus,
      todaySpend: tapTracker.getTodaySpend(),
      dailySpendCap: DAILY_SPEND_CAP_SATS,
      fundingInstructions: balanceStatus.status !== 'ok'
        ? `Send ARK sats to ${address} or swap Lightning via Boltz Exchange`
        : null
    })
  } catch (_error) {
    res.status(500).json({ error: 'Failed to get balance' })
  }
})

/**
 * Debug: Get VTXOs to verify wallet state
 */
app.get('/admin/debug', requireAdmin, async (req, res) => {
  try {
    const address = await hotWallet.getAddress()
    const vtxos = await hotWallet.getVtxos()
    const boardingUtxos = await hotWallet.getBoardingUtxos()
    const balanceStatus = await hotWallet.getBalanceStatus()
    res.json({
      address,
      vtxoCount: vtxos.length,
      vtxos: vtxos.map(v => ({
        txid: v.txid,
        vout: v.vout,
        value: v.value?.toString() || 'unknown',
        virtualStatus: v.virtualStatus
      })),
      boardingUtxoCount: boardingUtxos.length,
      boardingUtxos: boardingUtxos.map(u => ({
        txid: u.txid,
        vout: u.vout,
        value: u.value?.toString() || 'unknown',
        confirmed: u.status?.confirmed || false
      })),
      balance: balanceStatus
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to get debug info', message: error instanceof Error ? error.message : 'Unknown error' })
  }
})

/**
 * Recover swept VTXOs (admin endpoint)
 */
app.post('/admin/recover', requireAdmin, async (req, res) => {
  try {
    const txid = await hotWallet.recoverSweptVtxos()
    const balanceStatus = await hotWallet.getBalanceStatus()
    res.json({
      success: true,
      txid: txid || 'No recovery needed',
      balance: balanceStatus
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to recover', message: error instanceof Error ? error.message : 'Unknown error' })
  }
})

/**
 * Register an NFC tag for a venue
 */
app.post('/admin/tags', requireAdmin, (req, res) => {
  const { tagId, venueId } = req.body
  if (!tagId || !venueId) {
    return res.status(400).json({ error: 'tagId and venueId required' })
  }
  try {
    const tag = tapTracker.registerTag(tagId, venueId)
    res.status(201).json(tag)
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Tag already registered for this venue' })
    }
    res.status(500).json({ error: 'Failed to register tag' })
  }
})

/**
 * List tags for a venue
 */
app.get('/admin/tags/:venueId', requireAdmin, (req, res) => {
  const tags = tapTracker.listTagsByVenue(req.params.venueId)
  res.json({ tags })
})

/**
 * Deactivate an NFC tag
 */
app.delete('/admin/tags/:venueId/:tagId', requireAdmin, (req, res) => {
  const deactivated = tapTracker.deactivateTag(req.params.tagId, req.params.venueId)
  if (!deactivated) {
    return res.status(404).json({ error: 'Tag not found' })
  }
  res.json({ success: true })
})

/**
 * Core tap processing logic with mutex for concurrency control
 */
export async function processTap(userArkAddress: string, venueId: string, nfcTagId: string, ip: string, idempotencyKey?: string) {
  // Check idempotency key before acquiring mutex
  if (idempotencyKey) {
    const existing = tapTracker.findByIdempotencyKey(idempotencyKey)
    if (existing && existing.status === 'completed') {
      return {
        success: true,
        txid: existing.txid,
        amount: existing.reward_sats,
        message: `You earned ${existing.reward_sats} sats!`
      }
    }
  }

  // Acquire per-user mutex for rate-limit checks + INSERT pending
  const release = await tapMutex.acquire(userArkAddress)
  let tapId: number
  const rewardSats = DEFAULT_REWARD_SATS

  try {
    // Check venue whitelist
    if (ALLOWED_VENUES.length > 0 && !ALLOWED_VENUES.includes(venueId)) {
      return {
        success: false,
        status: 400,
        error: 'Unknown venue'
      }
    }

    // Validate NFC tag is registered for this venue
    if (!tapTracker.isValidTag(nfcTagId, venueId)) {
      return {
        success: false,
        status: 400,
        error: 'Unregistered NFC tag'
      }
    }

    // Check IP rate limit (Sybil defense)
    const ipCheck = tapTracker.canTapFromIp(ip, IP_RATE_LIMIT_MAX)
    if (!ipCheck.allowed) {
      return {
        success: false,
        status: 429,
        error: 'Too many taps from this network',
        retryAfterMs: ipCheck.retryAfterMs
      }
    }

    // Check per-address rate limiting
    const canTap = tapTracker.canTap(userArkAddress, venueId, TAP_COOLDOWN_MS)
    if (!canTap.allowed) {
      return {
        success: false,
        status: 429,
        error: 'Too many taps',
        retryAfterMs: canTap.retryAfterMs
      }
    }

    // Check daily spend cap
    if (DAILY_SPEND_CAP_SATS > 0) {
      const todaySpend = tapTracker.getTodaySpend()
      if (todaySpend + rewardSats > DAILY_SPEND_CAP_SATS) {
        console.warn(`[Tap] Daily spend cap reached: ${todaySpend}/${DAILY_SPEND_CAP_SATS} sats`)
        return {
          success: false,
          status: 503,
          error: 'Daily reward limit reached. Try again tomorrow.'
        }
      }
    }

    // Insert pending tap (holds the slot for rate limiting)
    tapId = tapTracker.beginTap(userArkAddress, venueId, nfcTagId, rewardSats, ip, idempotencyKey)
  } finally {
    release()
  }

  // Send reward outside mutex (slow network call)
  try {
    const txid = await hotWallet.sendReward(userArkAddress, rewardSats)
    tapTracker.completeTap(tapId, txid)
    return {
      success: true,
      txid,
      amount: rewardSats,
      message: `You earned ${rewardSats} sats!`
    }
  } catch (error) {
    tapTracker.failTap(tapId)
    throw error
  }
}

/**
 * Process a tap reward
 */
app.post('/tap', async (req, res) => {
  const { userArkAddress, venueId, nfcTagId } = req.body
  const ip = getClientIp(req)

  if (!userArkAddress || !venueId || !nfcTagId) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  if (!userArkAddress.startsWith('tark1') && !userArkAddress.startsWith('ark1')) {
    return res.status(400).json({ error: 'Invalid ARK address format' })
  }

  const idempotencyKey = req.headers['idempotency-key'] as string | undefined

  try {
    const result = await processTap(userArkAddress, venueId, nfcTagId, ip, idempotencyKey)
    if (!result.success) {
      return res.status(result.status || 500).json(result)
    }
    res.json(result)
  } catch (error) {
    console.error('[Tap] Error:', error)
    res.status(500).json({ error: 'Failed to process tap' })
  }
})

/**
 * Get tap stats for a user
 */
app.get('/stats/:userArkAddress', requireAdmin, (req, res) => {
  const { userArkAddress } = req.params
  const stats = tapTracker.getUserStats(userArkAddress, DEFAULT_REWARD_SATS)
  res.json(stats)
})

/**
 * Simulate a tap (for testing without NFC hardware)
 * Disabled in production unless ENABLE_SIMULATE_TAP=true
 */
app.post('/simulate-tap', async (req, res) => {
  if (!ENABLE_SIMULATE_TAP) {
    return res.status(404).json({ error: 'Not found' })
  }

  const { userArkAddress } = req.body
  const ip = getClientIp(req)

  if (!userArkAddress) {
    return res.status(400).json({ error: 'userArkAddress required' })
  }

  if (!userArkAddress.startsWith('tark1') && !userArkAddress.startsWith('ark1')) {
    return res.status(400).json({ error: 'Invalid ARK address format' })
  }

  try {
    const result = await processTap(userArkAddress, 'test-venue-001', 'test-tag-001', ip)
    if (!result.success) {
      return res.status(result.status || 500).json(result)
    }
    res.json(result)
  } catch (error) {
    console.error('[Simulate Tap] Error:', error)
    res.status(500).json({ error: 'Failed to process tap' })
  }
})

// Initialize and start
export async function start() {
  console.log('[Server] Starting Jukesats reward server...')
  console.log(`[Server] Reward: ${DEFAULT_REWARD_SATS} sats/tap`)
  console.log(`[Server] Venues: ${ALLOWED_VENUES.length > 0 ? ALLOWED_VENUES.join(', ') : 'ALL (no whitelist)'}`)
  console.log(`[Server] Daily cap: ${DAILY_SPEND_CAP_SATS > 0 ? `${DAILY_SPEND_CAP_SATS} sats` : 'unlimited'}`)
  console.log(`[Server] IP limit: ${IP_RATE_LIMIT_MAX} taps/hour`)
  console.log(`[Server] Simulate tap: ${ENABLE_SIMULATE_TAP ? 'enabled' : 'disabled'}`)
  console.log(`[Server] Admin auth: ${ADMIN_TOKEN ? 'configured' : 'NOT SET — admin endpoints disabled'}`)

  try {
    await hotWallet.init()

    // Start periodic VTXO renewal and recovery check
    setInterval(async () => {
      try {
        await hotWallet.renewIfNeeded()
        await hotWallet.recoverSweptVtxos()
      } catch (error) {
        console.error('[Server] VTXO maintenance error:', error)
      }
    }, 60 * 60 * 1000) // Check every hour

    const server = app.listen(PORT, () => {
      console.log(`[Server] Listening on port ${PORT}`)
    })

    const shutdown = (signal: string) => {
      console.log(`[Server] ${signal} received, shutting down...`)
      hotWallet.shutdown()
      server.close(() => {
        db.close()
        console.log('[Server] Shutdown complete')
        process.exit(0)
      })
      setTimeout(() => {
        console.error('[Server] Forced shutdown after timeout')
        process.exit(1)
      }, 10_000)
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))

  } catch (error) {
    console.error('[Server] Failed to start:', error)
    process.exit(1)
  }
}

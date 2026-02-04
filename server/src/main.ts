import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { hotWallet } from './hotWallet.js'
import { TapTracker } from './tapTracker.js'
import { createDb } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const app = express()
export const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())
// Trust proxy for IP extraction behind Fly.io
app.set('trust proxy', true)

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

// Mutex for serializing tap processing
class Mutex {
  private _lock: Promise<void> = Promise.resolve()
  async acquire(): Promise<() => void> {
    let release: () => void
    const next = new Promise<void>(r => { release = r })
    const prev = this._lock
    this._lock = next
    await prev
    return release!
  }
}
const tapMutex = new Mutex()

// Config
export const DEFAULT_REWARD_SATS = parseInt(process.env.DEFAULT_REWARD_SATS || '330', 10)
export const TAP_COOLDOWN_MS = parseInt(process.env.TAP_COOLDOWN_MS || '60000', 10)
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
export const ALLOWED_VENUES = (process.env.ALLOWED_VENUES || '').split(',').map((v: string) => v.trim()).filter(Boolean)
export const DAILY_SPEND_CAP_SATS = parseInt(process.env.DAILY_SPEND_CAP_SATS || '100000', 10)
export const IP_RATE_LIMIT_MAX = parseInt(process.env.IP_RATE_LIMIT_MAX || '10', 10)
export const ENABLE_SIMULATE_TAP = process.env.ENABLE_SIMULATE_TAP === 'true'

/**
 * Admin auth middleware
 */
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!ADMIN_TOKEN) {
    console.warn('[Auth] ADMIN_TOKEN not set — admin endpoints are disabled')
    return res.status(503).json({ error: 'Admin endpoints not configured' })
  }

  const auth = req.headers.authorization
  if (!auth || auth !== `Bearer ${ADMIN_TOKEN}`) {
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
app.get('/health', async (req, res) => {
  try {
    const balanceStatus = await hotWallet.getBalanceStatus()
    res.json({
      status: balanceStatus.status === 'critical' ? 'degraded' : 'ok',
      balance: {
        available: balanceStatus.available,
        settled: balanceStatus.settled,
        preconfirmed: balanceStatus.preconfirmed,
        status: balanceStatus.status
      },
      warning: balanceStatus.warning
    })
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Hot wallet not ready' })
  }
})

/**
 * Get hot wallet address (for funding)
 */
app.get('/admin/address', requireAdmin, async (req, res) => {
  try {
    const address = await hotWallet.getAddress()
    res.json({ address })
  } catch (error) {
    res.status(500).json({ error: 'Failed to get address' })
  }
})

/**
 * Get detailed hot wallet balance status
 */
app.get('/admin/balance', requireAdmin, async (req, res) => {
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
  } catch (error) {
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

  // Acquire mutex for rate-limit checks + INSERT pending
  const release = await tapMutex.acquire()
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
    res.status(500).json({
      error: 'Failed to process tap',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

/**
 * Get tap stats for a user
 */
app.get('/stats/:userArkAddress', (req, res) => {
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
    res.status(500).json({
      error: 'Failed to process tap',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
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

    app.listen(PORT, () => {
      console.log(`[Server] Listening on port ${PORT}`)
    })

  } catch (error) {
    console.error('[Server] Failed to start:', error)
    process.exit(1)
  }
}

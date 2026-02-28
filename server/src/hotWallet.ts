import {
  Wallet, SingleKey, VtxoManager, waitForIncomingFunds,
  OnchainWallet, EsploraProvider, ESPLORA_URL, Unroll,
  isSpendable, isRecoverable,
} from '@arkade-os/sdk'
import type { Identity, NetworkName, ChainTx } from '@arkade-os/sdk'
import { FileSystemStorageAdapter } from '@arkade-os/sdk/adapters/fileSystem'
import fs from 'fs'
import path from 'path'

const ARK_SERVER_URL = process.env.ARK_SERVER_URL || 'https://arkade.computer'
const STORAGE_PATH = process.env.WALLET_STORAGE_PATH || './data/hot-wallet'
const DATA_DIR = path.dirname(STORAGE_PATH) // /data on Fly, ./data locally
const EXIT_STATE_PATH = path.join(DATA_DIR, 'exit-state.json')

// Balance thresholds
const LOW_BALANCE_WARNING_SATS = 10000 // Warn when below 10k sats
const CRITICAL_BALANCE_SATS = 1000 // Critical when below 1k sats
const MIN_RESERVE_SATS = 1000 // Never let balance fall below this (prevents subdust change issues)

export type ExitState = {
  phase: 'unrolling' | 'waiting' | 'complete'
  vtxoTxids: string[] // completed unroll txids
  outputAddress: string | null
  startedAt: number
  lastUpdate: number
}

export class HotWallet {
  private wallet: Wallet | null = null
  private vtxoManager: VtxoManager | null = null
  private storage: FileSystemStorageAdapter
  private lastBalanceWarning: number = 0
  private listenerAbortController: AbortController | null = null
  private onchainWallet: OnchainWallet | null = null
  private exitInProgress = false

  constructor() {
    this.storage = new FileSystemStorageAdapter(STORAGE_PATH)
  }

  /**
   * Initialize the hot wallet
   * In production, the private key should come from a secure vault/HSM
   */
  async init(): Promise<void> {
    const privateKeyHex = process.env.HOT_WALLET_PRIVATE_KEY

    if (!privateKeyHex) {
      throw new Error('HOT_WALLET_PRIVATE_KEY environment variable required')
    }

    if (privateKeyHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(privateKeyHex)) {
      throw new Error('HOT_WALLET_PRIVATE_KEY must be a 64-character hex string')
    }

    let identity: ReturnType<typeof SingleKey.fromHex>
    try {
      identity = SingleKey.fromHex(privateKeyHex)
    } catch {
      throw new Error('HOT_WALLET_PRIVATE_KEY is invalid (failed to parse)')
    }

    // Clear private key from env to reduce exposure window
    delete process.env.HOT_WALLET_PRIVATE_KEY

    this.wallet = await Wallet.create({
      identity,
      arkServerUrl: ARK_SERVER_URL,
      storage: this.storage
    })

    // Setup VTXO manager for automatic renewal
    this.vtxoManager = new VtxoManager(this.wallet, {
      enabled: true,
      thresholdMs: 12 * 60 * 60 * 1000 // 12 hours - more aggressive for hot wallet
    })

    const address = await this.wallet.getAddress()
    const balance = await this.wallet.getBalance()

    console.log('[HotWallet] Initialized')
    console.log('[HotWallet] Address:', address)
    console.log('[HotWallet] Balance:', balance.available.toString(), 'sats available')

    // Check balance and warn if low
    this.checkBalanceAndWarn(BigInt(balance.available))

    // Attempt to recover any swept VTXOs
    await this.recoverSweptVtxos()

    // Start listening for incoming funds
    this.listenForIncomingFunds()
  }

  /**
   * Recover swept VTXOs (VTXOs that expired and were swept back to L1)
   */
  async recoverSweptVtxos(): Promise<string | null> {
    if (!this.vtxoManager) return null

    try {
      const recoverableBalance = await this.vtxoManager.getRecoverableBalance()
      console.log(`[HotWallet] Recoverable balance: ${recoverableBalance.recoverable} sats (${recoverableBalance.vtxoCount} VTXOs)`)

      if (recoverableBalance.recoverable > 0n) {
        console.log(`[HotWallet] Recovering ${recoverableBalance.recoverable} sats...`)
        const txid = await this.vtxoManager.recoverVtxos((event) => {
          console.log(`[HotWallet] Recovery event: ${event.type}`)
        })
        console.log(`[HotWallet] Recovered! TX: ${txid}`)

        // Refresh balance after recovery
        const newBalance = await this.wallet!.getBalance()
        console.log(`[HotWallet] New balance after recovery: ${newBalance.available} sats available`)

        return txid
      }

      return null
    } catch (error) {
      console.error('[HotWallet] Error recovering VTXOs:', error)
      return null
    }
  }

  /**
   * Listen for incoming funds in the background
   * Stoppable via shutdown() method
   */
  private async listenForIncomingFunds() {
    if (!this.wallet) return

    this.listenerAbortController = new AbortController()
    console.log('[HotWallet] Listening for incoming funds...')

    let backoffMs = 1000

    while (!this.listenerAbortController.signal.aborted) {
      try {
        const incoming = await waitForIncomingFunds(this.wallet)

        // Check if we should stop after await returns
        if (this.listenerAbortController.signal.aborted) break

        if (incoming.type === 'vtxo') {
          console.log(`[HotWallet] Received ${incoming.newVtxos.length} new VTXOs!`)
          for (const vtxo of incoming.newVtxos) {
            console.log(`[HotWallet]   - ${vtxo.value} sats (${vtxo.txid.slice(0, 16)}...)`)
          }
        } else if (incoming.type === 'utxo') {
          console.log(`[HotWallet] Received ${incoming.coins.length} UTXOs!`)
        }

        // Immediate balance refresh (removed redundant delayed refresh)
        const balance = await this.wallet.getBalance()
        console.log(`[HotWallet] New balance: ${balance.available} sats available`)

        // Reset backoff on success
        backoffMs = 1000

      } catch (error) {
        if (this.listenerAbortController.signal.aborted) break
        console.error('[HotWallet] Error listening for funds:', error)
        await new Promise(resolve => setTimeout(resolve, backoffMs))
        backoffMs = Math.min(backoffMs * 2, 60_000)
      }
    }

    console.log('[HotWallet] Fund listener stopped')
  }

  /**
   * Gracefully shutdown the hot wallet
   */
  shutdown() {
    console.log('[HotWallet] Shutting down...')
    if (this.listenerAbortController) {
      this.listenerAbortController.abort()
    }
    // VtxoManager runs on a timer interval; setting to null allows GC
    this.vtxoManager = null
  }

  /**
   * Get current balance
   */
  async getBalance() {
    if (!this.wallet) throw new Error('Hot wallet not initialized')
    return this.wallet.getBalance()
  }

  /**
   * Get balance status with warnings
   */
  async getBalanceStatus() {
    const balance = await this.getBalance()
    const availableSats = Number(balance.available)
    const totalSats = Number(balance.total ?? balance.available)

    return {
      available: balance.available.toString(),
      settled: balance.settled.toString(),
      preconfirmed: balance.preconfirmed.toString(),
      total: totalSats.toString(),
      recoverable: totalSats > availableSats ? (totalSats - availableSats).toString() : '0',
      status: availableSats < CRITICAL_BALANCE_SATS ? 'critical' :
              availableSats < LOW_BALANCE_WARNING_SATS ? 'low' : 'ok',
      warning: availableSats < CRITICAL_BALANCE_SATS
        ? `CRITICAL: Balance below ${CRITICAL_BALANCE_SATS} sats. Fund immediately!`
        : availableSats < LOW_BALANCE_WARNING_SATS
        ? `WARNING: Balance below ${LOW_BALANCE_WARNING_SATS} sats. Consider refunding.`
        : null
    }
  }

  /**
   * Check balance and log warnings (throttled to once per hour)
   */
  private checkBalanceAndWarn(availableBalance: bigint): void {
    const now = Date.now()
    const availableSats = Number(availableBalance)

    // Only warn once per hour to avoid spam
    if (now - this.lastBalanceWarning < 60 * 60 * 1000) {
      return
    }

    if (availableSats < CRITICAL_BALANCE_SATS) {
      console.error(`\n⚠️  CRITICAL: Hot wallet balance is ${availableSats} sats (below ${CRITICAL_BALANCE_SATS})`)
      console.error(`⚠️  System may fail to send rewards! Fund the wallet immediately.`)
      console.error(`⚠️  Address: ${this.wallet ? 'Run GET /admin/address to get address' : 'Unknown'}\n`)
      this.lastBalanceWarning = now
    } else if (availableSats < LOW_BALANCE_WARNING_SATS) {
      console.warn(`\n⚠️  WARNING: Hot wallet balance is ${availableSats} sats (below ${LOW_BALANCE_WARNING_SATS})`)
      console.warn(`⚠️  Consider refunding the wallet soon.`)
      console.warn(`⚠️  Address: ${this.wallet ? 'Run GET /admin/address to get address' : 'Unknown'}\n`)
      this.lastBalanceWarning = now
    }
  }

  /**
   * Get hot wallet address (for funding)
   */
  async getAddress(): Promise<string> {
    if (!this.wallet) throw new Error('Hot wallet not initialized')
    return this.wallet.getAddress()
  }

  /**
   * Send reward to a user's ARK address
   * Uses sendBitcoin() - the SDK handles VTXO selection and filtering automatically
   */
  async sendReward(userArkAddress: string, amountSats: number): Promise<string> {
    if (!this.wallet) throw new Error('Hot wallet not initialized')

    // Check balance first
    const balance = await this.wallet.getBalance()
    console.log(`[HotWallet] Balance: ${balance.available} sats available`)

    const availableSats = Number(balance.available)
    const balanceAfterSend = availableSats - amountSats

    if (availableSats < amountSats) {
      const address = await this.wallet.getAddress()
      throw new Error(
        `Insufficient hot wallet balance. ` +
        `Available: ${balance.available} sats, Required: ${amountSats} sats. ` +
        `Fund the wallet at: ${address}`
      )
    }

    // Prevent sends that would leave change below dust threshold (causes OP_RETURN errors)
    if (balanceAfterSend < MIN_RESERVE_SATS && balanceAfterSend > 0) {
      const address = await this.wallet.getAddress()
      throw new Error(
        `Cannot send: would leave balance below ${MIN_RESERVE_SATS} sats reserve. ` +
        `Available: ${availableSats} sats, After send: ${balanceAfterSend} sats. ` +
        `Fund the wallet at: ${address}`
      )
    }

    console.log(`[HotWallet] Sending ${amountSats} sats to ${userArkAddress.slice(0, 20)}...`)

    try {
      const txid = await this.wallet.sendBitcoin({
        address: userArkAddress,
        amount: amountSats
      })

      console.log(`[HotWallet] Sent! TX: ${txid}`)

      return txid
    } catch (error) {
      // Log detailed diagnostics on failure
      console.error(`[HotWallet] sendBitcoin failed:`, error)

      try {
        // Get VTXO state for debugging
        const vtxos = await this.wallet.getVtxos()
        const vtxoSummary = vtxos.map(v => ({
          value: v.value,
          state: v.virtualStatus?.state,
          expiry: v.virtualStatus?.batchExpiry
            ? new Date(v.virtualStatus.batchExpiry).toISOString()
            : 'unknown'
        }))
        console.error(`[HotWallet] VTXO state:`, JSON.stringify(vtxoSummary, null, 2))

        // Check for swept VTXOs specifically
        const sweptVtxos = vtxos.filter(v => v.virtualStatus?.state === 'swept')
        if (sweptVtxos.length > 0) {
          console.error(`[HotWallet] Found ${sweptVtxos.length} swept VTXOs - attempting recovery...`)
          await this.recoverSweptVtxos()
        }
      } catch (debugError) {
        console.error(`[HotWallet] Failed to get debug info:`, debugError)
      }

      // Re-throw with more context
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to send ${amountSats} sats: ${errorMessage}`)
    }
  }

  /**
   * Renew any expiring VTXOs (should be called periodically)
   */
  async renewIfNeeded(): Promise<string | null> {
    if (!this.vtxoManager) return null

    const expiring = await this.vtxoManager.getExpiringVtxos()
    if (expiring.length === 0) return null

    console.log(`[HotWallet] Renewing ${expiring.length} expiring VTXOs...`)
    const txid = await this.vtxoManager.renewVtxos()
    console.log(`[HotWallet] Renewed! TX: ${txid}`)
    return txid
  }

  /**
   * Get VTXOs for debugging
   */
  async getVtxos() {
    if (!this.wallet) throw new Error('Hot wallet not initialized')
    return this.wallet.getVtxos()
  }

  /**
   * Get boarding UTXOs (on-chain UTXOs waiting to be converted to VTXOs)
   */
  async getBoardingUtxos() {
    if (!this.wallet) throw new Error('Hot wallet not initialized')
    return this.wallet.getBoardingUtxos()
  }

  /**
   * Get the indexer provider (for chain cache)
   */
  getIndexerProvider() {
    if (!this.wallet) throw new Error('Hot wallet not initialized')
    return this.wallet.indexerProvider
  }

  /**
   * Initialize the on-chain wallet (same key, P2TR address) for fee bumping during unroll
   */
  async initOnchainWallet(): Promise<OnchainWallet> {
    if (this.onchainWallet) return this.onchainWallet

    if (!this.wallet) throw new Error('Hot wallet not initialized')

    const networkName = this.wallet.networkName
    const esploraUrl = ESPLORA_URL[networkName]
    const esploraProvider = new EsploraProvider(esploraUrl, { forcePolling: true })

    this.onchainWallet = await OnchainWallet.create(
      this.wallet.identity,
      networkName,
      esploraProvider,
    )

    console.log(`[HotWallet] On-chain wallet initialized: ${this.onchainWallet.address}`)
    return this.onchainWallet
  }

  /**
   * Get on-chain wallet address (for funding miner fees before unroll)
   */
  async getOnchainAddress(): Promise<string> {
    const ocw = await this.initOnchainWallet()
    return ocw.address
  }

  /**
   * Get on-chain wallet balance (sats available for miner fees)
   */
  async getOnchainBalance(): Promise<number> {
    const ocw = await this.initOnchainWallet()
    return ocw.getBalance()
  }

  /**
   * Emergency exit: unilaterally unroll all VTXOs to on-chain Bitcoin.
   * Called when ASP is detected offline.
   *
   * @param getCachedChain optional function to retrieve pre-cached chain data
   *   for a VTXO outpoint (used when indexer is also down)
   */
  async emergencyExit(
    getCachedChain?: (outpoint: { txid: string; vout: number }) => ChainTx[] | null
  ): Promise<ExitState> {
    if (!this.wallet) throw new Error('Hot wallet not initialized')
    if (this.exitInProgress) {
      console.warn('[HotWallet] Emergency exit already in progress')
      const existing = this.loadExitState()
      if (existing) return existing
      // No saved state yet — exit just started, return a placeholder
      return { phase: 'unrolling', vtxoTxids: [], outputAddress: null, startedAt: Date.now(), lastUpdate: Date.now() }
    }

    this.exitInProgress = true
    console.log('[HotWallet] Starting emergency exit...')

    try {
      // 1. Init on-chain wallet
      const ocw = await this.initOnchainWallet()
      const onchainBalance = await ocw.getBalance()
      console.log(`[HotWallet] On-chain balance for fees: ${onchainBalance} sats`)
      if (onchainBalance === 0) {
        console.warn('[HotWallet] WARNING: On-chain balance is 0. Unrolling requires miner fees.')
        console.warn(`[HotWallet] Fund on-chain address: ${ocw.address}`)
      }

      // 2. Get VTXOs to unroll
      const vtxos = await this.wallet.getVtxos({ withRecoverable: true })
      const exitableVtxos = vtxos.filter(v => isSpendable(v) || isRecoverable(v))
      console.log(`[HotWallet] Found ${exitableVtxos.length} VTXOs to unroll`)

      if (exitableVtxos.length === 0) {
        console.log('[HotWallet] No VTXOs to unroll')
        this.exitInProgress = false
        return { phase: 'complete', vtxoTxids: [], outputAddress: ocw.address, startedAt: Date.now(), lastUpdate: Date.now() }
      }

      // 3. Load or create exit state
      let exitState = this.loadExitState() ?? {
        phase: 'unrolling' as const,
        vtxoTxids: [] as string[],
        outputAddress: ocw.address,
        startedAt: Date.now(),
        lastUpdate: Date.now(),
      }

      const networkName = this.wallet.networkName
      const esploraUrl = ESPLORA_URL[networkName]
      const esploraProvider = new EsploraProvider(esploraUrl, { forcePolling: true })

      // 4. Unroll each VTXO
      for (const vtxo of exitableVtxos) {
        const outpoint = { txid: vtxo.txid, vout: vtxo.vout }

        // Skip if already unrolled in a previous run
        if (exitState.vtxoTxids.includes(vtxo.txid)) {
          console.log(`[HotWallet] Skipping already-unrolled VTXO ${vtxo.txid}:${vtxo.vout}`)
          continue
        }

        try {
          let session: Unroll.Session

          // Try indexer first, fall back to cached chain data
          try {
            session = await Unroll.Session.create(outpoint, ocw, esploraProvider, this.wallet.indexerProvider)
          } catch (indexerErr) {
            console.warn(`[HotWallet] Indexer unavailable, trying cached chain for ${vtxo.txid}:${vtxo.vout}`)
            const cachedChain = getCachedChain?.(outpoint)
            if (!cachedChain) {
              console.error(`[HotWallet] No cached chain data for ${vtxo.txid}:${vtxo.vout} — skipping`)
              continue
            }
            session = new Unroll.Session(
              { ...outpoint, chain: cachedChain },
              ocw,
              esploraProvider,
              this.wallet.indexerProvider,
            )
          }

          // Iterate the unroll steps
          for await (const step of session) {
            switch (step.type) {
              case Unroll.StepType.UNROLL:
                console.log(`[HotWallet] Broadcasting unroll tx: ${step.tx.id}`)
                break
              case Unroll.StepType.WAIT:
                console.log(`[HotWallet] Waiting for confirmation: ${step.txid}`)
                break
              case Unroll.StepType.DONE:
                console.log(`[HotWallet] Unroll complete for VTXO: ${step.vtxoTxid}`)
                exitState.vtxoTxids.push(step.vtxoTxid)
                exitState.lastUpdate = Date.now()
                this.saveExitState(exitState)
                break
            }
          }
        } catch (err) {
          console.error(`[HotWallet] Failed to unroll ${vtxo.txid}:${vtxo.vout}:`, err)
        }
      }

      // 5. Complete unroll — claim funds after CSV timelock
      if (exitState.vtxoTxids.length > 0) {
        exitState.phase = 'waiting'
        this.saveExitState(exitState)

        try {
          console.log(`[HotWallet] Completing unroll: claiming ${exitState.vtxoTxids.length} VTXOs to ${ocw.address}`)
          const claimTxid = await Unroll.completeUnroll(this.wallet, exitState.vtxoTxids, ocw.address)
          console.log(`[HotWallet] Claim broadcast! TX: ${claimTxid}`)
          exitState.phase = 'complete'
          exitState.lastUpdate = Date.now()
          this.saveExitState(exitState)
        } catch (err) {
          console.error('[HotWallet] completeUnroll failed (CSV timelock may not have expired yet):', err)
          // State is saved — can retry later
        }
      }

      return exitState
    } finally {
      this.exitInProgress = false
    }
  }

  private loadExitState(): ExitState | null {
    try {
      const data = fs.readFileSync(EXIT_STATE_PATH, 'utf-8')
      return JSON.parse(data) as ExitState
    } catch {
      return null
    }
  }

  private saveExitState(state: ExitState): void {
    fs.mkdirSync('./data', { recursive: true })
    fs.writeFileSync(EXIT_STATE_PATH, JSON.stringify(state, null, 2))
  }
}

// Singleton
export const hotWallet = new HotWallet()

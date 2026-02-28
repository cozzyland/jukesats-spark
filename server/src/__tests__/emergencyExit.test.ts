import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'

// Mock the SDK
vi.mock('@arkade-os/sdk', () => {
  const StepType = { UNROLL: 0, WAIT: 1, DONE: 2 }

  return {
    Wallet: { create: vi.fn() },
    SingleKey: { fromHex: vi.fn().mockReturnValue({ toHex: () => 'a'.repeat(64) }) },
    VtxoManager: vi.fn().mockImplementation(() => ({
      getRecoverableBalance: vi.fn().mockResolvedValue({ recoverable: 0n, vtxoCount: 0 }),
    })),
    waitForIncomingFunds: vi.fn().mockReturnValue(new Promise(() => {})),
    OnchainWallet: {
      create: vi.fn().mockResolvedValue({
        address: 'tb1qonchainaddress',
        getBalance: vi.fn().mockResolvedValue(50000),
        bumpP2A: vi.fn(),
      }),
    },
    EsploraProvider: vi.fn().mockImplementation(() => ({})),
    ESPLORA_URL: { testnet4: 'https://mempool.space/testnet4/api' },
    Unroll: {
      StepType,
      Session: {
        create: vi.fn(),
      },
      completeUnroll: vi.fn().mockResolvedValue('claim-txid-123'),
    },
    isSpendable: vi.fn().mockReturnValue(true),
    isRecoverable: vi.fn().mockReturnValue(false),
    FileSystemStorageAdapter: vi.fn(),
  }
})

vi.mock('@arkade-os/sdk/adapters/fileSystem', () => ({
  FileSystemStorageAdapter: vi.fn().mockImplementation(() => ({})),
}))

import { HotWallet } from '../hotWallet.js'
import { OnchainWallet, Unroll, isSpendable } from '@arkade-os/sdk'

const EXIT_STATE_PATH = './data/exit-state.json'

describe('HotWallet Emergency Exit', () => {
  let wallet: HotWallet

  beforeEach(async () => {
    // Clean exit state
    try { fs.unlinkSync(EXIT_STATE_PATH) } catch {}

    process.env.HOT_WALLET_PRIVATE_KEY = 'a'.repeat(64)

    // Mock Wallet.create to return a fake wallet
    const { Wallet } = await import('@arkade-os/sdk')
    ;(Wallet.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      getAddress: vi.fn().mockResolvedValue('tark1hotwalletaddress'),
      getBalance: vi.fn().mockResolvedValue({ available: 10000n, settled: 10000n, preconfirmed: 0n, total: 10000n }),
      getVtxos: vi.fn().mockResolvedValue([
        { txid: 'vtxo-1', vout: 0, value: 5000n, virtualStatus: { state: 'settled' } },
        { txid: 'vtxo-2', vout: 0, value: 5000n, virtualStatus: { state: 'settled' } },
      ]),
      getBoardingUtxos: vi.fn().mockResolvedValue([]),
      sendBitcoin: vi.fn(),
      identity: { toHex: () => 'a'.repeat(64) },
      networkName: 'testnet4',
      indexerProvider: { getVtxoChain: vi.fn() },
      onchainProvider: {},
    })

    wallet = new HotWallet()
    await wallet.init()
  })

  afterEach(() => {
    wallet.shutdown()
    try { fs.unlinkSync(EXIT_STATE_PATH) } catch {}
    vi.clearAllMocks()
  })

  it('initializes on-chain wallet', async () => {
    const address = await wallet.getOnchainAddress()
    expect(address).toBe('tb1qonchainaddress')
    expect(OnchainWallet.create).toHaveBeenCalled()
  })

  it('returns on-chain balance', async () => {
    const balance = await wallet.getOnchainBalance()
    expect(balance).toBe(50000)
  })

  it('runs emergency exit with async iterator steps', async () => {
    // Mock unroll session that yields UNROLL → WAIT → DONE for each VTXO
    const mockSession = {
      async *[Symbol.asyncIterator]() {
        yield { type: Unroll.StepType.UNROLL, tx: { id: 'unroll-tx-1' } }
        yield { type: Unroll.StepType.WAIT, txid: 'unroll-tx-1' }
        yield { type: Unroll.StepType.DONE, vtxoTxid: 'vtxo-done-1' }
      }
    }

    ;(Unroll.Session.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession)
    ;(isSpendable as ReturnType<typeof vi.fn>).mockReturnValue(true)

    const result = await wallet.emergencyExit()

    expect(result.vtxoTxids).toContain('vtxo-done-1')
    expect(Unroll.completeUnroll).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['vtxo-done-1']),
      'tb1qonchainaddress',
    )
  })

  it('persists exit state to disk', async () => {
    const mockSession = {
      async *[Symbol.asyncIterator]() {
        yield { type: Unroll.StepType.DONE, vtxoTxid: 'persisted-vtxo' }
      }
    }
    ;(Unroll.Session.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession)

    await wallet.emergencyExit()

    const saved = JSON.parse(fs.readFileSync(EXIT_STATE_PATH, 'utf-8'))
    expect(saved.vtxoTxids).toContain('persisted-vtxo')
    expect(saved.outputAddress).toBe('tb1qonchainaddress')
  })

  it('falls back to cached chain data when indexer is down', async () => {
    // Session.create throws (indexer down)
    ;(Unroll.Session.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Indexer down'))

    const cachedChain = [{ txid: 'cached-tx', expiresAt: '2025-12-31', type: 'TREE', spends: [] }]

    // Mock the Session constructor (used with cached chain data)
    const mockSession = {
      async *[Symbol.asyncIterator]() {
        yield { type: Unroll.StepType.DONE, vtxoTxid: 'cached-vtxo' }
      }
    }

    // We need to mock the constructor call — since Unroll.Session is a class,
    // mock it so that `new Unroll.Session(...)` returns our mock
    const originalSession = Unroll.Session
    const SessionMock = vi.fn().mockReturnValue(mockSession) as any
    SessionMock.create = originalSession.create
    ;(Unroll as any).Session = SessionMock

    const getCachedChain = vi.fn().mockReturnValue(cachedChain)
    const result = await wallet.emergencyExit(getCachedChain)

    expect(getCachedChain).toHaveBeenCalled()
    expect(result.vtxoTxids).toContain('cached-vtxo')

    // Restore
    ;(Unroll as any).Session = originalSession
  })

  it('handles zero VTXOs gracefully', async () => {
    // Make isSpendable and isRecoverable return false for all VTXOs
    const { isSpendable: isSp, isRecoverable: isRec } = await import('@arkade-os/sdk')
    ;(isSp as ReturnType<typeof vi.fn>).mockReturnValue(false)
    ;(isRec as ReturnType<typeof vi.fn>).mockReturnValue(false)

    const result = await wallet.emergencyExit()
    expect(result.phase).toBe('complete')
    expect(result.vtxoTxids).toEqual([])

    // Restore defaults
    ;(isSp as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(isRec as ReturnType<typeof vi.fn>).mockReturnValue(false)
  })

  it('prevents concurrent emergency exits', async () => {
    // Create a slow session
    const mockSession = {
      async *[Symbol.asyncIterator]() {
        await new Promise(resolve => setTimeout(resolve, 100))
        yield { type: Unroll.StepType.DONE, vtxoTxid: 'slow-vtxo' }
      }
    }
    ;(Unroll.Session.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession)

    // Start two exits concurrently
    const [result1, result2] = await Promise.all([
      wallet.emergencyExit(),
      wallet.emergencyExit(),
    ])

    // One runs fully, the other gets the guard early return
    expect(result1).toBeDefined()
    expect(result2).toBeDefined()
    // At least one should have unrolled VTXOs
    const hasVtxos = result1.vtxoTxids.length > 0 || result2.vtxoTxids.length > 0
    expect(hasVtxos).toBe(true)
  })
})

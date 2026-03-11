import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock SparkWallet before importing hotWallet
const mockWallet = {
  getSparkAddress: vi.fn().mockResolvedValue('spark1pmockaddress12345678'),
  getBalance: vi.fn().mockResolvedValue({ balance: 50000n, tokenBalances: new Map() }),
  transfer: vi.fn().mockResolvedValue({ id: 'mock-transfer-id' }),
  createLightningInvoice: vi.fn().mockResolvedValue({
    invoice: { encodedInvoice: 'lnbc10u1mock', paymentHash: 'abc', amount: 1000 },
    status: 'PENDING',
  }),
  getSingleUseDepositAddress: vi.fn().mockResolvedValue('bc1pmockdepositaddress'),
  cleanupConnections: vi.fn().mockResolvedValue(undefined),
}

vi.mock('@buildonspark/spark-sdk', () => ({
  SparkWallet: {
    initialize: vi.fn().mockResolvedValue({ wallet: mockWallet }),
  },
}))

describe('HotWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset env for each test
    process.env.HOT_WALLET_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  })

  it('initializes with valid mnemonic', async () => {
    // Must import fresh each time since it's a singleton
    const { HotWallet } = await import('../hotWallet.js')
    const hw = new HotWallet()
    await hw.init()

    expect(mockWallet.getSparkAddress).toHaveBeenCalled()
    expect(mockWallet.getBalance).toHaveBeenCalled()
  })

  it('throws without mnemonic', async () => {
    delete process.env.HOT_WALLET_MNEMONIC
    const { HotWallet } = await import('../hotWallet.js')
    const hw = new HotWallet()
    await expect(hw.init()).rejects.toThrow('HOT_WALLET_MNEMONIC environment variable required')
  })

  it('throws with invalid mnemonic word count', async () => {
    process.env.HOT_WALLET_MNEMONIC = 'only three words'
    const { HotWallet } = await import('../hotWallet.js')
    const hw = new HotWallet()
    await expect(hw.init()).rejects.toThrow('12 or 24 word')
  })

  it('sends reward and returns transfer ID', async () => {
    const { HotWallet } = await import('../hotWallet.js')
    const hw = new HotWallet()
    await hw.init()

    const txid = await hw.sendReward('spark1precipient123456789', 330)
    expect(txid).toBe('mock-transfer-id')
    expect(mockWallet.transfer).toHaveBeenCalledWith({
      receiverSparkAddress: 'spark1precipient123456789',
      amountSats: 330,
    })
  })

  it('rejects send when balance too low', async () => {
    mockWallet.getBalance.mockResolvedValueOnce({ balance: 50000n, tokenBalances: new Map() }) // init
    const { HotWallet } = await import('../hotWallet.js')
    const hw = new HotWallet()
    await hw.init()

    mockWallet.getBalance.mockResolvedValueOnce({ balance: 100n, tokenBalances: new Map() }) // sendReward check
    await expect(hw.sendReward('spark1precipient123456789', 330)).rejects.toThrow('Insufficient')
  })

  it('rejects send that would leave balance below reserve', async () => {
    mockWallet.getBalance.mockResolvedValueOnce({ balance: 50000n, tokenBalances: new Map() }) // init
    const { HotWallet } = await import('../hotWallet.js')
    const hw = new HotWallet()
    await hw.init()

    // Balance is 1500, send 1000, leaves 500 which is < 1000 reserve
    mockWallet.getBalance.mockResolvedValueOnce({ balance: 1500n, tokenBalances: new Map() })
    await expect(hw.sendReward('spark1precipient123456789', 1000)).rejects.toThrow('reserve')
  })

  it('creates Lightning deposit invoice', async () => {
    const { HotWallet } = await import('../hotWallet.js')
    const hw = new HotWallet()
    await hw.init()

    const invoice = await hw.createDepositInvoice(1000, 'Test funding')
    expect(invoice).toBe('lnbc10u1mock')
    expect(mockWallet.createLightningInvoice).toHaveBeenCalledWith({
      amountSats: 1000,
      memo: 'Test funding',
    })
  })

  it('gets single-use deposit address', async () => {
    const { HotWallet } = await import('../hotWallet.js')
    const hw = new HotWallet()
    await hw.init()

    const addr = await hw.getDepositAddress()
    expect(addr).toBe('bc1pmockdepositaddress')
  })

  it('returns balance status', async () => {
    const { HotWallet } = await import('../hotWallet.js')
    const hw = new HotWallet()
    await hw.init()

    const status = await hw.getBalanceStatus()
    expect(status.available).toBe('50000')
    expect(status.status).toBe('ok')
    expect(status.warning).toBeNull()
  })

  it('reports critical balance status', async () => {
    mockWallet.getBalance.mockResolvedValueOnce({ balance: 50000n, tokenBalances: new Map() }) // init
    const { HotWallet } = await import('../hotWallet.js')
    const hw = new HotWallet()
    await hw.init()

    mockWallet.getBalance.mockResolvedValueOnce({ balance: 500n, tokenBalances: new Map() })
    const status = await hw.getBalanceStatus()
    expect(status.status).toBe('critical')
    expect(status.warning).toContain('CRITICAL')
  })

  it('cleans up connections on shutdown', async () => {
    const { HotWallet } = await import('../hotWallet.js')
    const hw = new HotWallet()
    await hw.init()

    hw.shutdown()
    expect(mockWallet.cleanupConnections).toHaveBeenCalled()
  })
})

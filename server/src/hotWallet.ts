import { SparkWallet } from '@buildonspark/spark-sdk'

// Balance thresholds
const LOW_BALANCE_WARNING_SATS = 10000
const CRITICAL_BALANCE_SATS = 1000
const MIN_RESERVE_SATS = 1000

export class HotWallet {
  private wallet: SparkWallet | null = null
  private lastBalanceWarning: number = 0

  async init(): Promise<void> {
    const mnemonic = process.env.HOT_WALLET_MNEMONIC

    if (!mnemonic) {
      throw new Error('HOT_WALLET_MNEMONIC environment variable required')
    }

    const words = mnemonic.trim().split(/\s+/)
    if (words.length !== 12 && words.length !== 24) {
      throw new Error('HOT_WALLET_MNEMONIC must be a 12 or 24 word BIP-39 mnemonic')
    }

    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: mnemonic.trim(),
      options: { network: 'MAINNET' },
    })
    this.wallet = wallet

    // Clear mnemonic from env to reduce exposure window
    delete process.env.HOT_WALLET_MNEMONIC

    const address = await this.wallet.getSparkAddress()
    const { balance } = await this.wallet.getBalance()

    console.log('[HotWallet] Initialized')
    console.log('[HotWallet] Address:', address)
    console.log('[HotWallet] Balance:', balance.toString(), 'sats')

    this.checkBalanceAndWarn(balance)
  }

  async getBalance(): Promise<{ balance: bigint }> {
    if (!this.wallet) throw new Error('Hot wallet not initialized')
    const { balance } = await this.wallet.getBalance()
    return { balance }
  }

  async getBalanceStatus() {
    const { balance } = await this.getBalance()
    const availableSats = Number(balance)

    return {
      available: balance.toString(),
      status: availableSats < CRITICAL_BALANCE_SATS ? 'critical' as const :
              availableSats < LOW_BALANCE_WARNING_SATS ? 'low' as const : 'ok' as const,
      warning: availableSats < CRITICAL_BALANCE_SATS
        ? `CRITICAL: Balance below ${CRITICAL_BALANCE_SATS} sats. Fund immediately!`
        : availableSats < LOW_BALANCE_WARNING_SATS
        ? `WARNING: Balance below ${LOW_BALANCE_WARNING_SATS} sats. Consider refunding.`
        : null,
    }
  }

  private checkBalanceAndWarn(balance: bigint): void {
    const now = Date.now()
    const availableSats = Number(balance)

    if (now - this.lastBalanceWarning < 60 * 60 * 1000) return

    if (availableSats < CRITICAL_BALANCE_SATS) {
      console.error(`\n[HotWallet] CRITICAL: Balance is ${availableSats} sats (below ${CRITICAL_BALANCE_SATS})`)
      console.error(`[HotWallet] System may fail to send rewards! Fund the wallet immediately.\n`)
      this.lastBalanceWarning = now
    } else if (availableSats < LOW_BALANCE_WARNING_SATS) {
      console.warn(`\n[HotWallet] WARNING: Balance is ${availableSats} sats (below ${LOW_BALANCE_WARNING_SATS})`)
      console.warn(`[HotWallet] Consider refunding the wallet soon.\n`)
      this.lastBalanceWarning = now
    }
  }

  async getAddress(): Promise<string> {
    if (!this.wallet) throw new Error('Hot wallet not initialized')
    return this.wallet.getSparkAddress()
  }

  async sendReward(userSparkAddress: string, amountSats: number): Promise<string> {
    if (!this.wallet) throw new Error('Hot wallet not initialized')

    const { balance } = await this.wallet.getBalance()
    const availableSats = Number(balance)
    const balanceAfterSend = availableSats - amountSats

    if (availableSats < amountSats) {
      const address = await this.wallet.getSparkAddress()
      throw new Error(
        `Insufficient hot wallet balance. ` +
        `Available: ${balance} sats, Required: ${amountSats} sats. ` +
        `Fund the wallet at: ${address}`
      )
    }

    if (balanceAfterSend < MIN_RESERVE_SATS && balanceAfterSend > 0) {
      const address = await this.wallet.getSparkAddress()
      throw new Error(
        `Cannot send: would leave balance below ${MIN_RESERVE_SATS} sats reserve. ` +
        `Available: ${availableSats} sats, After send: ${balanceAfterSend} sats. ` +
        `Fund the wallet at: ${address}`
      )
    }

    console.log(`[HotWallet] Sending ${amountSats} sats to ${userSparkAddress.slice(0, 20)}...`)

    const transfer = await this.wallet.transfer({
      receiverSparkAddress: userSparkAddress,
      amountSats,
    })

    console.log(`[HotWallet] Sent! Transfer: ${transfer.id}`)
    return transfer.id
  }

  async createDepositInvoice(amountSats: number, memo?: string): Promise<string> {
    if (!this.wallet) throw new Error('Hot wallet not initialized')
    const request = await this.wallet.createLightningInvoice({
      amountSats,
      memo: memo || 'Jukesats hot wallet funding',
    })
    return request.invoice.encodedInvoice
  }

  async getDepositAddress(): Promise<string> {
    if (!this.wallet) throw new Error('Hot wallet not initialized')
    return this.wallet.getSingleUseDepositAddress()
  }

  shutdown(): void {
    console.log('[HotWallet] Shutting down...')
    if (this.wallet) {
      this.wallet.cleanupConnections().catch((err) => {
        console.error('[HotWallet] Cleanup error:', err)
      })
    }
  }
}

// Singleton
export const hotWallet = new HotWallet()

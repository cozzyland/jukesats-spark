import { SparkWallet } from '@buildonspark/spark-sdk'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'

const MNEMONIC_KEY = 'wallet-mnemonic'
const CACHED_ADDRESS_KEY = 'wallet-spark-address'

let wallet: SparkWallet | null = null
let address: string | null = null
let initPromise: Promise<string> | null = null

/** Initialize wallet. Safe to call concurrently — deduplicates via shared promise. */
export function initWallet(): Promise<string> {
  if (!initPromise) {
    initPromise = doInit().catch((error) => {
      initPromise = null
      throw error
    })
  }
  return initPromise
}

async function doInit(): Promise<string> {
  if (wallet && address) return address

  let mnemonic = await SecureStore.getItemAsync(MNEMONIC_KEY)

  if (mnemonic) {
    // Restore existing wallet
    const result = await SparkWallet.initialize({
      mnemonicOrSeed: mnemonic,
      options: { network: 'MAINNET' },
    })
    wallet = result.wallet
  } else {
    // Create new wallet — SDK auto-generates mnemonic
    const result = await SparkWallet.initialize({
      options: { network: 'MAINNET' },
    })
    wallet = result.wallet
    mnemonic = result.mnemonic!
    await SecureStore.setItemAsync(MNEMONIC_KEY, mnemonic, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    })
  }

  address = await wallet.getSparkAddress()
  await AsyncStorage.setItem(CACHED_ADDRESS_KEY, address)
  return address
}

/** Get cached address. Returns null if wallet not yet initialized. */
export async function getCachedAddress(): Promise<string | null> {
  if (address) return address
  return AsyncStorage.getItem(CACHED_ADDRESS_KEY)
}

export function getWallet(): SparkWallet {
  if (!wallet) throw new Error('Wallet not initialized')
  return wallet
}

export function getAddress(): string | null {
  return address
}

/** Send bitcoin to a Spark address. Returns transfer ID. */
export async function sendBitcoin(recipientAddress: string, amount: number): Promise<string> {
  const w = getWallet()
  const transfer = await w.transfer({
    receiverSparkAddress: recipientAddress,
    amountSats: amount,
  })
  return transfer.id
}

/** Get wallet balance in sats. */
export async function getBalance(): Promise<number> {
  try {
    const w = getWallet()
    const bal = await w.getBalance()
    return Number(bal.balance)
  } catch {
    return 0
  }
}

/** Create a Lightning invoice to receive sats. Returns BOLT11 invoice string. */
export async function createLightningInvoice(amountSats: number, memo?: string): Promise<string> {
  const w = getWallet()
  const request = await w.createLightningInvoice({
    amountSats,
    memo: memo || 'Jukesats payment',
  })
  return request.invoice.encodedInvoice
}

/** Pay a Lightning invoice (BOLT11). Returns the payment ID. */
export async function payLightningInvoice(invoice: string, amountSats?: number): Promise<string> {
  const w = getWallet()
  const result = await w.payLightningInvoice({
    invoice,
    ...(amountSats ? { amountSatsToSend: amountSats } : {}),
  })
  // Result could be LightningSendRequest or WalletTransfer (if paid via Spark)
  return 'id' in result ? result.id : String(result)
}

/** Subscribe to incoming transfer events. Callback receives updated balance in sats. */
export function onTransferReceived(callback: (balanceSats: number) => void): () => void {
  if (!wallet) return () => {}
  const handler = (_transferId: string, updatedBalance: bigint) => {
    callback(Number(updatedBalance))
  }
  wallet.on('transfer:claimed', handler)
  return () => { wallet?.off('transfer:claimed', handler) }
}

/** Cleanup wallet connections (call on app background/unmount). */
export async function cleanupWallet(): Promise<void> {
  if (wallet) {
    await wallet.cleanupConnections()
  }
}

import {
  Wallet, SingleKey, OnchainWallet, EsploraProvider, ESPLORA_URL,
  Unroll, isSpendable, isRecoverable,
} from '@arkade-os/sdk'
import type { ExtendedVirtualCoin, Outpoint } from '@arkade-os/sdk'
import { AsyncStorageAdapter } from '@arkade-os/sdk/adapters/asyncStorage'
import { ExpoArkProvider, ExpoIndexerProvider } from '@arkade-os/sdk/adapters/expo'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'

const ARK_SERVER_URL = 'https://arkade.computer'
const PRIVATE_KEY_KEY = 'wallet-private-key'
const CACHED_ADDRESS_KEY = 'wallet-ark-address'

let wallet: Wallet | null = null
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

  let privateKeyHex = await SecureStore.getItemAsync(PRIVATE_KEY_KEY)
  if (!privateKeyHex) {
    const identity = SingleKey.fromRandomBytes()
    privateKeyHex = identity.toHex()
    await SecureStore.setItemAsync(PRIVATE_KEY_KEY, privateKeyHex, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    })
  }

  wallet = await Wallet.create({
    identity: SingleKey.fromHex(privateKeyHex),
    arkServerUrl: ARK_SERVER_URL,
    storage: new AsyncStorageAdapter(),
    arkProvider: new ExpoArkProvider(ARK_SERVER_URL),
    indexerProvider: new ExpoIndexerProvider(ARK_SERVER_URL),
  })

  // getAddress() requires network (needs server pubkey), but result is deterministic
  address = await wallet.getAddress()
  await AsyncStorage.setItem(CACHED_ADDRESS_KEY, address)
  return address
}

/** Get cached address. Returns null if wallet not yet initialized. */
export async function getCachedAddress(): Promise<string | null> {
  if (address) return address
  return AsyncStorage.getItem(CACHED_ADDRESS_KEY)
}

export function getWallet(): Wallet {
  if (!wallet) throw new Error('Wallet not initialized')
  return wallet
}

export function getAddress(): string | null {
  return address
}

/** Send bitcoin to an ARK address. Returns txid. */
export async function sendBitcoin(recipientAddress: string, amount: number): Promise<string> {
  const w = getWallet()
  return w.sendBitcoin({ address: recipientAddress, amount })
}

// --- Unilateral Exit ---

let onchainWallet: OnchainWallet | null = null

/** Get or create the on-chain wallet (same private key, P2TR address). */
export async function getOnchainWallet(): Promise<OnchainWallet> {
  if (onchainWallet) return onchainWallet
  const w = getWallet()
  const networkName = w.networkName
  const esploraUrl = ESPLORA_URL[networkName]
  const esploraProvider = new EsploraProvider(esploraUrl, { forcePolling: true })
  onchainWallet = await OnchainWallet.create(w.identity, networkName, esploraProvider)
  return onchainWallet
}

/** Get on-chain address for funding miner fees. */
export async function getOnchainAddress(): Promise<string> {
  const ocw = await getOnchainWallet()
  return ocw.address
}

/** Get on-chain balance (sats for miner fees). */
export async function getOnchainBalance(): Promise<number> {
  const ocw = await getOnchainWallet()
  return ocw.getBalance()
}

/** Get VTXOs that can be unrolled (spendable or recoverable). */
export async function getExitableVtxos(): Promise<ExtendedVirtualCoin[]> {
  const w = getWallet()
  const vtxos = await w.getVtxos({ withRecoverable: true })
  return vtxos.filter(v => isSpendable(v) || isRecoverable(v))
}

export type UnrollProgress =
  | { type: 'unroll'; txId: string }
  | { type: 'wait'; txid: string }
  | { type: 'done'; vtxoTxid: string }

/** Begin unrolling a single VTXO. Yields progress events. */
export async function* beginUnroll(outpoint: Outpoint): AsyncGenerator<UnrollProgress> {
  const w = getWallet()
  const ocw = await getOnchainWallet()
  const networkName = w.networkName
  const esploraUrl = ESPLORA_URL[networkName]
  const esploraProvider = new EsploraProvider(esploraUrl, { forcePolling: true })

  const session = await Unroll.Session.create(outpoint, ocw, esploraProvider, w.indexerProvider)
  for await (const step of session) {
    switch (step.type) {
      case Unroll.StepType.UNROLL:
        yield { type: 'unroll', txId: step.tx.id }
        break
      case Unroll.StepType.WAIT:
        yield { type: 'wait', txid: step.txid }
        break
      case Unroll.StepType.DONE:
        yield { type: 'done', vtxoTxid: step.vtxoTxid }
        break
    }
  }
}

/** Complete exit: claim unrolled VTXOs to an on-chain address after CSV timelock. */
export async function completeExit(vtxoTxids: string[], outputAddress: string): Promise<string> {
  const w = getWallet()
  return Unroll.completeUnroll(w, vtxoTxids, outputAddress)
}

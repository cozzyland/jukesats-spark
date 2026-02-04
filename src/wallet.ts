import { Wallet, SingleKey } from '@arkade-os/sdk'
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
    initPromise = doInit()
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

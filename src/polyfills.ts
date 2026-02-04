import * as Crypto from 'expo-crypto'

if (!global.crypto) {
  (global as any).crypto = {}
}
;(global.crypto.getRandomValues as any) = Crypto.getRandomValues

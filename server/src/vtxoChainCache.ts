import fs from 'fs'
import path from 'path'
import type { IndexerProvider, Outpoint, ChainTx, ExtendedVirtualCoin } from '@arkade-os/sdk'

const DEFAULT_CACHE_DIR = './data/vtxo-chains'
const CACHE_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

type GetVtxos = () => Promise<ExtendedVirtualCoin[]>

export class VtxoChainCache {
  private indexer: IndexerProvider
  private getVtxos: GetVtxos
  private cacheDir: string
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(indexer: IndexerProvider, getVtxos: GetVtxos, cacheDir?: string) {
    this.indexer = indexer
    this.getVtxos = getVtxos
    this.cacheDir = cacheDir ?? DEFAULT_CACHE_DIR
    fs.mkdirSync(this.cacheDir, { recursive: true })
  }

  start(): void {
    // Run immediately, then on interval
    this.cacheAll().catch((err) => {
      console.error('[VtxoChainCache] Initial cache failed:', err)
    })
    this.timer = setInterval(() => {
      this.cacheAll().catch((err) => {
        console.error('[VtxoChainCache] Periodic cache failed:', err)
      })
    }, CACHE_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async cacheAll(): Promise<void> {
    let vtxos: ExtendedVirtualCoin[]
    try {
      vtxos = await this.getVtxos()
    } catch (err) {
      console.error('[VtxoChainCache] Failed to get VTXOs:', err)
      return
    }

    const activeOutpoints = new Set<string>()

    for (const vtxo of vtxos) {
      const key = `${vtxo.txid}:${vtxo.vout}`
      activeOutpoints.add(key)

      try {
        const result = await this.indexer.getVtxoChain({ txid: vtxo.txid, vout: vtxo.vout })
        const filePath = this.filePath(vtxo.txid, vtxo.vout)
        fs.writeFileSync(filePath, JSON.stringify(result.chain))
        console.log(`[VtxoChainCache] Cached chain for ${key} (${result.chain.length} txs)`)
      } catch (err) {
        console.warn(`[VtxoChainCache] Failed to cache chain for ${key}:`, err)
      }
    }

    // Clean up stale entries
    this.cleanStale(activeOutpoints)
  }

  getCachedChain(outpoint: Outpoint): ChainTx[] | null {
    const filePath = this.filePath(outpoint.txid, outpoint.vout)
    try {
      const data = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(data) as ChainTx[]
    } catch {
      return null
    }
  }

  private filePath(txid: string, vout: number): string {
    return path.join(this.cacheDir, `${txid}:${vout}.json`)
  }

  private cleanStale(activeOutpoints: Set<string>): void {
    try {
      const files = fs.readdirSync(this.cacheDir)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const key = file.replace('.json', '')
        if (!activeOutpoints.has(key)) {
          fs.unlinkSync(path.join(this.cacheDir, file))
          console.log(`[VtxoChainCache] Cleaned stale cache: ${key}`)
        }
      }
    } catch (err) {
      console.warn('[VtxoChainCache] Failed to clean stale entries:', err)
    }
  }
}

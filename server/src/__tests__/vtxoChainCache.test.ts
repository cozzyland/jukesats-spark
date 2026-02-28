import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { VtxoChainCache } from '../vtxoChainCache.js'
import type { IndexerProvider, ExtendedVirtualCoin, ChainTxType } from '@arkade-os/sdk'

const TEST_CACHE_DIR = './data/test-vtxo-chains'

function makeFakeVtxo(txid: string, vout: number): ExtendedVirtualCoin {
  return {
    txid,
    vout,
    value: 1000n,
    virtualStatus: { state: 'settled' as const },
  } as ExtendedVirtualCoin
}

function makeFakeChain(txid: string) {
  return [
    { txid, expiresAt: '2025-12-31', type: 'INDEXER_CHAINED_TX_TYPE_TREE' as ChainTxType, spends: [] },
    { txid: 'parent-' + txid, expiresAt: '2025-12-31', type: 'INDEXER_CHAINED_TX_TYPE_COMMITMENT' as ChainTxType, spends: [txid] },
  ]
}

describe('VtxoChainCache', () => {
  let mockIndexer: { getVtxoChain: ReturnType<typeof vi.fn> }
  let mockGetVtxos: ReturnType<typeof vi.fn>
  let cache: VtxoChainCache

  beforeEach(() => {
    // Clean test directory
    fs.rmSync(TEST_CACHE_DIR, { recursive: true, force: true })

    mockIndexer = {
      getVtxoChain: vi.fn(),
    }
    mockGetVtxos = vi.fn()
    cache = new VtxoChainCache(
      mockIndexer as unknown as IndexerProvider,
      mockGetVtxos,
      TEST_CACHE_DIR,
    )
  })

  afterEach(() => {
    cache.stop()
    fs.rmSync(TEST_CACHE_DIR, { recursive: true, force: true })
  })

  it('creates cache directory on construction', () => {
    expect(fs.existsSync(TEST_CACHE_DIR)).toBe(true)
  })

  it('caches chain data for each VTXO', async () => {
    const vtxo = makeFakeVtxo('abc123', 0)
    const chain = makeFakeChain('abc123')

    mockGetVtxos.mockResolvedValueOnce([vtxo])
    mockIndexer.getVtxoChain.mockResolvedValueOnce({ chain })

    await cache.cacheAll()

    // Verify file was written
    const cached = cache.getCachedChain({ txid: 'abc123', vout: 0 })
    expect(cached).toEqual(chain)
  })

  it('returns null for uncached outpoint', () => {
    const result = cache.getCachedChain({ txid: 'nonexistent', vout: 0 })
    expect(result).toBeNull()
  })

  it('cleans up stale cache entries', async () => {
    // Manually write a stale entry
    const stalePath = path.join(TEST_CACHE_DIR, 'old-txid:0.json')
    fs.writeFileSync(stalePath, '[]')
    expect(fs.existsSync(stalePath)).toBe(true)

    // Cache with no VTXOs — everything is stale
    mockGetVtxos.mockResolvedValueOnce([])
    await cache.cacheAll()

    expect(fs.existsSync(stalePath)).toBe(false)
  })

  it('preserves cache entries for active VTXOs', async () => {
    const vtxo = makeFakeVtxo('active-tx', 1)
    const chain = makeFakeChain('active-tx')

    mockGetVtxos.mockResolvedValueOnce([vtxo])
    mockIndexer.getVtxoChain.mockResolvedValueOnce({ chain })

    await cache.cacheAll()

    const filePath = path.join(TEST_CACHE_DIR, 'active-tx:1.json')
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('handles indexer failure gracefully per VTXO', async () => {
    const vtxo1 = makeFakeVtxo('good-tx', 0)
    const vtxo2 = makeFakeVtxo('bad-tx', 0)
    const chain1 = makeFakeChain('good-tx')

    mockGetVtxos.mockResolvedValueOnce([vtxo1, vtxo2])
    mockIndexer.getVtxoChain
      .mockResolvedValueOnce({ chain: chain1 })
      .mockRejectedValueOnce(new Error('Indexer timeout'))

    await cache.cacheAll()

    // good-tx cached, bad-tx not
    expect(cache.getCachedChain({ txid: 'good-tx', vout: 0 })).toEqual(chain1)
    expect(cache.getCachedChain({ txid: 'bad-tx', vout: 0 })).toBeNull()
  })

  it('handles getVtxos failure gracefully', async () => {
    mockGetVtxos.mockRejectedValueOnce(new Error('Wallet not initialized'))

    // Should not throw
    await cache.cacheAll()
  })
})

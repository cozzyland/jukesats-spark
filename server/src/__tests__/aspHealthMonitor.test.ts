import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AspHealthMonitor, AspStatus } from '../aspHealthMonitor.js'

// Mock RestArkProvider
vi.mock('@arkade-os/sdk', () => ({
  RestArkProvider: vi.fn().mockImplementation(() => ({
    getInfo: vi.fn(),
  })),
}))

import { RestArkProvider } from '@arkade-os/sdk'

function getMockedProvider(monitor: AspHealthMonitor): { getInfo: ReturnType<typeof vi.fn> } {
  // The provider is created in the constructor, access it via the mock
  const instance = (RestArkProvider as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value
  return instance
}

describe('AspHealthMonitor', () => {
  let monitor: AspHealthMonitor
  let statusChanges: AspStatus[]
  let provider: { getInfo: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.useFakeTimers()
    statusChanges = []
    monitor = new AspHealthMonitor('https://arkade.computer', (status) => {
      statusChanges.push(status)
    })
    provider = getMockedProvider(monitor)
  })

  afterEach(() => {
    monitor.stop()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  const fakeInfo = {
    unilateralExitDelay: 604800n,
    network: 'testnet4',
    dust: 450n,
    signerPubkey: 'abc',
    version: '0.3.0',
  }

  it('starts offline with no cached info', () => {
    const status = monitor.getStatus()
    expect(status.online).toBe(false)
    expect(status.lastSeen).toBe(0)
    expect(status.consecutiveFailures).toBe(0)
    expect(status.cachedInfo).toBeNull()
  })

  it('goes online after successful check', async () => {
    provider.getInfo.mockResolvedValueOnce(fakeInfo)
    await monitor.check()

    const status = monitor.getStatus()
    expect(status.online).toBe(true)
    expect(status.consecutiveFailures).toBe(0)
    expect(status.cachedInfo).toEqual(fakeInfo)
    expect(status.lastSeen).toBeGreaterThan(0)
  })

  it('fires onStatusChange when transitioning offline → online', async () => {
    provider.getInfo.mockResolvedValueOnce(fakeInfo)
    await monitor.check()

    expect(statusChanges).toHaveLength(1)
    expect(statusChanges[0].online).toBe(true)
  })

  it('stays online during individual failures (below threshold)', async () => {
    // First, go online
    provider.getInfo.mockResolvedValueOnce(fakeInfo)
    await monitor.check()
    expect(monitor.getStatus().online).toBe(true)

    // 4 failures (threshold is 5) — should stay online
    for (let i = 0; i < 4; i++) {
      provider.getInfo.mockRejectedValueOnce(new Error('Connection refused'))
      await monitor.check()
    }

    expect(monitor.getStatus().online).toBe(true)
    expect(monitor.getStatus().consecutiveFailures).toBe(4)
    // No offline transition callback
    expect(statusChanges).toHaveLength(1) // only the initial online transition
  })

  it('goes offline after 5 consecutive failures', async () => {
    // First, go online
    provider.getInfo.mockResolvedValueOnce(fakeInfo)
    await monitor.check()

    // 5 failures → offline
    for (let i = 0; i < 5; i++) {
      provider.getInfo.mockRejectedValueOnce(new Error('Connection refused'))
      await monitor.check()
    }

    expect(monitor.getStatus().online).toBe(false)
    expect(monitor.getStatus().consecutiveFailures).toBe(5)
    // Callback: online + offline = 2
    expect(statusChanges).toHaveLength(2)
    expect(statusChanges[1].online).toBe(false)
  })

  it('recovers to online after going offline', async () => {
    // Go online
    provider.getInfo.mockResolvedValueOnce(fakeInfo)
    await monitor.check()

    // Go offline
    for (let i = 0; i < 5; i++) {
      provider.getInfo.mockRejectedValueOnce(new Error('down'))
      await monitor.check()
    }
    expect(monitor.getStatus().online).toBe(false)

    // Recover
    provider.getInfo.mockResolvedValueOnce(fakeInfo)
    await monitor.check()

    expect(monitor.getStatus().online).toBe(true)
    expect(monitor.getStatus().consecutiveFailures).toBe(0)
    expect(statusChanges).toHaveLength(3) // online → offline → online
  })

  it('preserves cachedInfo through failures', async () => {
    provider.getInfo.mockResolvedValueOnce(fakeInfo)
    await monitor.check()

    provider.getInfo.mockRejectedValueOnce(new Error('timeout'))
    await monitor.check()

    // cachedInfo should still be the last successful response
    expect(monitor.getStatus().cachedInfo).toEqual(fakeInfo)
  })

  it('does not fire callback when status does not change', async () => {
    // Go online
    provider.getInfo.mockResolvedValueOnce(fakeInfo)
    await monitor.check()
    expect(statusChanges).toHaveLength(1)

    // Still online — no callback
    provider.getInfo.mockResolvedValueOnce(fakeInfo)
    await monitor.check()
    expect(statusChanges).toHaveLength(1)
  })

  it('returns a defensive copy from getStatus', () => {
    const s1 = monitor.getStatus()
    const s2 = monitor.getStatus()
    expect(s1).not.toBe(s2) // different object references
    expect(s1).toEqual(s2) // same values
  })
})

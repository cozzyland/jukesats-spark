import { RestArkProvider, ArkInfo } from '@arkade-os/sdk'

const POLL_INTERVAL_MS = 30_000
const OFFLINE_THRESHOLD = 5 // consecutive failures before declaring offline

export type AspStatus = {
  online: boolean
  lastSeen: number // epoch ms, 0 if never seen
  consecutiveFailures: number
  cachedInfo: ArkInfo | null
}

type StatusChangeCallback = (status: AspStatus) => void

export class AspHealthMonitor {
  private provider: RestArkProvider
  private status: AspStatus = {
    online: false,
    lastSeen: 0,
    consecutiveFailures: 0,
    cachedInfo: null,
  }
  private timer: ReturnType<typeof setInterval> | null = null
  private onStatusChange: StatusChangeCallback | null = null

  constructor(arkServerUrl: string, onStatusChange?: StatusChangeCallback) {
    this.provider = new RestArkProvider(arkServerUrl)
    this.onStatusChange = onStatusChange ?? null
  }

  getStatus(): AspStatus {
    return { ...this.status }
  }

  async start(): Promise<void> {
    // Do initial check immediately
    await this.check()
    this.timer = setInterval(() => this.check(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async check(): Promise<void> {
    const wasOnline = this.status.online
    try {
      const info = await this.provider.getInfo()
      this.status = {
        online: true,
        lastSeen: Date.now(),
        consecutiveFailures: 0,
        cachedInfo: info,
      }
    } catch {
      this.status.consecutiveFailures++
      if (this.status.consecutiveFailures >= OFFLINE_THRESHOLD) {
        this.status.online = false
      }
    }

    // Fire callback on transition
    if (wasOnline !== this.status.online && this.onStatusChange) {
      this.onStatusChange(this.getStatus())
    }
  }
}

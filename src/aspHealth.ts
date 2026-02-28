import { useState, useEffect, useRef } from 'react'

const API_URL = 'https://jukesats-server.fly.dev'

export type AspHealthStatus = 'online' | 'offline' | 'unknown'

export function useAspHealth(intervalMs = 60_000): AspHealthStatus {
  const [status, setStatus] = useState<AspHealthStatus>('unknown')
  const lastKnownRef = useRef<AspHealthStatus>('unknown')

  useEffect(() => {
    let mounted = true

    async function check() {
      try {
        const res = await fetch(`${API_URL}/asp-status`, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) return // Don't change status on server error
        const body = await res.json()
        const newStatus: AspHealthStatus = body.online ? 'online' : 'offline'
        if (mounted) {
          lastKnownRef.current = newStatus
          setStatus(newStatus)
        }
      } catch {
        // Network error (mobile flaky) — keep last known status
        // Don't falsely report ASP offline because user's phone lost signal
      }
    }

    check()
    const timer = setInterval(check, intervalMs)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [intervalMs])

  return status
}

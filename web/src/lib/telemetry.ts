// Reports how the app feels to the person using it (round trip to the server, time to
// sync, reconnects, key-to-paint) so it can be graphed next to the server's own metrics.
//
// What is sent: a metric NAME and a number, nothing else. No document text, no ids,
// no names. The server accepts only a fixed list of names (see server/src/telemetry.ts).
// Set NEXT_PUBLIC_TELEMETRY=off to turn it off completely.
import { API, tokenStore } from './api'

type Labels = Record<string, string>
interface MetricEvent { n: string; v: number; l?: Labels }

const ENABLED = process.env.NEXT_PUBLIC_TELEMETRY !== 'off'
const MAX_QUEUE = 500 // if the network is down, drop the oldest rather than grow without limit
const FLUSH_MS = 15_000

let queue: MetricEvent[] = []
let timer: ReturnType<typeof setInterval> | null = null

export function recordMetric(n: string, v = 1, l?: Labels) {
  if (!ENABLED || typeof window === 'undefined') return
  queue.push(l ? { n, v, l } : { n, v })
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)
  if (!timer) {
    timer = setInterval(() => void flushMetrics(), FLUSH_MS)
    // leaving the page: send what we have (keepalive lets the request outlive the page)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flushMetrics(true))
  }
  if (queue.length >= 50) void flushMetrics()
}

export async function flushMetrics(keepalive = false) {
  const token = tokenStore.get()
  if (!token || queue.length === 0) return
  const events = queue.slice(0, 100)
  queue = queue.slice(events.length)
  try {
    await fetch(`${API}/telemetry`, {
      method: 'POST',
      keepalive,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ events }),
    })
  } catch {
    /* metrics must never get in the way: drop them */
  }
}

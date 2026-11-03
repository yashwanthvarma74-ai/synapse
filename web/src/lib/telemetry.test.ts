// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let telemetry: typeof import('./telemetry')
const fetchMock = vi.fn()

beforeEach(async () => {
  vi.resetModules() // the queue is module-level state: start every test with a fresh one
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
  localStorage.setItem('synapse:token', 'test-token')
  telemetry = await import('./telemetry')
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const sentEvents = () => JSON.parse(fetchMock.mock.calls[0][1].body).events as Array<{ n: string; v: number; l?: Record<string, string> }>

describe('browser metrics beacon', () => {
  it('sends only a name, a number and labels, with the signed-in token', async () => {
    telemetry.recordMetric('rtt', 12.5)
    telemetry.recordMetric('connection', 1, { outcome: 'synced' })
    await telemetry.flushMetrics()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/telemetry$/)
    expect(init.headers.authorization).toBe('Bearer test-token')
    expect(sentEvents()).toEqual([{ n: 'rtt', v: 12.5 }, { n: 'connection', v: 1, l: { outcome: 'synced' } }])
    // nothing else travels: no document text, no ids, no user names
    for (const e of sentEvents()) expect(Object.keys(e).every((k) => ['n', 'v', 'l'].includes(k))).toBe(true)
  })

  it('does nothing when there is nothing to send', async () => {
    await telemetry.flushMetrics()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends nothing when nobody is signed in', async () => {
    localStorage.clear()
    telemetry.recordMetric('rtt', 5)
    await telemetry.flushMetrics()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never sends more than 100 events in one request (the server limit)', async () => {
    for (let i = 0; i < 130; i++) telemetry.recordMetric('rtt', i)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled()) // 50 queued events trigger a send on their own
    await telemetry.flushMetrics()
    for (const call of fetchMock.mock.calls) expect(JSON.parse(call[1].body).events.length).toBeLessThanOrEqual(100)
  })

  it('survives a failing network: metrics never throw into the app', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    telemetry.recordMetric('rtt', 5)
    await expect(telemetry.flushMetrics()).resolves.toBeUndefined()
  })

  it('uses keepalive when the page is being left, so the last events still go out', async () => {
    telemetry.recordMetric('rtt', 5)
    await telemetry.flushMetrics(true)
    expect(fetchMock.mock.calls[0][1].keepalive).toBe(true)
  })
})

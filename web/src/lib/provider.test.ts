// @vitest-environment jsdom
// The sync client reports timings and lifecycle events for the dashboard. These tests use a
// fake WebSocket and fake timers, so they check exactly WHICH events are reported WHEN.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import { Awareness } from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { SynapseProvider } from './provider'

class FakeWS {
  static instances: FakeWS[] = []
  static OPEN = 1
  static CLOSED = 3
  readyState = 1
  binaryType = ''
  sent: Uint8Array[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) { FakeWS.instances.push(this) }
  send(data: Uint8Array) { this.sent.push(new Uint8Array(data)) }
  close(code = 1006) { this.readyState = 3; this.onclose?.({ code }) }
  // test helpers: act as the server
  open() { this.onopen?.() }
  receive(bytes: Uint8Array) { this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }) }
  messagesOfType(type: number) { return this.sent.filter((m) => m[0] === type) }
}

const serverStep2 = () => {
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, 0)
  syncProtocol.writeSyncStep2(enc, new Y.Doc())
  return encoding.toUint8Array(enc)
}
const setVisibility = (v: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })

let events: Array<[string, number | undefined, Record<string, string> | undefined]>
let provider: SynapseProvider

function start() {
  const doc = new Y.Doc()
  provider = new SynapseProvider({ url: 'ws://test/collab/x', doc, awareness: new Awareness(doc), onMetric: (n, v, l) => events.push([n, v, l]) })
  return FakeWS.instances.at(-1)!
}
const names = () => events.map((e) => e[0] + (e[2]?.outcome ? `:${e[2].outcome}` : ''))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] })
  vi.spyOn(Math, 'random').mockReturnValue(0.5) // fixed backoff
  FakeWS.instances = []
  events = []
  setVisibility('visible')
  vi.stubGlobal('WebSocket', FakeWS)
})
afterEach(() => {
  provider?.destroy()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('SynapseProvider metrics', () => {
  it('reports an attempt, then a synced connection with its time to sync', () => {
    const ws = start()
    expect(names()).toEqual(['connection:attempt'])
    ws.open()
    vi.advanceTimersByTime(40)
    ws.receive(serverStep2())
    expect(names()).toEqual(['connection:attempt', 'connection:synced', 'time_to_sync'])
    const tts = events.find((e) => e[0] === 'time_to_sync')![1]!
    expect(tts).toBeGreaterThanOrEqual(40)
    expect(events.some((e) => e[0] === 'reconnect')).toBe(false) // the first sync is not a reconnect
  })

  it('measures the round trip by echoing a timestamp', () => {
    const ws = start()
    ws.open(); ws.receive(serverStep2())
    vi.advanceTimersByTime(5000) // the first probe goes out after 5 s
    const ping = ws.messagesOfType(2)[0]
    expect(ping).toBeTruthy()
    vi.advanceTimersByTime(20) // 20 ms pass...
    // ...and the gateway echoes the exact payload back as a type-3 message
    const dec = decoding.createDecoder(ping)
    decoding.readVarUint(dec)
    const echo = encoding.createEncoder()
    encoding.writeVarUint(echo, 3)
    encoding.writeVarUint8Array(echo, decoding.readVarUint8Array(dec))
    ws.receive(encoding.toUint8Array(echo))
    const rtt = events.find((e) => e[0] === 'rtt')
    expect(rtt![1]).toBeCloseTo(20, 0)
  })

  it('does not measure while the tab is hidden (the browser throttles its timers)', () => {
    const ws = start()
    ws.open(); ws.receive(serverStep2())
    setVisibility('hidden')
    vi.advanceTimersByTime(20_000)
    expect(ws.messagesOfType(2)).toHaveLength(0) // no probes sent while hidden
    // a reply that arrives while hidden is ignored too
    setVisibility('visible'); vi.advanceTimersByTime(5000)
    const ping = ws.messagesOfType(2)[0]
    setVisibility('hidden')
    const dec = decoding.createDecoder(ping); decoding.readVarUint(dec)
    const echo = encoding.createEncoder(); encoding.writeVarUint(echo, 3); encoding.writeVarUint8Array(echo, decoding.readVarUint8Array(dec))
    ws.receive(encoding.toUint8Array(echo))
    expect(events.some((e) => e[0] === 'rtt')).toBe(false)
  })

  it('reports a reconnect with how long it was offline', () => {
    const ws = start()
    ws.open(); ws.receive(serverStep2())
    events.length = 0
    ws.close() // connection lost
    vi.advanceTimersByTime(7000) // offline for a while; the provider retries meanwhile
    const ws2 = FakeWS.instances.at(-1)!
    expect(ws2).not.toBe(ws)
    ws2.open(); ws2.receive(serverStep2())
    expect(names()).toContain('connection:attempt')
    expect(names()).toContain('reconnect')
    const offline = events.find((e) => e[0] === 'offline_seconds')![1]!
    expect(offline).toBeGreaterThan(0.2)
    expect(offline).toBeLessThan(10)
  })

  it('reports a failed connection only when it drops by itself before syncing', () => {
    const ws = start()
    ws.open()
    ws.close() // dropped before the document synced: a real failure
    expect(names()).toContain('connection:failed')
  })

  it('does NOT count a connection the app cancelled (leaving the page) as a failure', () => {
    start()
    provider.destroy()
    expect(names()).not.toContain('connection:failed')
  })

  it('does not count the network simulator as a failure', () => {
    const ws = start()
    ws.open()
    provider.setPartitioned(true) // the demo "go offline" button
    expect(names()).not.toContain('connection:failed')
    void ws
  })

  it('stops probing after it is destroyed', () => {
    const ws = start()
    ws.open(); ws.receive(serverStep2())
    provider.destroy()
    vi.advanceTimersByTime(30_000)
    expect(ws.messagesOfType(2)).toHaveLength(0)
  })

  describe('saving a named version', () => {
    const reply = (ws: FakeWS, type: number, cid: string, value: number | string) => {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, type)
      encoding.writeVarString(enc, cid)
      if (typeof value === 'number') encoding.writeVarUint(enc, value)
      else encoding.writeVarString(enc, value)
      ws.receive(encoding.toUint8Array(enc))
    }
    const sentRequest = (ws: FakeWS) => {
      const dec = decoding.createDecoder(ws.messagesOfType(6).at(-1)!)
      decoding.readVarUint(dec)
      return { label: decoding.readVarString(dec), cid: decoding.readVarString(dec) }
    }
    const connect = () => {
      const ws = start()
      ws.open()
      ws.receive(serverStep2())
      return ws
    }

    it('sends the name and resolves with the version number the server answers with', async () => {
      const ws = connect()
      const saved = provider.saveVersion('Before the big change')
      const { label, cid } = sentRequest(ws)
      expect(label).toBe('Before the big change')
      reply(ws, 7, cid, 4)
      await expect(saved).resolves.toBe(4)
    })

    it('matches each answer to its own request', async () => {
      const ws = connect()
      const first = provider.saveVersion('one')
      const a = sentRequest(ws)
      const second = provider.saveVersion('two')
      const b = sentRequest(ws)
      reply(ws, 7, b.cid, 2)
      reply(ws, 7, a.cid, 1)
      await expect(first).resolves.toBe(1)
      await expect(second).resolves.toBe(2)
    })

    it('turns a refusal into a plain sentence', async () => {
      const ws = connect()
      const saved = provider.saveVersion('x')
      reply(ws, 8, sentRequest(ws).cid, 'forbidden')
      await expect(saved).rejects.toThrow('Only people who can edit can save versions.')
    })

    it('refuses straight away when offline, and sends nothing', async () => {
      const ws = start() // never connected
      await expect(provider.saveVersion('x')).rejects.toThrow(/offline/i)
      expect(ws.messagesOfType(6)).toHaveLength(0)
    })

    it('gives up if the server never answers', async () => {
      connect()
      const saved = provider.saveVersion('x')
      const outcome = expect(saved).rejects.toThrow(/did not answer/)
      await vi.advanceTimersByTimeAsync(10_001)
      await outcome
    })

    it('fails the request if the connection drops before the answer', async () => {
      const ws = connect()
      const saved = provider.saveVersion('x')
      const outcome = expect(saved).rejects.toThrow(/connection was lost/)
      ws.close()
      await outcome
    })
  })
})

// SynapseProvider: connects one Yjs doc to the gateway over a WebSocket.
// Written by hand (instead of using y-websocket) so every step is visible:
//   open -> send sync step 1 -> receive step 2 -> now live updates both ways.
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const MSG_SYNC = 0
const MSG_AWARENESS = 1
const MSG_PING = 2
const MSG_PONG = 3
const MSG_CHAT = 4 // [4, text, clientId] to send; [4, json] from the server
const MSG_CHAT_ERROR = 5 // [5, clientId, code] the server refused a message
const MSG_SAVE_VERSION = 6 // [6, label, clientId] save a named version of the document as the server holds it
const MSG_VERSION_SAVED = 7 // [7, clientId, versionNumber]
const MSG_VERSION_ERROR = 8 // [8, clientId, code]
const PING_EVERY_MS = 5000

export type Status = 'connecting' | 'connected' | 'offline' | 'revoked'

export interface ChatMessage { id: string; userId: string; name: string; text: string; at: string; cid?: string }
export type ChatErrorCode = 'forbidden' | 'invalid' | 'rate' | 'unavailable'

const VERSION_REFUSALS: Record<string, string> = {
  forbidden: 'Only people who can edit can save versions.',
  invalid: 'Give the version a name of up to 80 characters.',
  rate: "You're saving versions too quickly. Wait a moment and try again.",
  unavailable: "The version couldn't be saved right now. Try again in a moment.",
}
export type ChatEvent = { type: 'message'; message: ChatMessage } | { type: 'error'; cid: string; code: ChatErrorCode }

export interface ProviderOptions {
  url: string // e.g. ws://localhost:4000/collab/<docId>?user=...
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  presenceThrottleMs?: number
  // Called with timings and lifecycle events, for the metrics dashboard
  onMetric?: (name: string, value?: number, labels?: Record<string, string>) => void
}

export class SynapseProvider {
  readonly doc: Y.Doc
  readonly awareness: awarenessProtocol.Awareness
  status: Status = 'connecting'
  synced = false
  // Timing log used by the benchmarks / network simulator panel
  lastReconnectSyncMs: number | null = null

  // ---- network simulator (for the demo and tests) ----
  // partitioned: act as if the network is dead. latencyMs: delay every message.
  private partitioned = false
  private latencyMs = 0

  private ws: WebSocket | null = null
  private attempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectStartedAt = 0
  private destroyed = false
  private hadSynced = false // has this provider ever been fully synced?
  private lostAt: number | null = null // when the last synced connection was lost
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private listeners = new Set<() => void>()
  private chatListeners = new Set<(e: ChatEvent) => void>()
  private lastRequestId = 0
  private versionRequests = new Map<string, { resolve: (version: number) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private pendingAwareness = new Set<number>()
  private awarenessTimer: ReturnType<typeof setTimeout> | null = null
  private opts: ProviderOptions

  constructor(opts: ProviderOptions) {
    this.opts = opts
    this.doc = opts.doc
    this.awareness = opts.awareness
    this.doc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
    window.addEventListener('beforeunload', this.onUnload)
    this.connect()
  }

  // ---- public API ----------------------------------------------------------

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  // ---- chat (see server/src/chat.ts) ----
  onChat(fn: (e: ChatEvent) => void) {
    this.chatListeners.add(fn)
    return () => void this.chatListeners.delete(fn)
  }
  // Returns false when the message could not even be handed to the connection (offline).
  sendChat(text: string, cid: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.synced || this.partitioned) return false
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_CHAT)
    encoding.writeVarString(enc, text)
    encoding.writeVarString(enc, cid)
    this.send(encoding.toUint8Array(enc))
    return true
  }

  // Ask the server to save a named version of the document. It takes the snapshot from the copy it holds in
  // memory, and this message travels behind every edit already sent on this connection, so the version
  // contains everything typed up to this moment. Resolves with the version number.
  saveVersion(label: string): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.synced || this.partitioned) {
        return reject(new Error("You're offline. Saving a version needs a connection."))
      }
      const cid = String(++this.lastRequestId) // the server echoes it back on this connection only
      const timer = setTimeout(() => {
        this.versionRequests.delete(cid)
        reject(new Error('The server did not answer. Check your connection and try again.'))
      }, 10_000)
      this.versionRequests.set(cid, { resolve, reject, timer })
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SAVE_VERSION)
      encoding.writeVarString(enc, label)
      encoding.writeVarString(enc, cid)
      this.send(encoding.toUint8Array(enc))
    })
  }

  private settleVersion(cid: string, outcome: { version: number } | { error: string }) {
    const pending = this.versionRequests.get(cid)
    if (!pending) return
    clearTimeout(pending.timer)
    this.versionRequests.delete(cid)
    if ('version' in outcome) pending.resolve(outcome.version)
    else pending.reject(new Error(outcome.error))
  }

  private failPendingVersions(reason: string) {
    for (const cid of [...this.versionRequests.keys()]) this.settleVersion(cid, { error: reason })
  }

  setPartitioned(on: boolean) {
    this.partitioned = on
    if (on) {
      this.ws?.close() // cut the connection now
      this.setStatus('offline')
    } else if (!this.ws) {
      this.attempts = 0
      this.connect()
    }
  }
  isPartitioned() {
    return this.partitioned
  }
  setLatency(ms: number) {
    this.latencyMs = ms
  }
  getLatency() {
    return this.latencyMs
  }

  destroy() {
    this.destroyed = true
    this.doc.off('update', this.onDocUpdate)
    this.awareness.off('update', this.onAwarenessUpdate)
    window.removeEventListener('beforeunload', this.onUnload)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.awarenessTimer) clearTimeout(this.awarenessTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy')
    this.ws?.close()
    this.failPendingVersions('The page was closed before the version was saved.')
    this.listeners.clear()
    this.chatListeners.clear()
  }

  // ---- connection lifecycle -----------------------------------------------

  private connect() {
    if (this.destroyed || this.partitioned) return
    this.setStatus('connecting')
    this.connectStartedAt = performance.now()
    this.opts.onMetric?.('connection', 1, { outcome: 'attempt' })
    const ws = new WebSocket(this.opts.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      // Step 1 of the handshake: send our state vector. The server answers with
      // exactly the updates we are missing, and we answer with what it is missing.
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.writeSyncStep1(enc, this.doc)
      this.send(encoding.toUint8Array(enc))
      // Also announce our cursor/presence
      if (this.awareness.getLocalState() !== null) {
        this.send(this.encodeAwareness([this.doc.clientID]))
      }
    }

    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer)
      this.deliver(() => this.onMessage(data))
    }

    ws.onclose = (event) => {
      if (this.ws === ws) this.ws = null
      if (this.pingTimer) clearInterval(this.pingTimer)
      if (this.synced) this.lostAt = performance.now() // a good connection was lost
      else if (!this.destroyed && !this.partitioned) this.opts.onMetric?.('connection', 1, { outcome: 'failed' }) // never got synced
      this.synced = false
      this.failPendingVersions('The connection was lost before the version was saved. Try again.')
      // Everyone else's cursors are stale while we're disconnected
      const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID)
      awarenessProtocol.removeAwarenessStates(this.awareness, others, 'disconnect')
      if (this.destroyed) return
      // 4403 = the server removed our access. Don't retry: it would only be refused.
      if (event.code === 4403) {
        this.setStatus('revoked')
        return
      }
      this.setStatus('offline')
      this.scheduleReconnect()
    }

    ws.onerror = () => ws.close()
  }

  // Exponential backoff with full jitter: wait a random time between 0 and
  // min(cap, base * 2^attempts). Jitter stops thousands of clients from
  // reconnecting at the same instant after a server restart.
  private scheduleReconnect() {
    if (this.partitioned || this.destroyed) return
    const cap = 15_000
    const base = 500
    const max = Math.min(cap, base * 2 ** this.attempts)
    const delay = Math.random() * max
    this.attempts++
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  // ---- messages --------------------------------------------------------------

  private onMessage(data: Uint8Array) {
    const decoder = decoding.createDecoder(data)
    const type = decoding.readVarUint(decoder)
    if (type === MSG_SYNC) {
      const reply = encoding.createEncoder()
      encoding.writeVarUint(reply, MSG_SYNC)
      const syncType = syncProtocol.readSyncMessage(decoder, reply, this.doc, this)
      if (encoding.length(reply) > 1) this.send(encoding.toUint8Array(reply))
      if (syncType === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true
        this.attempts = 0
        this.lastReconnectSyncMs = performance.now() - this.connectStartedAt
        this.opts.onMetric?.('connection', 1, { outcome: 'synced' })
        this.opts.onMetric?.('time_to_sync', this.lastReconnectSyncMs)
        if (this.hadSynced) {
          this.opts.onMetric?.('reconnect')
          if (this.lostAt !== null) this.opts.onMetric?.('offline_seconds', (performance.now() - this.lostAt) / 1000)
        }
        this.hadSynced = true
        this.lostAt = null
        this.startPinging()
        this.setStatus('connected')
        this.emit()
      }
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        this,
      )
    } else if (type === MSG_CHAT) {
      try {
        const message = JSON.parse(decoding.readVarString(decoder)) as ChatMessage
        this.chatListeners.forEach((fn) => fn({ type: 'message', message }))
      } catch { /* a malformed message from the server is ignored */ }
    } else if (type === MSG_VERSION_SAVED) {
      const cid = decoding.readVarString(decoder)
      this.settleVersion(cid, { version: decoding.readVarUint(decoder) })
    } else if (type === MSG_VERSION_ERROR) {
      const cid = decoding.readVarString(decoder)
      this.settleVersion(cid, { error: VERSION_REFUSALS[decoding.readVarString(decoder)] ?? VERSION_REFUSALS.unavailable })
    } else if (type === MSG_CHAT_ERROR) {
      const cid = decoding.readVarString(decoder)
      const code = decoding.readVarString(decoder) as ChatErrorCode
      this.chatListeners.forEach((fn) => fn({ type: 'error', cid, code }))
    } else if (type === MSG_PONG) {
      // The gateway echoed our timestamp: the difference is the round trip
      const echoed = decoding.readFloat64(decoding.createDecoder(decoding.readVarUint8Array(decoder)))
      // Skip the sample if the tab was hidden meanwhile: delivery of the reply can be delayed
      // by throttling and the number would describe the browser, not the connection.
      if (typeof document === 'undefined' || document.visibilityState === 'visible') this.opts.onMetric?.('rtt', performance.now() - echoed)
    }
  }

  // Every few seconds, ask the gateway to echo a timestamp back. Measures how fast the
  // whole path (browser, network, gateway) answers, including any simulated delay.
  private startPinging() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = setInterval(() => {
      // A hidden tab has its timers throttled by the browser, which would make a healthy
      // connection look slow. Only measure while the page is visible.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const payload = encoding.createEncoder()
      encoding.writeFloat64(payload, performance.now())
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_PING)
      encoding.writeVarUint8Array(enc, encoding.toUint8Array(payload))
      this.send(encoding.toUint8Array(enc))
    }, PING_EVERY_MS)
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return // came from the server, don't send it back
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeUpdate(enc, update)
    this.send(encoding.toUint8Array(enc))
    // If we're offline this is dropped here on purpose: the update is already
    // in the doc (and IndexedDB), and the handshake on reconnect will send it.
  }

  // Presence changes often (every cursor move). Batch them: at most one
  // message per throttle window.
  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this || origin === 'disconnect') return
    for (const id of [...added, ...updated, ...removed]) {
      if (id === this.doc.clientID) this.pendingAwareness.add(id)
    }
    if (this.awarenessTimer || this.pendingAwareness.size === 0) return
    this.awarenessTimer = setTimeout(() => {
      this.awarenessTimer = null
      const ids = [...this.pendingAwareness]
      this.pendingAwareness.clear()
      this.send(this.encodeAwareness(ids))
    }, this.opts.presenceThrottleMs ?? 80)
  }

  private encodeAwareness(ids: number[]) {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_AWARENESS)
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids))
    return encoding.toUint8Array(enc)
  }

  private onUnload = () => {
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'unload')
  }

  // ---- low level ---------------------------------------------------------------

  private send(msg: Uint8Array) {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN || this.partitioned) return
    if (this.latencyMs > 0) setTimeout(() => ws.readyState === WebSocket.OPEN && ws.send(msg), this.latencyMs)
    else ws.send(msg)
  }

  // Delay incoming messages too when simulating latency (same delay keeps order)
  private deliver(fn: () => void) {
    if (this.partitioned) return
    if (this.latencyMs > 0) setTimeout(fn, this.latencyMs)
    else fn()
  }

  private setStatus(s: Status) {
    if (this.status === s) return
    this.status = s
    this.emit()
  }
  private emit() {
    this.listeners.forEach((fn) => fn())
  }
}

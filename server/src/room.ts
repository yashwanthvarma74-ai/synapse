// A Room is one open document on this gateway: the Yjs doc, the awareness
// (cursors, presence) and the sockets connected to it.
import type { WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import type { Bus } from './bus.js'
import type { DocStore } from './store.js'
import { m } from './telemetry.js'
import { logger } from './logger.js'

export const MSG_SYNC = 0
export const MSG_AWARENESS = 1
export const MSG_PING = 2 // client -> gateway: [2, bytes]
export const MSG_PONG = 3 // gateway -> client: the same bytes, echoed

export type Role = 'owner' | 'editor' | 'commenter' | 'viewer'
export const canWrite = (role: Role) => role === 'owner' || role === 'editor'

// Origins tag where a change came from, so we never echo it back to its source.
const ORIGIN_STORE = 'store'
const ORIGIN_BUS = 'bus'

interface Conn {
  role: Role
  userId: string
  awarenessIds: Set<number>
}

export interface RoomOptions {
  docId: string
  store: DocStore
  bus: Bus
  compactEvery: number
  onEmpty: (room: Room) => void
  // Called a moment after edits stop (debounced). Used to refresh the search index.
  onSettled?: (docId: string, doc: Y.Doc) => void
}

export class Room {
  readonly doc = new Y.Doc()
  readonly awareness = new awarenessProtocol.Awareness(this.doc)
  readonly conns = new Map<WebSocket, Conn>()
  closed = false
  private updatesSinceSnapshot = 0
  private unsubscribeBus: () => void = () => {}
  private writeChain: Promise<void> = Promise.resolve()
  private settleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private opts: RoomOptions) {
    // The server has no cursor of its own
    this.awareness.setLocalState(null)
    this.doc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
    this.unsubscribeBus = opts.bus.subscribe(opts.docId, this.onBusMessage)
  }

  // Rebuild the doc from storage: snapshot first, then the newer updates.
  async load() {
    const { snapshot, updates } = await this.opts.store.load(this.opts.docId)
    if (snapshot) Y.applyUpdate(this.doc, snapshot, ORIGIN_STORE)
    for (const u of updates) Y.applyUpdate(this.doc, u, ORIGIN_STORE)
    this.updatesSinceSnapshot = updates.length
  }

  // ---- connections ------------------------------------------------------

  addConn(ws: WebSocket, role: Role, userId: string) {
    this.conns.set(ws, { role, userId, awarenessIds: new Set() })

    // Start the sync handshake: "here is my state vector, send me what I'm missing".
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeSyncStep1(enc, this.doc)
    this.send(ws, encoding.toUint8Array(enc))

    // Tell the newcomer who is already here.
    const states = this.awareness.getStates()
    if (states.size > 0) {
      const aw = encoding.createEncoder()
      encoding.writeVarUint(aw, MSG_AWARENESS)
      encoding.writeVarUint8Array(
        aw,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]),
      )
      this.send(ws, encoding.toUint8Array(aw))
    }
  }

  removeConn(ws: WebSocket) {
    const conn = this.conns.get(ws)
    if (!conn) return
    this.conns.delete(ws)
    // Remove this socket's cursors so ghosts don't linger for other users
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.awarenessIds], null)
    if (this.conns.size === 0) this.opts.onEmpty(this)
  }

  // Re-check roles of open sockets (after an access change, and on a timer).
  // resolve() returns the user's current role, or null if access was removed.
  async recheck(resolve: (userId: string) => Promise<Role | null>, onlyUserId?: string) {
    for (const [ws, conn] of [...this.conns]) {
      if (onlyUserId && conn.userId !== onlyUserId) continue
      const role = await resolve(conn.userId).catch(() => conn.role) // on error keep the old role
      if (role === null) {
        m.revocations.add(1)
        ws.close(4403, 'access revoked')
      }
      else conn.role = role // takes effect on the very next message
    }
  }

  // ---- incoming messages -------------------------------------------------

  handleMessage(ws: WebSocket, data: Uint8Array) {
    const conn = this.conns.get(ws)
    if (!conn) return
    const started = performance.now()
    try {
      this.handle(ws, conn, data)
    } finally {
      m.handleDuration.record(performance.now() - started)
    }
  }

  private handle(ws: WebSocket, conn: Conn, data: Uint8Array) {
    const decoder = decoding.createDecoder(data)
    const type = decoding.readVarUint(decoder)

    if (type === MSG_PING) {
      // A browser measures its round trip to the gateway: we just echo what it sent
      m.messages.add(1, { kind: 'ping' })
      const echo = encoding.createEncoder()
      encoding.writeVarUint(echo, MSG_PONG)
      encoding.writeVarUint8Array(echo, decoding.readVarUint8Array(decoder))
      this.send(ws, encoding.toUint8Array(echo))
      return
    }

    if (type === MSG_SYNC) {
      // Sub-types: 0 = step1 (state vector), 1 = step2 (diff), 2 = update.
      // Step2 and update carry writes. Role is checked here, on EVERY message,
      // so revoking access takes effect immediately.
      const syncType = decoding.peekVarUint(decoder)
      const isWrite = syncType !== syncProtocol.messageYjsSyncStep1
      m.messages.add(1, { kind: syncType === syncProtocol.messageYjsSyncStep1 ? 'sync_step1' : syncType === syncProtocol.messageYjsSyncStep2 ? 'sync_step2' : 'sync_update' })
      if (isWrite) m.updateSize.record(data.length)
      if (isWrite && !canWrite(conn.role)) {
        m.writesDropped.add(1, { role: conn.role })
        return // drop the write silently
      }

      const reply = encoding.createEncoder()
      encoding.writeVarUint(reply, MSG_SYNC)
      syncProtocol.readSyncMessage(decoder, reply, this.doc, ws)
      // If the message asked a question (step1), reply holds the answer (step2)
      if (encoding.length(reply) > 1) this.send(ws, encoding.toUint8Array(reply))
    } else if (type === MSG_AWARENESS) {
      m.messages.add(1, { kind: 'awareness' })
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        ws,
      )
    }
  }

  // ---- outgoing: doc changes -> sockets, store and bus ---------------------

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeUpdate(enc, update)
    const msg = encoding.toUint8Array(enc)

    // Everyone gets it (including the sender: harmless, Yjs ignores duplicates)
    for (const ws of this.conns.keys()) this.send(ws, msg)

    if (origin === ORIGIN_STORE) return // just loaded from disk, don't write it back
    if (origin !== ORIGIN_BUS) {
      this.opts.bus.publish(this.opts.docId, msg) // tell the other gateways
      this.persist(update) // the gateway that received the edit is the one that stores it
      this.scheduleSettled()
    }
  }

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    const changed = [...added, ...updated, ...removed]
    // Remember which awareness ids belong to which socket, for cleanup on close
    if (origin && typeof origin === 'object' && this.conns.has(origin as WebSocket)) {
      const conn = this.conns.get(origin as WebSocket)!
      added.forEach((id) => conn.awarenessIds.add(id))
      removed.forEach((id) => conn.awarenessIds.delete(id))
    }
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_AWARENESS)
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
    )
    const msg = encoding.toUint8Array(enc)
    for (const ws of this.conns.keys()) this.send(ws, msg)
    if (origin !== ORIGIN_BUS) this.opts.bus.publish(this.opts.docId, msg)
  }

  // A message from another gateway: apply it as if a local client sent it.
  private onBusMessage = (message: Uint8Array) => {
    try {
      const decoder = decoding.createDecoder(message)
      const type = decoding.readVarUint(decoder)
      if (type === MSG_SYNC) {
        syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), this.doc, ORIGIN_BUS)
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), ORIGIN_BUS)
      }
    } catch (err) {
      logger.error({ docId: this.opts.docId, err: (err as Error).message }, 'ignored a malformed relay message')
    }
  }

  // ---- persistence ---------------------------------------------------------

  // Writes are chained so they hit the store in order.
  // If the database is unreachable the edit still reached everyone live, but it
  // is NOT stored. Rather than queue every missed update (unbounded memory), we
  // remember only that the room is "dirty". When the database answers again we
  // write the room's WHOLE current state as one update. Updates are idempotent, so
  // writing state that is already stored is harmless, and nothing typed during the
  // outage is lost as long as this gateway stays up. (If it dies first, the clients
  // still hold the edits and resend them on reconnect: see fault test F3.)
  private dirty = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = 1000

  private persist(update: Uint8Array) {
    this.writeChain = this.writeChain.then(async () => {
      if (this.dirty) return // the retry will write everything, this update included
      const t0 = performance.now()
      try {
        await this.opts.store.appendUpdate(this.opts.docId, update)
        m.persistDuration.record(performance.now() - t0)
      } catch (err) {
        m.persistFailures.add(1)
        return this.markDirty(err)
      }
      this.updatesSinceSnapshot++
      if (this.updatesSinceSnapshot >= this.opts.compactEvery) {
        try {
          // Compact: merge snapshot + log into a new snapshot and trim the log.
          await this.opts.store.compact(this.opts.docId)
          this.updatesSinceSnapshot = 0
          m.compactions.add(1, { result: 'ok' })
        } catch (err) {
          m.compactions.add(1, { result: 'failed' })
          logger.error({ docId: this.opts.docId, err: (err as Error).message }, 'compaction failed (will retry at the next threshold)')
        }
      }
    })
  }

  private markDirty(err: unknown) {
    if (!this.dirty) {
      logger.error({ docId: this.opts.docId, err: (err as Error).message }, 'database unavailable, will retry saving')
      m.dirtyRooms.add(1)
    }
    this.dirty = true
    if (this.retryTimer || this.closed) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.writeChain = this.writeChain.then(() => this.saveFullState())
    }, this.retryDelay)
    this.retryTimer.unref()
    this.retryDelay = Math.min(this.retryDelay * 2, 10_000) // back off, cap at 10 s
  }

  private async saveFullState() {
    if (!this.dirty) return
    try {
      await this.opts.store.appendUpdate(this.opts.docId, Y.encodeStateAsUpdate(this.doc))
      this.dirty = false
      m.dirtyRooms.add(-1)
      this.retryDelay = 1000
      this.updatesSinceSnapshot++
      logger.warn({ docId: this.opts.docId }, 'database back, saved the full state')
    } catch (err) {
      this.markDirty(err)
    }
  }

  // Re-read the stored state and merge it in. Fixes any update this gateway missed
  // (a lost Redis relay message, a subscription gap). Safe to run any time: merging
  // data we already have changes nothing, and new data is sent on to our clients.
  async resync() {
    if (this.closed) return
    try {
      const { snapshot, updates } = await this.opts.store.load(this.opts.docId)
      if (snapshot) Y.applyUpdate(this.doc, snapshot, ORIGIN_STORE)
      for (const u of updates) Y.applyUpdate(this.doc, u, ORIGIN_STORE)
    } catch (err) {
      logger.error({ docId: this.opts.docId, err: (err as Error).message }, 'resync failed') // try again next time
    }
  }

  private scheduleSettled() {
    if (!this.opts.onSettled) return
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => this.opts.onSettled?.(this.opts.docId, this.doc), 3000)
    this.settleTimer.unref()
  }

  flush() {
    return this.writeChain
  }

  private send(ws: WebSocket, msg: Uint8Array) {
    if (ws.readyState === ws.OPEN) ws.send(msg, (err) => err && ws.terminate())
  }

  async destroy() {
    this.unsubscribeBus()
    if (this.settleTimer) {
      clearTimeout(this.settleTimer)
      this.opts.onSettled?.(this.opts.docId, this.doc) // last chance to index final edits
    }
    await this.flush()
    if (this.dirty) await this.saveFullState() // last try before letting go of the data
    if (this.dirty) {
      logger.error({ docId: this.opts.docId }, 'EDITS NOT SAVED: room closed while the database was unavailable')
      this.dirty = false
      m.dirtyRooms.add(-1) // keep the gauge honest: this room no longer holds unsaved edits (it was dropped)
    }
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.awareness.destroy()
    this.doc.destroy()
  }
}

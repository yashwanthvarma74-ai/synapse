// The gateway: accepts WebSockets at /collab/<docId>, checks who the user is,
// and hands each socket to the Room for that document. It holds no truth of its
// own: the store does, so any gateway can serve any room.
import http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { Room, type Role } from './room.js'
import type { Bus } from './bus.js'
import type { DocStore } from './store.js'
import { m, observeGauge } from './telemetry.js'

export interface AuthResult {
  userId: string
  role: Role
}

// Called when a socket tries to join a room. Return null to reject.
export type Authorize = (req: {
  docId: string
  url: URL
}) => Promise<AuthResult | null> | AuthResult | null

export interface GatewayOptions {
  port: number
  store: DocStore
  bus: Bus
  authorize: Authorize
  compactEvery?: number
  idleMs?: number
  // Current role of a user on a doc (null = no access). Enables live revocation.
  resolveRole?: (userId: string, docId: string) => Promise<Role | null>
  recheckMs?: number
  // Anti-entropy: every resyncMs each open room re-reads the store, so a missed relay
  // message heals on its own. 0 turns it off.
  resyncMs?: number
  onSettled?: (docId: string, doc: import('yjs').Doc) => void
}

export function createGateway(opts: GatewayOptions) {
  const rooms = new Map<string, Promise<Room>>()
  const stopRoomsGauge = observeGauge('synapse_gateway_open_rooms', 'Documents currently open on this gateway', () => rooms.size)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 })
  const stats = { sockets: 0, joins: 0, rejected: 0, badMessages: 0 }

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, ...stats }))
      return
    }
    res.writeHead(404).end()
  })

  // Rooms that are shutting down. A new room for the same doc waits for the old
  // one to finish saving, so it never loads stale data.
  const closing = new Map<string, Promise<void>>()

  function getRoom(docId: string): Promise<Room> {
    let pending = rooms.get(docId)
    if (!pending) {
      const created: Promise<Room> = (async () => {
        await closing.get(docId)
        const room = new Room({
          docId,
          store: opts.store,
          bus: opts.bus,
          compactEvery: opts.compactEvery ?? 100,
          onSettled: opts.onSettled,
          onEmpty: (r) => {
            // Close the room shortly after the last person leaves. The grace
            // period covers quick refreshes and a join racing with the cleanup.
            setTimeout(() => {
              // Only close once, only if still empty, and only remove OUR map
              // entry (a newer room for the same doc must never be removed).
              if (r.closed || r.conns.size > 0) return
              r.closed = true
              if (rooms.get(docId) === created) rooms.delete(docId)
              const done = r.destroy().finally(() => {
                if (closing.get(docId) === done) closing.delete(docId)
              })
              closing.set(docId, done)
            }, opts.idleMs ?? 5_000).unref()
          },
        })
        await room.load()
        return room
      })()
      pending = created
      rooms.set(docId, pending)
    }
    return pending
  }

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const match = url.pathname.match(/^\/collab\/([\w-]{1,64})$/)
    if (!match) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      return socket.destroy()
    }
    const docId = match[1]
    // Auth runs BEFORE the upgrade, so unauthorised clients never get a socket
    const auth = await Promise.resolve(opts.authorize({ docId, url })).catch(() => null)
    if (!auth) {
      m.joins.add(1, { result: 'rejected' })
      stats.rejected++
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      return socket.destroy()
    }
    wss.handleUpgrade(req, socket, head, (ws) => void onConnection(ws, docId, auth))
  })

  async function onConnection(ws: WebSocket, docId: string, auth: AuthResult) {
    ws.binaryType = 'nodebuffer'
    // Messages that arrive while the room is still loading must not be lost
    const buffered: Uint8Array[] = []
    let room: Room | null = null
    // A socket error (for example a message over the size limit) must never be an
    // uncaught exception: that would take the whole gateway down for everyone.
    ws.on('error', () => ws.terminate())
    // Anything a client sends is untrusted. A malformed message closes THAT socket and
    // nothing else.
    const handle = (r: Room, bytes: Uint8Array) => {
      try {
        r.handleMessage(ws, bytes)
      } catch {
        stats.badMessages++
        m.badMessages.add(1)
        ws.close(1003, 'malformed message')
      }
    }
    ws.on('message', (data: Buffer) => {
      const bytes = new Uint8Array(data)
      if (room) handle(room, bytes)
      else buffered.push(bytes)
    })
    ws.on('close', () => {
      stats.sockets--
      m.sockets.add(-1)
      room?.removeConn(ws)
    })

    // Heartbeat: drop connections that stopped answering
    let alive = true
    ws.on('pong', () => (alive = true))
    const ping = setInterval(() => {
      if (!alive) return ws.terminate()
      alive = false
      ws.ping()
    }, 30_000)
    ws.on('close', () => clearInterval(ping))

    stats.sockets++
    stats.joins++
    m.sockets.add(1)
    m.joins.add(1, { result: 'accepted' })
    room = await getRoom(docId)
    if (room.closed) room = await getRoom(docId) // raced with a shutdown: get the fresh room
    if (ws.readyState !== ws.OPEN) return // closed while the room was loading
    room.addConn(ws, auth.role, auth.userId)
    for (const m of buffered) handle(room, m)
  }

  // Live access control: re-check open sockets when the API says access changed,
  // and every recheckMs as a safety net in case an event was missed.
  const recheckAll = (userId?: string) => {
    const resolveRole = opts.resolveRole
    if (!resolveRole) return
    for (const [docId, pending] of rooms) {
      void pending.then((room) => room.recheck((u) => resolveRole(u, docId), userId))
    }
  }
  const resyncAll = (reason: 'reconnect' | 'periodic' = 'periodic') => {
    for (const pending of rooms.values()) {
      void pending.then((room) => {
        m.resyncs.add(1, { reason })
        return room.resync()
      })
    }
  }
  const offResync = opts.bus.onResync(() => resyncAll('reconnect'))
  const resyncEvery = opts.resyncMs ?? 60_000
  const resyncTimer = resyncEvery > 0 ? setInterval(() => resyncAll('periodic'), resyncEvery) : null
  resyncTimer?.unref()
  const offAccess = opts.bus.onAccess((e) => recheckAll(e.userId))
  const timer = setInterval(() => recheckAll(), opts.recheckMs ?? 30_000)
  timer.unref()

  return {
    server,
    recheckAll,
    resyncAll,
    rooms,
    stats,
    listen: () =>
      new Promise<number>((resolve) =>
        server.listen(opts.port, () => {
          const addr = server.address()
          resolve(typeof addr === 'object' && addr ? addr.port : opts.port)
        }),
      ),
    async close() {
      clearInterval(timer)
      if (resyncTimer) clearInterval(resyncTimer)
      offResync()
      offAccess()
      stopRoomsGauge()
      for (const ws of wss.clients) ws.terminate()
      await new Promise((r) => server.close(r))
      for (const p of rooms.values()) {
        const r = await p
        if (!r.closed) {
          r.closed = true
          await r.destroy()
        }
      }
      await Promise.all(closing.values())
    },
  }
}

// k6 load test: many editors in ONE document, over real WebSockets, speaking the Yjs sync protocol.
//
//   cd load/k6 && npm run build
//   k6 run -e EDITORS=50 -e SECONDS=30 -e RATE=2 editors.js
//
// Every virtual user: becomes a guest, joins the workspace through an invite link, opens the
// document's WebSocket, then types RATE edits a second. Each edit carries a timestamp, so every
// other editor can measure how long the edit took to reach it (same machine, same clock).
import http from 'k6/http'
import { WebSocket } from 'k6/websockets'
import { Counter, Trend } from 'k6/metrics'
import { check } from 'k6'
import { Y, syncProtocol, encoding, decoding } from './dist/yjs.js'

const API = __ENV.API_URL || 'http://127.0.0.1:4201'
const GATEWAY = __ENV.GATEWAY_URL || 'ws://127.0.0.1:4200'
const EDITORS = Number(__ENV.EDITORS || 50)
const SECONDS = Number(__ENV.SECONDS || 30)
const RATE = Number(__ENV.RATE || 2)

const updateDelay = new Trend('update_delay_ms', true)
const sent = new Counter('edits_sent')
const received = new Counter('edits_received')
const connected = new Counter('sockets_connected')

export const options = {
  scenarios: {
    editors: { executor: 'per-vu-iterations', vus: EDITORS, iterations: 1, maxDuration: `${SECONDS + 60}s` },
  },
  thresholds: {
    // the targets from the brief
    update_delay_ms: ['p(95)<250'],
    sockets_connected: [`count>=${EDITORS}`],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
}

const json = { headers: { 'content-type': 'application/json' } }
const bearer = (t) => ({ headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` } })

export function setup() {
  const owner = http.post(`${API}/auth/guest`, '{}', json).json()
  const wid = owner.starter.workspaceId
  const invite = http.post(`${API}/workspaces/${wid}/invites`, JSON.stringify({ role: 'editor' }), bearer(owner.token)).json()
  return { docId: owner.starter.welcomeId, code: invite.code }
}

export default async function (data) {
  const guest = http.post(`${API}/auth/guest`, '{}', json).json()
  const accepted = http.post(`${API}/invites/${data.code}/accept`, '{}', bearer(guest.token))
  if (!check(accepted, { 'joined the workspace': (r) => r.status === 200 })) return

  const doc = new Y.Doc()
  const id = `vu${__VU}`
  const ping = doc.getMap('ping')
  let seq = 0

  // an edit from someone else: how long did it take to arrive?
  ping.observe((ev, tx) => {
    if (tx.origin !== 'remote') return
    ev.keysChanged.forEach((k) => {
      const v = ping.get(k)
      if (k !== id && v) {
        updateDelay.add(Date.now() - v.t)
        received.add(1)
      }
    })
  })

  const ws = new WebSocket(`${GATEWAY}/collab/${data.docId}?token=${guest.token}`)
  ws.binaryType = 'arraybuffer'
  let timer

  ws.onopen = () => {
    connected.add(1)
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, 0) // 0 = sync message
    syncProtocol.writeSyncStep1(enc, doc)
    ws.send(encoding.toUint8Array(enc))
    // our own edits go out as they happen
    doc.on('update', (update, origin) => {
      if (origin === 'remote') return
      const out = encoding.createEncoder()
      encoding.writeVarUint(out, 0)
      syncProtocol.writeUpdate(out, update)
      ws.send(encoding.toUint8Array(out))
    })
    // random start so the editors do not all fire in the same instant
    setTimeout(() => {
      timer = setInterval(() => {
        ping.set(id, { seq: ++seq, t: Date.now() })
        sent.add(1)
      }, 1000 / RATE)
    }, Math.random() * (1000 / RATE))
    setTimeout(() => {
      clearInterval(timer)
      setTimeout(() => ws.close(), 1500) // let in-flight edits arrive
    }, SECONDS * 1000)
  }

  ws.onmessage = (e) => {
    const dec = decoding.createDecoder(new Uint8Array(e.data))
    if (decoding.readVarUint(dec) !== 0) return // presence and pings are not what we measure
    const reply = encoding.createEncoder()
    encoding.writeVarUint(reply, 0)
    syncProtocol.readSyncMessage(dec, reply, doc, 'remote')
    if (encoding.length(reply) > 1) ws.send(encoding.toUint8Array(reply))
  }
  ws.onerror = (e) => console.error(`vu${__VU} websocket error: ${e.error ? e.error() : e}`)

  // keep this iteration alive until the socket closes (not sleep(): that would hold up the timers)
  await new Promise((resolve) => { ws.onclose = resolve })
}

// Outside-in uptime probe. Run it from somewhere that is not the server (a cron job, GitHub Actions,
// any uptime service that can run a command). It checks three things a real user depends on:
//   1. the API answers /health
//   2. the gateway answers /health
//   3. (if a canary token and document are given) a real sync: open the WebSocket, run the Yjs
//      handshake and get the document's state back. A server can pass the first two and still be
//      unable to sync, so this is the check that matches "can people actually collaborate".
// Prints one JSON line and exits 1 if anything failed. Never prints the token.
//
//   SYNAPSE_API_URL=https://api.example.com SYNAPSE_GATEWAY_URL=wss://gateway.example.com \
//   SYNAPSE_CANARY_TOKEN=... SYNAPSE_CANARY_DOC=... npx tsx ops/uptime.ts
import WebSocket from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

export interface ProbeConfig { apiUrl: string; gatewayUrl: string; canaryToken?: string; canaryDoc?: string; timeoutMs?: number }
interface Check { name: string; ok: boolean; ms: number; error?: string }
export interface ProbeResult { ok: boolean; at: string; checks: Check[] }

const httpBase = (url: string) => url.replace(/^ws/, 'http').replace(/\/$/, '')

async function timed(name: string, fn: () => Promise<void>): Promise<Check> {
  const t0 = performance.now()
  try {
    await fn()
    return { name, ok: true, ms: Math.round(performance.now() - t0) }
  } catch (err) {
    return { name, ok: false, ms: Math.round(performance.now() - t0), error: (err as Error).message }
  }
}

async function health(url: string, timeoutMs: number) {
  const res = await fetch(`${httpBase(url)}/health`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as { ok?: boolean }
  if (!body.ok) throw new Error('health said not ok')
}

function realSync(gatewayUrl: string, doc: string, token: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ydoc = new Y.Doc()
    const ws = new WebSocket(`${gatewayUrl.replace(/\/$/, '')}/collab/${doc}?token=${encodeURIComponent(token)}`)
    ws.binaryType = 'nodebuffer'
    const fail = (e: Error) => { clearTimeout(timer); ws.terminate(); reject(e) }
    const timer = setTimeout(() => fail(new Error(`no sync within ${timeoutMs} ms`)), timeoutMs)
    ws.on('error', (e) => fail(new Error(`websocket: ${e.message}`)))
    ws.on('close', (code) => fail(new Error(`closed before syncing (code ${code})`)))
    ws.on('open', () => {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, 0)
      syncProtocol.writeSyncStep1(enc, ydoc)
      ws.send(encoding.toUint8Array(enc))
    })
    ws.on('message', (data: Buffer) => {
      const dec = decoding.createDecoder(new Uint8Array(data))
      if (decoding.readVarUint(dec) !== 0) return
      const reply = encoding.createEncoder()
      encoding.writeVarUint(reply, 0)
      if (syncProtocol.readSyncMessage(dec, reply, ydoc, 'probe') === syncProtocol.messageYjsSyncStep2) {
        clearTimeout(timer)
        ws.removeAllListeners('close')
        ws.close()
        resolve()
      }
    })
  })
}

export async function probe(cfg: ProbeConfig): Promise<ProbeResult> {
  const timeout = cfg.timeoutMs ?? 5000
  const checks = await Promise.all([
    timed('api', () => health(cfg.apiUrl, timeout)),
    timed('gateway', () => health(cfg.gatewayUrl, timeout)),
    ...(cfg.canaryToken && cfg.canaryDoc ? [timed('sync', () => realSync(cfg.gatewayUrl, cfg.canaryDoc!, cfg.canaryToken!, timeout))] : []),
  ])
  return { ok: checks.every((c) => c.ok), at: new Date().toISOString(), checks }
}

// Run as a command (not when imported by the tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  const need = (k: string) => process.env[k] ?? (console.error(`Set ${k}`), process.exit(2))
  const result = await probe({
    apiUrl: need('SYNAPSE_API_URL'), gatewayUrl: need('SYNAPSE_GATEWAY_URL'),
    canaryToken: process.env.SYNAPSE_CANARY_TOKEN, canaryDoc: process.env.SYNAPSE_CANARY_DOC,
    timeoutMs: Number(process.env.TIMEOUT_MS ?? 5000),
  })
  console.log(JSON.stringify(result))
  process.exit(result.ok ? 0 : 1)
}

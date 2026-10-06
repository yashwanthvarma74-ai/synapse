import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createGateway } from '../src/gateway.js'
import { NoBus } from '../src/bus.js'
import { MemoryStore } from '../src/store.js'
import { probe } from '../ops/uptime.js'

const closers: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const c of closers.splice(0)) await c() })

async function gateway(authorize: Parameters<typeof createGateway>[0]['authorize'] = () => ({ userId: 'canary', role: 'viewer' })) {
  const g = createGateway({ port: 0, store: new MemoryStore(), bus: new NoBus(), authorize })
  const port = await g.listen()
  closers.push(() => g.close())
  return port
}
async function fakeApi(status = 200) {
  const s = http.createServer((_q, r) => { r.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: status === 200 })) })
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  closers.push(() => new Promise<void>((r) => s.close(() => r())))
  return (s.address() as { port: number }).port
}

describe('uptime probe', () => {
  it('passes all three checks against a healthy system, including a real sync', async () => {
    const gw = await gateway(), api = await fakeApi()
    const r = await probe({ apiUrl: `http://127.0.0.1:${api}`, gatewayUrl: `ws://127.0.0.1:${gw}`, canaryToken: 't', canaryDoc: 'canary-doc' })
    expect(r.checks.map((c) => `${c.name}:${c.ok}`)).toEqual(['api:true', 'gateway:true', 'sync:true'])
    expect(r.ok).toBe(true)
  })

  it('without a canary it still checks the two health endpoints (and says it did not test syncing)', async () => {
    const gw = await gateway(), api = await fakeApi()
    const r = await probe({ apiUrl: `http://127.0.0.1:${api}`, gatewayUrl: `ws://127.0.0.1:${gw}` })
    expect(r.checks.map((c) => c.name)).toEqual(['api', 'gateway'])
  })

  it('reports the gateway as the failing part when it is down', async () => {
    const api = await fakeApi()
    const r = await probe({ apiUrl: `http://127.0.0.1:${api}`, gatewayUrl: 'ws://127.0.0.1:1', canaryToken: 't', canaryDoc: 'd', timeoutMs: 1000 })
    expect(r.ok).toBe(false)
    expect(r.checks.find((c) => c.name === 'api')!.ok).toBe(true)
    expect(r.checks.find((c) => c.name === 'gateway')!.ok).toBe(false)
    expect(r.checks.find((c) => c.name === 'sync')!.ok).toBe(false)
  })

  it('catches the case /health cannot: the gateway is up but refuses to sync (bad token)', async () => {
    const gw = await gateway(() => null as never), api = await fakeApi()
    const r = await probe({ apiUrl: `http://127.0.0.1:${api}`, gatewayUrl: `ws://127.0.0.1:${gw}`, canaryToken: 'expired', canaryDoc: 'd', timeoutMs: 2000 })
    expect(r.checks.find((c) => c.name === 'gateway')!.ok).toBe(true) // looks healthy...
    expect(r.checks.find((c) => c.name === 'sync')!.ok).toBe(false) // ...but nobody can collaborate
    expect(r.ok).toBe(false)
  })

  it('treats an unhealthy API as a failure', async () => {
    const gw = await gateway(), api = await fakeApi(503)
    const r = await probe({ apiUrl: `http://127.0.0.1:${api}`, gatewayUrl: `ws://127.0.0.1:${gw}` })
    expect(r.checks.find((c) => c.name === 'api')).toMatchObject({ ok: false, error: 'HTTP 503' })
  })

  it('never puts the token in its output', async () => {
    const r = await probe({ apiUrl: 'http://127.0.0.1:1', gatewayUrl: 'ws://127.0.0.1:1', canaryToken: 'SECRET-TOKEN-VALUE', canaryDoc: 'd', timeoutMs: 500 })
    expect(JSON.stringify(r)).not.toContain('SECRET-TOKEN-VALUE')
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import WebSocket from 'ws'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { AggregationTemporality, InMemoryMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { initTelemetry, recordClientMetric, type TelemetryHandle } from '../src/telemetry.js'
import { MongoStore } from '../src/mongoStore.js'
import { collections, ensureIndexes } from '../src/db.js'
import { createApi } from '../src/api.js'
import { createGateway } from '../src/gateway.js'
import { NoBus } from '../src/bus.js'
import { MemoryStore } from '../src/store.js'
import { makeAuthorize, roleOnDocument } from '../src/access.js'
import { TestClient, waitFor } from './helpers.js'

const SECRET = 'telemetry-secret-telemetry-secret-0123456789'
const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
let telemetry: TelemetryHandle
let store: MongoStore

// Read the CURRENT value of a metric: sum over its data points that match `where`
async function read(name: string, where: Record<string, string> = {}) {
  await telemetry.reader.forceFlush()
  const all = exporter.getMetrics().at(-1)?.scopeMetrics.flatMap((s) => s.metrics) ?? []
  const metric = all.find((x) => x.descriptor.name === name)
  if (!metric) return 0
  return metric.dataPoints
    .filter((p) => Object.entries(where).every(([k, v]) => p.attributes[k] === v))
    .reduce((sum, p) => sum + (typeof p.value === 'number' ? p.value : (p.value as { count: number }).count), 0)
}
async function allAttributes() {
  await telemetry.reader.forceFlush()
  const all = exporter.getMetrics().at(-1)?.scopeMetrics.flatMap((s) => s.metrics) ?? []
  return all.flatMap((x) => x.dataPoints.flatMap((p) => Object.values(p.attributes).map(String)))
}

beforeAll(async () => {
  telemetry = initTelemetry({ serviceName: 'test', reader: new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 }) })
  store = new MongoStore('mongodb://127.0.0.1:27017', `synapse_test_tel_${Date.now()}`)
  await store.init()
})
afterAll(async () => {
  await telemetry.shutdown()
  await store.db.dropDatabase()
  await store.close()
})

describe('browser-reported metrics are strictly validated', () => {
  it('accepts known names with sane values and counts the rest as rejected', async () => {
    const before = await read('synapse_client_events_rejected')
    expect(recordClientMetric('rtt', 12.5)).toBe(true)
    expect(recordClientMetric('connection', 1, { outcome: 'synced' })).toBe(true)
    expect(recordClientMetric('does_not_exist', 1)).toBe(false) // unknown name
    expect(recordClientMetric('rtt', Number.NaN)).toBe(false)
    expect(recordClientMetric('rtt', -5)).toBe(false)
    expect(recordClientMetric('rtt', 1e9)).toBe(false) // absurdly large
    expect(recordClientMetric('rtt', '12')).toBe(false) // wrong type
    expect(recordClientMetric('connection', 1, { outcome: 'banana' })).toBe(false) // label value not allowed
    expect(recordClientMetric('connection', 1)).toBe(false) // required label missing
    expect(recordClientMetric('rtt', 5, { userId: 'abc' })).toBe(false) // a label that must not exist
    expect(await read('synapse_client_events_rejected')).toBe(before + 8)
    expect(await read('synapse_client_gateway_rtt')).toBe(1)
    expect(await read('synapse_client_connections', { outcome: 'synced' })).toBe(1)
  })
})

describe('gateway metrics', () => {
  it('counts joins, open sockets, dropped writes, the ping echo and bad messages', async () => {
    const gw = createGateway({
      port: 0, store: new MemoryStore(), bus: new NoBus(), idleMs: 20,
      authorize: ({ url }) => (url.searchParams.get('deny') ? null : { userId: 'u', role: (url.searchParams.get('role') ?? 'editor') as 'editor' | 'viewer' }),
    })
    const port = await gw.listen()
    try {
      const joinsBefore = await read('synapse_gateway_joins', { result: 'accepted' })
      const rejectedBefore = await read('synapse_gateway_joins', { result: 'rejected' })

      const editor = new TestClient(port, 'tel', '?role=editor')
      const viewer = new TestClient(port, 'tel', '?role=viewer')
      await editor.connect(); await viewer.connect()
      await waitFor(() => viewer.synced && editor.synced)
      await expect(new TestClient(port, 'tel', '?deny=1').connect()).rejects.toBeTruthy()

      expect(await read('synapse_gateway_joins', { result: 'accepted' })).toBe(joinsBefore + 2)
      expect(await read('synapse_gateway_joins', { result: 'rejected' })).toBe(rejectedBefore + 1)
      expect(await read('synapse_gateway_open_sockets')).toBe(2)

      // a viewer's write is refused and counted, with the ROLE as the only label
      const droppedBefore = await read('synapse_gateway_writes_dropped', { role: 'viewer' })
      viewer.doc.getText('body').insert(0, 'nope')
      await new Promise((r) => setTimeout(r, 200))
      expect(await read('synapse_gateway_writes_dropped', { role: 'viewer' })).toBeGreaterThan(droppedBefore)

      // ping: the gateway echoes the exact bytes inside a type-3 message
      const raw = new WebSocket(`ws://127.0.0.1:${port}/collab/tel`)
      await new Promise<void>((res) => raw.on('open', () => res()))
      const reply = new Promise<Uint8Array>((res) => raw.on('message', (d: Buffer) => { const arr = new Uint8Array(d); if (arr[0] === 3) res(arr) }))
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, 2)
      encoding.writeVarUint8Array(enc, new Uint8Array([1, 2, 3, 4]))
      raw.send(encoding.toUint8Array(enc))
      const got = decoding.createDecoder(await reply)
      expect(decoding.readVarUint(got)).toBe(3)
      expect([...decoding.readVarUint8Array(got)]).toEqual([1, 2, 3, 4])
      expect(await read('synapse_gateway_messages', { kind: 'ping' })).toBe(1)

      // a malformed message is counted and closes only that socket
      const badBefore = await read('synapse_gateway_bad_messages')
      raw.send(Buffer.from([1, 255, 255, 255, 255, 15])) // garbage presence message: throws while decoding
      await new Promise((r) => setTimeout(r, 200))
      expect(await read('synapse_gateway_bad_messages')).toBe(badBefore + 1)

      raw.close(); editor.close(); viewer.close()
      await new Promise((r) => setTimeout(r, 200))
      expect(await read('synapse_gateway_open_sockets')).toBe(0)
    } finally {
      await gw.close()
    }
  })

  it('tracks rooms that hold edits the database refused, and clears them when it recovers', async () => {
    const inner = new MemoryStore()
    let down = false
    const flaky = {
      load: (id: string) => inner.load(id),
      compact: (id: string) => inner.compact(id),
      appendUpdate: async (id: string, u: Uint8Array) => { if (down) throw new Error('db down'); return inner.appendUpdate(id, u) },
    }
    const gw = createGateway({ port: 0, store: flaky, bus: new NoBus(), idleMs: 20, authorize: () => ({ userId: 'u', role: 'editor' }) })
    const port = await gw.listen()
    try {
      const c = new TestClient(port, 'dirty-gauge')
      await c.connect()
      c.doc.getText('body').insert(0, 'ok ')
      await new Promise((r) => setTimeout(r, 150))
      const failuresBefore = await read('synapse_gateway_persist_failures')
      down = true
      c.doc.getText('body').insert(3, 'unsaved')
      await new Promise((r) => setTimeout(r, 300))
      expect(await read('synapse_gateway_persist_failures')).toBeGreaterThan(failuresBefore)
      expect(await read('synapse_gateway_dirty_rooms')).toBe(1)
      down = false
      const deadline = Date.now() + 6000
      while ((await read('synapse_gateway_dirty_rooms')) !== 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200))
      expect(await read('synapse_gateway_dirty_rooms')).toBe(0)
      c.close()
    } finally {
      await gw.close()
    }
  })
})

describe('API metrics', () => {
  it('labels requests by route pattern, never by id, and accepts browser timings only when signed in', async () => {
    const c = collections(store.db)
    await ensureIndexes(c)
    const api = createApi({ c, store, bus: new NoBus(), secret: SECRET })
    const reg = await request(api).post('/auth/register').send({ email: 'tel@test.dev', name: 'Tel', password: 'password123' })
    const auth = { Authorization: `Bearer ${reg.body.token}` }
    const ws = (await request(api).post('/workspaces').set(auth).send({ name: 'W' })).body.id
    const doc = (await request(api).post(`/workspaces/${ws}/documents`).set(auth).send({ title: 'D' })).body.id
    await request(api).get(`/documents/${doc}`).set(auth)

    expect(await read('synapse_http_request_duration', { route: '/documents/:id', method: 'GET', status_class: '2xx' })).toBe(1)
    expect(await read('synapse_http_request_duration', { route: '/workspaces/:id/documents' })).toBeGreaterThanOrEqual(1)
    // no real id anywhere in any label of any metric
    const labels = await allAttributes()
    expect(labels.some((v) => /[0-9a-f]{24}/.test(v))).toBe(false)
    expect(labels).not.toContain(reg.body.user.id)

    // browser timings
    expect((await request(api).post('/telemetry').send({ events: [{ n: 'rtt', v: 5 }] })).status).toBe(401)
    const ok = await request(api).post('/telemetry').set(auth).send({ events: [
      { n: 'rtt', v: 20 }, { n: 'keystroke_to_paint', v: 9 }, { n: 'connection', v: 1, l: { outcome: 'attempt' } },
      { n: 'nope', v: 1 }, { n: 'rtt', v: -1 },
    ] })
    expect(ok.body).toEqual({ accepted: 3, rejected: 2 })
    expect((await request(api).post('/telemetry').set(auth).send({ events: new Array(101).fill({ n: 'rtt', v: 1 }) })).status).toBe(400) // too many at once
    expect(await read('synapse_auth_failures', { kind: 'token' })).toBeGreaterThanOrEqual(1)
  })
})

// Hosts like Render give a service ONE port. In single-port mode the gateway's HTTP server hands
// everything that is not the WebSocket upgrade (or /health) to the API, so both share one address.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { MongoStore } from '../src/mongoStore.js'
import { collections, ensureIndexes } from '../src/db.js'
import { createApi } from '../src/api.js'
import { createGateway } from '../src/gateway.js'
import { LocalHub } from '../src/bus.js'
import { makeAuthorize, roleOnDocument } from '../src/access.js'
import { TestClient, waitFor } from './helpers.js'

const SECRET = 'single-port-secret-single-port-secret-0123'
let store: MongoStore
let gateway: ReturnType<typeof createGateway>
let port: number

beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT = '1000'
  store = new MongoStore('mongodb://127.0.0.1:27017', `synapse_test_sp_${Date.now()}`)
  await store.init()
  const c = collections(store.db)
  await ensureIndexes(c)
  const bus = new LocalHub().connect('one')
  const api = createApi({ c, store, bus, secret: SECRET })
  gateway = createGateway({
    port: 0, store, bus,
    authorize: makeAuthorize(c, SECRET),
    resolveRole: (u, d) => roleOnDocument(c, u, d),
    fallback: (req, res) => api(req, res),
  })
  port = await gateway.listen()
})
afterAll(async () => {
  await gateway.close()
  await store.db.dropDatabase()
  await store.close()
})

describe('API and WebSocket gateway on one port', () => {
  const http = () => request(`http://127.0.0.1:${port}`)

  it('answers /health from the gateway and normal routes from the API', async () => {
    expect((await http().get('/health')).body).toMatchObject({ ok: true, rooms: expect.any(Number) })
    expect((await http().get('/config')).body).toEqual({ uploads: false, summaries: false, chat: false })
    const missing = await http().get('/nope')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'Not found' }) // the API's own 404, not the gateway's empty one
  })

  it('a guest can sign in over HTTP and then sync a document over the WebSocket on the same port', async () => {
    const g = await http().post('/auth/guest').send({})
    expect(g.status).toBe(201)
    const doc = g.body.starter.welcomeId as string
    const client = new TestClient(port, doc, `?token=${g.body.token}`)
    await client.connect()
    await waitFor(() => client.synced)
    client.doc.getText('body').insert(0, 'hi') // an edit goes through too
    client.close()
  })

  it('refuses a WebSocket with no token on that port', async () => {
    const bad = new TestClient(port, 'a'.repeat(24), '')
    await expect(bad.connect().then(() => waitFor(() => bad.synced, 800))).rejects.toBeDefined()
  })

  it('CORS and rate limiting still apply to the API routes', async () => {
    const r = await http().options('/auth/guest').set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'POST')
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:3000')
  })
})

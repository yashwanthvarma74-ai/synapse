import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { MongoStore } from '../src/mongoStore.js'
import { collections, ensureIndexes } from '../src/db.js'
import { createApi } from '../src/api.js'
import { createGateway } from '../src/gateway.js'
import { LocalHub } from '../src/bus.js'
import { makeAuthorize, roleOnDocument } from '../src/access.js'
import { TestClient, waitFor } from './helpers.js'

const SECRET = 'test-secret-test-secret-test-secret'
let store: MongoStore
let c: ReturnType<typeof collections>
let api: ReturnType<typeof createApi>
let gw: ReturnType<typeof createGateway>
let port: number

const users: Record<string, { token: string; id: string }> = {}
let wsId: string
let docId: string

async function signup(name: string) {
  const r = await request(api).post('/auth/register').send({ email: `${name}@test.dev`, name, password: 'password123' })
  expect(r.status).toBe(201)
  users[name] = { token: r.body.token, id: r.body.user.id }
}
const as = (name: string) => ({ Authorization: `Bearer ${users[name].token}` })

beforeAll(async () => {
  store = new MongoStore('mongodb://127.0.0.1:27017', `synapse_test_access_${Date.now()}`)
  await store.init()
  c = collections(store.db)
  await ensureIndexes(c)
  const hub = new LocalHub()
  api = createApi({ c, store, bus: hub.connect('api'), secret: SECRET })
  gw = createGateway({
    port: 0, store, bus: hub.connect('gw'), idleMs: 20,
    authorize: makeAuthorize(c, SECRET),
    resolveRole: (userId, docId) => roleOnDocument(c, userId, docId),
  })
  port = await gw.listen()

  for (const n of ['ravi', 'sai', 'eve']) await signup(n)
  wsId = (await request(api).post('/workspaces').set(as('ravi')).send({ name: 'Team' })).body.id
  docId = (await request(api).post(`/workspaces/${wsId}/documents`).set(as('ravi')).send({ title: 'Plan' })).body.id
  await request(api).put(`/workspaces/${wsId}/members`).set(as('ravi')).send({ email: 'sai@test.dev', role: 'viewer' })
})
afterAll(async () => {
  await gw.close()
  await store.db.dropDatabase()
  await store.close()
})

const connect = (name: string | null, doc = docId) =>
  new TestClient(port, doc, name ? `?token=${users[name].token}` : '')

describe('accounts', () => {
  it('rejects bad input and duplicate emails, never stores plaintext passwords', async () => {
    expect((await request(api).post('/auth/register').send({ email: 'nope', name: 'x', password: 'short' })).status).toBe(400)
    expect((await request(api).post('/auth/register').send({ email: 'ravi@test.dev', name: 'dup', password: 'password123' })).status).toBe(409)
    const u = await c.users.findOne({ email: 'ravi@test.dev' })
    expect(u!.passwordHash).not.toContain('password123')
  })
  it('logs in, and gives the same error for a wrong password and an unknown email', async () => {
    const ok = await request(api).post('/auth/login').send({ email: 'ravi@test.dev', password: 'password123' })
    expect(ok.status).toBe(200)
    const bad = await request(api).post('/auth/login').send({ email: 'ravi@test.dev', password: 'wrongwrong' })
    const none = await request(api).post('/auth/login').send({ email: 'ghost@test.dev', password: 'wrongwrong' })
    expect([bad.status, none.status]).toEqual([401, 401])
    expect(bad.body).toEqual(none.body)
  })
  it('refuses requests with no token or a forged token', async () => {
    expect((await request(api).get('/workspaces')).status).toBe(401)
    expect((await request(api).get('/workspaces').set('Authorization', 'Bearer abc.def.ghi')).status).toBe(401)
  })
})

describe('API roles', () => {
  it('hides workspaces from non-members (404, not 403)', async () => {
    expect((await request(api).get(`/workspaces/${wsId}/documents`).set(as('eve'))).status).toBe(404)
    expect((await request(api).get(`/documents/${docId}`).set(as('eve'))).status).toBe(404)
  })
  it('lets a viewer read but not create documents or change members', async () => {
    expect((await request(api).get(`/documents/${docId}`).set(as('sai'))).body.role).toBe('viewer')
    expect((await request(api).post(`/workspaces/${wsId}/documents`).set(as('sai')).send({ title: 'x' })).status).toBe(403)
    expect((await request(api).put(`/workspaces/${wsId}/members`).set(as('sai')).send({ email: 'eve@test.dev', role: 'owner' })).status).toBe(403)
  })
  it('enforces comment permissions', async () => {
    expect((await request(api).post(`/documents/${docId}/comments`).set(as('sai')).send({ body: 'hi' })).status).toBe(403) // viewer
    await request(api).put(`/workspaces/${wsId}/members`).set(as('ravi')).send({ email: 'sai@test.dev', role: 'commenter' })
    const r = await request(api).post(`/documents/${docId}/comments`).set(as('sai')).send({ body: 'looks good' })
    expect(r.status).toBe(201)
    expect((await request(api).get(`/documents/${docId}/comments`).set(as('ravi'))).body).toHaveLength(1)
    expect((await request(api).patch(`/comments/${r.body.id}`).set(as('eve')).send({ resolved: true })).status).toBe(404)
    await request(api).put(`/workspaces/${wsId}/members`).set(as('ravi')).send({ email: 'sai@test.dev', role: 'viewer' }) // reset
  })
  it("won't demote the workspace owner", async () => {
    const r = await request(api).put(`/workspaces/${wsId}/members`).set(as('ravi')).send({ email: 'ravi@test.dev', role: 'viewer' })
    expect(r.status).toBe(400)
  })
})

describe('gateway access control', () => {
  it('rejects sockets with no token, a bad token, or no membership', async () => {
    await expect(connect(null).connect()).rejects.toBeTruthy()
    await expect(new TestClient(port, docId, '?token=garbage').connect()).rejects.toBeTruthy()
    await expect(connect('eve').connect()).rejects.toBeTruthy() // valid user, not a member
  })

  it('viewer can read but the server drops their writes', async () => {
    const owner = connect('ravi')
    const viewer = connect('sai')
    await owner.connect()
    await viewer.connect()
    owner.doc.getText('body').insert(0, 'owner text')
    await waitFor(() => viewer.text() === 'owner text')
    viewer.doc.getText('body').insert(0, 'HACKED ')
    await new Promise((r) => setTimeout(r, 200))
    expect(owner.text()).toBe('owner text')
    owner.close()
    viewer.close()
  })

  it('revoking access closes the open socket immediately', async () => {
    const sai = connect('sai')
    await sai.connect()
    let closed = false
    sai.ws.on('close', (code: number) => {
      closed = code === 4403
    })
    await request(api).delete(`/workspaces/${wsId}/members/${users.sai.id}`).set(as('ravi'))
    await waitFor(() => closed, 2000)
    // and they can't get back in
    await expect(connect('sai').connect()).rejects.toBeTruthy()
  })

  it('a role change from editor to viewer takes effect on the live socket', async () => {
    await request(api).put(`/workspaces/${wsId}/members`).set(as('ravi')).send({ email: 'sai@test.dev', role: 'editor' })
    const owner = connect('ravi')
    const sai = connect('sai')
    await owner.connect()
    await sai.connect()
    sai.doc.getText('body').insert(0, 'a')
    await waitFor(() => owner.text().includes('a'))
    await request(api).put(`/workspaces/${wsId}/members`).set(as('ravi')).send({ email: 'sai@test.dev', role: 'viewer' })
    await new Promise((r) => setTimeout(r, 200))
    const before = owner.text()
    sai.doc.getText('body').insert(0, 'ILLEGAL')
    await new Promise((r) => setTimeout(r, 200))
    expect(owner.text()).toBe(before)
    owner.close()
    sai.close()
  })
})

describe('version history', () => {
  it('saves, lists and returns a named version', async () => {
    expect((await request(api).post(`/documents/${docId}/versions`).set(as('sai')).send({ label: 'x' })).status).toBe(403)
    const r = await request(api).post(`/documents/${docId}/versions`).set(as('ravi')).send({ label: 'Draft 1' })
    expect(r.status).toBe(201)
    const list = await request(api).get(`/documents/${docId}/versions`).set(as('sai'))
    expect(list.body.map((v: { label: string }) => v.label)).toEqual(['Draft 1'])
    const state = await request(api).get(`/documents/${docId}/versions/${r.body.version}`).set(as('sai')).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (d: Buffer) => chunks.push(d))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(state.status).toBe(200)
    expect(state.body.length).toBeGreaterThan(0)
  })
})

describe('search', () => {
  it("only returns documents from the caller's own workspaces", async () => {
    await c.documents.updateOne({ _id: (await c.documents.findOne({}))!._id }, { $set: { text: 'quarterly roadmap discussion' } })
    const mine = await request(api).get('/search?q=roadmap').set(as('ravi'))
    expect(mine.body).toHaveLength(1)
    const theirs = await request(api).get('/search?q=roadmap').set(as('eve')) // eve belongs to no workspace
    expect(theirs.body).toHaveLength(0)
  })
})

describe('rate limiting', () => {
  it('slows down repeated login attempts', async () => {
    let last = 0
    for (let i = 0; i < 40; i++) last = (await request(api).post('/auth/login').send({ email: 'ravi@test.dev', password: 'nopenope1' })).status
    expect(last).toBe(429)
  })
})

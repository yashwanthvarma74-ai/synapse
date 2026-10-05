import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import request from 'supertest'
import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { MongoStore } from '../src/mongoStore.js'
import { collections, ensureIndexes } from '../src/db.js'
import { createApi } from '../src/api.js'
import { createGateway } from '../src/gateway.js'
import { LocalHub } from '../src/bus.js'
import { makeAuthorize, roleOnDocument } from '../src/access.js'
import { mergeStored } from '../src/store.js'
import { extractText } from '../src/text.js'
import { pruneGuests } from '../src/prune.js'
import { TestClient, waitFor } from './helpers.js'

const SECRET = 'onboarding-secret-onboarding-secret-0123456'
let store: MongoStore
let c: ReturnType<typeof collections>
let api: ReturnType<typeof createApi>

const previousLimit = process.env.AUTH_RATE_LIMIT
beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT = '1000' // these tests create many accounts quickly; the limiter has its own test in access.test.ts
  store = new MongoStore('mongodb://127.0.0.1:27017', `synapse_test_onb_${Date.now()}`)
  await store.init()
  c = collections(store.db)
  await ensureIndexes(c)
  api = createApi({ c, store, bus: new LocalHub().connect('api'), secret: SECRET })
})
afterAll(async () => {
  if (previousLimit === undefined) delete process.env.AUTH_RATE_LIMIT
  else process.env.AUTH_RATE_LIMIT = previousLimit
  await store.db.dropDatabase()
  await store.close()
})

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
const stored = async (docId: string) => {
  const d = new Y.Doc()
  Y.applyUpdate(d, mergeStored(await store.load(docId)))
  return d
}
async function signup(name: string) {
  const r = await request(api).post('/auth/register').send({ email: `${name}@onb.dev`, name, password: 'password123' })
  expect(r.status).toBe(201)
  return { token: r.body.token as string, id: r.body.user.id as string }
}

describe('first-run content', () => {
  it('every new account gets a workspace with a Welcome document and a sample board', async () => {
    const u = await signup('newbie')
    const ws = await request(api).get('/workspaces').set(auth(u.token))
    expect(ws.body).toHaveLength(1)
    expect(ws.body[0]).toMatchObject({ name: 'My workspace', role: 'owner' })
    const docs = await request(api).get(`/workspaces/${ws.body[0].id}/documents`).set(auth(u.token))
    expect(docs.body.map((d: { title: string; type: string }) => `${d.type}:${d.title}`).sort()).toEqual(['canvas:Sample board', 'doc:Welcome to Synapse'])
  })

  it('the Welcome document is valid for the EDITOR\'s schema, so it will open correctly', async () => {
    const u = await signup('schema')
    const ws = (await request(api).get('/workspaces').set(auth(u.token))).body[0].id
    const doc = (await request(api).get(`/workspaces/${ws}/documents`).set(auth(u.token))).body.find((d: { type: string }) => d.type === 'doc')
    const ydoc = await stored(doc.id)
    const node = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment('default'), getSchema([StarterKit]))
    expect(() => node.check()).not.toThrow() // throws if any node or mark breaks the schema
    const text = extractText(ydoc)
    expect(text).toContain('Welcome to Synapse')
    expect(text).toContain('Go offline on purpose')
    expect(text).toContain('Press Share')
    expect(node.childCount).toBeGreaterThan(5)
  })

  it('the sample board has shapes and connectors that point at real shapes', async () => {
    const u = await signup('board')
    const ws = (await request(api).get('/workspaces').set(auth(u.token))).body[0].id
    const board = (await request(api).get(`/workspaces/${ws}/documents`).set(auth(u.token))).body.find((d: { type: string }) => d.type === 'canvas')
    const objects = (await stored(board.id)).getMap<Y.Map<unknown>>('objects')
    const kinds = [...objects.values()].map((m) => m.get('kind'))
    expect(kinds.filter((k) => k !== 'connector').length).toBeGreaterThanOrEqual(4)
    for (const m of objects.values()) {
      if (m.get('kind') !== 'connector') continue
      expect(objects.has(m.get('from') as string)).toBe(true)
      expect(objects.has(m.get('to') as string)).toBe(true)
    }
  })

  it('the starter text is searchable', async () => {
    const u = await signup('searcher')
    const r = await request(api).get('/search?q=offline').set(auth(u.token))
    expect(r.body.length).toBeGreaterThan(0)
  })
})

describe('guest accounts ("try it now")', () => {
  it('creates a working account in one request, with starter content and a friendly name', async () => {
    const r = await request(api).post('/auth/guest')
    expect(r.status).toBe(201)
    expect(r.body.user.guest).toBe(true)
    expect(r.body.user.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/) // like "Curious Otter"
    const me = await request(api).get('/me').set(auth(r.body.token))
    expect(me.body.guest).toBe(true)
    const docs = await request(api).get(`/workspaces/${r.body.starter.workspaceId}/documents`).set(auth(r.body.token))
    expect(docs.body).toHaveLength(2)
    expect(r.body.starter.welcomeId).toBeTruthy()
  })

  it('a guest cannot sign in again with a password, and each guest is separate', async () => {
    const a = await request(api).post('/auth/guest')
    const b = await request(api).post('/auth/guest')
    expect(a.body.user.id).not.toBe(b.body.user.id)
    const login = await request(api).post('/auth/login').send({ email: a.body.user.email, password: 'password123' })
    expect(login.status).toBe(401)
    // one guest cannot see another guest's documents
    const other = await request(api).get(`/documents/${b.body.starter.welcomeId}`).set(auth(a.body.token))
    expect(other.status).toBe(404)
  })

  it('can be turned off, and is capped per hour', async () => {
    const off = createApi({ c, store, bus: new LocalHub().connect('x'), secret: SECRET, guestsEnabled: false })
    expect((await request(off).post('/auth/guest')).status).toBe(403)
    const capped = createApi({ c, store, bus: new LocalHub().connect('y'), secret: SECRET, maxGuestsPerHour: 2 })
    expect((await request(capped).post('/auth/guest')).status).toBe(201)
    expect((await request(capped).post('/auth/guest')).status).toBe(201)
    expect((await request(capped).post('/auth/guest')).status).toBe(429)
  })

  it('upgrading keeps everything the guest made and enables password sign-in', async () => {
    const g = await request(api).post('/auth/guest')
    const up = await request(api).post('/auth/upgrade').set(auth(g.body.token)).send({ email: 'grown@onb.dev', name: 'Grown Up', password: 'password123' })
    expect(up.status).toBe(200)
    const login = await request(api).post('/auth/login').send({ email: 'grown@onb.dev', password: 'password123' })
    expect(login.status).toBe(200)
    expect(login.body.user.id).toBe(g.body.user.id) // same account, same documents
    const docs = await request(api).get(`/workspaces/${g.body.starter.workspaceId}/documents`).set(auth(login.body.token))
    expect(docs.body).toHaveLength(2)
    expect((await request(api).get('/me').set(auth(login.body.token))).body.guest).toBe(false)
  })

  it('refuses to upgrade a normal account, and refuses a taken email', async () => {
    const n = await signup('already-full')
    expect((await request(api).post('/auth/upgrade').set(auth(n.token)).send({ email: 'x@onb.dev', name: 'X', password: 'password123' })).status).toBe(400)
    const g = await request(api).post('/auth/guest')
    expect((await request(api).post('/auth/upgrade').set(auth(g.body.token)).send({ email: 'already-full@onb.dev', name: 'X', password: 'password123' })).status).toBe(409)
  })
})

describe('invite links', () => {
  it('only the owner can make, list and revoke them; the role cannot be owner', async () => {
    const owner = await signup('inv-owner')
    const guest = await request(api).post('/auth/guest')
    const ws = (await request(api).get('/workspaces').set(auth(owner.token))).body[0].id
    expect((await request(api).post(`/workspaces/${ws}/invites`).set(auth(guest.body.token)).send({ role: 'editor' })).status).toBe(404) // not even a member
    expect((await request(api).post(`/workspaces/${ws}/invites`).set(auth(owner.token)).send({ role: 'owner' })).status).toBe(400)
    const made = await request(api).post(`/workspaces/${ws}/invites`).set(auth(owner.token)).send({ role: 'editor' })
    expect(made.status).toBe(201)
    expect(made.body.code.length).toBeGreaterThanOrEqual(22) // 128 bits: not guessable
    const other = await request(api).post(`/workspaces/${ws}/invites`).set(auth(owner.token)).send({ role: 'editor' })
    expect(other.body.code).not.toBe(made.body.code)
    const listed = await request(api).get(`/workspaces/${ws}/invites`).set(auth(owner.token))
    expect(listed.body.length).toBe(2)
    await request(api).delete(`/workspaces/${ws}/invites/${made.body.code}`).set(auth(owner.token))
    expect((await request(api).get(`/invites/${made.body.code}`)).status).toBe(404) // revoked
  })

  it('shows who invited you to what, without signing in', async () => {
    const owner = await signup('inv-shows')
    const ws = (await request(api).get('/workspaces').set(auth(owner.token))).body[0].id
    const { code } = (await request(api).post(`/workspaces/${ws}/invites`).set(auth(owner.token)).send({ role: 'commenter' })).body
    const info = await request(api).get(`/invites/${code}`)
    expect(info.status).toBe(200)
    expect(info.body).toEqual({ workspaceName: 'My workspace', inviterName: 'inv-shows', role: 'commenter' })
    expect((await request(api).get('/invites/not-a-real-code')).status).toBe(404)
  })

  it('accepting adds you with exactly the invite\'s role, and you can then open the documents', async () => {
    const owner = await signup('inv-acc')
    const ws = (await request(api).get('/workspaces').set(auth(owner.token))).body[0].id
    const { code } = (await request(api).post(`/workspaces/${ws}/invites`).set(auth(owner.token)).send({ role: 'viewer' })).body
    const guest = await request(api).post('/auth/guest')
    expect((await request(api).post(`/invites/${code}/accept`)).status).toBe(401) // must be signed in (a guest is fine)
    const acc = await request(api).post(`/invites/${code}/accept`).set(auth(guest.body.token))
    expect(acc.status).toBe(200)
    expect(acc.body.workspaceId).toBe(ws)
    expect(acc.body.documentId).toBeTruthy()
    const doc = await request(api).get(`/documents/${acc.body.documentId}`).set(auth(guest.body.token))
    expect(doc.body.role).toBe('viewer')
    expect((await request(api).post(`/workspaces/${ws}/documents`).set(auth(guest.body.token)).send({ title: 'nope' })).status).toBe(403) // viewers cannot create
  })

  it('never lowers someone who already has more access', async () => {
    const owner = await signup('inv-keep')
    const ws = (await request(api).get('/workspaces').set(auth(owner.token))).body[0].id
    const { code } = (await request(api).post(`/workspaces/${ws}/invites`).set(auth(owner.token)).send({ role: 'viewer' })).body
    await request(api).post(`/invites/${code}/accept`).set(auth(owner.token)) // the owner opens their own viewer link
    expect((await request(api).get('/workspaces').set(auth(owner.token))).body.find((w: { id: string }) => w.id === ws).role).toBe('owner')
  })

  it('expired and revoked links stop working', async () => {
    const owner = await signup('inv-exp')
    const ws = (await request(api).get('/workspaces').set(auth(owner.token))).body[0].id
    const { code } = (await request(api).post(`/workspaces/${ws}/invites`).set(auth(owner.token)).send({ role: 'editor' })).body
    await c.invites.updateOne({ code }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
    const guest = await request(api).post('/auth/guest')
    expect((await request(api).post(`/invites/${code}/accept`).set(auth(guest.body.token))).status).toBe(404)
    expect((await request(api).get(`/invites/${code}`)).status).toBe(404)
  })

  it('end to end: after accepting, the new person can really connect to the document and edit', async () => {
    const hub = new LocalHub()
    const gw = createGateway({ port: 0, store, bus: hub.connect('gw'), idleMs: 20, authorize: makeAuthorize(c, SECRET), resolveRole: (u, d) => roleOnDocument(c, u, d) })
    const port = await gw.listen()
    const api2 = createApi({ c, store, bus: hub.connect('api2'), secret: SECRET })
    try {
      const owner = (await request(api2).post('/auth/register').send({ email: 'e2e-owner@onb.dev', name: 'Owner', password: 'password123' })).body
      const ws = (await request(api2).get('/workspaces').set(auth(owner.token))).body[0].id
      const welcome = (await request(api2).get(`/workspaces/${ws}/documents`).set(auth(owner.token))).body.find((d: { type: string }) => d.type === 'doc')
      const { code } = (await request(api2).post(`/workspaces/${ws}/invites`).set(auth(owner.token)).send({ role: 'editor' })).body
      const guest = (await request(api2).post('/auth/guest')).body
      // before accepting: refused
      await expect(new TestClient(port, welcome.id, `?token=${guest.token}`).connect()).rejects.toBeTruthy()
      await request(api2).post(`/invites/${code}/accept`).set(auth(guest.token))
      const a = new TestClient(port, welcome.id, `?token=${owner.token}`)
      const b = new TestClient(port, welcome.id, `?token=${guest.token}`)
      await a.connect(); await b.connect()
      b.doc.getText('side').insert(0, 'hello from the invited guest')
      await waitFor(() => a.doc.getText('side').toString() === 'hello from the invited guest')
      a.close(); b.close()
    } finally {
      await gw.close()
    }
  })
})

describe('pruning old guests', () => {
  const longAgo = new Date(Date.now() - 90 * 86_400_000)
  const age = (id: string) => c.users.updateOne({ _id: new ObjectId(id) }, { $set: { createdAt: longAgo } })
  const counts = async () => ({ users: await c.users.countDocuments(), workspaces: await c.workspaces.countDocuments(), docs: await c.documents.countDocuments() })

  it('shows what it would remove, and removes nothing, by default', async () => {
    const g = await request(api).post('/auth/guest')
    await age(g.body.user.id)
    const before = await counts()
    const r = await pruneGuests(c, store, { olderThanDays: 30 })
    expect(r.dryRun).toBe(true)
    expect(r.guests).toBeGreaterThanOrEqual(1)
    expect(await counts()).toEqual(before)
  })

  it('removes an old guest with their workspace, documents and stored edits, and nothing else', async () => {
    const old = await request(api).post('/auth/guest')
    const fresh = await request(api).post('/auth/guest')
    await age(old.body.user.id)
    const before = await counts()
    const oldDoc = old.body.starter.welcomeId
    expect((await store.load(oldDoc)).updates.length).toBeGreaterThan(0)
    const r = await pruneGuests(c, store, { olderThanDays: 30, dryRun: false })
    expect(r.guests).toBeGreaterThanOrEqual(1)
    expect((await store.load(oldDoc)).updates.length).toBe(0) // the stored edits are gone too
    expect(await c.users.findOne({ _id: new ObjectId(old.body.user.id) })).toBeNull()
    expect(await c.users.findOne({ _id: new ObjectId(fresh.body.user.id) })).not.toBeNull() // a recent guest is untouched
    expect((await counts()).users).toBeLessThan(before.users)
  })

  it('never touches a guest who upgraded to a real account', async () => {
    const g = await request(api).post('/auth/guest')
    await request(api).post('/auth/upgrade').set(auth(g.body.token)).send({ email: 'keeper@onb.dev', name: 'Keeper', password: 'password123' })
    await age(g.body.user.id)
    await pruneGuests(c, store, { olderThanDays: 30, dryRun: false })
    expect(await c.users.findOne({ _id: new ObjectId(g.body.user.id) })).not.toBeNull()
    expect(await c.workspaces.findOne({ _id: new ObjectId(g.body.starter.workspaceId) })).not.toBeNull()
  })

  it('never deletes a workspace that a real person still shares', async () => {
    const owner = await request(api).post('/auth/guest')
    const friend = await signup('real-friend')
    const { code } = (await request(api).post(`/workspaces/${owner.body.starter.workspaceId}/invites`).set(auth(owner.body.token)).send({ role: 'editor' })).body
    await request(api).post(`/invites/${code}/accept`).set(auth(friend.token))
    await age(owner.body.user.id)
    await pruneGuests(c, store, { olderThanDays: 30, dryRun: false })
    expect(await c.workspaces.findOne({ _id: new ObjectId(owner.body.starter.workspaceId) })).not.toBeNull() // the friend still has it
    const docs = await request(api).get(`/workspaces/${owner.body.starter.workspaceId}/documents`).set(auth(friend.token))
    expect(docs.body).toHaveLength(2)
  })
})

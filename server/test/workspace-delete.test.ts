import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import * as Y from 'yjs'
import { MongoStore } from '../src/mongoStore.js'
import { collections, ensureIndexes } from '../src/db.js'
import { createApi } from '../src/api.js'
import { createGateway } from '../src/gateway.js'
import { LocalHub } from '../src/bus.js'
import { makeAuthorize, roleOnDocument } from '../src/access.js'
import { MongoChatStore } from '../src/chat.js'
import { s3Settings, s3Storage, type Storage } from '../src/storage.js'
import { TestClient, waitFor } from './helpers.js'

const SECRET = 'workspace-delete-secret-0123456789012345'
let store: MongoStore
let c: ReturnType<typeof collections>
let chat: MongoChatStore
let api: ReturnType<typeof createApi>
let gateway: ReturnType<typeof createGateway>
let port: number
const deleted: string[] = []
let storageFails = false
const storage: Storage = {
  presignPut: async () => '', presignGet: async () => '',
  deletePrefix: async (p) => { if (storageFails) throw new Error('bucket unreachable'); deleted.push(p); return 1 },
}

beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT = '1000'
  store = new MongoStore('mongodb://127.0.0.1:27017', `synapse_test_wsdel_${Date.now()}`)
  await store.init()
  c = collections(store.db)
  await ensureIndexes(c)
  chat = new MongoChatStore(store.db)
  await chat.init()
  const hub = new LocalHub()
  api = createApi({ c, store, bus: hub.connect('api'), secret: SECRET, storage, chat })
  gateway = createGateway({
    port: 0, store, bus: hub.connect('gw'), authorize: makeAuthorize(c, SECRET),
    resolveRole: (u, d) => roleOnDocument(c, u, d), recheckMs: 60_000, chat,
  })
  port = await gateway.listen()
})
afterAll(async () => {
  await gateway.close()
  await store.db.dropDatabase()
  await store.close()
})

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
async function guest() {
  const r = await request(api).post('/auth/guest').send({})
  return { token: r.body.token as string, id: r.body.user.id as string, ...r.body.starter as { workspaceId: string; welcomeId: string; boardId: string } }
}

describe('DELETE /workspaces/:id', () => {
  it('removes the workspace and everything in it: content, versions, comments, chat, invites and members', async () => {
    const u = await guest()
    // give the workspace something of every kind
    await request(api).post(`/documents/${u.welcomeId}/comments`).set(auth(u.token)).send({ body: 'a comment' })
    await store.saveNamedVersion(u.welcomeId, 'v1', u.id)
    await chat.append(u.welcomeId, { userId: u.id, name: 'Me', text: 'a chat message' })
    await request(api).post(`/workspaces/${u.workspaceId}/invites`).set(auth(u.token)).send({ role: 'editor' })
    const wid = (await import('mongodb')).ObjectId.createFromHexString(u.workspaceId)
    expect((await store.load(u.welcomeId)).updates.length).toBeGreaterThan(0)

    const r = await request(api).delete(`/workspaces/${u.workspaceId}`).set(auth(u.token))
    expect(r.status).toBe(204)

    expect(await c.workspaces.countDocuments({ _id: wid })).toBe(0)
    expect(await c.documents.countDocuments({ workspaceId: wid })).toBe(0)
    expect(await c.memberships.countDocuments({ workspaceId: wid })).toBe(0)
    expect(await c.invites.countDocuments({ workspaceId: wid })).toBe(0)
    expect(await c.comments.countDocuments({})).toBe(0)
    for (const doc of [u.welcomeId, u.boardId]) {
      const loaded = await store.load(doc)
      expect(loaded.snapshot).toBeNull()
      expect(loaded.updates).toEqual([])
      expect(await chat.list(doc)).toEqual([])
    }
    expect(await store.listVersions(u.welcomeId)).toEqual([])
    expect(deleted).toEqual(expect.arrayContaining([`${u.welcomeId}/`, `${u.boardId}/`])) // uploaded files too
    // and it no longer shows up
    expect((await request(api).get('/workspaces').set(auth(u.token))).body).toEqual([])
  })

  it('leaves everyone else\'s workspaces, and the user\'s other workspaces, untouched', async () => {
    const a = await guest()
    const b = await guest()
    const extra = await request(api).post('/workspaces').set(auth(a.token)).send({ name: 'Keep me' })
    expect((await request(api).delete(`/workspaces/${a.workspaceId}`).set(auth(a.token))).status).toBe(204)
    const mine = (await request(api).get('/workspaces').set(auth(a.token))).body
    expect(mine.map((w: { name: string }) => w.name)).toEqual(['Keep me'])
    expect(mine[0].id).toBe(extra.body.id)
    expect((await request(api).get(`/documents/${b.welcomeId}`).set(auth(b.token))).status).toBe(200)
    expect((await store.load(b.welcomeId)).updates.length).toBeGreaterThan(0)
    expect((await chat.list(b.welcomeId)).length).toBe(0)
  })

  it('is for owners only: editors and viewers get 403, strangers 404, signed-out 401', async () => {
    const owner = await guest()
    const other = await guest()
    const invite = await request(api).post(`/workspaces/${owner.workspaceId}/invites`).set(auth(owner.token)).send({ role: 'editor' })
    await request(api).post(`/invites/${invite.body.code}/accept`).set(auth(other.token)).send({})
    expect((await request(api).delete(`/workspaces/${owner.workspaceId}`).set(auth(other.token))).status).toBe(403) // an editor
    const stranger = await guest()
    expect((await request(api).delete(`/workspaces/${owner.workspaceId}`).set(auth(stranger.token))).status).toBe(404)
    expect((await request(api).delete(`/workspaces/${owner.workspaceId}`)).status).toBe(401)
    expect((await request(api).get(`/documents/${owner.welcomeId}`).set(auth(owner.token))).status).toBe(200) // all still there
  })

  it('a second delete finds nothing, and the old invite link no longer works', async () => {
    const u = await guest()
    const invite = await request(api).post(`/workspaces/${u.workspaceId}/invites`).set(auth(u.token)).send({ role: 'viewer' })
    expect((await request(api).delete(`/workspaces/${u.workspaceId}`).set(auth(u.token))).status).toBe(204)
    expect((await request(api).delete(`/workspaces/${u.workspaceId}`).set(auth(u.token))).status).toBe(404)
    expect((await request(api).get(`/invites/${invite.body.code}`)).status).toBe(404)
  })

  it('can delete your last workspace and then make a new one', async () => {
    const u = await guest()
    expect((await request(api).delete(`/workspaces/${u.workspaceId}`).set(auth(u.token))).status).toBe(204)
    expect((await request(api).get('/workspaces').set(auth(u.token))).body).toEqual([])
    const fresh = await request(api).post('/workspaces').set(auth(u.token)).send({ name: 'Second try' })
    expect(fresh.status).toBe(201)
    expect((await request(api).get('/workspaces').set(auth(u.token))).body).toHaveLength(1)
  })

  it('does not let a storage problem block the deletion', async () => {
    const u = await guest()
    storageFails = true
    const r = await request(api).delete(`/workspaces/${u.workspaceId}`).set(auth(u.token))
    storageFails = false
    expect(r.status).toBe(204)
    expect((await request(api).get('/workspaces').set(auth(u.token))).body).toEqual([])
  })

  it('closes the connections of people who have the document open', async () => {
    const u = await guest()
    const client = new TestClient(port, u.welcomeId, `?token=${u.token}`)
    await client.connect()
    await waitFor(() => client.synced)
    let code = 0
    client.ws.on('close', (c: number) => { code = c })
    await request(api).delete(`/workspaces/${u.workspaceId}`).set(auth(u.token))
    await waitFor(() => code !== 0, 5000)
    expect(code).toBe(4403) // "access revoked": the browser stops reconnecting and clears its offline copy
  })

  it('refuses new connections to a deleted document', async () => {
    const u = await guest()
    await request(api).delete(`/workspaces/${u.workspaceId}`).set(auth(u.token))
    await expect(new TestClient(port, u.welcomeId, `?token=${u.token}`).connect()).rejects.toBeTruthy()
  })
})

describe('deleting uploaded files from the bucket', () => {
  const settings = s3Settings({ S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'AK', S3_SECRET_ACCESS_KEY: 'SK', S3_ENDPOINT: 'http://minio:9000' } as NodeJS.ProcessEnv)!
  function fakeAdmin(pages: Array<{ keys: string[]; more: boolean }>) {
    const sent: Array<{ kind: string; input: Record<string, unknown> }> = []
    let i = 0
    return {
      sent,
      client: {
        send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
          sent.push({ kind: cmd.constructor.name, input: cmd.input })
          if (cmd.constructor.name === 'ListObjectsV2Command') {
            const p = pages[i++] ?? { keys: [], more: false }
            return { Contents: p.keys.map((Key) => ({ Key })), IsTruncated: p.more, NextContinuationToken: p.more ? `t${i}` : undefined }
          }
          return {}
        },
      },
    }
  }

  it('lists and deletes everything under the prefix, across pages', async () => {
    const f = fakeAdmin([{ keys: ['d1/a.png', 'd1/b.png'], more: true }, { keys: ['d1/c.pdf'], more: false }])
    const n = await s3Storage(settings, undefined, f.client as never).deletePrefix('d1/')
    expect(n).toBe(3)
    const lists = f.sent.filter((s) => s.kind === 'ListObjectsV2Command')
    expect(lists.map((l) => l.input.Prefix)).toEqual(['d1/', 'd1/'])
    expect(lists[1].input.ContinuationToken).toBe('t1')
    const dels = f.sent.filter((s) => s.kind === 'DeleteObjectsCommand')
    expect(dels).toHaveLength(2)
    expect((dels[0].input.Delete as { Objects: unknown[] }).Objects).toEqual([{ Key: 'd1/a.png' }, { Key: 'd1/b.png' }])
  })

  it('does not call delete when there is nothing there', async () => {
    const f = fakeAdmin([{ keys: [], more: false }])
    expect(await s3Storage(settings, undefined, f.client as never).deletePrefix('none/')).toBe(0)
    expect(f.sent.some((s) => s.kind === 'DeleteObjectsCommand')).toBe(false)
  })
})

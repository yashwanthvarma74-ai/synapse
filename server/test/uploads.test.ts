import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { MongoStore } from '../src/mongoStore.js'
import { collections, ensureIndexes } from '../src/db.js'
import { createApi } from '../src/api.js'
import { LocalHub } from '../src/bus.js'
import { MAX_UPLOAD_BYTES, s3Settings, s3Storage, type Storage } from '../src/storage.js'

const SECRET = 'uploads-secret-uploads-secret-0123456789'
let store: MongoStore
let api: ReturnType<typeof createApi>
let apiNoStorage: ReturnType<typeof createApi>
const calls: string[] = []

// A fake bucket: records what it was asked to sign, touches no network
const fake: Storage = {
  presignPut: async (key, type, size) => (calls.push(`put ${key} ${type} ${size}`), `https://bucket.test/${key}?signed=put`),
  presignGet: async (key, opts) => (calls.push(`get ${key}${opts?.download ? ' download' : ''}`), `https://bucket.test/${key}?signed=get`),
}

beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT = '1000'
  store = new MongoStore('mongodb://127.0.0.1:27017', `synapse_test_up_${Date.now()}`)
  await store.init()
  const c = collections(store.db)
  await ensureIndexes(c)
  api = createApi({ c, store, bus: new LocalHub().connect('api'), secret: SECRET, storage: fake, publicUrl: 'https://api.test' })
  apiNoStorage = createApi({ c, store, bus: new LocalHub().connect('api2'), secret: SECRET })
})
afterAll(async () => {
  await store.db.dropDatabase()
  await store.close()
})

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
async function owner(name: string) {
  const r = await request(api).post('/auth/register').send({ email: `${name}@up.dev`, name, password: 'password123' })
  const ws = (await request(api).get('/workspaces').set(auth(r.body.token))).body[0].id
  const docs = (await request(api).get(`/workspaces/${ws}/documents`).set(auth(r.body.token))).body
  return { token: r.body.token as string, ws, docId: docs.find((d: { type: string }) => d.type === 'doc').id as string }
}
const ask = (token: string, docId: string, body: object, app = api) => request(app).post(`/documents/${docId}/uploads`).set(auth(token)).send(body)

describe('upload permission', () => {
  it('gives an editor a signed URL for exactly the key, type and size, and a stable link', async () => {
    const u = await owner('ann')
    const r = await ask(u.token, u.docId, { name: 'cat.png', contentType: 'image/png', size: 1234 })
    expect(r.status).toBe(201)
    expect(r.body.image).toBe(true)
    expect(r.body.url).toMatch(new RegExp(`^https://api.test/files/${u.docId}/[a-f0-9]{32}\\.png$`))
    const key = r.body.url.replace('https://api.test/files/', '')
    expect(r.body.uploadUrl).toBe(`https://bucket.test/${key}?signed=put`)
    expect(calls).toContain(`put ${key} image/png 1234`)
  })

  it('never uses the filename the client sent: the key is random with a fixed extension', async () => {
    const u = await owner('bob')
    const r = await ask(u.token, u.docId, { name: '../../etc/passwd.html', contentType: 'image/jpeg', size: 10 })
    expect(r.body.url).not.toContain('passwd')
    expect(r.body.url).toMatch(/\.jpg$/)
  })

  it('rejects types that could run in a browser, and files that are too big', async () => {
    const u = await owner('cy')
    expect((await ask(u.token, u.docId, { name: 'x.html', contentType: 'text/html', size: 10 })).status).toBe(415)
    expect((await ask(u.token, u.docId, { name: 'x.svg', contentType: 'image/svg+xml', size: 10 })).status).toBe(415)
    expect((await ask(u.token, u.docId, { name: 'x.png', contentType: 'image/png', size: MAX_UPLOAD_BYTES + 1 })).status).toBe(413)
    expect((await ask(u.token, u.docId, { name: 'x.png', contentType: 'image/png', size: 0 })).status).toBe(400)
  })

  it('viewers and commenters cannot upload; strangers get a 404; signed-out gets 401', async () => {
    const u = await owner('dee')
    const v = await request(api).post('/auth/register').send({ email: 'viewer@up.dev', name: 'viewer', password: 'password123' })
    await request(api).put(`/workspaces/${u.ws}/members`).set(auth(u.token)).send({ email: 'viewer@up.dev', role: 'viewer' })
    expect((await ask(v.body.token, u.docId, { name: 'a.png', contentType: 'image/png', size: 5 })).status).toBe(403)
    await request(api).put(`/workspaces/${u.ws}/members`).set(auth(u.token)).send({ email: 'viewer@up.dev', role: 'commenter' })
    expect((await ask(v.body.token, u.docId, { name: 'a.png', contentType: 'image/png', size: 5 })).status).toBe(403)
    const stranger = await request(api).post('/auth/register').send({ email: 'stranger@up.dev', name: 'stranger', password: 'password123' })
    expect((await ask(stranger.body.token, u.docId, { name: 'a.png', contentType: 'image/png', size: 5 })).status).toBe(404)
    expect((await request(api).post(`/documents/${u.docId}/uploads`).send({})).status).toBe(401)
  })

  it('says plainly when the server has no storage configured', async () => {
    const u = await owner('eve')
    const r = await ask(u.token, u.docId, { name: 'a.png', contentType: 'image/png', size: 5 }, apiNoStorage)
    expect(r.status).toBe(501)
    expect(r.body.error).toMatch(/not set up/)
  })
})

describe('file links', () => {
  const doc = 'a'.repeat(24), name = 'b'.repeat(32)
  it('redirect to a fresh short-lived download URL (images inline, other files as downloads)', async () => {
    const img = await request(api).get(`/files/${doc}/${name}.png`)
    expect(img.status).toBe(302)
    expect(img.headers.location).toBe(`https://bucket.test/${doc}/${name}.png?signed=get`)
    await request(api).get(`/files/${doc}/${name}.pdf`)
    expect(calls).toContain(`get ${doc}/${name}.pdf download`)
  })
  it('refuse anything that is not a name we generated (no path tricks)', async () => {
    for (const bad of [`/files/${doc}/..%2Fsecret.png`, `/files/${doc}/${name}.exe`, `/files/zzz/${name}.png`, `/files/${doc}/short.png`])
      expect((await request(api).get(bad)).status, bad).toBe(404)
  })
  it('404 when uploads are off', async () => expect((await request(apiNoStorage).get(`/files/${doc}/${name}.png`)).status).toBe(404))
})

describe('the real signer (no network: signing is pure computation)', () => {
  const s = s3Settings({ S3_BUCKET: 'b', S3_ENDPOINT: 'http://127.0.0.1:9000', S3_ACCESS_KEY_ID: 'AK', S3_SECRET_ACCESS_KEY: 'SK' } as NodeJS.ProcessEnv)!
  it('signs the content type and size so the browser cannot swap them', async () => {
    const url = new URL(await s3Storage(s).presignPut('d/k.png', 'image/png', 99))
    expect(url.host).toBe('127.0.0.1:9000')
    expect(url.pathname).toBe('/b/d/k.png')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toMatch(/content-length/)
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toMatch(/content-type/)
  })
  it('download URLs expire in minutes, not days', async () => {
    const url = new URL(await s3Storage(s).presignGet('d/k.pdf', { download: 'k.pdf' }))
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600')
    expect(url.searchParams.get('response-content-disposition')).toContain('attachment')
  })
  it('signs with the address browsers use when it differs from the server\'s own', async () => {
    const both = s3Settings({ S3_BUCKET: 'b', S3_ENDPOINT: 'http://minio:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:9000', S3_ACCESS_KEY_ID: 'AK', S3_SECRET_ACCESS_KEY: 'SK' } as NodeJS.ProcessEnv)!
    expect(new URL(await s3Storage(both).presignPut('d/k.png', 'image/png', 9)).host).toBe('localhost:9000')
    expect(new URL(await s3Storage(both).presignGet('d/k.png')).host).toBe('localhost:9000')
  })
  it('stays off unless all three settings exist', () => {
    expect(s3Settings({} as NodeJS.ProcessEnv)).toBeNull()
    expect(s3Settings({ S3_BUCKET: 'b' } as NodeJS.ProcessEnv)).toBeNull()
  })
})

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { createGateway } from '../src/gateway.js'
import { LocalHub, NoBus } from '../src/bus.js'
import { MemoryStore } from '../src/store.js'
import type { Role } from '../src/room.js'
import { MongoStore } from '../src/mongoStore.js'
import { collections, ensureIndexes } from '../src/db.js'
import { createApi } from '../src/api.js'
import {
  MAX_CHAT_CHARS, MongoChatStore, MemoryChatStore, MSG_CHAT, MSG_CHAT_ERROR, TokenBucket, cleanChatText,
  type ChatMessage,
} from '../src/chat.js'
import { TestClient, waitFor } from './helpers.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('cleaning what people type', () => {
  it('keeps normal text, including emoji, other languages and line breaks', () => {
    expect(cleanChatText('hello 👋')).toBe('hello 👋')
    expect(cleanChatText('నమస్కారం, how are you?')).toBe('నమస్కారం, how are you?')
    expect(cleanChatText('line one\nline two')).toBe('line one\nline two')
  })
  it('trims, and tidies long runs of blank lines', () => {
    expect(cleanChatText('  hi  ')).toBe('hi')
    expect(cleanChatText('a\n\n\n\n\nb')).toBe('a\n\nb')
  })
  it('refuses empty, whitespace-only and non-text input', () => {
    for (const bad of ['', '   ', '\n\n', '\u0000\u0001', 42, null, undefined, {}]) expect(cleanChatText(bad)).toBeNull()
  })
  it('removes control characters and the invisible overrides that make text read backwards', () => {
    expect(cleanChatText('a\u0000b\u0007c')).toBe('abc')
    expect(cleanChatText('safe‮gnp.exe')).toBe('safegnp.exe')
  })
  it('enforces the length limit by characters, not bytes', () => {
    expect(cleanChatText('x'.repeat(MAX_CHAT_CHARS))).not.toBeNull()
    expect(cleanChatText('x'.repeat(MAX_CHAT_CHARS + 1))).toBeNull()
    expect(cleanChatText('👋'.repeat(MAX_CHAT_CHARS))).not.toBeNull() // 2000 emoji is 4000 UTF-16 units but 2000 characters
  })
  it('leaves markup as plain text (the page shows it as text, never as HTML)', () => {
    expect(cleanChatText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('the rate limiter', () => {
  it('allows a burst, then one message every two seconds', () => {
    let now = 0
    const b = new TokenBucket(5, 0.5, () => now)
    expect([1, 2, 3, 4, 5].map(() => b.take())).toEqual([true, true, true, true, true])
    expect(b.take()).toBe(false)
    now += 1000
    expect(b.take()).toBe(false)
    now += 1000
    expect(b.take()).toBe(true)
    expect(b.take()).toBe(false)
  })
  it('never banks more than the burst size, however long you wait', () => {
    let now = 0
    const b = new TokenBucket(3, 1, () => now)
    now += 3_600_000
    expect([1, 2, 3, 4].map(() => b.take())).toEqual([true, true, true, false])
  })
})

describe('the in-memory store', () => {
  it('lists the newest page oldest-first, and pages backwards with `before`', async () => {
    const s = new MemoryChatStore()
    for (let i = 1; i <= 7; i++) await s.append('d', { userId: 'u', name: 'U', text: `m${i}` })
    const page1 = await s.list('d', { limit: 3 })
    expect(page1.map((m) => m.text)).toEqual(['m5', 'm6', 'm7'])
    const page2 = await s.list('d', { limit: 3, before: page1[0].id })
    expect(page2.map((m) => m.text)).toEqual(['m2', 'm3', 'm4'])
    expect((await s.list('other')).length).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------------
describe('chat through the gateway', () => {
  const open: Array<{ close: () => Promise<void> }> = []
  afterEach(async () => { for (const g of open.splice(0)) await g.close() })

  const auth = ({ url }: { url: URL }) => ({
    userId: url.searchParams.get('user') ?? 'anon',
    role: (url.searchParams.get('role') ?? 'editor') as Role,
    name: url.searchParams.get('name') ?? 'Anon',
  })
  async function start(opts: Partial<Parameters<typeof createGateway>[0]> = {}) {
    const g = createGateway({ port: 0, store: new MemoryStore(), bus: new NoBus(), authorize: auth, chat: new MemoryChatStore(), idleMs: 20, ...opts })
    const port = await g.listen()
    open.push(g)
    return { g, port }
  }
  async function person(port: number, user: string, role: Role = 'editor', doc = 'room1') {
    const c = new TestClient(port, doc, `?user=${user}&role=${role}&name=${user.toUpperCase()}`)
    await c.connect()
    const got: ChatMessage[] = []
    const errs: string[][] = []
    c.ws.on('message', (d: Buffer) => {
      const dec = decoding.createDecoder(new Uint8Array(d))
      const t = decoding.readVarUint(dec)
      if (t === MSG_CHAT) got.push(JSON.parse(decoding.readVarString(dec)))
      else if (t === MSG_CHAT_ERROR) errs.push([decoding.readVarString(dec), decoding.readVarString(dec)])
    })
    const send = (text: string, cid = 'c1') => {
      const e = encoding.createEncoder()
      encoding.writeVarUint(e, MSG_CHAT)
      encoding.writeVarString(e, text)
      encoding.writeVarString(e, cid)
      c.ws.send(encoding.toUint8Array(e))
    }
    return { c, got, errs, send }
  }

  it('delivers a message to everyone in the room, the sender included, with the sender\'s id echoed', async () => {
    const { port } = await start()
    const ann = await person(port, 'ann')
    const bob = await person(port, 'bob')
    ann.send('hello team', 'abc123')
    await waitFor(() => ann.got.length === 1 && bob.got.length === 1)
    for (const got of [ann.got[0], bob.got[0]]) {
      expect(got).toMatchObject({ text: 'hello team', userId: 'ann', name: 'ANN', cid: 'abc123' })
      expect(got.id).toBeTruthy()
      expect(new Date(got.at).getTime()).toBeGreaterThan(Date.now() - 5000)
    }
  })

  it('does not leak into other documents', async () => {
    const { port } = await start()
    const ann = await person(port, 'ann', 'editor', 'room-a')
    const eve = await person(port, 'eve', 'editor', 'room-b')
    ann.send('private to room a')
    await waitFor(() => ann.got.length === 1)
    await sleep(100)
    expect(eve.got).toEqual([])
  })

  it('saves messages in order, so history survives a refresh', async () => {
    const chat = new MemoryChatStore()
    const { port } = await start({ chat })
    const ann = await person(port, 'ann')
    for (const t of ['one', 'two', 'three']) ann.send(t, t)
    await waitFor(() => ann.got.length === 3)
    expect((await chat.list('room1')).map((m) => m.text)).toEqual(['one', 'two', 'three'])
    expect(ann.got.map((m) => m.text)).toEqual(['one', 'two', 'three'])
  })

  it('takes the author from the server: a client cannot send a message as somebody else', async () => {
    const { port } = await start()
    const mallory = await person(port, 'mallory')
    mallory.send('I am the CEO')
    await waitFor(() => mallory.got.length === 1)
    expect(mallory.got[0]).toMatchObject({ userId: 'mallory', name: 'MALLORY' })
  })

  it('lets owners, editors and commenters send, and refuses viewers (who can still read)', async () => {
    const { port } = await start()
    const owner = await person(port, 'o', 'owner')
    const commenter = await person(port, 'c', 'commenter')
    const viewer = await person(port, 'v', 'viewer')
    owner.send('from owner'); commenter.send('from commenter')
    await waitFor(() => viewer.got.length === 2) // the viewer READS both
    viewer.send('let me in', 'vv')
    await waitFor(() => viewer.errs.length === 1)
    expect(viewer.errs[0]).toEqual(['vv', 'forbidden'])
    await sleep(100)
    expect(owner.got.map((m) => m.text)).toEqual(['from owner', 'from commenter']) // the viewer's message went nowhere
  })

  it('refuses empty and over-long messages, and cleans the rest', async () => {
    const chat = new MemoryChatStore()
    const { port } = await start({ chat })
    const ann = await person(port, 'ann')
    ann.send('   ', 'e1')
    ann.send('x'.repeat(MAX_CHAT_CHARS + 1), 'e2')
    await waitFor(() => ann.errs.length === 2)
    expect(ann.errs).toEqual([['e1', 'invalid'], ['e2', 'invalid']])
    ann.send('ok\u0000‮ text')
    await waitFor(() => ann.got.length === 1)
    expect(ann.got[0].text).toBe('ok text')
    expect((await chat.list('room1')).length).toBe(1)
  })

  it('rate limits per person (not per tab): a burst is allowed, then "rate"; others are unaffected', async () => {
    const { port } = await start()
    const tab1 = await person(port, 'spammer')
    const tab2 = await person(port, 'spammer')
    const other = await person(port, 'calm')
    for (let i = 0; i < 4; i++) tab1.send(`a${i}`, `a${i}`)
    for (let i = 0; i < 4; i++) tab2.send(`b${i}`, `b${i}`)
    await waitFor(() => tab1.errs.length + tab2.errs.length >= 3)
    expect(tab1.errs.concat(tab2.errs).every(([, code]) => code === 'rate')).toBe(true)
    expect(other.got.filter((m) => m.userId === 'spammer').length).toBe(5) // the burst of 5, no more
    other.send('still fine')
    await waitFor(() => other.got.some((m) => m.userId === 'calm'))
  })

  it('tells the sender when chat is not available (no store configured)', async () => {
    const { port } = await start({ chat: undefined })
    const ann = await person(port, 'ann')
    ann.send('hello', 'x')
    await waitFor(() => ann.errs.length === 1)
    expect(ann.errs[0]).toEqual(['x', 'unavailable'])
  })

  it('tells the sender when the database is down, and does not show the message to anyone', async () => {
    const broken = new MemoryChatStore()
    broken.append = async () => { throw new Error('database down') }
    const { port } = await start({ chat: broken })
    const ann = await person(port, 'ann')
    const bob = await person(port, 'bob')
    ann.send('lost?', 'x')
    await waitFor(() => ann.errs.length === 1)
    expect(ann.errs[0]).toEqual(['x', 'unavailable'])
    await sleep(100)
    expect(bob.got).toEqual([])
  })

  it('reaches people on a DIFFERENT gateway, and is saved only once', async () => {
    const hub = new LocalHub()
    const chat = new MemoryChatStore() // the shared database
    const a = await start({ bus: hub.connect('a'), chat })
    const b = await start({ bus: hub.connect('b'), chat })
    const ann = await person(a.port, 'ann')
    const bob = await person(b.port, 'bob')
    ann.send('across servers')
    await waitFor(() => bob.got.length === 1 && ann.got.length === 1)
    expect(bob.got[0]).toMatchObject({ text: 'across servers', name: 'ANN' })
    await sleep(100)
    expect((await chat.list('room1')).length).toBe(1) // not saved twice
    bob.send('and back')
    await waitFor(() => ann.got.length === 2)
  })

  it('stops a person who loses their role from sending (the next message is checked, not the join)', async () => {
    let role: Role | null = 'editor'
    const { port } = await start({ resolveRole: async () => role, recheckMs: 40 })
    const ann = await person(port, 'ann')
    ann.send('before')
    await waitFor(() => ann.got.length === 1)
    role = 'viewer'
    await sleep(150)
    ann.send('after', 'z')
    await waitFor(() => ann.errs.length === 1)
    expect(ann.errs[0]).toEqual(['z', 'forbidden'])
  })

  it('closes only the sender\'s socket on a malformed message, and the room keeps working', async () => {
    const { port } = await start()
    const bad = await person(port, 'bad')
    const good = await person(port, 'good')
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, MSG_CHAT) // a chat message with nothing after it
    bad.c.ws.send(encoding.toUint8Array(e))
    await waitFor(() => bad.c.ws.readyState !== bad.c.ws.OPEN)
    good.send('still here')
    await waitFor(() => good.got.length === 1)
  })
})

// ---------------------------------------------------------------------------------------------------
describe('chat history over HTTP, against a real MongoDB', () => {
  const SECRET = 'chat-secret-chat-secret-chat-secret-0123456'
  let store: MongoStore
  let chat: MongoChatStore
  let api: ReturnType<typeof createApi>

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT = '1000'
    store = new MongoStore('mongodb://127.0.0.1:27017', `synapse_test_chat_${Date.now()}`)
    await store.init()
    const c = collections(store.db)
    await ensureIndexes(c)
    chat = new MongoChatStore(store.db)
    await chat.init()
    api = createApi({ c, store, bus: new LocalHub().connect('x'), secret: SECRET, chat })
  })
  afterAll(async () => {
    await store.db.dropDatabase()
    await store.close()
  })

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
  async function owner(name: string) {
    const r = await request(api).post('/auth/register').send({ email: `${name}@chat.dev`, name, password: 'password123' })
    const ws = (await request(api).get('/workspaces').set(auth(r.body.token))).body[0].id
    const docs = (await request(api).get(`/workspaces/${ws}/documents`).set(auth(r.body.token))).body
    return { token: r.body.token as string, ws, doc: docs.find((d: { type: string }) => d.type === 'doc').id as string }
  }

  it('creates the indexes it relies on, including one that expires old messages', async () => {
    const idx = await store.db.collection('chat_messages').indexes()
    expect(idx.some((i) => i.key && (i.key as Record<string, number>).docId === 1 && (i.key as Record<string, number>)._id === -1)).toBe(true)
    expect(idx.find((i) => i.key && 'at' in i.key)?.expireAfterSeconds).toBe(180 * 86_400)
  })

  it('returns the newest messages oldest-first and pages backwards', async () => {
    const u = await owner('ann')
    for (let i = 1; i <= 7; i++) await chat.append(u.doc, { userId: 'u1', name: 'Ann', text: `m${i}` })
    const first = await request(api).get(`/documents/${u.doc}/chat?limit=3`).set(auth(u.token))
    expect(first.status).toBe(200)
    expect(first.body.map((m: ChatMessage) => m.text)).toEqual(['m5', 'm6', 'm7'])
    const older = await request(api).get(`/documents/${u.doc}/chat?limit=3&before=${first.body[0].id}`).set(auth(u.token))
    expect(older.body.map((m: ChatMessage) => m.text)).toEqual(['m2', 'm3', 'm4'])
    expect(first.headers['cache-control']).toBe('no-store')
  })

  it('lets a viewer read, shows strangers nothing (404) and signed-out callers 401', async () => {
    const u = await owner('bea')
    await chat.append(u.doc, { userId: 'u', name: 'Bea', text: 'secret plans' })
    const v = await request(api).post('/auth/register').send({ email: 'viewer@chat.dev', name: 'v', password: 'password123' })
    await request(api).put(`/workspaces/${u.ws}/members`).set(auth(u.token)).send({ email: 'viewer@chat.dev', role: 'viewer' })
    expect((await request(api).get(`/documents/${u.doc}/chat`).set(auth(v.body.token))).body[0].text).toBe('secret plans')
    const stranger = await request(api).post('/auth/register').send({ email: 'stranger@chat.dev', name: 's', password: 'password123' })
    expect((await request(api).get(`/documents/${u.doc}/chat`).set(auth(stranger.body.token))).status).toBe(404)
    expect((await request(api).get(`/documents/${u.doc}/chat`)).status).toBe(401)
  })

  it('rejects silly query values instead of passing them to the database', async () => {
    const u = await owner('cy')
    for (const q of ['limit=0', 'limit=101', 'limit=abc', 'before=%7B%22%24gt%22%3A%22%22%7D', 'before=ZZZ']) {
      expect((await request(api).get(`/documents/${u.doc}/chat?${q}`).set(auth(u.token))).status, q).toBe(400)
    }
  })

  it('keeps each document\'s chat separate, and deleteDocument removes it', async () => {
    const u = await owner('dee')
    const docs = (await request(api).get(`/workspaces/${u.ws}/documents`).set(auth(u.token))).body
    const other = docs.find((d: { id: string }) => d.id !== u.doc).id
    await chat.append(u.doc, { userId: 'u', name: 'Dee', text: 'in the doc' })
    await chat.append(other, { userId: 'u', name: 'Dee', text: 'in the board' })
    expect((await chat.list(u.doc)).map((m) => m.text)).toEqual(['in the doc'])
    await chat.deleteDocument(u.doc)
    expect(await chat.list(u.doc)).toEqual([])
    expect((await chat.list(other)).length).toBe(1)
  })

  it('/config says whether chat is on', async () => {
    expect((await request(api).get('/config')).body.chat).toBe(true)
    const c = collections(store.db)
    const off = createApi({ c, store, bus: new LocalHub().connect('y'), secret: SECRET })
    expect((await request(off).get('/config')).body.chat).toBe(false)
  })
})

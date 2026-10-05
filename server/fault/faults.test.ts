// Fault injection: break real components while people are editing and check what
// survives. Real gateway processes, real MongoDB and Redis (private instances).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { TestClient, waitFor } from '../test/helpers.js'
import { setupDoc, startGateway, type Gateway } from '../bench/lib.js'
import { MongoStore } from '../src/mongoStore.js'
import { health, newMongo, newRedis, sleep, waitPort } from './infra.js'

const MONGO_PORT = 27090
const REDIS_PORT = 6390
const MONGO = `mongodb://127.0.0.1:${MONGO_PORT}`
const REDIS = `redis://127.0.0.1:${REDIS_PORT}`
const mongo = newMongo(MONGO_PORT)
const redis = newRedis(REDIS_PORT)
const started: Gateway[] = []

const gateway = async (port: number, db: string, opts: { redis?: boolean | string } = {}) => {
  const g = await startGateway(port, db, { mongoUrl: MONGO, ...opts })
  started.push(g)
  return g
}
const client = (g: Gateway, docId: string, token: string) => new TestClient(g.port, docId, `?token=${token}`)
const type = (c: TestClient, s: string) => { const t = c.doc.getText('body'); t.insert(t.length, s) }

// Reconnect a client's EXISTING document (like a browser with an IndexedDB copy)
async function reconnect(g: Gateway, docId: string, token: string, doc: Y.Doc, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const c = client(g, docId, token)
    c.doc = doc
    try { await c.connect(); return c } catch { await sleep(250) }
  }
  throw new Error('could not reconnect')
}

beforeAll(async () => { await mongo.start() })
afterAll(async () => {
  for (const g of started) await g.kill()
  if (redis.running) await redis.kill()
  if (mongo.running) await mongo.kill()
})

describe('F1: Redis dies mid-session and comes back', () => {
  it('local editing survives, and gateways converge again after Redis returns', async () => {
    await redis.start()
    const db = `f1_${Date.now()}`
    const s = await setupDoc(db, 3, MONGO)
    const g1 = await gateway(4201, db, { redis: REDIS })
    const g2 = await gateway(4202, db, { redis: REDIS })
    const a = client(g1, s.docId, s.tokens[0]) // editor on gateway 1
    const c = client(g1, s.docId, s.tokens[1]) // second person on gateway 1
    const b = client(g2, s.docId, s.tokens[2]) // person on gateway 2
    await a.connect(); await c.connect(); await b.connect()
    await sleep(400)
    type(a, 'one ')
    await waitFor(() => b.text() === 'one ')

    await redis.kill() // crash
    await sleep(500)
    type(a, 'two ')
    await waitFor(() => c.text() === 'one two ') // same gateway still works
    expect((await health(4201))?.ok).toBe(true)  // gateways did not crash
    expect((await health(4202))?.ok).toBe(true)
    await sleep(500)
    expect(b.text()).toBe('one ') // different gateway cannot see "two" during the outage (expected)

    await redis.start() // Redis returns (empty, as after a real restart)
    await sleep(3000)   // give clients of ioredis time to reconnect and resubscribe
    type(a, 'three ')   // a NEW edit after recovery
    // The question: does B ever get "two"? A relayed message was lost during the outage.
    await waitFor(() => b.text().includes('three '), 10_000)
    await waitFor(() => b.text() === a.text(), 20_000) // heals within 20 s
    await s.drop(); a.close(); b.close(); c.close()
  })
})

describe('F1b: a LONG Redis outage (longer than the client library queues commands)', () => {
  it('gateways converge again once Redis returns', async () => {
    if (!redis.running) await redis.start()
    const db = `f1b_${Date.now()}`
    const s = await setupDoc(db, 2, MONGO)
    const g1 = await gateway(4208, db, { redis: REDIS })
    const g2 = await gateway(4209, db, { redis: REDIS })
    const a = client(g1, s.docId, s.tokens[0]); const b = client(g2, s.docId, s.tokens[1])
    await a.connect(); await b.connect()
    await sleep(400)
    type(a, 'one ')
    await waitFor(() => b.text() === 'one ')

    await redis.kill()
    type(a, 'two ') // published into the void
    await sleep(45_000) // longer than the Redis client keeps retrying a command
    await redis.start()
    await sleep(4000)
    type(a, 'three ')
    await waitFor(() => b.text().includes('three '), 10_000)
    await waitFor(() => b.text() === a.text(), 20_000) // B must also get "two"
    await s.drop(); a.close(); b.close()
  })
})

describe('F3: a gateway is killed right after a burst of edits', () => {
  it('no edit is lost: clients resend what the restarted gateway is missing', async () => {
    const db = `f3_${Date.now()}`
    const s = await setupDoc(db, 2, MONGO)
    let g = await gateway(4203, db)
    const a = client(g, s.docId, s.tokens[0])
    const b = client(g, s.docId, s.tokens[1])
    await a.connect(); await b.connect()
    await sleep(300)
    for (let i = 0; i < 60; i++) type(a, `a${i} `)
    await g.kill() // killed immediately: some edits were never stored
    await sleep(300)
    for (let i = 0; i < 20; i++) type(b, `b${i} `) // b keeps typing while the server is dead

    g = await gateway(4203, db) // restart on the same port
    const a2 = await reconnect(g, s.docId, s.tokens[0], a.doc)
    const b2 = await reconnect(g, s.docId, s.tokens[1], b.doc)
    await waitFor(() => a2.text() === b2.text(), 15_000)
    for (let i = 0; i < 60; i++) expect(a2.text()).toContain(`a${i} `)
    for (let i = 0; i < 20; i++) expect(a2.text()).toContain(`b${i} `)
    await sleep(1500)
    const store = new MongoStore(MONGO, db); await store.init()
    const stored = await store.currentText(s.docId)
    for (let i = 0; i < 60; i++) expect(stored).toContain(`a${i} `) // and it is really in the database
    for (let i = 0; i < 20; i++) expect(stored).toContain(`b${i} `)
    await store.close(); await s.drop(); a2.close(); b2.close()
  })
})

describe('F4: garbage, truncated and oversized WebSocket messages', () => {
  it('never crashes the gateway or corrupts the document', async () => {
    const db = `f4_${Date.now()}`
    const s = await setupDoc(db, 3, MONGO)
    const g = await gateway(4204, db)
    const a = client(g, s.docId, s.tokens[0]); const b = client(g, s.docId, s.tokens[1])
    await a.connect(); await b.connect()
    type(a, 'important text')
    await waitFor(() => b.text() === 'important text')

    // a real update, then truncated copies of it
    const real = Y.encodeStateAsUpdate(a.doc)
    const framed = Buffer.concat([Buffer.from([0, 2, real.length]), Buffer.from(real)])
    const bad: Buffer[] = [
      Buffer.alloc(0), Buffer.from([0xff]), Buffer.from([0]), Buffer.from([1]),
      Buffer.from([0, 2, 255, 255, 255, 255, 255, 255]),
      Buffer.from([0, 1, 200, ...Array.from({ length: 50 }, (_, i) => (i * 37) % 256)]),
      Buffer.from([1, 255, 255, 255, 255, 15]),
      framed.subarray(0, 9), framed.subarray(0, framed.length - 3),
      Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 131 + 7) % 256)),
    ]
    for (const payload of bad) {
      const evil = new WebSocket(`ws://127.0.0.1:${g.port}/collab/${s.docId}?token=${s.tokens[2]}`)
      await new Promise<void>((res) => { evil.on('open', () => res()); evil.on('error', () => res()) })
      evil.on('error', () => {})
      evil.send(payload)
      await sleep(80)
      evil.close()
    }
    // an oversized message (the gateway limit is 8 MB)
    const big = new WebSocket(`ws://127.0.0.1:${g.port}/collab/${s.docId}?token=${s.tokens[2]}`)
    await new Promise<void>((res) => { big.on('open', () => res()); big.on('error', () => res()) })
    big.on('error', () => {})
    big.send(Buffer.alloc(9 * 1024 * 1024, 7))
    await sleep(800)
    big.terminate()

    expect(g.exited()).toBe(false)          // still running
    expect((await health(g.port))?.ok).toBe(true)
    type(a, ' + more') // honest users are unaffected
    await waitFor(() => b.text() === 'important text + more')
    expect(a.text()).toBe('important text + more')
    await s.drop(); a.close(); b.close()
  })
})

describe('F5: Redis is already down when a gateway starts', () => {
  it('starts anyway and serves people on that gateway', async () => {
    const db = `f5_${Date.now()}`
    const s = await setupDoc(db, 2, MONGO)
    expect(redis.running).toBe(true)
    await redis.kill()
    const g = await gateway(4205, db, { redis: REDIS })
    const a = client(g, s.docId, s.tokens[0]); const b = client(g, s.docId, s.tokens[1])
    await a.connect(); await b.connect()
    type(a, 'works without redis')
    await waitFor(() => b.text() === 'works without redis')
    expect(g.exited()).toBe(false)
    await s.drop(); a.close(); b.close()
  })
})

describe('F2: MongoDB dies mid-session and comes back', () => {
  it('live editing continues, new joins fail safely, and nothing typed is lost', async () => {
    const db = `f2_${Date.now()}`
    const s = await setupDoc(db, 3, MONGO)
    const g = await gateway(4206, db)
    const a = client(g, s.docId, s.tokens[0]); const b = client(g, s.docId, s.tokens[1])
    await a.connect(); await b.connect()
    type(a, 'before ')
    await waitFor(() => b.text() === 'before ')
    await sleep(500)

    await mongo.kill() // database crash
    type(a, 'during-1 ')
    type(b, 'during-2 ')
    await waitFor(() => a.text().includes('during-2 ') && b.text().includes('during-1 ')) // still live
    expect(g.exited()).toBe(false)
    // a NEW person cannot be authorised while the database is down: refused, not crashed
    const late = client(g, s.docId, s.tokens[2])
    await expect(late.connect()).rejects.toBeTruthy()
    expect(g.exited()).toBe(false)

    await mongo.start() // database returns with its data
    await sleep(500)
    type(a, 'after ')
    await waitFor(() => b.text().includes('after '))
    // a newcomer can join again and sees everything
    let c2: TestClient | null = null
    for (let i = 0; i < 40 && !c2; i++) { const t = client(g, s.docId, s.tokens[2]); try { await t.connect(); c2 = t } catch { await sleep(500) } }
    expect(c2).not.toBeNull()
    await waitFor(() => c2!.text() === a.text(), 10_000)
    // and it is in the DATABASE, not just in the gateway's memory
    await sleep(6000)
    const store = new MongoStore(MONGO, db); await store.init()
    const stored = await store.currentText(s.docId)
    for (const word of ['before ', 'during-1 ', 'during-2 ', 'after ']) expect(stored).toContain(word)
    await store.close(); await s.drop(); a.close(); b.close(); c2!.close()
  })
})

describe('F6: MongoDB is down when a gateway starts', () => {
  it('fails fast with an error instead of hanging', async () => {
    expect(mongo.running).toBe(true)
    await mongo.kill()
    const t0 = Date.now()
    await expect(startGateway(4207, `f6_${Date.now()}`, { mongoUrl: MONGO })).rejects.toThrow()
    expect(Date.now() - t0).toBeLessThan(15_000)
  })
})

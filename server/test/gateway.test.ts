import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createGateway } from '../src/gateway.js'
import { LocalHub, NoBus } from '../src/bus.js'
import { MemoryStore } from '../src/store.js'
import type { Role } from '../src/room.js'
import { TestClient, waitFor } from './helpers.js'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const open: Array<{ close: () => Promise<void> }> = []
afterEach(async () => {
  for (const g of open.splice(0)) await g.close()
})

const devAuth = ({ url }: { url: URL }) => ({
  userId: url.searchParams.get('user') ?? 'anon',
  role: (url.searchParams.get('role') ?? 'editor') as Role,
})

async function start(opts: Partial<Parameters<typeof createGateway>[0]> = {}) {
  const g = createGateway({
    port: 0,
    store: new MemoryStore(),
    bus: new NoBus(),
    authorize: devAuth,
    idleMs: 20,
    ...opts,
  })
  const port = await g.listen()
  open.push(g)
  return { g, port }
}

describe('gateway', () => {
  it('syncs two editors in the same room', async () => {
    const { port } = await start()
    const a = new TestClient(port, 'doc1')
    const b = new TestClient(port, 'doc1')
    await a.connect()
    await b.connect()
    a.doc.getText('body').insert(0, 'hello')
    await waitFor(() => b.text() === 'hello')
    b.doc.getText('body').insert(5, ' world')
    await waitFor(() => a.text() === 'hello world')
  })

  it('rapid join/leave churn never splits a document into two rooms', async () => {
    const { port, g } = await start({ idleMs: 5 })
    for (let i = 0; i < 15; i++) {
      const c = new TestClient(port, 'churn')
      await c.connect()
      c.close()
      await new Promise((r) => setTimeout(r, 3 + (i % 4) * 2)) // land near the idle timer
    }
    const a = new TestClient(port, 'churn')
    const b = new TestClient(port, 'churn')
    await a.connect()
    await b.connect()
    a.doc.getText('body').insert(0, 'still one room')
    await waitFor(() => b.text() === 'still one room')
    expect(g.rooms.size).toBe(1)
  })

  it('does not leak between rooms', async () => {
    const { port } = await start()
    const a = new TestClient(port, 'room-a')
    const b = new TestClient(port, 'room-b')
    await a.connect()
    await b.connect()
    a.doc.getText('body').insert(0, 'secret')
    await new Promise((r) => setTimeout(r, 100))
    expect(b.text()).toBe('')
  })

  it('drops writes from viewers but lets them read', async () => {
    const { port } = await start()
    const editor = new TestClient(port, 'perm', '?role=editor')
    const viewer = new TestClient(port, 'perm', '?role=viewer')
    await editor.connect()
    await viewer.connect()
    editor.doc.getText('body').insert(0, 'from editor')
    await waitFor(() => viewer.text() === 'from editor') // viewers can read
    viewer.doc.getText('body').insert(0, 'HACK ')
    await new Promise((r) => setTimeout(r, 150))
    expect(editor.text()).toBe('from editor') // the write never landed
  })

  it('rejects an invalid doc path', async () => {
    const { port } = await start()
    const c = new TestClient(port, '../etc')
    await expect(c.connect()).rejects.toBeTruthy()
  })

  it('persists and reloads a document, with compaction', async () => {
    const store = new MemoryStore()
    const { port } = await start({ store, compactEvery: 3 })
    const a = new TestClient(port, 'saved')
    await a.connect()
    const t = a.doc.getText('body')
    for (let i = 0; i < 7; i++) t.insert(t.length, `${i}`)
    await waitFor(() => a.text() === '0123456')
    a.close()
    await waitFor(() => false, 200).catch(() => {}) // let the room idle out and flush
    const stored = await store.load('saved')
    expect(stored.snapshot).not.toBeNull() // compaction happened
    expect(stored.updates.length).toBeLessThan(3)

    const b = new TestClient(port, 'saved')
    await b.connect()
    await waitFor(() => b.text() === '0123456')
  })

  it('relays between two gateways through the bus', async () => {
    const hub = new LocalHub()
    const store = new MemoryStore() // shared, like MongoDB would be
    const g1 = await start({ store, bus: hub.connect('g1') })
    const g2 = await start({ store, bus: hub.connect('g2') })
    const a = new TestClient(g1.port, 'shared')
    const b = new TestClient(g2.port, 'shared')
    await a.connect()
    await b.connect()
    a.doc.getText('body').insert(0, 'across gateways')
    await waitFor(() => b.text() === 'across gateways')
  })
})

describe('gateway with Redis', () => {
  it('relays between two gateways through real Redis', async () => {
    const { RedisBus } = await import('../src/redisBus.js')
    const url = 'redis://localhost:6379'
    const b1 = new RedisBus(url, 'gw-1')
    const b2 = new RedisBus(url, 'gw-2')
    const store = new MemoryStore()
    const g1 = await start({ store, bus: b1 })
    const g2 = await start({ store, bus: b2 })
    // registered after the gateways, so they close first and the buses last
    open.push({ close: () => b1.close() }, { close: () => b2.close() })
    const a = new TestClient(g1.port, 'redis-doc')
    const b = new TestClient(g2.port, 'redis-doc')
    await a.connect()
    await b.connect()
    await new Promise((r) => setTimeout(r, 100)) // let the subscriptions settle
    a.doc.getText('body').insert(0, 'via redis')
    await waitFor(() => b.text() === 'via redis')
    b.doc.getText('body').insert(9, '!')
    await waitFor(() => a.text() === 'via redis!')
  })
})

describe('text extraction', () => {
  it('turns a Tiptap document into searchable plain text', async () => {
    const { extractText } = await import('../src/text.js')
    const doc = new Y.Doc()
    const frag = doc.getXmlFragment('default')
    const p1 = new Y.XmlElement('paragraph')
    p1.insert(0, [new Y.XmlText('Quarterly roadmap')])
    const p2 = new Y.XmlElement('paragraph')
    p2.insert(0, [new Y.XmlText('Ship the editor')])
    frag.insert(0, [p1, p2])
    expect(extractText(doc)).toBe('Quarterly roadmap\nShip the editor')
  })
})

describe('self-healing', () => {
  it('a gateway that missed relay messages heals by re-reading the store', async () => {
    const { LocalHub } = await import('../src/bus.js')
    type BusT = ReturnType<InstanceType<typeof LocalHub>['connect']>
    const hub = new LocalHub()
    const store = new MemoryStore()
    // gateway 1 publishes to nobody: every relay message is "lost"
    const lossy = (b: BusT): BusT => ({ ...b, publish: () => {} })
    const g1 = await start({ store, bus: lossy(hub.connect('g1')), resyncMs: 150 })
    const g2 = await start({ store, bus: hub.connect('g2'), resyncMs: 150 })
    const a = new TestClient(g1.port, 'heal')
    const b = new TestClient(g2.port, 'heal')
    await a.connect()
    await b.connect()
    a.doc.getText('body').insert(0, 'only reachable through the store')
    await waitFor(() => b.text() === 'only reachable through the store', 4000)
  })

  it('keeps edits made while the database is down and saves them when it returns', async () => {
    const inner = new MemoryStore()
    let down = false
    const flaky = {
      load: (id: string) => inner.load(id),
      compact: (id: string) => inner.compact(id),
      appendUpdate: async (id: string, u: Uint8Array) => {
        if (down) throw new Error('database unavailable')
        return inner.appendUpdate(id, u)
      },
    }
    const { port } = await start({ store: flaky })
    const a = new TestClient(port, 'flaky')
    await a.connect()
    a.doc.getText('body').insert(0, 'before ')
    await sleep(100)
    down = true
    a.doc.getText('body').insert(7, 'during ') // typed while the database is down
    a.doc.getText('body').insert(14, 'also-during ')
    await sleep(300)
    down = false
    // the gateway retries on its own (1 s backoff) and writes the full state
    const storedText = async () => {
      const stored = await inner.load('flaky')
      const doc = new Y.Doc()
      if (stored.snapshot) Y.applyUpdate(doc, stored.snapshot)
      stored.updates.forEach((u) => Y.applyUpdate(doc, u))
      return doc.getText('body').toString()
    }
    const deadline = Date.now() + 6000
    let text = await storedText()
    while (!text.includes('also-during ') && Date.now() < deadline) {
      await sleep(200)
      text = await storedText()
    }
    expect(text).toContain('before ')
    expect(text).toContain('during ')
    expect(text).toContain('also-during ')
  })
})

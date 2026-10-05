import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MongoStore } from '../src/mongoStore.js'
import { mergeStored } from '../src/store.js'
import { createGateway } from '../src/gateway.js'
import { NoBus } from '../src/bus.js'
import { TestClient, waitFor } from './helpers.js'

const dbName = `synapse_test_${Date.now()}`
let store: MongoStore

beforeAll(async () => {
  store = new MongoStore('mongodb://127.0.0.1:27017', dbName)
  await store.init()
})
afterAll(async () => {
  await store.db.dropDatabase()
  await store.close()
})

// make an update that inserts `text` at the end of doc.getText('body')
function edit(doc: Y.Doc, text: string) {
  let captured!: Uint8Array
  const h = (u: Uint8Array) => (captured = u)
  doc.on('update', h)
  doc.getText('body').insert(doc.getText('body').length, text)
  doc.off('update', h)
  return captured
}

describe('MongoStore', () => {
  it('stores updates in order and loads them back', async () => {
    const doc = new Y.Doc()
    for (const t of ['a', 'b', 'c']) await store.appendUpdate('d1', edit(doc, t))
    const loaded = await store.load('d1')
    expect(loaded.snapshot).toBeNull()
    expect(loaded.updates).toHaveLength(3)
    const rebuilt = new Y.Doc()
    Y.applyUpdate(rebuilt, mergeStored(loaded))
    expect(rebuilt.getText('body').toString()).toBe('abc')
  })

  it('compaction keeps content, shrinks the log, and is repeatable', async () => {
    const doc = new Y.Doc()
    for (const t of ['x', 'y', 'z']) await store.appendUpdate('d2', edit(doc, t))
    await store.compact('d2')
    let loaded = await store.load('d2')
    expect(loaded.snapshot).not.toBeNull()
    expect(loaded.updates).toHaveLength(0)
    await store.appendUpdate('d2', edit(doc, '!'))
    await store.compact('d2')
    loaded = await store.load('d2')
    expect(loaded.updates).toHaveLength(0)
    expect(await store.snapshots.countDocuments({ docId: 'd2', label: null })).toBe(1) // old ones pruned
    expect(await store.currentText('d2')).toBe('xyz!')
  })

  it('compact with nothing new does nothing', async () => {
    await store.compact('never-existed')
    expect((await store.load('never-existed')).snapshot).toBeNull()
  })

  it('does not lose an update written by another gateway during compaction', async () => {
    // Two writers (think: two gateways) hammer the same doc while compaction runs
    const a = new Y.Doc()
    const b = new Y.Doc()
    const writes: Promise<unknown>[] = []
    for (let i = 0; i < 20; i++) {
      writes.push(store.appendUpdate('d3', edit(a, `a${i} `)))
      writes.push(store.appendUpdate('d3', edit(b, `b${i} `)))
      if (i % 5 === 0) writes.push(store.compact('d3'))
    }
    await Promise.all(writes)
    const text = await store.currentText('d3')
    for (let i = 0; i < 20; i++) {
      expect(text).toContain(`a${i} `)
      expect(text).toContain(`b${i} `)
    }
  })

  it('keeps named versions separate from compaction', async () => {
    const doc = new Y.Doc()
    await store.appendUpdate('d4', edit(doc, 'draft one'))
    const v = await store.saveNamedVersion('d4', 'First draft', 'ravi')
    await store.appendUpdate('d4', edit(doc, ' + more'))
    await store.compact('d4')
    await store.compact('d4')
    const list = await store.listVersions('d4')
    expect(list.map((x) => x.label)).toEqual(['First draft'])
    const state = await store.getVersionState('d4', v)
    const old = new Y.Doc()
    Y.applyUpdate(old, state!)
    expect(old.getText('body').toString()).toBe('draft one') // history survives compaction
    expect(await store.currentText('d4')).toBe('draft one + more')
  })

  it('a gateway restart loses nothing (end to end through MongoDB)', async () => {
    const make = () => createGateway({ port: 0, store, bus: new NoBus(), idleMs: 20, compactEvery: 4,
      authorize: () => ({ userId: 'u', role: 'editor' }) })
    let g = make()
    let port = await g.listen()
    const a = new TestClient(port, 'persist-e2e')
    await a.connect()
    for (let i = 0; i < 9; i++) a.doc.getText('body').insert(a.doc.getText('body').length, `${i}`)
    await waitFor(() => a.text() === '012345678')
    await new Promise((r) => setTimeout(r, 200))
    a.close()
    await g.close() // simulates stopping the server

    g = make()
    port = await g.listen()
    const b = new TestClient(port, 'persist-e2e')
    await b.connect()
    await waitFor(() => b.text() === '012345678')
    await g.close()
  })

  it('has the indexes the queries rely on', async () => {
    const idx = await store.updates.indexes()
    expect(idx.some((i) => i.key.docId === 1 && i.key.seq === 1 && i.unique)).toBe(true)
    // explain plan: loading a doc must use the index, not scan the collection
    const plan = await store.updates.find({ docId: 'd3', seq: { $gt: 0 } }).sort({ seq: 1 }).explain('queryPlanner')
    expect(JSON.stringify(plan)).toContain('IXSCAN')
  })
})

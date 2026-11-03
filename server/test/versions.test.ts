import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { createGateway } from '../src/gateway.js'
import { NoBus } from '../src/bus.js'
import { MemoryStore, type VersionStore } from '../src/store.js'
import { MSG_SAVE_VERSION, MSG_VERSION_ERROR, MSG_VERSION_SAVED, type Role } from '../src/room.js'
import { TestClient, waitFor } from './helpers.js'

const open: Array<{ close: () => Promise<void> }> = []
afterEach(async () => { for (const g of open.splice(0)) await g.close() })

// A version store that remembers what it was asked to save
function recorder(opts: { failWith?: string } = {}) {
  const saved: Array<{ docId: string; label: string; userId: string; state: Uint8Array }> = []
  const store: VersionStore = {
    saveNamedVersion: async (docId, label, userId, liveState) => {
      if (opts.failWith) throw new Error(opts.failWith)
      saved.push({ docId, label, userId, state: liveState! })
      return saved.length
    },
  }
  return { saved, store }
}

async function start(versions?: VersionStore) {
  const g = createGateway({
    port: 0, store: new MemoryStore(), bus: new NoBus(), idleMs: 20, versions,
    authorize: ({ url }) => ({ userId: url.searchParams.get('user') ?? 'anon', role: (url.searchParams.get('role') ?? 'editor') as Role }),
  })
  const port = await g.listen()
  open.push(g)
  return port
}

async function person(port: number, user: string, role: Role = 'editor') {
  const c = new TestClient(port, 'doc1', `?user=${user}&role=${role}`)
  await c.connect()
  await waitFor(() => c.synced)
  const replies: Array<{ type: number; cid: string; value: string | number }> = []
  c.ws.on('message', (d: Buffer) => {
    const dec = decoding.createDecoder(new Uint8Array(d))
    const type = decoding.readVarUint(dec)
    if (type === MSG_VERSION_SAVED) replies.push({ type, cid: decoding.readVarString(dec), value: decoding.readVarUint(dec) })
    else if (type === MSG_VERSION_ERROR) replies.push({ type, cid: decoding.readVarString(dec), value: decoding.readVarString(dec) })
  })
  const save = (label: string, cid = 'c1') => {
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, MSG_SAVE_VERSION)
    encoding.writeVarString(e, label)
    encoding.writeVarString(e, cid)
    c.ws.send(encoding.toUint8Array(e))
  }
  return { c, replies, save }
}

const textOf = (state: Uint8Array) => {
  const d = new Y.Doc()
  Y.applyUpdate(d, state)
  return d.getText('body').toString()
}

describe('saving a named version through the live connection', () => {
  it('contains the edit typed an instant before pressing Save (that is the whole point)', async () => {
    const { saved, store } = recorder()
    const ann = await person(await start(store), 'ann')
    ann.c.doc.getText('body').insert(0, 'typed just now')
    ann.save('Draft') // sent straight after the edit, on the same connection
    await waitFor(() => ann.replies.length === 1)
    expect(ann.replies[0]).toEqual({ type: MSG_VERSION_SAVED, cid: 'c1', value: 1 })
    expect(textOf(saved[0].state)).toBe('typed just now')
  })

  it('records who saved it, which document, and the tidied-up label', async () => {
    const { saved, store } = recorder()
    const ann = await person(await start(store), 'ann')
    ann.save('  Before   the big change  ')
    await waitFor(() => ann.replies.length === 1)
    expect(saved[0]).toMatchObject({ docId: 'doc1', userId: 'ann', label: 'Before the big change' })
  })

  it('sees what other people typed too, not just the saver', async () => {
    const { saved, store } = recorder()
    const port = await start(store)
    const ann = await person(port, 'ann')
    const bob = await person(port, 'bob')
    bob.c.doc.getText('body').insert(0, 'from bob')
    await waitFor(() => ann.c.text() === 'from bob')
    ann.save('together')
    await waitFor(() => ann.replies.length === 1)
    expect(textOf(saved[0].state)).toBe('from bob')
  })

  it('refuses viewers and commenters, and saves nothing', async () => {
    const { saved, store } = recorder()
    const port = await start(store)
    for (const role of ['viewer', 'commenter'] as const) {
      const p = await person(port, role, role)
      p.save('nope', 'x')
      await waitFor(() => p.replies.length === 1)
      expect(p.replies[0]).toEqual({ type: MSG_VERSION_ERROR, cid: 'x', value: 'forbidden' })
    }
    expect(saved).toEqual([])
  })

  it('refuses an empty or over-long label', async () => {
    const { saved, store } = recorder()
    const ann = await person(await start(store), 'ann')
    ann.save('   ', 'a')
    ann.save('x'.repeat(81), 'b')
    await waitFor(() => ann.replies.length === 2)
    expect(ann.replies.map((r) => r.value)).toEqual(['invalid', 'invalid'])
    expect(saved).toEqual([])
  })

  it('limits how fast one person can save', async () => {
    const { store } = recorder()
    const ann = await person(await start(store), 'ann')
    for (let i = 0; i < 7; i++) ann.save(`v${i}`, `c${i}`)
    await waitFor(() => ann.replies.length === 7)
    expect(ann.replies.filter((r) => r.type === MSG_VERSION_SAVED)).toHaveLength(5)
    expect(ann.replies.filter((r) => r.value === 'rate')).toHaveLength(2)
  })

  it('says so when the database fails, or when versions are not available at all', async () => {
    const broken = await person(await start(recorder({ failWith: 'database down' }).store), 'ann')
    broken.save('x')
    await waitFor(() => broken.replies.length === 1)
    expect(broken.replies[0].value).toBe('unavailable')
    const none = await person(await start(undefined), 'bob')
    none.save('x')
    await waitFor(() => none.replies.length === 1)
    expect(none.replies[0].value).toBe('unavailable')
  })

  it('answers each request with its own id', async () => {
    const { store } = recorder()
    const ann = await person(await start(store), 'ann')
    ann.save('first', 'one')
    ann.save('second', 'two')
    await waitFor(() => ann.replies.length === 2)
    expect(ann.replies.map((r) => r.cid).sort()).toEqual(['one', 'two'])
  })
})

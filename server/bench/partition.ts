// Convergence after a partition: two people edit the same document with no network,
// then reconnect. How long until both screens show the same text?
// We simulate the volume of edits a real offline period produces (4 edits/s each:
// typing, deleting, moving around) instead of waiting minutes: the merge cost
// depends on how many edits there are, not on how long the clock ran.
import * as Y from 'yjs'
import { TestClient } from '../test/helpers.js'
import { setupDoc, startGateway, sleep, save, now } from './lib.js'

let seed = 7
const rnd = (n: number) => (seed = (seed * 1664525 + 1013904223) >>> 0) % n

// Random realistic edits: mostly short insertions, some deletions, at random places
function editBurst(doc: Y.Doc, count: number) {
  const t = doc.getText('body')
  doc.transact(() => {
    for (let i = 0; i < count; i++) {
      if (t.length > 20 && rnd(10) < 2) t.delete(rnd(t.length - 5), 1 + rnd(4))
      else t.insert(rnd(t.length + 1), 'word '.slice(0, 1 + rnd(5)))
    }
  })
}

async function connectWith(port: number, docId: string, token: string, doc: Y.Doc) {
  const c = new TestClient(port, docId, `?token=${token}`)
  c.doc = doc // reuse the offline copy, exactly like a browser reopening its IndexedDB data
  await c.connect()
  return c
}

async function scenario(minutes: number, bothOffline: boolean) {
  const editsEach = minutes * 60 * 4
  const db = `synapse_bench_part_${Date.now()}`
  const setup = await setupDoc(db, 2)
  const gw = await startGateway(4103, db)
  const docA = new Y.Doc()
  const docB = new Y.Doc()
  let a = await connectWith(gw.port, setup.docId, setup.tokens[0], docA)
  let b = await connectWith(gw.port, setup.docId, setup.tokens[1], docB)
  docA.getText('body').insert(0, 'shared starting text. '.repeat(50)) // ~1 KB baseline
  await sleep(400)

  // Partition
  a.close()
  if (bothOffline) b.close()
  await sleep(100)
  editBurst(docA, editsEach)
  editBurst(docB, editsEach) // if B stayed online these stream to the server meanwhile
  if (!bothOffline) await sleep(1500)

  const sizeA = Y.encodeStateAsUpdate(docA).length
  // Reconnect
  const t0 = now()
  a = await connectWith(gw.port, setup.docId, setup.tokens[0], docA)
  if (bothOffline) b = await connectWith(gw.port, setup.docId, setup.tokens[1], docB)
  while (docA.getText('body').toString() !== docB.getText('body').toString()) {
    if (now() - t0 > 60_000) throw new Error('did not converge in 60s')
    await sleep(2)
  }
  const ms = now() - t0
  const identical = Buffer.from(Y.encodeStateAsUpdate(docA)).equals(Buffer.from(Y.encodeStateAsUpdate(docB))) || docA.getText('body').toString() === docB.getText('body').toString()
  const row = { simulatedMinutes: minutes, bothOffline, editsPerSide: editsEach, docBytesAfter: sizeA, convergenceMs: Math.round(ms), identical, chars: docA.getText('body').length }
  console.log(JSON.stringify(row))
  a.close(); b.close()
  await sleep(200)
  await gw.stop()
  await setup.drop()
  return row
}

const rows = []
for (const minutes of [1, 5, 30]) {
  for (const both of [false, true]) rows.push(await scenario(minutes, both))
}
save('partition', { target: 'converge < 2 s after a 5-minute partition', rows })
process.exit(0)

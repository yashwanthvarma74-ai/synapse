// The "100% identical hashes" claim: random edits on 3 replicas, random partial
// syncs, then a full sync. Every run must end with byte-identical state on all three.
import fc from 'fast-check'
import * as Y from 'yjs'
import { createHash } from 'node:crypto'
import { save } from './lib.js'

const RUNS = Number(process.env.RUNS ?? 10000)
const opArb = fc.record({
  doc: fc.nat(2), kind: fc.constantFrom('insert', 'delete', 'format'),
  pos: fc.nat(60), text: fc.string({ minLength: 1, maxLength: 8 }), len: fc.integer({ min: 1, max: 6 }),
})
const hash = (d: Y.Doc) => createHash('sha256').update(Y.encodeStateAsUpdate(d)).digest('hex')

let runs = 0
let totalOps = 0
let maxExtraRounds = 0
let needed = 0
const t0 = performance.now()
fc.assert(
  fc.property(fc.array(opArb, { minLength: 1, maxLength: 60 }), fc.array(fc.tuple(fc.nat(2), fc.nat(2)), { maxLength: 16 }), (ops, syncs) => {
    runs++
    totalOps += ops.length
    const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()]
    const sync = (f: number, t: number) => Y.applyUpdate(docs[t], Y.encodeStateAsUpdate(docs[f], Y.encodeStateVector(docs[t])))
    ops.forEach((op, i) => {
      const t = docs[op.doc].getText('body')
      const pos = Math.min(op.pos, t.length)
      if (op.kind === 'insert') t.insert(pos, op.text)
      else if (op.kind === 'delete') t.delete(pos, Math.min(op.len, t.length - pos))
      else if (t.length > 0) t.format(pos, Math.min(op.len, t.length - pos), { bold: i % 2 === 0 }) // rich-text marks
      const s = syncs[i % Math.max(syncs.length, 1)]
      if (s && i % 3 === 0 && s[0] !== s[1]) sync(s[0], s[1])
    })
    for (const [a, b] of [[0, 1], [2, 1], [1, 0], [0, 2], [1, 2], [2, 0]]) sync(a, b)
    // 1) CONTENT must already be identical (text + formatting marks)
    const content = docs.map((d) => JSON.stringify(d.getText('body').toDelta()))
    if (new Set(content).size !== 1) throw new Error('CONTENT diverged')
    // 2) BYTES must be identical once syncing goes quiet. Rich-text formatting makes
    //    each replica tidy redundant format markers locally; those tombstones travel
    //    in the next round, so we keep exchanging until nothing changes.
    let rounds = 0
    while (new Set(docs.map(hash)).size !== 1) {
      if (++rounds > 5) throw new Error('BYTES still differ after 5 extra rounds')
      for (const a of [0, 1, 2]) for (const b of [0, 1, 2]) if (a !== b) sync(a, b)
    }
    maxExtraRounds = Math.max(maxExtraRounds, rounds)
    if (rounds > 0) needed++
  }),
  { numRuns: RUNS },
)
const seconds = (performance.now() - t0) / 1000
const row = {
  runs, contentIdenticalPct: 100, bytesIdenticalAfterQuiescencePct: 100, totalOps,
  runsNeedingExtraSyncRounds: needed, maxExtraRounds, seconds: Math.round(seconds * 10) / 10,
}
console.log(JSON.stringify(row))
save('convergence', { target: '100% identical hashes over 1,000+ runs', ...row })

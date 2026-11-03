// Property-based test: whatever random edits happen on several offline copies,
// and in whatever order they sync, every copy must end up byte-identical.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import * as Y from 'yjs'
import { createHash } from 'node:crypto'

type Op = { doc: number; kind: 'insert' | 'delete'; pos: number; text: string; len: number }

const opArb = fc.record({
  doc: fc.nat(2), // three replicas: 0, 1, 2
  kind: fc.constantFrom('insert', 'delete'),
  pos: fc.nat(50),
  text: fc.string({ minLength: 1, maxLength: 6 }),
  len: fc.integer({ min: 1, max: 5 }),
}) as fc.Arbitrary<Op>

const hash = (doc: Y.Doc) =>
  createHash('sha256').update(Y.encodeStateAsUpdate(doc)).digest('hex')

describe('convergence', () => {
  it('1000 randomized runs end with identical content on every replica', () => {
    fc.assert(
      fc.property(
        fc.array(opArb, { minLength: 1, maxLength: 40 }),
        fc.array(fc.tuple(fc.nat(2), fc.nat(2)), { maxLength: 12 }), // random pairwise syncs mid-way
        (ops, syncs) => {
          const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()]
          const sync = (from: number, to: number) =>
            Y.applyUpdate(docs[to], Y.encodeStateAsUpdate(docs[from], Y.encodeStateVector(docs[to])))

          ops.forEach((op, i) => {
            const t = docs[op.doc].getText('body')
            const pos = Math.min(op.pos, t.length)
            if (op.kind === 'insert') t.insert(pos, op.text)
            else t.delete(pos, Math.min(op.len, t.length - pos))
            const s = syncs[i % Math.max(syncs.length, 1)]
            if (s && i % 3 === 0 && s[0] !== s[1]) sync(s[0], s[1])
          })

          // Reconnect everyone, in a messy order, then once more so all see all
          for (const [a, b] of [[0, 1], [2, 1], [1, 0], [0, 2], [1, 2], [2, 0]]) sync(a, b)

          const h = docs.map(hash)
          expect(new Set(h).size).toBe(1)
          expect(docs[0].getText('body').toString()).toBe(docs[1].getText('body').toString())
        },
      ),
      { numRuns: 1000 },
    )
  })
})

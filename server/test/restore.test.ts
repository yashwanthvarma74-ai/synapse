// Version restore copies an old snapshot's content into the LIVE doc as a new edit
// (same code as web/src/components/History.tsx). Check it merges for everyone.
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { extractText } from '../src/text.js'

function para(text: string) {
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText(text)])
  return p
}

function restore(live: Y.Doc, oldState: Uint8Array) {
  const old = new Y.Doc()
  Y.applyUpdate(old, oldState)
  const src = old.getXmlFragment('default')
  const dst = live.getXmlFragment('default')
  live.transact(() => {
    dst.delete(0, dst.length)
    dst.insert(0, src.toArray().map((n) => (n as Y.XmlElement).clone()))
  })
}

describe('version restore', () => {
  it('replaces content with the old version and reaches other replicas', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    a.getXmlFragment('default').insert(0, [para('draft one')])
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const savedVersion = Y.encodeStateAsUpdate(a) // "First draft"

    a.getXmlFragment('default').insert(1, [para('more work that we will throw away')])
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    expect(extractText(b)).toContain('throw away')

    restore(a, savedVersion)
    expect(extractText(a)).toBe('draft one')
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    expect(extractText(b)).toBe('draft one')
  })

  it('an edit made on another replica while restoring does not break convergence', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    a.getXmlFragment('default').insert(0, [para('base')])
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const saved = Y.encodeStateAsUpdate(a)
    a.getXmlFragment('default').insert(1, [para('later')])
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))

    restore(a, saved) // a restores...
    b.getXmlFragment('default').insert(2, [para('concurrent edit from b')]) // ...while b keeps typing
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    expect(extractText(a)).toBe(extractText(b)) // replicas agree, whatever the outcome
  })
})

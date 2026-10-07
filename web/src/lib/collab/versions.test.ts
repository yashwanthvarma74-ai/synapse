import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import { getSchema } from '@tiptap/core'
import { contentExtensions } from '../editor/extensions'
import { addShape, canvasText, listObjects } from '../board/canvasModel'
import { boardObjects, documentContent, restoreInto, stateToDoc } from './versions'
import type { JsonNode } from '../export/blocks'

const schema = getSchema(contentExtensions)
const para = (text: string): JsonNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })

function writtenDoc(...texts: string[]) {
  const doc = new Y.Doc()
  prosemirrorJSONToYXmlFragment(schema, { type: 'doc', content: texts.map(para) }, doc.getXmlFragment('default'))
  return doc
}
const textsOf = (doc: Y.Doc) => (documentContent(doc).content ?? []).map((n) => n.content?.map((t) => t.text).join('') ?? '')

describe('reading a saved version', () => {
  it('turns a saved document back into editor content', () => {
    const saved = stateToDoc(Y.encodeStateAsUpdate(writtenDoc('first', 'second')))
    expect(textsOf(saved)).toEqual(['first', 'second'])
  })
  it('reads the shapes of a saved board', () => {
    const board = new Y.Doc()
    addShape(board, 'sticky', 10, 20, 'idea')
    const saved = stateToDoc(Y.encodeStateAsUpdate(board))
    expect(boardObjects(saved)).toMatchObject([{ kind: 'sticky', text: 'idea' }])
  })
})

describe('restoring a saved version', () => {
  it('puts a document back exactly as it was when the version was saved', () => {
    const live = writtenDoc('draft one')
    const savedState = Y.encodeStateAsUpdate(live) // the moment Save was pressed
    // ...then the document keeps changing
    live.getXmlFragment('default').delete(0, 1)
    prosemirrorJSONToYXmlFragment(schema, { type: 'doc', content: [para('something else'), para('and more')] }, live.getXmlFragment('default'))
    expect(textsOf(live)).not.toEqual(['draft one'])

    restoreInto(live, stateToDoc(savedState), 'doc')
    expect(textsOf(live)).toEqual(['draft one'])
  })

  it('puts a board back too: later shapes disappear and earlier ones return', () => {
    const live = new Y.Doc()
    addShape(live, 'rect', 0, 0, 'plan')
    const savedState = Y.encodeStateAsUpdate(live)
    const [plan] = listObjects(live)
    live.getMap<Y.Map<unknown>>('objects').delete(plan.id) // deleted afterwards
    addShape(live, 'ellipse', 50, 50, 'added later')
    expect(canvasText(live)).toBe('added later')

    restoreInto(live, stateToDoc(savedState), 'canvas')
    expect(canvasText(live)).toBe('plan')
    expect(listObjects(live)).toHaveLength(1)
  })

  it('reaches other people as one ordinary edit, so their copies match', () => {
    const live = writtenDoc('now')
    const mine = new Y.Doc()
    Y.applyUpdate(mine, Y.encodeStateAsUpdate(live))
    const older = writtenDoc('long ago')
    restoreInto(live, older, 'doc')
    Y.applyUpdate(mine, Y.encodeStateAsUpdate(live))
    expect(textsOf(mine)).toEqual(['long ago'])
  })

  it('does not change the saved version it copied from', () => {
    const live = writtenDoc('now')
    const saved = writtenDoc('then')
    restoreInto(live, saved, 'doc')
    live.getXmlFragment('default').delete(0, 1)
    expect(textsOf(saved)).toEqual(['then'])
  })
})

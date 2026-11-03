import * as Y from 'yjs'
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { getSchema } from '@tiptap/core'
import { contentExtensions } from '../editor/extensions'
import { listObjects, objectsMap, type CanvasObject } from '../board/canvasModel'
import type { JsonNode } from '../export/blocks'

export type DocType = 'doc' | 'canvas'

export const stateToDoc = (state: Uint8Array) => {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  return doc
}

let schema: ReturnType<typeof getSchema> | null = null

// What a saved document looked like, as editor content. Built from the same extensions the editor uses.
export function documentContent(saved: Y.Doc): JsonNode {
  schema ??= getSchema(contentExtensions)
  return yXmlFragmentToProseMirrorRootNode(saved.getXmlFragment('default'), schema).toJSON() as JsonNode
}

export const boardObjects = (saved: Y.Doc): CanvasObject[] => listObjects(saved)

// Put the live document back the way `saved` was. This is written as an ordinary edit, so nothing is erased:
// everyone sees the change arrive, and it can be undone (or restored again from the version saved just before).
export function restoreInto(live: Y.Doc, saved: Y.Doc, type: DocType) {
  live.transact(() => {
    if (type === 'canvas') {
      const target = objectsMap(live)
      target.forEach((_, key) => target.delete(key))
      objectsMap(saved).forEach((shape, key) => target.set(key, shape.clone()))
    } else {
      const target = live.getXmlFragment('default')
      target.delete(0, target.length)
      target.insert(0, saved.getXmlFragment('default').toArray().map((node) => (node as Y.XmlElement).clone()))
    }
  })
}

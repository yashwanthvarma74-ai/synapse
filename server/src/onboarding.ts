// What a new person sees first: a workspace with a Welcome document and a sample board, not an empty
// dashboard. The Welcome text is written with the editor's own schema, so it always opens correctly.
import { ObjectId } from 'mongodb'
import * as Y from 'yjs'
import { getSchema, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import type { Collections } from './db.js'
import type { DocStore } from './store.js'
import { extractText } from './text.js'

const schema = getSchema([StarterKit])

// Tiny helpers to write the document as data
type Run = string | { bold: string }
const runs = (parts: Run[]): JSONContent[] =>
  parts.map((p) => (typeof p === 'string' ? { type: 'text', text: p } : { type: 'text', text: p.bold, marks: [{ type: 'bold' }] }))
const p = (...parts: Run[]): JSONContent => ({ type: 'paragraph', content: runs(parts) })
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
const list = (kind: 'bulletList' | 'orderedList', items: Run[][]): JSONContent => ({
  type: kind,
  content: items.map((parts) => ({ type: 'listItem', content: [{ type: 'paragraph', content: runs(parts) }] })),
})

const WELCOME_TITLE = 'Welcome to Synapse'

const welcomeDocument: JSONContent = {
  type: 'doc',
  content: [
    h(1, WELCOME_TITLE),
    p('Synapse is a collaborative editor that keeps working offline. Edits from every person and device merge without conflicts.'),
    h(2, 'Things to try'),
    list('orderedList', [
      [{ bold: 'Edit.' }, ' Type anywhere on this page. Changes are saved as you type.'],
      [{ bold: 'Invite.' }, ' Press Share, copy the link and open it in a second window. Each cursor carries its owner\'s name.'],
      [{ bold: 'Go offline.' }, ' Open "Try offline mode" under the title and switch it on. Keep typing in both windows.'],
      [{ bold: 'Reconnect.' }, ' Switch it off. The two copies exchange what they are missing and merge.'],
    ]),
    h(2, 'Also here'),
    list('bulletList', [
      [{ bold: 'Comments.' }, ' Select text and write in the Comments panel. The comment stays on that text as the page changes.'],
      [{ bold: 'Versions.' }, ' Save a named version in History, then preview or restore it.'],
      [{ bold: 'Whiteboard.' }, ' The Sample board in this workspace has shapes, sticky notes and connectors.'],
      [{ bold: 'Formatting.' }, ' Use the toolbar, or Markdown shortcuts such as # for a heading.'],
    ]),
    h(2, 'How it works'),
    p('Documents are Yjs CRDTs. Each edit has a unique ID and a causal position, so concurrent edits can be applied in any order and every copy converges. The server relays and stores updates but does not decide the result. The repository documentation covers the design and the measurements.'),
  ],
}

async function writeWelcomeDocument(doc: Y.Doc) {
  prosemirrorJSONToYXmlFragment(schema, welcomeDocument, doc.getXmlFragment('default'))
}

// The sample board
interface Shape { kind: 'rect' | 'ellipse' | 'sticky'; x: number; y: number; w: number; h: number; text: string; color: string; id: string }
const shape = (id: string, kind: Shape['kind'], x: number, y: number, w: number, hh: number, text: string, color: string): Shape => ({ id, kind, x, y, w, h: hh, text, color })

function writeSampleBoard(doc: Y.Doc) {
  const shapes: Shape[] = [
    shape('idea', 'sticky', -300, -160, 190, 120, 'Drag to move', '#ffe066'),
    shape('edit', 'sticky', -300, 20, 190, 120, 'Double click to edit text', '#ffa8a8'),
    shape('plan', 'rect', -20, -120, 180, 90, 'Plan', '#4dabf7'),
    shape('goal', 'ellipse', 230, -150, 150, 150, 'Goal', '#69db7c'),
    shape('tip', 'sticky', 40, 70, 210, 130, 'Connect joins two shapes with a line', '#d0bfff'),
  ]
  const links: Array<[string, string, string]> = [['c1', 'plan', 'goal'], ['c2', 'idea', 'plan']]
  const objects = doc.getMap<Y.Map<unknown>>('objects')
  doc.transact(() => {
    let z = Date.now() * 1000
    for (const s of shapes) {
      const m = new Y.Map<unknown>()
      objects.set(s.id, m)
      m.set('kind', s.kind); m.set('x', s.x); m.set('y', s.y); m.set('w', s.w); m.set('h', s.h)
      m.set('text', s.text); m.set('color', s.color); m.set('z', z++)
    }
    for (const [id, from, to] of links) {
      const m = new Y.Map<unknown>()
      objects.set(id, m)
      m.set('kind', 'connector'); m.set('from', from); m.set('to', to); m.set('color', '#868e96'); m.set('z', 0)
    }
  })
}

// Put it all in the database for one user
export async function createStarterWorkspace(c: Collections, store: DocStore, userId: ObjectId) {
  const now = new Date()
  const workspaceId = new ObjectId()
  await c.workspaces.insertOne({ _id: workspaceId, name: 'My workspace', ownerId: userId, createdAt: now })
  await c.memberships.insertOne({ _id: new ObjectId(), workspaceId, userId, role: 'owner' })

  const welcome = new Y.Doc()
  await writeWelcomeDocument(welcome)
  const board = new Y.Doc()
  writeSampleBoard(board)

  const welcomeId = new ObjectId()
  const boardId = new ObjectId()
  await c.documents.insertMany([
    { _id: welcomeId, workspaceId, title: WELCOME_TITLE, type: 'doc', text: extractText(welcome), createdAt: now, updatedAt: now },
    { _id: boardId, workspaceId, title: 'Sample board', type: 'canvas', text: extractText(board), createdAt: now, updatedAt: new Date(now.getTime() - 1) },
  ])
  await store.appendUpdate(welcomeId.toHexString(), Y.encodeStateAsUpdate(welcome))
  await store.appendUpdate(boardId.toHexString(), Y.encodeStateAsUpdate(board))
  return { workspaceId: workspaceId.toHexString(), welcomeId: welcomeId.toHexString(), boardId: boardId.toHexString() }
}

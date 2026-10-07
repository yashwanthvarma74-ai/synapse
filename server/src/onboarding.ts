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
const quote = (...parts: Run[]): JSONContent => ({ type: 'blockquote', content: [{ type: 'paragraph', content: runs(parts) }] })

const WELCOME_TITLE = 'Welcome to Synapse'

const welcomeDocument: JSONContent = {
  type: 'doc',
  content: [
    h(1, WELCOME_TITLE),
    p('Synapse is a shared notebook that never loses your work. Everyone can edit at the same time, and it keeps working when the internet does not.'),
    h(2, 'Try it in one minute'),
    list('orderedList', [
      [{ bold: 'Type here.' }, ' Click anywhere on this page and write something. It saves as you type.'],
      [{ bold: 'Bring someone in.' }, ' Press Share at the top, copy the invite link, and open it in another window or send it to a friend. You will see each other typing, with names on the cursors.'],
      [{ bold: 'Go offline on purpose.' }, ' Open "Try offline mode" under the title and switch it on. Keep typing. Your changes are safe on this device.'],
      [{ bold: 'Come back online.' }, ' Switch it off. Everything merges. Nobody has to choose whose version wins, and nothing is lost.'],
    ]),
    h(2, 'More things to try'),
    list('bulletList', [
      [{ bold: 'Comment on a sentence.' }, ' Select some text, then write in the Comments panel on the right.'],
      [{ bold: 'Save a version.' }, ' Open History, name the current version, and restore it later if you change your mind.'],
      [{ bold: 'Open the Sample board.' }, ' It is in this workspace. Drag shapes, double-click a note to edit it, and connect two shapes with a line.'],
      [{ bold: 'Format your words.' }, ' Use the toolbar above the page for headings, lists and quotes. Keyboard shortcuts work too.'],
    ]),
    h(2, 'Why it is different'),
    quote('Two people edit the same sentence while offline? Both edits are kept, and every copy ends up identical.'),
    p('Under the hood Synapse uses a CRDT, a data structure designed so that copies can be edited separately and merged in any order without a referee. The project documentation explains how it works, with measurements.'),
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
    shape('idea', 'sticky', -300, -160, 190, 120, 'Drag me anywhere', '#ffe066'),
    shape('edit', 'sticky', -300, 20, 190, 120, 'Double-click a shape to edit its text', '#ffa8a8'),
    shape('plan', 'rect', -20, -120, 180, 90, 'Plan', '#4dabf7'),
    shape('goal', 'ellipse', 230, -150, 150, 150, 'Goal', '#69db7c'),
    shape('tip', 'sticky', 40, 70, 210, 130, 'Use the Connect button to join two shapes with a line', '#d0bfff'),
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

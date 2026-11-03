// The canvas as data. Everything on the board lives in one Yjs map called "objects":
//   objects: Y.Map<id -> Y.Map<field -> value>>
// Each object is its own small map, so two people changing different fields of the same shape (one moves
// it, one recolours it) both win, and two people moving the same shape end up on one of the two positions.
// No rendering code here, so it can be tested without a browser.
import * as Y from 'yjs'

export type Kind = 'rect' | 'ellipse' | 'sticky' | 'connector'

export interface CanvasObject {
  id: string
  kind: Kind
  x: number
  y: number
  w: number
  h: number
  text: string
  color: string
  from?: string // connectors: id of the object where the line starts
  to?: string // connectors: id of the object where the line ends
  z: number // draw order, higher is on top
}

// Tag for transactions made by this user, so undo only reverts our own edits
export const LOCAL = 'canvas-local'

export const DEFAULTS: Record<Exclude<Kind, 'connector'>, { w: number; h: number; color: string }> = {
  rect: { w: 160, h: 100, color: '#4dabf7' },
  ellipse: { w: 140, h: 140, color: '#69db7c' },
  sticky: { w: 180, h: 140, color: '#ffe066' },
}

export const objectsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('objects')

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
const KINDS: Kind[] = ['rect', 'ellipse', 'sticky', 'connector']

// Reads never trust the stored shape: other clients (or old versions) wrote it.
export function readObject(id: string, m: Y.Map<unknown>): CanvasObject | null {
  const kind = str(m.get('kind')) as Kind
  if (!KINDS.includes(kind)) return null
  return {
    id,
    kind,
    x: num(m.get('x')),
    y: num(m.get('y')),
    w: Math.max(1, num(m.get('w'), 100)),
    h: Math.max(1, num(m.get('h'), 100)),
    text: str(m.get('text')),
    color: str(m.get('color'), '#adb5bd'),
    from: m.get('from') as string | undefined,
    to: m.get('to') as string | undefined,
    z: num(m.get('z')),
  }
}

export function listObjects(doc: Y.Doc): CanvasObject[] {
  const out: CanvasObject[] = []
  objectsMap(doc).forEach((m, id) => {
    const o = readObject(id, m)
    if (o) out.push(o)
  })
  return out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
let zCounter = 0
const nextZ = () => Date.now() * 1000 + (zCounter = (zCounter + 1) % 1000)

export function addShape(doc: Y.Doc, kind: Exclude<Kind, 'connector'>, x: number, y: number, text = ''): string {
  const id = newId()
  const d = DEFAULTS[kind]
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    objectsMap(doc).set(id, m)
    m.set('kind', kind)
    m.set('x', x - d.w / 2) // x,y given as the centre, stored as top-left
    m.set('y', y - d.h / 2)
    m.set('w', d.w)
    m.set('h', d.h)
    m.set('color', d.color)
    m.set('text', text)
    m.set('z', nextZ())
  }, LOCAL)
  return id
}

export function addConnector(doc: Y.Doc, from: string, to: string): string | null {
  const objs = objectsMap(doc)
  if (from === to || !objs.has(from) || !objs.has(to)) return null
  // No duplicate connector between the same pair, in either direction
  for (const o of listObjects(doc)) {
    if (o.kind === 'connector' && ((o.from === from && o.to === to) || (o.from === to && o.to === from))) return null
  }
  const id = newId()
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    objs.set(id, m)
    m.set('kind', 'connector')
    m.set('from', from)
    m.set('to', to)
    m.set('color', '#868e96')
    m.set('z', 0) // lines sit under shapes
  }, LOCAL)
  return id
}

export function updateObject(doc: Y.Doc, id: string, patch: Partial<Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'text' | 'color'>>) {
  const m = objectsMap(doc).get(id)
  if (!m) return // it was deleted by someone else meanwhile: ignore
  doc.transact(() => {
    for (const [k, v] of Object.entries(patch)) if (m.get(k) !== v) m.set(k, v)
  }, LOCAL)
}

export function moveBy(doc: Y.Doc, ids: Iterable<string>, dx: number, dy: number) {
  doc.transact(() => {
    for (const id of ids) {
      const m = objectsMap(doc).get(id)
      if (!m || m.get('kind') === 'connector') continue
      m.set('x', num(m.get('x')) + dx)
      m.set('y', num(m.get('y')) + dy)
    }
  }, LOCAL)
}

export function bringToFront(doc: Y.Doc, id: string) {
  const m = objectsMap(doc).get(id)
  if (m && m.get('kind') !== 'connector') doc.transact(() => m.set('z', nextZ()), LOCAL)
}

// Deleting a shape also deletes the connectors attached to it (no dangling lines)
export function deleteObjects(doc: Y.Doc, ids: Iterable<string>) {
  const gone = new Set(ids)
  doc.transact(() => {
    const objs = objectsMap(doc)
    objs.forEach((m, id) => {
      if (m.get('kind') === 'connector' && (gone.has(m.get('from') as string) || gone.has(m.get('to') as string))) gone.add(id)
    })
    for (const id of gone) objs.delete(id)
  }, LOCAL)
}

// Undo/redo that only affects this user's changes
export function createUndoManager(doc: Y.Doc) {
  return new Y.UndoManager(objectsMap(doc), { trackedOrigins: new Set([LOCAL]), captureTimeout: 400 })
}

// Plain text on the board, for search indexing
export function canvasText(doc: Y.Doc): string {
  return listObjects(doc).filter((o) => o.text).map((o) => o.text).join('\n')
}

// Where a connector's line starts and ends: the centres of its two shapes.
// Returns null if either end no longer exists (e.g. a concurrent delete).
export function connectorEnds(doc: Y.Doc, c: CanvasObject): { x1: number; y1: number; x2: number; y2: number } | null {
  const a = c.from ? objectsMap(doc).get(c.from) : undefined
  const b = c.to ? objectsMap(doc).get(c.to) : undefined
  if (!a || !b) return null
  const A = readObject(c.from!, a)
  const B = readObject(c.to!, b)
  if (!A || !B) return null
  return { x1: A.x + A.w / 2, y1: A.y + A.h / 2, x2: B.x + B.w / 2, y2: B.y + B.h / 2 }
}

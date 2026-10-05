import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  addConnector, addShape, canvasText, connectorEnds, createUndoManager, deleteObjects,
  listObjects, moveBy, objectsMap, updateObject,
} from './canvasModel'

const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}
const same = (a: Y.Doc, b: Y.Doc) => expect(listObjects(a)).toEqual(listObjects(b))

describe('canvas model', () => {
  it('adds shapes centred on the given point', () => {
    const d = new Y.Doc()
    const id = addShape(d, 'rect', 100, 100)
    const o = listObjects(d).find((x) => x.id === id)!
    expect(o.x + o.w / 2).toBe(100)
    expect(o.y + o.h / 2).toBe(100)
  })

  it('connectors follow their shapes and reject duplicates and self-links', () => {
    const d = new Y.Doc()
    const a = addShape(d, 'rect', 0, 0)
    const b = addShape(d, 'ellipse', 300, 0)
    expect(addConnector(d, a, a)).toBeNull()
    const c = addConnector(d, a, b)!
    expect(addConnector(d, b, a)).toBeNull() // same pair, other direction
    const conn = listObjects(d).find((o) => o.id === c)!
    const before = connectorEnds(d, conn)!
    moveBy(d, [b], 0, 200)
    const after = connectorEnds(d, conn)!
    expect(after.y2 - before.y2).toBe(200)
  })

  it('deleting a shape deletes its connectors', () => {
    const d = new Y.Doc()
    const a = addShape(d, 'rect', 0, 0)
    const b = addShape(d, 'rect', 200, 0)
    addConnector(d, a, b)
    deleteObjects(d, [a])
    expect(listObjects(d).map((o) => o.id)).toEqual([b])
  })

  it('two people changing different fields of one shape both win', () => {
    const a = new Y.Doc()
    const id = addShape(a, 'sticky', 50, 50)
    const b = new Y.Doc()
    sync(a, b)
    moveBy(a, [id], 100, 0) // a moves it
    updateObject(b, id, { color: '#ff6b6b' }) // b recolours it, at the same time
    sync(a, b)
    same(a, b)
    const o = listObjects(a)[0]
    expect(o.color).toBe('#ff6b6b')
    expect(o.x).toBe(50 - 90 + 100)
  })

  it('one person deleting while another moves does not break anything', () => {
    const a = new Y.Doc()
    const id = addShape(a, 'rect', 0, 0)
    const b = new Y.Doc()
    sync(a, b)
    deleteObjects(a, [id])
    moveBy(b, [id], 10, 10)
    sync(a, b)
    same(a, b)
    expect(listObjects(a)).toHaveLength(0)
  })

  it('ignores corrupt data written by other clients', () => {
    const d = new Y.Doc()
    const m = new Y.Map<unknown>()
    objectsMap(d).set('bad', m)
    m.set('kind', 'banana')
    const weird = new Y.Map<unknown>()
    objectsMap(d).set('weird', weird)
    weird.set('kind', 'rect')
    weird.set('x', 'not a number')
    weird.set('w', -5)
    const objs = listObjects(d)
    expect(objs).toHaveLength(1)
    expect(objs[0].x).toBe(0)
    expect(objs[0].w).toBe(1)
  })

  it('undo only reverts MY changes, not other people', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    const undo = createUndoManager(a)
    const mine = addShape(a, 'rect', 0, 0)
    sync(a, b)
    const theirs = addShape(b, 'ellipse', 400, 0)
    sync(a, b)
    undo.undo()
    const ids = listObjects(a).map((o) => o.id)
    expect(ids).not.toContain(mine)
    expect(ids).toContain(theirs)
    undo.redo()
    expect(listObjects(a).map((o) => o.id)).toContain(mine)
  })

  it('extracts text for search', () => {
    const d = new Y.Doc()
    addShape(d, 'sticky', 0, 0, 'ship the canvas')
    addShape(d, 'rect', 0, 0)
    expect(canvasText(d)).toBe('ship the canvas')
  })

  it('1000 random operations on three replicas still converge', () => {
    const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()]
    let seed = 42
    const rnd = (n: number) => (seed = (seed * 1664525 + 1013904223) >>> 0) % n
    for (let i = 0; i < 1000; i++) {
      const d = docs[rnd(3)]
      const ids = listObjects(d).map((o) => o.id)
      const r = rnd(10)
      if (r < 3 || ids.length < 2) addShape(d, (['rect', 'ellipse', 'sticky'] as const)[rnd(3)], rnd(500), rnd(500))
      else if (r < 6) moveBy(d, [ids[rnd(ids.length)]], rnd(50) - 25, rnd(50) - 25)
      else if (r < 7) updateObject(d, ids[rnd(ids.length)], { text: `t${i}` })
      else if (r < 8) addConnector(d, ids[rnd(ids.length)], ids[rnd(ids.length)])
      else if (r < 9) deleteObjects(d, [ids[rnd(ids.length)]])
      if (rnd(8) === 0) sync(docs[rnd(3)], docs[rnd(3)])
    }
    sync(docs[0], docs[1]); sync(docs[1], docs[2]); sync(docs[2], docs[0]); sync(docs[0], docs[1])
    same(docs[0], docs[1])
    same(docs[1], docs[2])
  })
})

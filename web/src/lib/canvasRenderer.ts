// Draws the canvas model with PixiJS (WebGL) and turns pointer/keyboard input into
// model edits. It never keeps its own copy of the data: the Yjs doc is the truth,
// and every change (local or from another person) flows doc -> sync() -> screen.
import { Application, Container, Graphics, Rectangle, Text, type FederatedPointerEvent } from 'pixi.js'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import {
  addConnector, addShape, bringToFront, connectorEnds, createUndoManager, deleteObjects,
  listObjects, moveBy, objectsMap, updateObject, type CanvasObject, type Kind,
} from './canvasModel'

export type Tool = 'select' | 'connect'

export interface RendererOptions {
  readOnly: boolean
  user: { name: string; color: string }
  onSelection: (ids: string[]) => void
  onObjects: (objects: CanvasObject[]) => void // for the accessible list
  onEdit: (id: string) => void // user asked to edit this object's text
  onTool: (tool: Tool) => void
  announce: (message: string) => void
  onZoom?: (scale: number) => void // so the toolbar can show "125%"
}

const MIN_SCALE = 0.1
const MAX_SCALE = 4
const SELECT_COLOR = 0x3b5bdb

interface View {
  container: Container
  gfx: Graphics
  label: Text | null
  shapeSig: string // what the Graphics/Text look like (colour, size, text...)
}

export class CanvasRenderer {
  private app = new Application()
  private world = new Container()
  private overlay = new Graphics() // selection boxes
  private cursors = new Container() // other people's pointers
  private lines = new Graphics() // connectors
  private shapes = new Container()
  private views = new Map<string, View>()
  private selection = new Set<string>()
  private tool: Tool = 'select'
  private connectFrom: string | null = null
  private undo: Y.UndoManager
  private objects = listObjectsEmpty()
  private raf = 0
  private destroyed = false
  private ready = false
  private panning: { x: number; y: number } | null = null
  private dragging: { x: number; y: number } | null = null
  private resizing: { id: string; x: number; y: number; w: number; h: number } | null = null
  private cursorLabels = new Map<number, Container>()
  private addCount = 0

  constructor(
    private host: HTMLElement,
    private doc: Y.Doc,
    private awareness: Awareness,
    private opts: RendererOptions,
  ) {
    this.undo = createUndoManager(doc)
  }

  async init() {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    await this.app.init({
      resizeTo: this.host,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      background: dark ? 0x14171d : 0xf8f9fb,
    })
    if (this.destroyed) {
      this.app.destroy(true, { children: true })
      return
    }
    this.host.appendChild(this.app.canvas)
    this.shapes.sortableChildren = true
    this.world.addChild(this.lines, this.shapes, this.overlay, this.cursors)
    this.app.stage.addChild(this.world)
    this.app.stage.eventMode = 'static'
    this.app.stage.hitArea = this.app.screen

    this.app.stage.on('pointerdown', this.onStageDown)
    this.app.stage.on('globalpointermove', this.onMove)
    this.app.stage.on('pointerup', this.onUp)
    this.app.stage.on('pointerupoutside', this.onUp)
    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.app.canvas.addEventListener('dblclick', this.onDoubleClick)

    objectsMap(this.doc).observeDeep(this.scheduleSync)
    this.awareness.on('change', this.scheduleSync)
    // Presence: others see our name and colour (the text editor does this for itself)
    this.awareness.setLocalStateField('user', this.opts.user)
    this.ready = true
    this.world.position.set(this.host.clientWidth / 2, this.host.clientHeight / 2) // origin in the middle
    this.sync()
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    if (!this.ready) return
    objectsMap(this.doc).unobserveDeep(this.scheduleSync)
    this.awareness.off('change', this.scheduleSync)
    this.app.canvas.removeEventListener('wheel', this.onWheel)
    this.app.canvas.removeEventListener('dblclick', this.onDoubleClick)
    this.undo.destroy()
    this.awareness.setLocalStateField('canvasCursor', null)
    this.app.destroy(true, { children: true })
  }

  // ---------------------------------------------------------------- public API

  setTool(tool: Tool) {
    this.tool = tool
    this.connectFrom = null
    this.opts.onTool(tool)
    if (tool === 'connect') this.opts.announce('Connect mode: choose the first shape, then the second')
  }
  getTool() {
    return this.tool
  }
  getSelection() {
    return [...this.selection]
  }

  add(kind: Exclude<Kind, 'connector'>) {
    if (this.opts.readOnly) return
    const c = this.centerWorld()
    // fan out new shapes a little so they don't stack exactly
    const n = this.addCount++ % 6 // own counter: this.objects is only refreshed on the next frame
    const id = addShape(this.doc, kind, c.x + n * 24, c.y + n * 24)
    this.select([id])
    this.opts.announce(`Added ${kind === 'sticky' ? 'sticky note' : kind}`)
  }

  // Dev/measurement helper: lots of shapes at once, in a single transaction
  addMany(count: number) {
    if (this.opts.readOnly) return
    this.doc.transact(() => {
      for (let i = 0; i < count; i++) {
        addShape(this.doc, (['rect', 'ellipse', 'sticky'] as const)[i % 3], (i % 25) * 190 - 2300, Math.floor(i / 25) * 150 - 1000, `#${i}`)
      }
    })
  }

  deleteSelected() {
    if (this.opts.readOnly || this.selection.size === 0) return
    const n = this.selection.size
    deleteObjects(this.doc, this.selection)
    this.selection.clear()
    this.opts.onSelection([])
    this.opts.announce(`Deleted ${n} object${n > 1 ? 's' : ''}`)
  }

  nudge(dx: number, dy: number) {
    if (this.opts.readOnly || this.selection.size === 0) return
    moveBy(this.doc, this.selection, dx, dy)
  }

  // Change the colour of every selected shape (connectors have no fill)
  setColorOfSelection(color: string) {
    if (this.opts.readOnly) return
    for (const id of this.selection) {
      const o = this.objects.find((x) => x.id === id)
      if (o && o.kind !== 'connector') updateObject(this.doc, id, { color })
    }
  }

  // Keyboard alternative to dragging the corner handle (WCAG 2.1.1)
  resizeSelected(dw: number, dh: number) {
    if (this.opts.readOnly || this.selection.size !== 1) return
    const id = [...this.selection][0]
    const o = this.objects.find((x) => x.id === id)
    if (!o || o.kind === 'connector') return
    const w = Math.max(40, o.w + dw)
    const h = Math.max(30, o.h + dh)
    updateObject(this.doc, id, { w, h })
    this.opts.announce(`Resized to ${Math.round(w)} by ${Math.round(h)}`)
  }

  select(ids: string[]) {
    this.selection = new Set(ids)
    this.opts.onSelection(ids)
    this.draw()
  }

  // Used by both a click on a shape and Enter on the accessible list
  pick(id: string) {
    if (this.tool === 'connect' && !this.opts.readOnly) {
      if (!this.connectFrom) {
        this.connectFrom = id
        this.select([id])
        this.opts.announce('First shape chosen. Choose the second shape.')
      } else {
        const made = addConnector(this.doc, this.connectFrom, id)
        this.opts.announce(made ? 'Connected' : 'Those two shapes are already connected, or the same shape')
        this.setTool('select')
      }
      return
    }
    this.select([id])
    bringToFront(this.doc, id)
  }

  undoLast() {
    this.undo.undo()
  }
  redoLast() {
    this.undo.redo()
  }

  zoomBy(factor: number, cx = this.host.clientWidth / 2, cy = this.host.clientHeight / 2) {
    const old = this.world.scale.x
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * factor))
    const k = next / old
    // keep the point under (cx,cy) fixed while scaling
    this.world.position.set(cx - (cx - this.world.x) * k, cy - (cy - this.world.y) * k)
    this.world.scale.set(next)
    this.draw() // remote cursors keep a constant on-screen size
    this.opts.onZoom?.(next)
    this.opts.announce(`Zoom ${Math.round(next * 100)} percent`)
  }
  resetView() {
    this.opts.onZoom?.(1)
    this.world.scale.set(1)
    this.world.position.set(this.host.clientWidth / 2, this.host.clientHeight / 2)
  }
  panBy(dx: number, dy: number) {
    this.world.position.set(this.world.x + dx, this.world.y + dy)
  }

  screenRectOf(id: string) {
    const o = this.objects.find((x) => x.id === id)
    if (!o) return null
    const s = this.world.scale.x
    return { left: this.world.x + o.x * s, top: this.world.y + o.y * s, width: o.w * s, height: o.h * s }
  }

  stats() {
    return { objects: this.objects.length, fps: this.app.ticker.FPS, scale: this.world.scale.x }
  }
  get ticker() {
    return this.app.ticker
  }

  // ---------------------------------------------------------------- input

  private toWorld(gx: number, gy: number) {
    const s = this.world.scale.x
    return { x: (gx - this.world.x) / s, y: (gy - this.world.y) / s }
  }
  private centerWorld() {
    return this.toWorld(this.host.clientWidth / 2, this.host.clientHeight / 2)
  }

  private onStageDown = (e: FederatedPointerEvent) => {
    // Shapes call stopPropagation, so this only fires on empty space
    this.panning = { x: e.global.x, y: e.global.y }
    if (this.selection.size && !e.shiftKey) this.select([])
    if (this.tool === 'connect') this.setTool('select')
  }

  private onShapeDown(id: string, e: FederatedPointerEvent) {
    e.stopPropagation()
    if (e.shiftKey && this.tool === 'select') {
      const next = new Set(this.selection)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      this.select([...next])
    } else if (!this.selection.has(id) || this.tool === 'connect') {
      this.pick(id)
    }
    if (this.tool === 'select' && !this.opts.readOnly) this.dragging = { x: e.global.x, y: e.global.y }
  }

  private onMove = (e: FederatedPointerEvent) => {
    const w = this.toWorld(e.global.x, e.global.y)
    this.awareness.setLocalStateField('canvasCursor', { x: w.x, y: w.y }) // provider throttles sending
    if (this.resizing) {
      const r = this.resizing
      updateObject(this.doc, r.id, { w: Math.max(40, r.w + (w.x - r.x)), h: Math.max(30, r.h + (w.y - r.y)) })
    } else if (this.dragging) {
      const s = this.world.scale.x
      const dx = (e.global.x - this.dragging.x) / s
      const dy = (e.global.y - this.dragging.y) / s
      this.dragging = { x: e.global.x, y: e.global.y }
      moveBy(this.doc, this.selection, dx, dy)
    } else if (this.panning) {
      this.panBy(e.global.x - this.panning.x, e.global.y - this.panning.y)
      this.panning = { x: e.global.x, y: e.global.y }
    }
  }

  private onUp = () => {
    this.panning = null
    this.dragging = null
    this.resizing = null
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const rect = this.app.canvas.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
      // pinch-zoom on a trackpad arrives as ctrl+wheel
      this.zoomBy(Math.exp(-e.deltaY * 0.0025), e.clientX - rect.left, e.clientY - rect.top)
    } else {
      this.panBy(-e.deltaX, -e.deltaY)
    }
  }

  private onDoubleClick = (e: MouseEvent) => {
    if (this.opts.readOnly) return
    const rect = this.app.canvas.getBoundingClientRect()
    const w = this.toWorld(e.clientX - rect.left, e.clientY - rect.top)
    const hit = [...this.objects].reverse().find((o) => o.kind !== 'connector' && w.x >= o.x && w.x <= o.x + o.w && w.y >= o.y && w.y <= o.y + o.h)
    if (hit) this.opts.onEdit(hit.id)
  }

  // ---------------------------------------------------------------- drawing

  private scheduleSync = () => {
    if (this.raf || this.destroyed) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.sync()
    })
  }

  // Make the screen match the doc. Only objects whose data changed are redrawn,
  // and a pure move only changes a position (no Graphics rebuild).
  private sync() {
    if (this.destroyed || !this.ready) return
    this.objects = listObjects(this.doc)
    const seen = new Set<string>()
    for (const o of this.objects) {
      if (o.kind === 'connector') continue
      seen.add(o.id)
      let v = this.views.get(o.id)
      if (!v) {
        v = this.createView(o)
        this.shapes.addChild(v.container) // without this the shape exists but is never drawn
        this.views.set(o.id, v)
      }
      const sig = `${o.kind}|${o.w}|${o.h}|${o.color}|${o.text}`
      if (sig !== v.shapeSig) this.drawShape(v, o, sig)
      v.container.position.set(o.x, o.y)
      v.container.zIndex = o.z
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        v.container.destroy({ children: true })
        this.views.delete(id)
        if (this.selection.delete(id)) this.opts.onSelection([...this.selection])
      }
    }
    this.draw()
    this.opts.onObjects(this.objects)
  }

  private createView(o: CanvasObject): View {
    const container = new Container()
    const gfx = new Graphics()
    container.addChild(gfx)
    container.eventMode = 'static'
    container.cursor = 'grab'
    container.on('pointerdown', (e) => this.onShapeDown(o.id, e))
    return { container, gfx, label: null, shapeSig: '' }
  }

  private drawShape(v: View, o: CanvasObject, sig: string) {
    v.shapeSig = sig
    const g = v.gfx.clear()
    if (o.kind === 'ellipse') g.ellipse(o.w / 2, o.h / 2, o.w / 2, o.h / 2)
    else g.roundRect(0, 0, o.w, o.h, o.kind === 'sticky' ? 4 : 10)
    g.fill({ color: o.color }).stroke({ width: 1.5, color: 0x000000, alpha: 0.25 })
    v.container.hitArea = new Rectangle(0, 0, o.w, o.h)

    if (v.label) v.label.destroy()
    v.label = null
    if (o.text) {
      const sticky = o.kind === 'sticky'
      const t = new Text({
        text: o.text,
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 16, fill: 0x1a1a1a, wordWrap: true, wordWrapWidth: o.w - 20, align: sticky ? 'left' : 'center' },
      })
      if (sticky) t.position.set(10, 10)
      else {
        t.anchor.set(0.5)
        t.position.set(o.w / 2, o.h / 2)
      }
      v.container.addChild(t)
      v.label = t
    }
  }

  // connectors, selection outlines and remote cursors (cheap: redrawn each sync)
  private draw() {
    const lines = this.lines.clear()
    for (const o of this.objects) {
      if (o.kind !== 'connector') continue
      const ends = connectorEnds(this.doc, o)
      if (ends) lines.moveTo(ends.x1, ends.y1).lineTo(ends.x2, ends.y2).stroke({ width: 3, color: 0x868e96 })
    }
    const sel = this.overlay.clear()
    for (const id of this.selection) {
      const o = this.objects.find((x) => x.id === id)
      if (!o || o.kind === 'connector') continue
      sel.rect(o.x - 3, o.y - 3, o.w + 6, o.h + 6).stroke({ width: 2, color: SELECT_COLOR })
    }
    // resize handle on a single selected shape
    if (!this.opts.readOnly && this.selection.size === 1) {
      const o = this.objects.find((x) => x.id === [...this.selection][0])
      if (o && o.kind !== 'connector') {
        sel.rect(o.x + o.w - 6, o.y + o.h - 6, 12, 12).fill({ color: SELECT_COLOR })
        this.ensureHandle(o)
      }
    } else if (this.handle) this.handle.visible = false
    this.drawCursors()
  }

  private handle: Graphics | null = null
  private ensureHandle(o: CanvasObject) {
    if (!this.handle) {
      const h = new Graphics().rect(0, 0, 16, 16).fill({ color: 0xffffff, alpha: 0.001 }) // invisible hit target
      h.eventMode = 'static'
      h.cursor = 'nwse-resize'
      h.on('pointerdown', (e: FederatedPointerEvent) => {
        e.stopPropagation()
        const id = [...this.selection][0]
        const cur = this.objects.find((x) => x.id === id)
        if (!cur) return
        const w = this.toWorld(e.global.x, e.global.y)
        this.resizing = { id, x: w.x, y: w.y, w: cur.w, h: cur.h }
      })
      this.world.addChild(h)
      this.handle = h
    }
    this.handle.visible = true
    this.handle.position.set(o.x + o.w - 8, o.y + o.h - 8)
  }

  private drawCursors() {
    const live = new Set<number>()
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.awareness.clientID) return
      const c = state.canvasCursor as { x: number; y: number } | null | undefined
      const u = state.user as { name?: string; color?: string } | undefined
      if (!c || !u?.name) return
      live.add(clientId)
      let node = this.cursorLabels.get(clientId)
      if (!node) {
        node = new Container()
        const color = Number.parseInt((u.color ?? '#888888').replace('#', ''), 16)
        node.addChild(new Graphics().poly([0, 0, 0, 18, 5, 14, 12, 14]).fill({ color }))
        const t = new Text({ text: u.name, style: { fontSize: 11, fill: 0xffffff, fontFamily: 'system-ui, sans-serif' } })
        t.position.set(12, 14)
        const bg = new Graphics().roundRect(10, 12, t.width + 6, 16, 3).fill({ color })
        t.position.set(13, 13)
        node.addChild(bg, t)
        this.cursors.addChild(node)
        this.cursorLabels.set(clientId, node)
      }
      node.position.set(c.x, c.y)
      node.scale.set(1 / this.world.scale.x) // keep cursors a constant size when zoomed
    })
    for (const [id, node] of this.cursorLabels) {
      if (!live.has(id)) {
        node.destroy({ children: true })
        this.cursorLabels.delete(id)
      }
    }
  }
}

function listObjectsEmpty(): CanvasObject[] {
  return []
}

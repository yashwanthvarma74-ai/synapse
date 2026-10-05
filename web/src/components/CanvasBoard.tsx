'use client'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { CanvasRenderer, type Tool } from '@/lib/canvasRenderer'
import { updateObject, type CanvasObject } from '@/lib/canvasModel'
import type { Collab } from '@/lib/useCollab'

// Handlers are passed as props and only run on click, never during render
function ToolButton({ label, onClick, disabled, pressed, title }: {
  label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; title?: string
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={pressed} title={title ?? label}>
      {label}
    </button>
  )
}

const NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', sticky: 'Sticky note', connector: 'Connector' } as const

// Every canvas action is reachable by keyboard:
//   toolbar buttons (add / connect / delete / undo / zoom), the object list (select,
//   arrow keys to move, Enter to edit text), and shortcuts on the board itself.
export default function CanvasBoard({ collab, readOnly }: { collab: Collab; readOnly: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const renderer = useRef<CanvasRenderer | null>(null)
  const params = useSearchParams()
  const stress = params.get('stress') === '1'

  const [objects, setObjects] = useState<CanvasObject[]>([])
  const [selection, setSelection] = useState<string[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [announcement, setAnnouncement] = useState('')
  const [editing, setEditing] = useState<{ id: string; left: number; top: number; width: number; height: number; text: string } | null>(null)
  const [fps, setFps] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!host.current) return
    const r = new CanvasRenderer(host.current, collab.doc, collab.awareness, {
      readOnly,
      user: collab.user,
      onSelection: setSelection,
      onObjects: setObjects,
      onTool: setTool,
      announce: setAnnouncement,
      onEdit: (id) => {
        const rect = r.screenRectOf(id)
        const obj = collab.doc.getMap<{ get(k: string): unknown }>('objects').get(id)
        if (rect && obj) setEditing({ id, ...rect, text: String(obj.get('text') ?? '') })
      },
    })
    renderer.current = r
    r.init().catch((e) => setError(`The canvas could not start: ${(e as Error).message}`))
    const timer = stress ? setInterval(() => setFps(Math.round(r.stats().fps)), 500) : undefined
    return () => {
      if (timer) clearInterval(timer)
      renderer.current = null
      r.destroy()
    }
  }, [collab, readOnly, stress])

  const r = () => renderer.current

  function commitEdit(save: boolean) {
    if (editing && save) updateObject(collab.doc, editing.id, { text: editing.text.slice(0, 500) })
    setEditing(null)
    host.current?.focus()
  }

  function onBoardKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return
    const step = e.shiftKey ? 50 : 10
    const mod = e.metaKey || e.ctrlKey
    const rr = r()
    if (!rr) return
    const handled = (fn: () => void) => {
      e.preventDefault()
      fn()
    }
    if (mod && e.key.toLowerCase() === 'z') return handled(() => (e.shiftKey ? rr.redoLast() : rr.undoLast()))
    if (e.key === 'Delete' || e.key === 'Backspace') return handled(() => rr.deleteSelected())
    if (e.key === 'Escape') return handled(() => (rr.getTool() === 'connect' ? rr.setTool('select') : rr.select([])))
    if (e.altKey && selection.length === 1 && e.key.startsWith('Arrow')) {
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      return handled(() => rr.resizeSelected(...d[e.key]))
    }
    if (e.key === 'ArrowLeft') return handled(() => (selection.length ? rr.nudge(-step, 0) : rr.panBy(step, 0)))
    if (e.key === 'ArrowRight') return handled(() => (selection.length ? rr.nudge(step, 0) : rr.panBy(-step, 0)))
    if (e.key === 'ArrowUp') return handled(() => (selection.length ? rr.nudge(0, -step) : rr.panBy(0, step)))
    if (e.key === 'ArrowDown') return handled(() => (selection.length ? rr.nudge(0, step) : rr.panBy(0, -step)))
    if (e.key === '+' || e.key === '=') return handled(() => rr.zoomBy(1.2))
    if (e.key === '-') return handled(() => rr.zoomBy(1 / 1.2))
    if (e.key === '0') return handled(() => rr.resetView())
    if (e.key === 'Enter' && selection.length === 1 && !readOnly) {
      return handled(() => {
        const rect = rr.screenRectOf(selection[0])
        const o = objects.find((x) => x.id === selection[0])
        if (rect && o && o.kind !== 'connector') setEditing({ id: o.id, ...rect, text: o.text })
      })
    }
  }

  const shapes = objects.filter((o) => o.kind !== 'connector')

  return (
    <div className="canvas-layout">
      <div>
        <div className="toolbar" role="toolbar" aria-label="Canvas tools">
          <ToolButton label="Select" onClick={() => r()?.setTool('select')} pressed={tool === 'select'} />
          <ToolButton label="Connect" onClick={() => r()?.setTool('connect')} pressed={tool === 'connect'} disabled={readOnly} title="Connect two shapes with a line" />
          <span className="sep" />
          <ToolButton label="+ Rectangle" onClick={() => r()?.add('rect')} disabled={readOnly} />
          <ToolButton label="+ Ellipse" onClick={() => r()?.add('ellipse')} disabled={readOnly} />
          <ToolButton label="+ Sticky" onClick={() => r()?.add('sticky')} disabled={readOnly} />
          <span className="sep" />
          <ToolButton label="Delete" onClick={() => r()?.deleteSelected()} disabled={readOnly || selection.length === 0} />
          <ToolButton label="Undo" onClick={() => r()?.undoLast()} disabled={readOnly} />
          <ToolButton label="Redo" onClick={() => r()?.redoLast()} disabled={readOnly} />
          <span className="sep" />
          <ToolButton label="Zoom −" onClick={() => r()?.zoomBy(1 / 1.2)} />
          <ToolButton label="Zoom +" onClick={() => r()?.zoomBy(1.2)} />
          <ToolButton label="Reset view" onClick={() => r()?.resetView()} />
          {stress && <ToolButton label="Add 500 shapes" onClick={() => r()?.addMany(500)} />}
          {stress && <span className="muted" data-testid="fps">{fps} FPS · {objects.length} objects</span>}
        </div>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="canvas-wrap">
          <div
            ref={host}
            className="canvas-host"
            tabIndex={0}
            role="application"
            aria-label="Canvas"
            aria-describedby="canvas-help"
            onKeyDown={onBoardKey}
          />
          {editing && (
            <textarea
              autoFocus
              className="canvas-edit"
              aria-label="Edit text"
              style={{ left: editing.left, top: editing.top, width: Math.max(editing.width, 120), height: Math.max(editing.height, 60) }}
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              onBlur={() => commitEdit(true)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') commitEdit(false)
                else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit(true)
              }}
            />
          )}
        </div>
        <p className="hint">
          Drag empty space to pan. Scroll to pan, pinch or Ctrl+scroll to zoom. Double-click a shape to edit its text.
          {readOnly && ' You have read-only access.'}
        </p>
        <p id="canvas-help" className="sr-only">
          Shapes are in the object list below the canvas, where you can select them. With the canvas focused, arrow keys pan,
          or move the selected shape, and Alt plus arrow resizes it; Delete removes the selection; plus and minus zoom; zero resets the view; Control or Command
          plus Z undoes; Enter edits the text of the selected shape.
        </p>
        <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
      </div>

      <section className="panel" aria-label="Object list">
        <h2>Objects ({shapes.length})</h2>
        <ul className="list objects" aria-label="Objects on the canvas">
          {shapes.length === 0 && <li className="muted">Nothing here yet. Add a shape from the toolbar.</li>}
          {shapes.slice(0, 200).map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className={selection.includes(o.id) ? 'obj selected' : 'obj'}
                aria-pressed={selection.includes(o.id)}
                onClick={() => r()?.pick(o.id)}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 50 : 10
                  const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
                  if (mv[e.key] && e.altKey && selection.includes(o.id)) {
                    e.preventDefault()
                    r()?.resizeSelected(...mv[e.key]) // Alt + arrow resizes (announces its own result)
                  } else if (mv[e.key] && selection.includes(o.id)) {
                    e.preventDefault()
                    r()?.nudge(...mv[e.key])
                    setAnnouncement(`Moved ${NAMES[o.kind]}`)
                  } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault()
                    r()?.deleteSelected()
                  } else if (e.key === 'e' || (e.key === 'Enter' && selection.includes(o.id) && tool === 'select')) {
                    e.preventDefault()
                    const rect = r()?.screenRectOf(o.id)
                    if (rect && !readOnly) setEditing({ id: o.id, ...rect, text: o.text })
                  }
                }}
              >
                <span className="swatch" style={{ background: o.color }} aria-hidden />
                {NAMES[o.kind]}: {o.text || <em>no text</em>}
              </button>
            </li>
          ))}
        </ul>
        {shapes.length > 200 && <p className="muted">Showing the first 200 of {shapes.length}.</p>}
        <p className="hint">In the list: arrow keys move the selected object, Alt+arrows resize it, E edits its text, Delete removes it. In Connect mode, press Enter on two objects.</p>
      </section>
    </div>
  )
}

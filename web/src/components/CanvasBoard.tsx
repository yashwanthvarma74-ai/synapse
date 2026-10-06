'use client'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { CanvasRenderer } from '@/lib/canvasRenderer'
import { useUi } from '@/lib/uiStore'
import { updateObject, type CanvasObject } from '@/lib/canvasModel'
import type { Collab } from '@/lib/useCollab'

// Small outline icons. They sit next to a visible word, so they are decoration.
const ICONS: Record<string, string> = {
  select: 'M5 3l14 7-6 2-2 6z',
  connect: 'M6 18a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18 11a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM8 14l8-5',
  sticky: 'M5 4h14v11l-5 5H5zM14 20v-5h5',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2M12 17h.01',
}
const Icon = ({ name }: { name: keyof typeof ICONS }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={ICONS[name]} />
  </svg>
)

// Handlers are passed as props and only run on click, never during render
function ToolButton({ label, icon, onClick, disabled, pressed, title }: {
  label: string; icon?: keyof typeof ICONS; onClick: () => void; disabled?: boolean; pressed?: boolean; title?: string
}) {
  return (
    <button type="button" className="icon-btn" onClick={onClick} disabled={disabled} aria-pressed={pressed} title={title ?? label}>
      {icon && <Icon name={icon} />}
      {label}
    </button>
  )
}

// Colours for shapes (all light enough for the dark text drawn on them)
const SHAPE_COLORS = [
  { name: 'yellow', hex: '#ffe066' }, { name: 'pink', hex: '#ffa8a8' }, { name: 'orange', hex: '#ffc078' },
  { name: 'green', hex: '#69db7c' }, { name: 'blue', hex: '#4dabf7' }, { name: 'purple', hex: '#d0bfff' }, { name: 'grey', hex: '#ced4da' },
]

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
  const tool = useUi((s) => s.canvasTool)
  const setTool = useUi((s) => s.setCanvasTool)
  const [announcement, setAnnouncement] = useState('')
  const [editing, setEditing] = useState<{ id: string; left: number; top: number; width: number; height: number; text: string } | null>(null)
  const [fps, setFps] = useState(0)
  const [zoom, setZoom] = useState(1)
  const helpOpen = useUi((s) => s.canvasHelpOpen)
  const setHelpOpen = useUi((s) => s.setCanvasHelpOpen)
  const help = useRef<HTMLDialogElement>(null)
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
      onZoom: setZoom,
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
      useUi.getState().resetCanvasUi() // a new board starts on the Select tool with help closed
    }
  }, [collab, readOnly, stress, setTool])

  const r = () => renderer.current

  // open and close the help <dialog> (native: it traps focus and closes on Escape)
  useEffect(() => {
    const d = help.current
    if (!d) return
    if (helpOpen && !d.open) d.showModal()
    if (!helpOpen && d.open) d.close()
  }, [helpOpen])

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
  const selectedShape = shapes.find((o) => selection.includes(o.id))
  const MODE_HINT = readOnly
    ? 'You can look around but not change this board.'
    : tool === 'connect'
      ? 'Connect mode: click one shape, then another, to join them with a line. Press Escape to stop.'
      : selection.length
        ? 'Drag to move. Drag the corner square to resize. Double-click to edit the text.'
        : 'Click a shape to select it. Drag empty space to move around. Scroll to pan, Ctrl+scroll to zoom.'

  return (
    <div className="canvas-layout">
      <div>
        <div className="toolbar" role="toolbar" aria-label="Canvas tools">
          <ToolButton label="Select" icon="select" onClick={() => r()?.setTool('select')} pressed={tool === 'select'} title="Select and move shapes" />
          <ToolButton label="Connect" icon="connect" onClick={() => r()?.setTool('connect')} pressed={tool === 'connect'} disabled={readOnly} title="Join two shapes with a line" />
          <span className="sep" />
          <ToolButton label="Sticky note" icon="sticky" onClick={() => r()?.add('sticky')} disabled={readOnly} title="Add a sticky note" />
          <ToolButton label="Rectangle" icon="rect" onClick={() => r()?.add('rect')} disabled={readOnly} title="Add a rectangle" />
          <ToolButton label="Ellipse" icon="ellipse" onClick={() => r()?.add('ellipse')} disabled={readOnly} title="Add an ellipse" />
          <span className="sep" />
          <ToolButton label="Delete" icon="trash" onClick={() => r()?.deleteSelected()} disabled={readOnly || selection.length === 0} title="Delete the selected shapes" />
          <ToolButton label="Undo" icon="undo" onClick={() => r()?.undoLast()} disabled={readOnly} title="Undo (Ctrl+Z)" />
          <ToolButton label="Redo" icon="redo" onClick={() => r()?.redoLast()} disabled={readOnly} title="Redo (Ctrl+Shift+Z)" />
          <span className="sep" />
          <ToolButton label="Zoom out" icon="minus" onClick={() => r()?.zoomBy(1 / 1.2)} title="Zoom out (-)" />
          <span className="zoom-label" aria-hidden="true">{Math.round(zoom * 100)}%</span>
          <ToolButton label="Zoom in" icon="plus" onClick={() => r()?.zoomBy(1.2)} title="Zoom in (+)" />
          <ToolButton label="Reset view" icon="fit" onClick={() => r()?.resetView()} title="Back to 100% and the middle (0)" />
          <span className="sep" />
          <ToolButton label="Help" icon="help" onClick={() => setHelpOpen(true)} title="How to use the whiteboard" />
          {stress && <ToolButton label="Add 500 shapes" onClick={() => r()?.addMany(500)} />}
          {stress && <span className="muted" data-testid="fps">{fps} FPS · {objects.length} objects</span>}
        </div>
        {selectedShape && !readOnly && (
          <div className="toolbar" role="group" aria-label="Colour of the selected shape">
            <span className="muted">Colour:</span>
            <span className="palette">
              {SHAPE_COLORS.map((c) => (
                <button key={c.hex} type="button" aria-label={`Colour ${c.name}`} title={c.name} aria-pressed={selectedShape.color === c.hex}
                  style={{ background: c.hex }} onClick={() => r()?.setColorOfSelection(c.hex)} />
              ))}
            </span>
          </div>
        )}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="canvas-wrap">
          {shapes.length === 0 && (
            <div className="canvas-empty">
              <div>
                <strong>Your whiteboard is empty</strong>
                {readOnly ? 'Nothing has been added yet.' : 'Add a sticky note, a rectangle or an ellipse from the toolbar to begin.'}
              </div>
            </div>
          )}
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
        <p className="hint">{MODE_HINT}</p>
        <p id="canvas-help" className="sr-only">
          Shapes are in the object list below the canvas, where you can select them. With the canvas focused, arrow keys pan,
          or move the selected shape, and Alt plus arrow resizes it; Delete removes the selection; plus and minus zoom; zero resets the view; Control or Command
          plus Z undoes; Enter edits the text of the selected shape.
        </p>
        <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
        <dialog ref={help} onClose={() => setHelpOpen(false)} aria-labelledby="canvas-help-title">
          <h2 id="canvas-help-title">Using the whiteboard</h2>
          <ul className="help-list">
            <li><span>Add a shape</span><span>Use the buttons above the board</span></li>
            <li><span>Move a shape</span><span>Drag it, or press <kbd>←</kbd> <kbd>↑</kbd> <kbd>→</kbd> <kbd>↓</kbd></span></li>
            <li><span>Resize a shape</span><span>Drag the corner square, or <kbd>Alt</kbd> + arrow keys</span></li>
            <li><span>Edit the text</span><span>Double-click it, or press <kbd>Enter</kbd></span></li>
            <li><span>Join two shapes</span><span>Press Connect, then click each shape</span></li>
            <li><span>Change the colour</span><span>Select a shape, then pick a colour</span></li>
            <li><span>Delete</span><span><kbd>Delete</kbd> or the Delete button</span></li>
            <li><span>Undo and redo</span><span><kbd>Ctrl</kbd>+<kbd>Z</kbd> and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></span></li>
            <li><span>Move around</span><span>Drag empty space, or scroll</span></li>
            <li><span>Zoom</span><span><kbd>Ctrl</kbd>+scroll, or <kbd>+</kbd> and <kbd>-</kbd>; <kbd>0</kbd> resets</span></li>
          </ul>
          <p className="hint">Everyone who has the board open sees your changes, with your name on your pointer.</p>
          <div className="dialog-actions"><button className="btn" onClick={() => setHelpOpen(false)}>Got it</button></div>
        </dialog>
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

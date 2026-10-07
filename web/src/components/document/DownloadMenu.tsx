'use client'
import { useEffect, useRef, useState } from 'react'
import type { CanvasObject } from '@/lib/board/canvasModel'
import type { JsonNode } from '@/lib/export/blocks'
import { exportBoard, exportDocument, NothingToExport, pdfProblems, saveFile, type BoardFormat, type DocFormat } from '@/lib/export/index'

interface Choice {
  format: DocFormat | BoardFormat
  title: string
  hint: string
}

const DOCUMENT_CHOICES: Choice[] = [
  { format: 'pdf', title: 'PDF document', hint: '.pdf' },
  { format: 'docx', title: 'Word document', hint: '.docx' },
  { format: 'txt', title: 'Plain text', hint: '.txt' },
  { format: 'md', title: 'Markdown', hint: '.md' },
]
const BOARD_CHOICES: Choice[] = [
  { format: 'png', title: 'PNG image', hint: '.png' },
  { format: 'svg', title: 'SVG image', hint: '.svg' },
]

interface Props {
  title: string
  kind: 'doc' | 'canvas'
  // read when a choice is made, so the file always holds what is on the page at that moment
  getContent?: () => JsonNode | null
  getObjects?: () => CanvasObject[]
}

export default function DownloadMenu({ title, kind, getContent, getObjects }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const choices = kind === 'canvas' ? BOARD_CHOICES : DOCUMENT_CHOICES

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const items = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[data-choice]') ?? [])]

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      setOpen(false)
      button.current?.focus()
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open) {
      e.preventDefault()
      const all = items()
      const at = all.indexOf(document.activeElement as HTMLButtonElement)
      all[(at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus()
    }
  }

  async function choose(choice: Choice) {
    setBusy(choice.format)
    setFailed(false)
    setMessage('')
    try {
      const file =
        kind === 'canvas'
          ? await exportBoard(choice.format as BoardFormat, getObjects?.() ?? [], title)
          : await exportDocument(choice.format as DocFormat, getContent?.() ?? { type: 'doc' }, title)
      saveFile(file)
      setMessage(`${file.filename} downloaded.`)
      setOpen(false)
      button.current?.focus()
    } catch (err) {
      setFailed(true)
      setMessage(err instanceof NothingToExport ? err.message : "The file couldn't be created. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  // PDF uses a built-in font that does not cover every script. Say so before it surprises someone.
  const content = kind === 'doc' && open ? getContent?.() : null
  const missing = content ? pdfProblems(content) : []

  return (
    <div className="download" ref={root} onKeyDown={onKeyDown}>
      <button ref={button} type="button" className="btn secondary" aria-expanded={open} aria-controls="download-list" onClick={() => setOpen((o) => !o)}>
        Download
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div id="download-list" className="download-list" role="group" aria-label={kind === 'canvas' ? 'Download the board as' : 'Download the document as'}>
          {choices.map((c) => (
            <button key={c.format} type="button" data-choice onClick={() => choose(c)} disabled={busy !== null}>
              <span>{busy === c.format ? 'Preparing…' : c.title}</span>
              <span className="muted">{c.hint}</span>
            </button>
          ))}
          {missing.length > 0 && (
            <p className="hint">
              PDF can&apos;t show some characters here ({missing.slice(0, 4).join(' ')}{missing.length > 4 ? '…' : ''}). Word or plain text will keep them.
            </p>
          )}
        </div>
      )}
      <p role={failed ? 'alert' : 'status'} className={failed ? 'download-note error' : 'sr-only'}>{message}</p>
    </div>
  )
}

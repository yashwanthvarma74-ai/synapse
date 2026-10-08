'use client'
import { useState } from 'react'
import { Menu } from '@yashwanthvarma74/react'
import type { CanvasObject } from '@/lib/board/canvasModel'
import type { JsonNode } from '@/lib/export/blocks'
import { DownloadIcon } from '../ui/Icons'
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
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const [pdfNote, setPdfNote] = useState('')
  const choices = kind === 'canvas' ? BOARD_CHOICES : DOCUMENT_CHOICES

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
    } catch (err) {
      setFailed(true)
      setMessage(err instanceof NothingToExport ? err.message : "The file couldn't be created. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  // PDF uses a built-in font that does not cover every script. Say so when the menu opens, before it surprises someone.
  function onOpenChange(open: boolean) {
    if (!open || kind !== 'doc') return
    const missing = pdfProblems(getContent?.() ?? { type: 'doc' })
    setPdfNote(missing.length > 0
      ? `PDF can't show some characters here (${missing.slice(0, 4).join(' ')}${missing.length > 4 ? '…' : ''}). Word or plain text will keep them.`
      : '')
  }

  return (
    <div className="download">
      <Menu onOpenChange={onOpenChange}>
        <Menu.Trigger variant="secondary">
          <DownloadIcon size={16} />
          Download
        </Menu.Trigger>
        <Menu.Content aria-label={kind === 'canvas' ? 'Download the board as' : 'Download the document as'} placement="bottom end">
          {choices.map((c) => (
            <Menu.Item key={c.format} id={c.format} shortcut={c.hint} disabled={busy !== null} onAction={() => void choose(c)}>
              {busy === c.format ? 'Preparing…' : c.title}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu>
      {pdfNote && <p className="hint download-note">{pdfNote}</p>}
      <p role={failed ? 'alert' : 'status'} className={failed ? 'download-note error' : 'sr-only'}>{message}</p>
    </div>
  )
}

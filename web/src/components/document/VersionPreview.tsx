'use client'
import { useMemo, useRef } from 'react'
import { Button, Dialog, DialogBody, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@yashwanthvarma74/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { contentExtensions } from '@/lib/editor/extensions'
import { boardObjects, documentContent, stateToDoc, type DocType } from '@/lib/collab/versions'
import { boardToSvg, svgToDataUrl } from '@/lib/export/board'
import { fullDate } from '@/lib/time'
import type { VersionItem } from '@/lib/api'

interface Props {
  version: VersionItem
  state: Uint8Array // the saved document, exactly as it was when Save was pressed
  type: DocType
  canRestore: boolean
  restoring: boolean
  onRestore: () => void
  onClose: () => void
}

// Shows a saved version as it was, so you can see what you would go back to before you do it.
export default function VersionPreview({ version, state, type, canRestore, restoring, onRestore, onClose }: Props) {
  const close = useRef<HTMLButtonElement>(null)
  const saved = useMemo(() => stateToDoc(state), [state])
  const content = useMemo(() => (type === 'doc' ? documentContent(saved) : null), [saved, type])
  const board = useMemo(() => (type === 'canvas' ? boardToSvg(boardObjects(saved)) : null), [saved, type])
  const editor = useEditor(
    {
      extensions: contentExtensions,
      content: content ?? undefined,
      editable: false,
      immediatelyRender: false,
      // read-only content, not a text box
      editorProps: { attributes: { role: 'document', 'aria-label': 'Saved version of the document' } },
    },
    [content],
  )
  const what = type === 'canvas' ? 'board' : 'document'

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }} size="lg" initialFocusRef={close}>
      <DialogHeader>
        <DialogTitle>{version.label}</DialogTitle>
        <DialogDescription>Saved by {version.savedBy} on <time dateTime={version.createdAt}>{fullDate(version.createdAt)}</time></DialogDescription>
        <DialogClose />
      </DialogHeader>
      <DialogBody>
        <div className="version-body" tabIndex={0} role="region" aria-label={`The ${what} as it was when this version was saved`}>
          {type === 'canvas' ? (
            board ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={svgToDataUrl(board.svg)} alt="" width={board.width} height={board.height} className="version-board" />
            ) : (
              <p className="muted">The board was empty when this version was saved.</p>
            )
          ) : (
            <EditorContent editor={editor} />
          )}
        </div>
        <p id="version-note" className="hint">
          Restoring puts the {what} back exactly as shown here. What you have now is saved first as “Before restoring {version.label}”, so you can come back to it.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button ref={close} variant="secondary" onClick={onClose}>Close</Button>
        {canRestore && (
          <Button variant="primary" onClick={onRestore} disabled={restoring}>
            {restoring ? 'Restoring…' : 'Restore this version'}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}

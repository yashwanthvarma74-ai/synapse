'use client'

import { useEffect, useState } from 'react'
import { useEditor, EditorContent, type Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type { Collab } from '@/lib/collab/useCollab'
import { recordMetric } from '@/lib/telemetry'
import { SlashCommand } from '@/lib/editor/slashCommand'
import { Uploads } from '@/lib/editor/uploadExtension'

// The editor holds no text of its own: Collaboration binds it to the Yjs doc, so typing becomes a Yjs
// update that goes to IndexedDB and to the gateway.
export default function Editor({
  docId,
  collab,
  readOnly,
  onEditor,
}: {
  docId: string
  collab: Collab
  readOnly: boolean
  onEditor?: (editor: TiptapEditor | null) => void
}) {
  const [upload, setUpload] = useState<{ message: string; error: boolean }>({ message: '', error: false })
  const editor = useEditor(
    {
      extensions: [
        // Yjs brings its own undo, which only undoes your edits, not everyone's
        StarterKit.configure({ undoRedo: false }),
        Placeholder.configure({ placeholder: readOnly ? 'This document is empty.' : 'Start writing here…' }),
        Image.configure({ HTMLAttributes: { loading: 'lazy' } }),
        ...(readOnly ? [] : [SlashCommand, Uploads.configure({ docId, onStatus: (message, error = false) => setUpload({ message, error }) })]),
        Collaboration.configure({ document: collab.doc }),
        CollaborationCaret.configure({
          provider: { awareness: collab.awareness },
          user: collab.user,
        }),
      ],
      editable: !readOnly,
      immediatelyRender: false,
      editorProps: {
        attributes: { 'aria-label': 'Document editor', role: 'textbox', 'aria-multiline': 'true' },
      },
    },
    [collab, readOnly, docId],
  )

  useEffect(() => {
    onEditor?.(editor)
    return () => onEditor?.(null)
  }, [editor, onEditor])

  // Time from a key press to the screen updating. Printable keys only, about 10 samples a second at most,
  // so measuring never costs more than it tells.
  useEffect(() => {
    const dom = editor?.view.dom
    if (!dom) return
    let last = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey) return
      const t0 = performance.now()
      if (t0 - last < 100) return
      last = t0
      requestAnimationFrame(() => setTimeout(() => recordMetric('keystroke_to_paint', performance.now() - t0), 0))
    }
    dom.addEventListener('keydown', onKey)
    return () => dom.removeEventListener('keydown', onKey)
  }, [editor])

  return (
    <div className="editor-wrap">
      <EditorContent editor={editor} />
      {/* announced politely; an error is also shown so it is not missed */}
      <p role={upload.error ? 'alert' : 'status'} className={upload.error ? 'error' : 'upload-status'}>{upload.message}</p>
    </div>
  )
}

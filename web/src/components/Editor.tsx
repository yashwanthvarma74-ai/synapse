'use client'

import { useEffect } from 'react'
import { useEditor, EditorContent, type Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type { Collab } from '@/lib/useCollab'
import { recordMetric } from '@/lib/telemetry'
import { SlashCommand } from '@/lib/slashCommand'

// The editor does not hold its own text: Collaboration binds it to the Yjs doc.
// Typing becomes a Yjs update, and the same update goes to IndexedDB and the gateway.
export default function Editor({
  collab,
  readOnly,
  onEditor,
}: {
  collab: Collab
  readOnly: boolean
  onEditor?: (editor: TiptapEditor | null) => void
}) {
  const editor = useEditor(
    {
      extensions: [
        // Yjs brings its own undo, which only undoes YOUR edits, not everyone's
        StarterKit.configure({ undoRedo: false }),
        Placeholder.configure({ placeholder: readOnly ? 'This document is empty.' : 'Start writing here…' }),
        ...(readOnly ? [] : [SlashCommand]),
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
    [collab, readOnly],
  )

  useEffect(() => {
    onEditor?.(editor)
    return () => onEditor?.(null)
  }, [editor, onEditor])

  // How long from a key press until the screen has updated. Printable keys only, and
  // at most about 10 samples a second so the measuring never costs more than it tells.
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
    </div>
  )
}

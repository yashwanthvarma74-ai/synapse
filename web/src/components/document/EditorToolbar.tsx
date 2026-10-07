'use client'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'

// Formatting buttons. Plain words and letters, with the keyboard shortcut in the tooltip.
export default function EditorToolbar({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold') ?? false, italic: e?.isActive('italic') ?? false, strike: e?.isActive('strike') ?? false,
      h1: e?.isActive('heading', { level: 1 }) ?? false, h2: e?.isActive('heading', { level: 2 }) ?? false,
      bullets: e?.isActive('bulletList') ?? false, numbers: e?.isActive('orderedList') ?? false,
      quote: e?.isActive('blockquote') ?? false, code: e?.isActive('codeBlock') ?? false,
    }),
  })
  const off = disabled || !editor
  const run = (fn: (c: ReturnType<Editor['chain']>) => { run: () => boolean }) => () => editor && fn(editor.chain().focus()).run()
  const btn = (label: string, shortcut: string, pressed: boolean | null, onClick: () => void, content: React.ReactNode) => (
    <button type="button" aria-label={label} title={shortcut ? `${label} (${shortcut})` : label} aria-pressed={pressed ?? undefined} disabled={off} onClick={onClick}>
      {content}
    </button>
  )
  return (
    <div className="format-bar" role="toolbar" aria-label="Formatting">
      {btn('Undo', 'Ctrl+Z', null, () => editor?.commands.undo?.(), 'Undo')}
      {btn('Redo', 'Ctrl+Shift+Z', null, () => editor?.commands.redo?.(), 'Redo')}
      <span className="sep" />
      {btn('Bold', 'Ctrl+B', s?.bold ?? false, run((c) => c.toggleBold()), <strong>Bold</strong>)}
      {btn('Italic', 'Ctrl+I', s?.italic ?? false, run((c) => c.toggleItalic()), <em>Italic</em>)}
      {btn('Strike', 'Ctrl+Shift+S', s?.strike ?? false, run((c) => c.toggleStrike()), <s>Strike</s>)}
      <span className="sep" />
      {btn('Heading', 'Ctrl+Alt+1', s?.h1 ?? false, run((c) => c.toggleHeading({ level: 1 })), 'Heading')}
      {btn('Subheading', 'Ctrl+Alt+2', s?.h2 ?? false, run((c) => c.toggleHeading({ level: 2 })), 'Subheading')}
      <span className="sep" />
      {btn('Bullets', 'Ctrl+Shift+8', s?.bullets ?? false, run((c) => c.toggleBulletList()), 'Bullets')}
      {btn('Numbers', 'Ctrl+Shift+7', s?.numbers ?? false, run((c) => c.toggleOrderedList()), 'Numbers')}
      {btn('Quote', 'Ctrl+Shift+B', s?.quote ?? false, run((c) => c.toggleBlockquote()), 'Quote')}
      {btn('Code block', 'Ctrl+Alt+C', s?.code ?? false, run((c) => c.toggleCodeBlock()), 'Code')}
      <span className="sep" />
      {btn('Image', '', null, () => editor?.commands.chooseFile('image'), 'Image')}
      {btn('File', '', null, () => editor?.commands.chooseFile('file'), 'File')}
    </div>
  )
}

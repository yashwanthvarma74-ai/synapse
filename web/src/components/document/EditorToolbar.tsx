'use client'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { BoldIcon, BulletsIcon, CodeIcon, HeadingIcon, ImageIcon, ItalicIcon, NumbersIcon, PaperclipIcon, QuoteIcon, RedoIcon, StrikeIcon, SubheadingIcon, UndoIcon } from '../ui/Icons'

// Formatting buttons: an icon each, named for screen readers, with the keyboard shortcut in the tooltip.
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
      {btn('Undo', 'Ctrl+Z', null, () => editor?.commands.undo?.(), <UndoIcon />)}
      {btn('Redo', 'Ctrl+Shift+Z', null, () => editor?.commands.redo?.(), <RedoIcon />)}
      <span className="sep" />
      {btn('Bold', 'Ctrl+B', s?.bold ?? false, run((c) => c.toggleBold()), <BoldIcon />)}
      {btn('Italic', 'Ctrl+I', s?.italic ?? false, run((c) => c.toggleItalic()), <ItalicIcon />)}
      {btn('Strike', 'Ctrl+Shift+S', s?.strike ?? false, run((c) => c.toggleStrike()), <StrikeIcon />)}
      <span className="sep" />
      {btn('Heading', 'Ctrl+Alt+1', s?.h1 ?? false, run((c) => c.toggleHeading({ level: 1 })), <HeadingIcon />)}
      {btn('Subheading', 'Ctrl+Alt+2', s?.h2 ?? false, run((c) => c.toggleHeading({ level: 2 })), <SubheadingIcon />)}
      <span className="sep" />
      {btn('Bullets', 'Ctrl+Shift+8', s?.bullets ?? false, run((c) => c.toggleBulletList()), <BulletsIcon />)}
      {btn('Numbers', 'Ctrl+Shift+7', s?.numbers ?? false, run((c) => c.toggleOrderedList()), <NumbersIcon />)}
      {btn('Quote', 'Ctrl+Shift+B', s?.quote ?? false, run((c) => c.toggleBlockquote()), <QuoteIcon />)}
      {btn('Code block', 'Ctrl+Alt+C', s?.code ?? false, run((c) => c.toggleCodeBlock()), <CodeIcon />)}
      <span className="sep" />
      {btn('Image', '', null, () => editor?.commands.chooseFile('image'), <ImageIcon />)}
      {btn('File', '', null, () => editor?.commands.chooseFile('file'), <PaperclipIcon />)}
    </div>
  )
}

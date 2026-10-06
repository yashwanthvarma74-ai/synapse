// The blocks you can insert by typing "/" in the editor. Kept apart from the editor code so
// the list and its filtering can be tested without a browser.
import type { Editor, Range } from '@tiptap/core'

export interface SlashItem {
  id: string
  title: string
  hint: string
  words: string[] // extra words that should find this item
  run: (editor: Editor, range: Range) => void
}

const start = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range)

export const slashItems: SlashItem[] = [
  { id: 'h1', title: 'Heading', hint: 'Big section title', words: ['h1', 'title'], run: (e, r) => start(e, r).setNode('heading', { level: 1 }).run() },
  { id: 'h2', title: 'Subheading', hint: 'Medium section title', words: ['h2'], run: (e, r) => start(e, r).setNode('heading', { level: 2 }).run() },
  { id: 'h3', title: 'Small heading', hint: 'Small section title', words: ['h3'], run: (e, r) => start(e, r).setNode('heading', { level: 3 }).run() },
  { id: 'bullets', title: 'Bullet list', hint: 'A simple list', words: ['ul', 'unordered', 'list'], run: (e, r) => start(e, r).toggleBulletList().run() },
  { id: 'numbers', title: 'Numbered list', hint: 'A list with 1, 2, 3', words: ['ol', 'ordered', 'list'], run: (e, r) => start(e, r).toggleOrderedList().run() },
  { id: 'quote', title: 'Quote', hint: 'Set a passage apart', words: ['blockquote', 'cite'], run: (e, r) => start(e, r).toggleBlockquote().run() },
  { id: 'code', title: 'Code block', hint: 'Fixed-width code', words: ['snippet', 'pre'], run: (e, r) => start(e, r).toggleCodeBlock().run() },
  { id: 'image', title: 'Image', hint: 'Upload a picture', words: ['picture', 'photo', 'upload', 'png'], run: (e, r) => { start(e, r).run(); e.commands.chooseFile('image') } },
  { id: 'file', title: 'File', hint: 'Attach a PDF or text file', words: ['attach', 'pdf', 'upload', 'document'], run: (e, r) => { start(e, r).run(); e.commands.chooseFile('file') } },
  { id: 'divider', title: 'Divider', hint: 'A horizontal line', words: ['line', 'rule', 'hr', 'separator'], run: (e, r) => start(e, r).setHorizontalRule().run() },
]

export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  const starts = items.filter((i) => i.title.toLowerCase().startsWith(q) || i.words.some((w) => w.startsWith(q)))
  const contains = items.filter((i) => !starts.includes(i) && (i.title.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q)))
  return [...starts, ...contains]
}

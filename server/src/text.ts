// Pull plain text out of a Tiptap document (a Yjs XmlFragment named "default"),
// for full-text search. Blocks (paragraphs, headings...) become lines.
import * as Y from 'yjs'

function walk(node: Y.XmlElement | Y.XmlText | Y.XmlFragment | Y.XmlHook, out: string[]) {
  if (node instanceof Y.XmlText) {
    out.push(node.toDelta().map((d: { insert?: unknown }) => (typeof d.insert === 'string' ? d.insert : '')).join(''))
    return
  }
  if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
    const parts: string[] = []
    node.forEach((child) => walk(child as Y.XmlElement, parts))
    out.push(parts.join(''))
    out.push('\n')
  }
}

// Text typed on canvas shapes and sticky notes
function canvasText(doc: Y.Doc): string {
  const parts: string[] = []
  doc.getMap<Y.Map<unknown>>('objects').forEach((m) => {
    const t = m.get('text')
    if (typeof t === 'string' && t) parts.push(t)
  })
  return parts.join('\n')
}

export function extractText(doc: Y.Doc, field = 'default'): string {
  const canvas = canvasText(doc)
  if (canvas) return canvas.slice(0, 200_000)
  const out: string[] = []
  const fragment = doc.getXmlFragment(field)
  fragment.forEach((child) => walk(child as Y.XmlElement, out))
  return out.join('').replace(/\n{2,}/g, '\n').trim().slice(0, 200_000)
}

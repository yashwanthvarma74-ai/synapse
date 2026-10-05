// Plain text from a Tiptap Yjs document (same idea as server/src/text.ts), used to
// preview old versions.
import * as Y from 'yjs'

function walk(node: Y.XmlElement | Y.XmlText | Y.XmlFragment | Y.XmlHook, out: string[]) {
  if (node instanceof Y.XmlText) {
    out.push(node.toDelta().map((d: { insert?: unknown }) => (typeof d.insert === 'string' ? d.insert : '')).join(''))
  } else if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
    const parts: string[] = []
    node.forEach((child) => walk(child as Y.XmlElement, parts))
    out.push(parts.join(''), '\n')
  }
}

export function extractText(doc: Y.Doc): string {
  const out: string[] = []
  doc.getXmlFragment('default').forEach((c) => walk(c as Y.XmlElement, out))
  return out.join('').replace(/\n{2,}/g, '\n').trim()
}

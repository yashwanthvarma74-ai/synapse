// The editor's content (ProseMirror JSON) as a small, flat structure that every export format can walk.

export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  underline?: boolean
  code?: boolean
  href?: string
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; ordered: boolean; items: Block[][] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'code'; text: string }
  | { type: 'rule' }
  | { type: 'image'; src: string; alt: string }

export interface JsonNode {
  type?: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

function runsOf(nodes: JsonNode[] = []): Run[] {
  const runs: Run[] = []
  for (const n of nodes) {
    if (n.type === 'hardBreak') {
      runs.push({ text: '\n' })
    } else if (n.type === 'text' && n.text) {
      const run: Run = { text: n.text }
      for (const mark of n.marks ?? []) {
        if (mark.type === 'bold') run.bold = true
        else if (mark.type === 'italic') run.italic = true
        else if (mark.type === 'strike') run.strike = true
        else if (mark.type === 'underline') run.underline = true
        else if (mark.type === 'code') run.code = true
        else if (mark.type === 'link' && typeof mark.attrs?.href === 'string') run.href = mark.attrs.href
      }
      runs.push(run)
    }
  }
  return runs
}

const plainText = (nodes: JsonNode[] = []) => nodes.map((n) => n.text ?? '').join('')

function blockOf(node: JsonNode): Block[] {
  switch (node.type) {
    case 'paragraph':
      return [{ type: 'paragraph', runs: runsOf(node.content) }]
    case 'heading': {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 1)) as 1 | 2 | 3
      return [{ type: 'heading', level, runs: runsOf(node.content) }]
    }
    case 'bulletList':
    case 'orderedList':
      return [{ type: 'list', ordered: node.type === 'orderedList', items: (node.content ?? []).map((item) => blocksOf(item.content)) }]
    case 'blockquote':
      return [{ type: 'quote', blocks: blocksOf(node.content) }]
    case 'codeBlock':
      return [{ type: 'code', text: plainText(node.content) }]
    case 'horizontalRule':
      return [{ type: 'rule' }]
    case 'image':
      return typeof node.attrs?.src === 'string' ? [{ type: 'image', src: node.attrs.src, alt: String(node.attrs.alt ?? '') }] : []
    default:
      return []
  }
}

const blocksOf = (nodes: JsonNode[] = []): Block[] => nodes.flatMap(blockOf)

export const parseDoc = (doc: JsonNode): Block[] => blocksOf(doc.content)

export const runsToText = (runs: Run[]) => runs.map((r) => r.text).join('')

// Every piece of text in the document, in order (used to look for characters a format cannot show)
export function allText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'heading':
        case 'paragraph':
          return runsToText(b.runs)
        case 'list':
          return b.items.map(allText).join('\n')
        case 'quote':
          return allText(b.blocks)
        case 'code':
          return b.text
        default:
          return ''
      }
    })
    .join('\n')
}

export const isEmpty = (blocks: Block[]) => allText(blocks).trim() === '' && !blocks.some((b) => b.type === 'image')

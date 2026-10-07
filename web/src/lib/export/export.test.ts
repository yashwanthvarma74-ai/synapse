import { describe, expect, it } from 'vitest'
import { allText, isEmpty, parseDoc, type JsonNode } from './blocks'
import { toMarkdown, toPlainText } from './text'

const t = (text: string, ...marks: string[]): JsonNode => ({ type: 'text', text, marks: marks.map((type) => ({ type })) })
const p = (...content: JsonNode[]): JsonNode => ({ type: 'paragraph', content })
const doc = (...content: JsonNode[]): JsonNode => ({ type: 'doc', content })
const li = (...content: JsonNode[]): JsonNode => ({ type: 'listItem', content })

const sample = doc(
  { type: 'heading', attrs: { level: 1 }, content: [t('Plan')] },
  p(t('Ship the '), t('beta', 'bold'), t(' by '), t('Friday', 'italic', 'strike'), t('.')),
  { type: 'bulletList', content: [li(p(t('write docs'))), li(p(t('test it')), { type: 'orderedList', content: [li(p(t('unit'))), li(p(t('browser')))] })] },
  { type: 'blockquote', content: [p(t('Ship early.'))] },
  { type: 'codeBlock', content: [t('npm test\nnpm run build')] },
  { type: 'horizontalRule' },
  p({ type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }),
)

describe('reading the editor content', () => {
  it('turns ProseMirror JSON into simple blocks', () => {
    const blocks = parseDoc(sample)
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'quote', 'code', 'rule', 'paragraph'])
    expect(blocks[1]).toMatchObject({ runs: [{ text: 'Ship the ' }, { text: 'beta', bold: true }, { text: ' by ' }, { text: 'Friday', italic: true, strike: true }, { text: '.' }] })
  })
  it('keeps nested lists and clamps deep headings to three levels', () => {
    const blocks = parseDoc(doc({ type: 'heading', attrs: { level: 5 }, content: [t('x')] }, sample.content![2]))
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 3 })
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: false })
  })
  it('ignores node types it does not know, and images without an address', () => {
    expect(parseDoc(doc({ type: 'mystery' }, { type: 'image', attrs: {} }))).toEqual([])
  })
  it('treats hard breaks as new lines', () => {
    const [b] = parseDoc(doc(p(t('one'), { type: 'hardBreak' }, t('two'))))
    expect(b).toMatchObject({ type: 'paragraph' })
    expect(allText([b])).toBe('one\ntwo')
  })
  it('knows when a document is empty', () => {
    expect(isEmpty(parseDoc(doc(p())))).toBe(true)
    expect(isEmpty(parseDoc(doc(p(t('   ')))))).toBe(true)
    expect(isEmpty(parseDoc(doc(p(t('hi')))))).toBe(false)
    expect(isEmpty(parseDoc(doc({ type: 'image', attrs: { src: '/x.png' } })))).toBe(false)
  })
})

describe('plain text', () => {
  it('writes readable text with list markers, quotes and indented code', () => {
    expect(toPlainText(parseDoc(sample))).toBe([
      'Plan',
      '',
      'Ship the beta by Friday.',
      '',
      '- write docs',
      '- test it',
      '  1. unit',
      '  2. browser',
      '',
      '> Ship early.',
      '',
      '    npm test',
      '    npm run build',
      '',
      '----------',
      '',
      'docs',
      '',
    ].join('\n'))
  })
  it('names images instead of dropping them silently', () => {
    expect(toPlainText(parseDoc(doc({ type: 'image', attrs: { src: '/a.png', alt: 'a cat' } })))).toBe('[Image: a cat]\n')
  })
})

describe('Markdown', () => {
  it('keeps headings, emphasis, links, lists, quotes and code', () => {
    expect(toMarkdown(parseDoc(sample))).toBe([
      '# Plan',
      '',
      'Ship the **beta** by ~~*Friday*~~.',
      '',
      '- write docs',
      '- test it',
      '  1. unit',
      '  2. browser',
      '',
      '> Ship early.',
      '',
      '```',
      'npm test',
      'npm run build',
      '```',
      '',
      '---',
      '',
      '[docs](https://example.com)',
      '',
    ].join('\n'))
  })
  it('writes images with their address', () => {
    expect(toMarkdown(parseDoc(doc({ type: 'image', attrs: { src: 'https://x/y.png', alt: 'logo' } })))).toBe('![logo](https://x/y.png)\n')
  })
})

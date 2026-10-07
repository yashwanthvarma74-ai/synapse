import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseDoc, type JsonNode } from './blocks'
import { boardToSvg, wrapText } from './board'
import { fileName } from './index'
import { buildPdfDefinition, toPdf, uncoveredCharacters } from './pdf'
import { toWord } from './word'
import type { CanvasObject } from '../canvasModel'

const t = (text: string, ...marks: string[]): JsonNode => ({ type: 'text', text, marks: marks.map((type) => ({ type })) })
const p = (...content: JsonNode[]): JsonNode => ({ type: 'paragraph', content })
const doc = (...content: JsonNode[]): JsonNode => ({ type: 'doc', content })
const li = (...content: JsonNode[]): JsonNode => ({ type: 'listItem', content })
const link = (text: string, href: string): JsonNode => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })

const sample = doc(
  { type: 'heading', attrs: { level: 1 }, content: [t('Quarterly plan')] },
  p(t('Ship the '), t('beta', 'bold'), t(' and read '), link('the notes', 'https://example.com/notes')),
  { type: 'bulletList', content: [li(p(t('write docs'))), li(p(t('test it')))] },
  { type: 'orderedList', content: [li(p(t('first'))), li(p(t('second')))] },
  { type: 'orderedList', content: [li(p(t('again from one')))] },
  { type: 'blockquote', content: [p(t('A quoted line'))] },
  { type: 'codeBlock', content: [t('npm test')] },
)

// a 1x1 PNG
const PIXEL = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

async function openDocx(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  return { zip, xml: await zip.file('word/document.xml')!.async('string') }
}

describe('Word', () => {
  it('writes a real .docx (a zip) holding the text, headings and formatting', async () => {
    const { xml } = await openDocx(await toWord(parseDoc(sample), 'Quarterly plan'))
    for (const text of ['Quarterly plan', 'Ship the ', 'beta', 'write docs', 'A quoted line', 'npm test']) expect(xml).toContain(text)
    expect(xml).toContain('Heading1')
    expect(xml).toMatch(/<w:b[ />]/) // the bold run
  })

  it('makes real links, bullets and numbered lists that each restart at one', async () => {
    const { zip, xml } = await openDocx(await toWord(parseDoc(sample), 'x'))
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('https://example.com/notes')
    expect(xml).toContain('<w:hyperlink')
    const numbering = await zip.file('word/numbering.xml')!.async('string')
    expect(numbering.match(/<w:num /g)!.length).toBeGreaterThanOrEqual(3) // two numbered lists, plus bullets
    const refs = [...xml.matchAll(/<w:numId w:val="(\d+)"/g)].map((m) => m[1])
    expect(new Set(refs).size).toBeGreaterThanOrEqual(3)
  })

  it('embeds an image when it can be loaded, and names it when it cannot', async () => {
    const withImage = doc({ type: 'image', attrs: { src: '/a.png', alt: 'a pixel' } })
    const ok = await openDocx(await toWord(parseDoc(withImage), 'x', async () => ({ data: PIXEL, width: 1, height: 1 })))
    expect(Object.keys(ok.zip.files).some((f) => f.startsWith('word/media/'))).toBe(true)
    const missing = await openDocx(await toWord(parseDoc(withImage), 'x', async () => null))
    expect(Object.keys(missing.zip.files).some((f) => f.startsWith('word/media/'))).toBe(false)
    expect(missing.xml).toContain('[Image: a pixel]')
  })

  it('keeps line breaks inside a paragraph', async () => {
    const { xml } = await openDocx(await toWord(parseDoc(doc(p(t('one'), { type: 'hardBreak' }, t('two')))), 'x'))
    expect(xml).toContain('<w:br/>')
  })
})

describe('PDF', () => {
  it('describes headings, lists, quotes and code for the PDF library', () => {
    const def = buildPdfDefinition(parseDoc(sample), 'Quarterly plan')
    const content = def.content as unknown as Array<Record<string, unknown>>
    expect(content[0]).toMatchObject({ fontSize: 22, bold: true })
    expect(content.some((c) => 'ul' in c)).toBe(true)
    expect(content.some((c) => 'ol' in c)).toBe(true)
    expect(content.filter((c) => 'table' in c)).toHaveLength(2) // the quote and the code block
    expect(def.info).toMatchObject({ title: 'Quarterly plan' })
  })

  it('produces an actual PDF file', async () => {
    const blob = await toPdf(parseDoc(sample), 'Quarterly plan')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(2000)
  })

  it('shows a placeholder for an image it cannot load', () => {
    const def = buildPdfDefinition(parseDoc(doc({ type: 'image', attrs: { src: '/gone.png', alt: 'logo' } })), 'x')
    expect(def.content).toEqual([expect.objectContaining({ text: '[Image: logo]' })])
  })

  it('lists the characters the PDF font cannot show, so the page can warn first', () => {
    expect(uncoveredCharacters(parseDoc(doc(p(t('Plain English, Ελληνικά, Русский, café, 12 €')))))).toEqual([])
    const bad = uncoveredCharacters(parseDoc(doc(p(t('నమస్కారం hello 👋')))))
    expect(bad).toContain('న')
    expect(bad).toContain('👋')
    expect(bad).not.toContain('h')
  })
})

// ---------------------------------------------------------------------------------------------------
const obj = (id: string, patch: Partial<CanvasObject> = {}): CanvasObject => ({ id, kind: 'rect', x: 0, y: 0, w: 160, h: 100, text: '', color: '#4dabf7', z: 0, ...patch })
const eight = (s: string) => s.length * 8 // a stand-in for measuring text

describe('whiteboard image', () => {
  it('has nothing to draw for an empty board (connectors alone do not count)', () => {
    expect(boardToSvg([], eight)).toBeNull()
    expect(boardToSvg([obj('c', { kind: 'connector', from: 'a', to: 'b' })], eight)).toBeNull()
  })

  it('draws every shape kind with its colour, and sizes the image to fit with a margin', () => {
    const image = boardToSvg([
      obj('a', { x: 0, y: 0, w: 100, h: 50 }),
      obj('b', { kind: 'ellipse', x: 200, y: 100, w: 80, h: 80, color: '#69db7c' }),
      obj('c', { kind: 'sticky', x: 20, y: 150, w: 100, h: 100, color: '#ffe066' }),
    ], eight)!
    expect(image.svg.match(/<rect /g)).toHaveLength(3) // the background, the box and the sticky note
    expect(image.svg).toContain('<ellipse')
    expect(image.svg).toContain('fill="#69db7c"')
    expect(image.svg).toContain('rx="4"') // sticky notes have tighter corners
    expect(image.width).toBe(280 + 80) // widest right edge, plus 40 either side
    expect(image.height).toBe(250 + 80)
  })

  it('joins connected shapes with a line from centre to centre, and skips a connector whose end was deleted', () => {
    const image = boardToSvg([
      obj('a', { x: 0, y: 0, w: 100, h: 100 }),
      obj('b', { x: 200, y: 0, w: 100, h: 100 }),
      obj('ok', { kind: 'connector', from: 'a', to: 'b' }),
      obj('dangling', { kind: 'connector', from: 'a', to: 'deleted' }),
    ], eight)!
    expect(image.svg.match(/<line /g)).toHaveLength(1)
    expect(image.svg).toContain('x1="50" y1="50" x2="250" y2="50"')
  })

  it('escapes text so a board can never inject markup into the image', () => {
    const image = boardToSvg([obj('a', { text: '<script>alert(1)</script> & "quotes"' })], eight)!
    expect(image.svg).not.toContain('<script>')
    expect(image.svg).toContain('&lt;script&gt;')
    expect(image.svg).toContain('&amp;')
  })

  it('only accepts plain hex colours', () => {
    const image = boardToSvg([obj('a', { color: 'red" onload="alert(1)' })], eight)!
    expect(image.svg).not.toContain('onload')
    expect(image.svg).toContain('#adb5bd')
  })

  it('wraps long text inside the shape, honouring line breaks and splitting very long words', () => {
    expect(wrapText('one two three four', 100, eight)).toEqual(['one two', 'three four'])
    expect(wrapText('a\nb', 100, eight)).toEqual(['a', 'b'])
    const long = wrapText('abcdefghijklmnopqrstuvwxyz', 80, eight)
    expect(long.length).toBeGreaterThan(2)
    expect(long.join('')).toBe('abcdefghijklmnopqrstuvwxyz')
    expect(long.every((l) => eight(l) <= 80)).toBe(true)
  })

  it('centres text in boxes and ellipses, and starts it at the top left on sticky notes', () => {
    const box = boardToSvg([obj('a', { text: 'hi', w: 200, h: 100 })], eight)!
    expect(box.svg).toContain('text-anchor="middle"')
    const sticky = boardToSvg([obj('a', { kind: 'sticky', text: 'hi', w: 200, h: 100 })], eight)!
    expect(sticky.svg).toContain('text-anchor="start"')
  })
})

describe('file names', () => {
  it('turns a title into a safe name, keeping letters from any language', () => {
    expect(fileName('Q3 plan: draft/2', 'pdf')).toBe('Q3-plan-draft-2.pdf')
    expect(fileName('నమస్కారం notes', 'docx')).toContain('.docx')
    expect(fileName('  ///  ', 'txt')).toBe('synapse.txt')
    expect(fileName('x'.repeat(200), 'md').length).toBeLessThanOrEqual(63)
  })
})

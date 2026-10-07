import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import { allText, type Block, type Run } from './blocks'
import { collectImages, fit, loadAll, noImages, type ImageLoader, type LoadedImage } from './images'

const HEADING_SIZE = { 1: 22, 2: 17, 3: 14 } as const
const PAGE_WIDTH_PT = 480

// The bundled PDF font covers Latin, Greek and Cyrillic and common symbols, not every script (Telugu, Hindi,
// emoji...). These are the characters it cannot be trusted with, so the page can warn before exporting.
const COVERED = /[\s\u0000-ɏͰ-ϿЀ-ӿ -⁯₠-⃏℀-⅏←-⇿∀-⋿]/
export function uncoveredCharacters(blocks: Block[]): string[] {
  return [...new Set([...allText(blocks)].filter((ch) => !COVERED.test(ch)))]
}

function inline(runs: Run[]): Content[] {
  return runs.map((r) => ({
    text: r.text,
    bold: r.bold,
    italics: r.italic,
    decoration: [r.strike ? 'lineThrough' : '', r.underline || r.href ? 'underline' : ''].filter(Boolean) as Array<'lineThrough' | 'underline'>,
    color: r.href ? '#1d4ed8' : undefined,
    link: r.href,
    background: r.code ? '#f1f3f5' : undefined,
  }))
}

export function buildPdfDefinition(blocks: Block[], title: string, images = new Map<string, LoadedImage>()): TDocumentDefinitions {
  const convert = (list: Block[]): Content[] =>
    list.map((b): Content => {
      switch (b.type) {
        case 'heading':
          return { text: inline(b.runs), fontSize: HEADING_SIZE[b.level], bold: true, margin: [0, b.level === 1 ? 6 : 12, 0, 6] }
        case 'paragraph':
          return { text: inline(b.runs).length ? inline(b.runs) : ' ', margin: [0, 0, 0, 8], lineHeight: 1.25 }
        case 'list': {
          const items = b.items.map((item) => ({ stack: convert(item), margin: [0, 0, 0, 2] }))
          return (b.ordered ? { ol: items, margin: [0, 0, 0, 8] } : { ul: items, margin: [0, 0, 0, 8] }) as Content
        }
        case 'quote':
          return {
            table: { widths: ['*'], body: [[{ stack: convert(b.blocks), color: '#495057' }]] },
            layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 3 : 0), vLineColor: () => '#ced4da', paddingLeft: () => 12, paddingTop: () => 0, paddingBottom: () => 0 },
            margin: [0, 0, 0, 8],
          }
        case 'code':
          return {
            table: { widths: ['*'], body: [[{ text: b.text || ' ', fontSize: 10, preserveLeadingSpaces: true, fillColor: '#f1f3f5' }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
            margin: [0, 0, 0, 8],
          }
        case 'rule':
          return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: PAGE_WIDTH_PT, y2: 0, lineWidth: 1, lineColor: '#ced4da' }], margin: [0, 6, 0, 10] }
        case 'image': {
          const img = images.get(b.src)
          if (!img) return { text: `[Image${b.alt ? `: ${b.alt}` : ''}]`, italics: true, color: '#868e96', margin: [0, 0, 0, 8] }
          const size = fit(img, PAGE_WIDTH_PT)
          return { image: `data:image/png;base64,${btoa(String.fromCharCode(...img.data))}`, width: size.width, margin: [0, 0, 0, 8] }
        }
      }
    })

  return {
    info: { title, author: 'Synapse', creator: 'Synapse' },
    pageSize: 'A4',
    pageMargins: [56, 64, 56, 64],
    defaultStyle: { font: 'Roboto', fontSize: 11 },
    content: convert(blocks),
    footer: (page: number, pages: number) => ({ text: `${page} / ${pages}`, alignment: 'center', fontSize: 9, color: '#868e96', margin: [0, 24, 0, 0] }),
  }
}

export async function toPdf(blocks: Block[], title: string, loader: ImageLoader = noImages): Promise<Blob> {
  const images = await loadAll(collectImages(blocks), loader)
  // loaded on demand: the PDF library and its fonts are large, and most visits never export a PDF
  const pdfMake = (await import('pdfmake/build/pdfmake')).default
  const fonts = (await import('pdfmake/build/vfs_fonts')).default as unknown as Record<string, string>
  pdfMake.addVirtualFileSystem(fonts)
  return pdfMake.createPdf(buildPdfDefinition(blocks, title, images)).getBlob()
}

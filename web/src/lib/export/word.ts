import { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, TextRun, type ParagraphChild } from 'docx'
import type { Block, Run } from './blocks'
import { collectImages, fit, loadAll, noImages, type ImageLoader, type LoadedImage } from './images'

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3]
const PAGE_WIDTH_PX = 600

function textRuns(runs: Run[]): ParagraphChild[] {
  return runs.flatMap((r): ParagraphChild[] => {
    const lines = r.text.split('\n')
    const pieces = lines.map(
      (line, i) =>
        new TextRun({
          text: line,
          break: i > 0 ? 1 : undefined,
          bold: r.bold,
          italics: r.italic,
          strike: r.strike,
          underline: r.underline || r.href ? {} : undefined,
          color: r.href ? '1D4ED8' : undefined,
          font: r.code ? 'Consolas' : undefined,
          shading: r.code ? { fill: 'F1F3F5' } : undefined,
        }),
    )
    return r.href ? [new ExternalHyperlink({ link: r.href, children: pieces })] : pieces
  })
}

export async function toWord(blocks: Block[], title: string, loader: ImageLoader = noImages): Promise<Blob> {
  const images = await loadAll(collectImages(blocks), loader)
  const orderedLists: string[] = [] // one numbering definition per numbered list, so each starts at 1

  function convert(list: Block[], level = 0, quoted = false): Paragraph[] {
    const indent = quoted ? { left: 360 } : undefined
    const border = quoted ? { left: { style: BorderStyle.SINGLE, size: 12, color: 'CED4DA', space: 8 } } : undefined
    return list.flatMap((b): Paragraph[] => {
      switch (b.type) {
        case 'heading':
          return [new Paragraph({ heading: HEADINGS[b.level - 1], children: textRuns(b.runs), spacing: { before: 240, after: 80 } })]
        case 'paragraph':
          return [new Paragraph({ children: textRuns(b.runs), indent, border, spacing: { after: 120 } })]
        case 'list': {
          const reference = b.ordered ? `ol-${orderedLists.push(`ol-${orderedLists.length}`) - 1}` : undefined
          return b.items.flatMap((item) => {
            const [first, ...rest] = item
            const head = first && (first.type === 'paragraph' || first.type === 'heading') ? first.runs : []
            const row = new Paragraph({
              children: textRuns(head),
              ...(reference ? { numbering: { reference, level: Math.min(level, 5) } } : { bullet: { level: Math.min(level, 5) } }),
            })
            const others = (head.length ? rest : item)
            return [row, ...convert(others, level + 1, quoted)]
          })
        }
        case 'quote':
          return convert(b.blocks, level, true)
        case 'code':
          return b.text.split('\n').map((line) => new Paragraph({ children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 20 })], shading: { fill: 'F1F3F5' } }))
        case 'rule':
          return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CED4DA', space: 1 } }, spacing: { after: 160 } })]
        case 'image': {
          const img: LoadedImage | undefined = images.get(b.src)
          if (!img) return [new Paragraph({ children: [new TextRun({ text: `[Image${b.alt ? `: ${b.alt}` : ''}]`, italics: true })] })]
          return [new Paragraph({ children: [new ImageRun({ type: 'png', data: img.data, transformation: fit(img, PAGE_WIDTH_PX), altText: { name: b.alt || 'image', description: b.alt || 'image', title: b.alt || 'image' } })], spacing: { after: 120 } })]
        }
      }
    })
  }

  const children = convert(blocks)
  const doc = new Document({
    title,
    creator: 'Synapse',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: orderedLists.map((reference) => ({
        reference,
        levels: Array.from({ length: 6 }, (_, level) => ({
          level,
          format: LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
        })),
      })),
    },
    sections: [{ children }],
  })
  return Packer.toBlob(doc)
}

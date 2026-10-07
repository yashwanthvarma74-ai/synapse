import type { CanvasObject } from '../canvasModel'
import { boardToSvg, svgToPng } from './board'
import { isEmpty, parseDoc, type JsonNode } from './blocks'
import { loadImage } from './images'
import { toMarkdown, toPlainText } from './text'
import { toPdf, uncoveredCharacters } from './pdf'
import { toWord } from './word'

export type DocFormat = 'pdf' | 'docx' | 'txt' | 'md'
export type BoardFormat = 'png' | 'svg'

export interface Exported {
  blob: Blob
  filename: string
}

// Thrown when there is nothing to put in the file, so the page can say so plainly
export class NothingToExport extends Error {}

// "Q3 plan: draft/2" -> "Q3-plan-draft-2"
export function fileName(title: string, extension: string) {
  const base = title.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${base || 'synapse'}.${extension}`
}

export async function exportDocument(format: DocFormat, content: JsonNode, title: string): Promise<Exported> {
  const blocks = parseDoc(content)
  if (isEmpty(blocks)) throw new NothingToExport('This document is empty, so there is nothing to download yet.')
  const filename = fileName(title, format)
  switch (format) {
    case 'txt':
      return { blob: new Blob([toPlainText(blocks)], { type: 'text/plain;charset=utf-8' }), filename }
    case 'md':
      return { blob: new Blob([toMarkdown(blocks)], { type: 'text/markdown;charset=utf-8' }), filename }
    case 'docx':
      return { blob: await toWord(blocks, title, loadImage), filename }
    case 'pdf':
      return { blob: await toPdf(blocks, title, loadImage), filename }
  }
}

export async function exportBoard(format: BoardFormat, objects: CanvasObject[], title: string): Promise<Exported> {
  const image = boardToSvg(objects)
  if (!image) throw new NothingToExport('This board is empty, so there is nothing to download yet.')
  const filename = fileName(title, format)
  if (format === 'svg') return { blob: new Blob([image.svg], { type: 'image/svg+xml;charset=utf-8' }), filename }
  return { blob: await svgToPng(image), filename }
}

// Characters in this document that the PDF font cannot show (empty when the document is safe to export)
export const pdfProblems = (content: JsonNode) => uncoveredCharacters(parseDoc(content))

export function saveFile({ blob, filename }: Exported) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

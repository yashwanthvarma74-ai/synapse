import type { CanvasObject } from '../canvasModel'

// A whiteboard drawn as SVG, styled like the live canvas. One drawing serves the version preview and both
// image downloads (SVG as is, PNG by rasterising it).

export interface BoardImage {
  svg: string
  width: number
  height: number
}

export type Measure = (text: string) => number

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const FONT_SIZE = 16
const LINE_HEIGHT = 20
const TEXT_PADDING = 10
const MARGIN = 40
const BACKGROUND = '#f8f9fb'
const MAX_PIXELS = 8192

let ruler: CanvasRenderingContext2D | null = null
const measureInBrowser: Measure = (text) => {
  if (typeof document === 'undefined') return text.length * 8.4
  ruler ??= document.createElement('canvas').getContext('2d')!
  ruler.font = `${FONT_SIZE}px ${FONT}`
  return ruler.measureText(text).width
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
// Colours come from whatever a collaborator stored, so only plain hex values are allowed through
const safeColor = (c: string) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#adb5bd')

// Break text into lines that fit a width. Respects line breaks and splits words that are wider than the box.
export function wrapText(text: string, maxWidth: number, measure: Measure = measureInBrowser): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = ''
      let rest = word
      while (measure(rest) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1
        while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut--
        lines.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    lines.push(line)
  }
  return lines
}

function label(o: CanvasObject, measure: Measure): string {
  if (!o.text) return ''
  const lines = wrapText(o.text, o.w - TEXT_PADDING * 2, measure)
  const sticky = o.kind === 'sticky'
  const top = sticky ? o.y + TEXT_PADDING : o.y + o.h / 2 - (lines.length * LINE_HEIGHT) / 2
  const x = sticky ? o.x + TEXT_PADDING : o.x + o.w / 2
  const spans = lines.map((line, i) => `<tspan x="${x}" y="${top + i * LINE_HEIGHT + FONT_SIZE * 0.85}">${escapeXml(line)}</tspan>`).join('')
  return `<text fill="#1a1a1a" font-size="${FONT_SIZE}" text-anchor="${sticky ? 'start' : 'middle'}">${spans}</text>`
}

// Returns null when there is nothing on the board to draw
export function boardToSvg(objects: CanvasObject[], measure: Measure = measureInBrowser): BoardImage | null {
  const shapes = objects.filter((o) => o.kind !== 'connector')
  if (shapes.length === 0) return null

  const left = Math.min(...shapes.map((o) => o.x)) - MARGIN
  const top = Math.min(...shapes.map((o) => o.y)) - MARGIN
  const width = Math.ceil(Math.max(...shapes.map((o) => o.x + o.w)) + MARGIN - left)
  const height = Math.ceil(Math.max(...shapes.map((o) => o.y + o.h)) + MARGIN - top)
  const byId = new Map(shapes.map((o) => [o.id, o]))

  const lines = objects
    .filter((o) => o.kind === 'connector')
    .flatMap((c) => {
      const a = c.from ? byId.get(c.from) : undefined
      const b = c.to ? byId.get(c.to) : undefined
      if (!a || !b) return [] // an end was deleted
      return [`<line x1="${a.x + a.w / 2}" y1="${a.y + a.h / 2}" x2="${b.x + b.w / 2}" y2="${b.y + b.h / 2}" stroke="#868e96" stroke-width="3"/>`]
    })

  const drawn = shapes.map((o) => {
    const style = `fill="${safeColor(o.color)}" stroke="rgba(0,0,0,0.25)" stroke-width="1.5"`
    const shape =
      o.kind === 'ellipse'
        ? `<ellipse cx="${o.x + o.w / 2}" cy="${o.y + o.h / 2}" rx="${o.w / 2}" ry="${o.h / 2}" ${style}/>`
        : `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${o.kind === 'sticky' ? 4 : 10}" ${style}/>`
    return shape + label(o, measure)
  })

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}" font-family="${FONT}">` +
    `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="${BACKGROUND}"/>` +
    lines.join('') +
    drawn.join('') +
    '</svg>'
  return { svg, width, height }
}

export const svgToDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

// Draw the SVG onto a canvas and save it as a PNG. Twice the size for sharpness, but never an enormous canvas.
export async function svgToPng({ svg, width, height }: BoardImage): Promise<Blob> {
  const scale = Math.min(2, MAX_PIXELS / Math.max(width, height))
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('The board could not be drawn.'))
    img.src = svgToDataUrl(svg)
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0, width, height)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be created.'))), 'image/png'))
}

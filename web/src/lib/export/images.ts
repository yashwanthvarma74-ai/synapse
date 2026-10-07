// Pictures in a document are links to uploaded files. Word and PDF need the actual bytes, so they are fetched here.
// If one cannot be fetched (the storage does not allow it, or it was deleted) the export carries on without it.

export interface LoadedImage {
  data: Uint8Array // always PNG, whatever the original was
  width: number
  height: number
}

export type ImageLoader = (src: string) => Promise<LoadedImage | null>

export const noImages: ImageLoader = async () => null

export const loadImage: ImageLoader = async (src) => {
  try {
    const res = await fetch(src)
    if (!res.ok) return null
    const bitmap = await createImageBitmap(await res.blob())
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!png) return null
    return { data: new Uint8Array(await png.arrayBuffer()), width: bitmap.width, height: bitmap.height }
  } catch {
    return null
  }
}

// Every distinct image address in the document, so they can be fetched together
export function collectImages(blocks: import('./blocks').Block[]): string[] {
  const found = new Set<string>()
  const walk = (list: import('./blocks').Block[]) => {
    for (const b of list) {
      if (b.type === 'image') found.add(b.src)
      else if (b.type === 'list') b.items.forEach(walk)
      else if (b.type === 'quote') walk(b.blocks)
    }
  }
  walk(blocks)
  return [...found]
}

export async function loadAll(srcs: string[], loader: ImageLoader) {
  const entries = await Promise.all(srcs.map(async (src) => [src, await loader(src)] as const))
  return new Map(entries.filter((e): e is [string, LoadedImage] => e[1] !== null))
}

// Scale an image down to fit a width (never up)
export function fit(img: { width: number; height: number }, maxWidth: number) {
  const scale = Math.min(1, maxWidth / img.width)
  return { width: Math.round(img.width * scale), height: Math.round(img.height * scale) }
}

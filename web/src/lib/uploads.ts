// Upload one file straight to object storage. Three steps: ask our API for permission (it checks
// the role, the type and the size), PUT the bytes to the signed URL (they never pass through our
// server), then use the link our API gave us. See ADR 0012.
import { api } from './api'

export const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain']
export const MAX_BYTES = 10 * 1024 * 1024
export const ACCEPT = ALLOWED.join(',')

export interface Uploaded { url: string; name: string; image: boolean }

// A friendly reason a file cannot be uploaded, or null if it looks fine. The server checks again.
export function problemWith(file: { name: string; type: string; size: number }): string | null {
  if (!ALLOWED.includes(file.type)) return `"${file.name}" is not a type we can upload. Use PNG, JPEG, GIF, WebP, PDF or plain text.`
  if (file.size === 0) return `"${file.name}" is empty.`
  if (file.size > MAX_BYTES) return `"${file.name}" is too big. The limit is ${MAX_BYTES / 1024 / 1024} MB.`
  return null
}

export async function uploadFile(docId: string, file: File): Promise<Uploaded> {
  const problem = problemWith(file)
  if (problem) throw new Error(problem)
  const permit = await api<{ uploadUrl: string; url: string; name: string; image: boolean }>(`/documents/${docId}/uploads`, {
    body: { name: file.name, contentType: file.type, size: file.size },
  })
  let res: Response
  try {
    // the signed URL only accepts exactly this content type and size
    res = await fetch(permit.uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file })
  } catch {
    throw new Error('The upload could not reach the storage server. Check your connection and try again.')
  }
  if (!res.ok) throw new Error(`The storage server refused "${file.name}" (${res.status}).`)
  return { url: permit.url, name: permit.name, image: permit.image }
}

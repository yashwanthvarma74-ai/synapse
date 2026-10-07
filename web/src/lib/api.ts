// Thin client for the REST API. The signed token lives in localStorage and is sent
// as a Bearer header. (httpOnly cookies are safer against XSS; see docs/adr for the tradeoff.)
export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001'

// Tell other parts of the page (the header) that the person signed in or out
const announce = () => typeof window !== 'undefined' && window.dispatchEvent(new Event('synapse:auth'))

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem('synapse:token')
    } catch {
      return null
    }
  },
  set(token: string) {
    try {
      localStorage.setItem('synapse:token', token)
    } catch {}
    announce()
  },
  clear() {
    try {
      localStorage.removeItem('synapse:token')
    } catch {}
    announce()
  },
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = tokenStore.get()
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}

export async function apiBytes(path: string): Promise<Uint8Array> {
  const token = tokenStore.get()
  const res = await fetch(`${API}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

export type Role = 'owner' | 'editor' | 'commenter' | 'viewer'
export interface User { id: string; email: string; name: string; guest?: boolean }
export interface WorkspaceItem { id: string; name: string; role: Role }
export interface DocItem { id: string; title: string; type: 'doc' | 'canvas'; updatedAt: string }
export interface Member extends User { role: Role }
export interface DocMeta { id: string; title: string; type: 'doc' | 'canvas'; workspaceId: string; role: Role }
export interface CommentItem {
  id: string; authorId: string; authorName: string; body: string; quote: string
  anchor: string | null; parentId: string | null; resolved: boolean; createdAt: string
}
export interface VersionItem { version: number; label: string; createdAt: string; createdBy?: string; savedBy: string }

'use client'
// Everything that comes FROM THE SERVER goes through TanStack Query: it caches, refetches,
// dedupes identical requests and gives loading and error states for free. State that only
// exists in the browser (is a dialog open, which tool is selected) lives in uiStore.ts.
import { QueryClient, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { api, tokenStore, type CommentItem, type DocItem, type DocMeta, type Member, type User, type VersionItem, type WorkspaceItem } from './api'

export const keys = {
  me: ['me'] as const,
  workspaces: ['workspaces'] as const,
  docs: (w: string) => ['workspaces', w, 'documents'] as const,
  members: (w: string) => ['workspaces', w, 'members'] as const,
  invites: (w: string) => ['workspaces', w, 'invites'] as const,
  doc: (d: string) => ['documents', d] as const,
  comments: (d: string) => ['documents', d, 'comments'] as const,
  versions: (d: string) => ['documents', d, 'versions'] as const,
  search: (q: string) => ['search', q] as const,
}

// Do not retry a "no" from the server (401, 403, 404): asking again will not change it.
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        retry: (count, err) => {
          const status = (err as { status?: number }).status
          return !(status && status < 500) && count < 2
        },
      },
    },
  })
}

export interface Invite { code: string; role: 'editor' | 'commenter' | 'viewer'; expiresAt: string; uses: number }
export interface Hit { id: string; title: string; snippet: string }

// What this server can do (uploads, AI summaries). Fetched once; the app only offers what works.
export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: () => api<{ uploads: boolean; summaries: boolean }>('/config'), staleTime: 5 * 60_000 })
export const useWorkspaces = (enabled = true) => useQuery({ queryKey: keys.workspaces, queryFn: () => api<WorkspaceItem[]>('/workspaces'), enabled })
export const useWorkspaceDocs = (w: string, enabled = true) => useQuery({ queryKey: keys.docs(w), queryFn: () => api<DocItem[]>(`/workspaces/${w}/documents`), enabled })
export const useMembers = (w: string, enabled = true) => useQuery({ queryKey: keys.members(w), queryFn: () => api<Member[]>(`/workspaces/${w}/members`), enabled })
export const useInvites = (w: string, enabled = true) => useQuery({ queryKey: keys.invites(w), queryFn: () => api<Invite[]>(`/workspaces/${w}/invites`), enabled })
export const useDocMeta = (d: string, enabled = true) => useQuery({ queryKey: keys.doc(d), queryFn: () => api<DocMeta>(`/documents/${d}`), enabled })
export const useVersions = (d: string) => useQuery({ queryKey: keys.versions(d), queryFn: () => api<VersionItem[]>(`/documents/${d}/versions`) })
// Comments are polled so a new one from someone else shows up without a refresh
export const useComments = (d: string) => useQuery({ queryKey: keys.comments(d), queryFn: () => api<CommentItem[]>(`/documents/${d}/comments`), refetchInterval: 5_000 })
export const useSearch = (q: string) => useQuery({ queryKey: keys.search(q), queryFn: () => api<Hit[]>(`/search?q=${encodeURIComponent(q)}`), enabled: q.length > 0, staleTime: 0 })

// Who am I? null when signed out. A token the server rejects is thrown away.
export const useMe = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: async (): Promise<User | null> => {
      if (!tokenStore.get()) return null
      try {
        return await api<User>('/me')
      } catch {
        tokenStore.clear()
        return null
      }
    },
    staleTime: 60_000,
  })

// Run any change to the server, then refresh the lists it affects. Resolves true on success
// and false on failure (the message is in `error`), so a form can decide whether to clear itself.
export function useAction(invalidate: QueryKey[]) {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  })
  return {
    run: (fn: () => Promise<unknown>) => m.mutateAsync(fn).then(() => true, () => false),
    error: m.error?.message ?? '',
    pending: m.isPending,
    reset: m.reset,
  }
}

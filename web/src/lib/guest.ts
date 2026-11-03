import { api, tokenStore, type User } from './api'

export interface Starter { workspaceId: string; welcomeId: string; boardId: string }

// "Try it now": create a throwaway account (with a Welcome document and a sample board)
// and sign in as it. Returns where to send the person.
export async function startGuest(): Promise<Starter> {
  const r = await api<{ token: string; user: User; starter: Starter }>('/auth/guest', { method: 'POST', body: {} })
  tokenStore.set(r.token)
  return r.starter
}

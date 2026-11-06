import { API, api, tokenStore, type User } from './api'

// The hosted API sleeps when idle (free tier) and takes up to a minute to wake. Pinging it as soon
// as the landing page loads means it is usually awake by the time the visitor clicks "Try it now".
export function wakeServer() {
  fetch(`${API}/health`).catch(() => {})
}

export interface Starter { workspaceId: string; welcomeId: string; boardId: string }

// "Try it now": create a throwaway account (with a Welcome document and a sample board)
// and sign in as it. Returns where to send the person.
export async function startGuest(): Promise<Starter> {
  const r = await api<{ token: string; user: User; starter: Starter }>('/auth/guest', { method: 'POST', body: {} })
  tokenStore.set(r.token)
  return r.starter
}

'use client'
import { useEffect, useSyncExternalStore } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { api, tokenStore, type User } from './api'

// ONE shared session for the whole page. The header and the page both read it, so the
// server is asked "who am I?" once, and signing in or out updates everything at once.
interface State { user: User | null; ready: boolean }
const INITIAL: State = { user: null, ready: false }
let state: State = INITIAL
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  listeners.forEach((l) => l())
}

export function refreshSession(): Promise<void> {
  if (!tokenStore.get()) {
    set({ user: null, ready: true })
    return Promise.resolve()
  }
  if (!inFlight) {
    inFlight = api<User>('/me')
      .then((user) => set({ user, ready: true }))
      .catch(() => {
        tokenStore.clear() // the token is no good any more
        set({ user: null, ready: true })
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

// Loads the signed-in user. With { optional: true } a signed-out visitor is fine (the
// landing page and the header); otherwise they are sent to /login and brought back after.
export function useSession(opts: { optional?: boolean } = {}) {
  const router = useRouter()
  const path = usePathname()
  const { user, ready } = useSyncExternalStore(subscribe, () => state, () => INITIAL)

  useEffect(() => {
    void refreshSession()
    // another part of the page signed in or out (for example the "Try it now" button)
    const again = () => void refreshSession()
    window.addEventListener('synapse:auth', again)
    return () => window.removeEventListener('synapse:auth', again)
  }, [])

  useEffect(() => {
    if (ready && !user && !opts.optional) router.replace(`/login?next=${encodeURIComponent(path)}`)
  }, [ready, user, opts.optional, path, router])

  const signOut = () => {
    tokenStore.clear()
    router.replace('/')
  }
  return { user, ready, signOut }
}

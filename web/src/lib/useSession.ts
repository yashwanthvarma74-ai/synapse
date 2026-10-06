'use client'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { tokenStore } from './api'
import { useMe } from './queries'

// Loads the signed-in user (cached by TanStack Query, so the header and the page share one
// request). With { optional: true } a signed-out visitor is fine (the landing page and the
// header); otherwise they are sent to /login and brought back after.
export function useSession(opts: { optional?: boolean } = {}) {
  const router = useRouter()
  const path = usePathname()
  const { data, isPending } = useMe()
  const user = data ?? null
  const ready = !isPending

  useEffect(() => {
    if (ready && !user && !opts.optional) router.replace(`/login?next=${encodeURIComponent(path)}`)
  }, [ready, user, opts.optional, path, router])

  const signOut = () => {
    tokenStore.clear()
    router.replace('/')
  }
  return { user, ready, signOut }
}

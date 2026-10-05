'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, tokenStore, type User } from './api'

// Loads the signed-in user, or sends the visitor to /login.
export function useSession() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!tokenStore.get()) {
      router.replace('/login')
      return
    }
    api<User>('/me')
      .then((u) => !cancelled && setUser(u))
      .catch(() => {
        tokenStore.clear()
        router.replace('/login')
      })
    return () => {
      cancelled = true
    }
  }, [router])

  const signOut = () => {
    tokenStore.clear()
    router.replace('/login')
  }
  return { user, signOut }
}

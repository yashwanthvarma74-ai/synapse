'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { keys, makeQueryClient } from '@/lib/queries'
import { tokenStore } from '@/lib/api'

// One query cache for the whole app. When someone signs in or out (the token changes),
// the "who am I" answer is refreshed, and on sign-out everything cached for the old
// person is dropped so it can never show up on the next person's screen.
export default function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient)
  useEffect(() => {
    const onAuth = () => {
      if (!tokenStore.get()) client.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] })
      void client.invalidateQueries({ queryKey: keys.me })
    }
    window.addEventListener('synapse:auth', onAuth)
    return () => window.removeEventListener('synapse:auth', onAuth)
  }, [client])
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Logo from './ui/Logo'
import { useSession } from '@/lib/useSession'
import { startGuest } from '@/lib/guest'

// The bar at the top of every page: who you are, and the one thing you most likely want next.
export default function AppHeader() {
  const { user, ready, signOut } = useSession({ optional: true })
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function tryIt() {
    setBusy(true)
    try {
      const s = await startGuest()
      router.push(`/doc/${s.welcomeId}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" className="brand" aria-label="Synapse, home">
          <Logo />
          <span>Synapse</span>
        </Link>
        <nav className="header-actions" aria-label="Account">
          {!ready ? null : user ? (
            <>
              <Link className="btn ghost small" href="/">Your workspaces</Link>
              <span className="who">
                {user.name}
                {user.guest && <span className="guest-badge">Guest</span>}
              </span>
              {user.guest && <Link className="btn small" href="/upgrade">Save your work</Link>}
              <button className="btn secondary small" onClick={signOut}>Sign out</button>
            </>
          ) : (
            <>
              <Link className="btn ghost small" href="/login">Sign in</Link>
              <button className="btn small" onClick={tryIt} disabled={busy}>{busy ? 'Setting up…' : 'Try it now'}</button>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

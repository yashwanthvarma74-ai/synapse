'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Logo from '../ui/Logo'
import { useSession } from '@/lib/useSession'
import { startGuest } from '@/lib/guest'
import { Badge, Button, buttonClass } from '@yashwanthvarma74/react'

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
              <Link className={buttonClass({ variant: 'ghost', size: 'sm' })} href="/">Your workspaces</Link>
              <span className="who">
                {user.name}
                {user.guest && <Badge variant="accent">Guest</Badge>}
              </span>
              {user.guest && <Link className={buttonClass({ variant: 'primary', size: 'sm' })} href="/upgrade">Save your work</Link>}
              <Button variant="secondary" size="sm" onClick={signOut}>Sign out</Button>
            </>
          ) : (
            <>
              <Link className={buttonClass({ variant: 'ghost', size: 'sm' })} href="/login">Sign in</Link>
              <Button variant="primary" size="sm" onClick={tryIt} disabled={busy}>{busy ? 'Setting up…' : 'Try it now'}</Button>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

'use client'
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { keys, useAction, useWorkspaces } from '@/lib/queries'
import { useSession } from '@/lib/useSession'
import Search from '@/components/Search'
import Landing from '@/components/Landing'
import { EmptyDocsArt } from '@/components/ui/Illustrations'

const ROLE_HELP: Record<string, string> = {
  owner: 'You own this', editor: 'You can edit', commenter: 'You can comment', viewer: 'You can read',
}

// Signed out: the landing page. Signed in: your workspaces.
export default function Dashboard() {
  const { user, ready } = useSession({ optional: true })
  const { data: workspaces, error: loadError } = useWorkspaces(!!user)
  const [name, setName] = useState('')
  const action = useAction([keys.workspaces])
  const error = action.error || loadError?.message || ''

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    if (await action.run(() => api('/workspaces', { body: { name } }))) setName('')
  }

  if (!ready) return <div className="page"><p className="muted">Loading…</p></div>
  if (!user) return <Landing />

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Your workspaces</h1>
          <p>A workspace is a folder for a team or a project. Open one to see its documents and boards.</p>
        </div>
      </div>

      {user.guest && (
        <div className="banner">
          <p><strong>You&apos;re using a guest account.</strong> Create a free account to keep your work and use it on other devices.</p>
          <Link className="btn small" href="/upgrade">Save your work</Link>
        </div>
      )}

      <Search />
      {error && <p role="alert" className="error">{error}</p>}

      {workspaces?.length === 0 ? (
        <div className="empty">
          <EmptyDocsArt />
          <strong>No workspaces yet</strong>
          Create your first one below. It only takes a name.
        </div>
      ) : (
        <ul className="cards" aria-label="Workspaces">
          {workspaces?.map((w) => (
            <li key={w.id}>
              <Link href={`/w/${w.id}`} className="card doc-card">
                <strong>{w.name}</strong>
                <span className="meta">{ROLE_HELP[w.role] ?? w.role}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="create-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name a new workspace, for example “Team notes”" maxLength={80} aria-label="New workspace name" />
        <button className="btn secondary">Create workspace</button>
      </form>
    </div>
  )
}

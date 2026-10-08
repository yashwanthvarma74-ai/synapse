'use client'
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { keys, useAction, useWorkspaces } from '@/lib/queries'
import { useSession } from '@/lib/useSession'
import Search from '@/components/home/Search'
import Landing from '@/components/home/Landing'
import { Button, Card, EmptyState, Input, buttonClass } from '@yashwanthvarma74/react'

const ROLE_HELP: Record<string, string> = {
  owner: 'You own this', editor: 'You can edit', commenter: 'You can comment', viewer: 'You can read',
}

// Signed out: the landing page. Signed in: your workspaces.
export default function Dashboard() {
  const router = useRouter()
  const { user, ready } = useSession({ optional: true })
  const { data: workspaces, error: loadError } = useWorkspaces(!!user)
  const [name, setName] = useState('')
  const action = useAction([keys.workspaces])
  const error = action.error || loadError?.message || ''

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    let created = ''
    const ok = await action.run(async () => { created = (await api<{ id: string }>('/workspaces', { body: { name } })).id })
    if (ok) {
      setName('')
      router.push(`/w/${created}`) // straight into the new workspace
    }
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
          <Link className={buttonClass({ variant: 'primary', size: 'sm' })} href="/upgrade">Save your work</Link>
        </div>
      )}

      <Search />
      {error && <p role="alert" className="error">{error}</p>}

      {workspaces?.length === 0 ? (
        <EmptyState title="No workspaces yet" description="Create your first one below. It only takes a name." headingLevel={2} />
      ) : (
        <ul className="cards" aria-label="Workspaces">
          {workspaces?.map((w) => (
            <li key={w.id}>
              <Link href={`/w/${w.id}`} className="doc-link">
                <Card interactive className="doc-card">
                  <strong>{w.name}</strong>
                  <span className="meta">{ROLE_HELP[w.role] ?? w.role}</span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="create-row">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name a new workspace, for example “Team notes”" maxLength={80} aria-label="New workspace name" />
        <Button variant="secondary" type="submit">Create workspace</Button>
      </form>
    </div>
  )
}

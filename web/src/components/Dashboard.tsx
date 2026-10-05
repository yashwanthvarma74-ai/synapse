'use client'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { api, type WorkspaceItem } from '@/lib/api'
import { useSession } from '@/lib/useSession'
import Search from '@/components/Search'

export default function Dashboard() {
  const { user, signOut } = useSession()
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => api<WorkspaceItem[]>('/workspaces').then(setWorkspaces).catch((e) => setError(e.message)), [])
  useEffect(() => {
    if (user) void load()
  }, [user, load])

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await api('/workspaces', { body: { name } })
      setName('')
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (!user) return <div className="shell"><p className="muted">Loading…</p></div>

  return (
    <div className="shell">
      <div className="topbar">
        <h1>Synapse</h1>
        <span className="muted">{user.name} · <button className="link" onClick={signOut}>Sign out</button></span>
      </div>
      <Search />
      <h2>Workspaces</h2>
      {error && <p role="alert" className="error">{error}</p>}
      {workspaces?.length === 0 && <p className="muted">No workspaces yet. Create your first one below.</p>}
      <ul className="list">
        {workspaces?.map((w) => (
          <li key={w.id}><Link href={`/w/${w.id}`}>{w.name}</Link> <span className="badge">{w.role}</span></li>
        ))}
      </ul>
      <form onSubmit={create} className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New workspace name" maxLength={80} aria-label="New workspace name" />
        <button className="btn">Create</button>
      </form>
    </div>
  )
}

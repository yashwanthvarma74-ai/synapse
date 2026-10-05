'use client'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api, type DocItem, type Member, type Role, type WorkspaceItem } from '@/lib/api'
import { useSession } from '@/lib/useSession'
import { usePageTitle } from '@/lib/usePageTitle'

const ROLES: Role[] = ['owner', 'editor', 'commenter', 'viewer']

export default function WorkspaceView({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const { user } = useSession()
  const [ws, setWs] = useState<WorkspaceItem | null>(null)
  const [docs, setDocs] = useState<DocItem[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [title, setTitle] = useState('')
  const [docType, setDocType] = useState<'doc' | 'canvas'>('doc')
  const [invite, setInvite] = useState({ email: '', role: 'editor' as Role })
  const [error, setError] = useState('')

  // The three requests are independent, so they run together
  const load = useCallback(
    () =>
      Promise.all([
        api<WorkspaceItem[]>('/workspaces'),
        api<DocItem[]>(`/workspaces/${workspaceId}/documents`),
        api<Member[]>(`/workspaces/${workspaceId}/members`),
      ])
        .then(([all, documents, people]) => {
          setWs(all.find((w) => w.id === workspaceId) ?? null)
          setDocs(documents)
          setMembers(people)
        })
        .catch((e: Error) => setError(e.message)),
    [workspaceId],
  )
  useEffect(() => {
    if (user) void load()
  }, [user, load])

  const run = (fn: () => Promise<unknown>) => async (e?: FormEvent) => {
    e?.preventDefault()
    setError('')
    try {
      await fn()
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const createDoc = run(async () => {
    if (!title.trim()) return
    const d = await api<{ id: string }>(`/workspaces/${workspaceId}/documents`, { body: { title, type: docType } })
    router.push(`/doc/${d.id}`)
  })
  const addMember = run(async () => {
    await api(`/workspaces/${workspaceId}/members`, { method: 'PUT', body: invite })
    setInvite({ ...invite, email: '' })
  })
  usePageTitle(ws?.name)
  const isOwner = ws?.role === 'owner'
  const canEdit = ws?.role === 'owner' || ws?.role === 'editor'

  if (!user) return <div className="shell"><p className="muted">Loading…</p></div>

  return (
    <div className="shell">
      <nav aria-label="Back"><Link className="back-link" href="/">← All workspaces</Link></nav>
      <h1>{ws?.name ?? 'Workspace'} {ws && <span className="badge">{ws.role}</span>}</h1>
      {error && <p role="alert" className="error">{error}</p>}

      <h2>Documents</h2>
      <ul className="list">
        {docs.length === 0 && <li className="muted">No documents yet.</li>}
        {docs.map((d) => <li key={d.id}><Link href={`/doc/${d.id}`}>{d.title}</Link> <span className="badge">{d.type}</span></li>)}
      </ul>
      {canEdit && (
        <form onSubmit={createDoc} className="row">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New document title" maxLength={120} aria-label="New document title" />
          <select value={docType} onChange={(e) => setDocType(e.target.value as 'doc' | 'canvas')} aria-label="Document type">
            <option value="doc">Document</option>
            <option value="canvas">Canvas</option>
          </select>
          <button className="btn">Create</button>
        </form>
      )}

      <h2>People</h2>
      <ul className="list">
        {members.map((m) => (
          <li key={m.id} className="row spread">
            <span>{m.name} <span className="muted">{m.email}</span></span>
            {isOwner ? (
              <span className="row">
                <select value={m.role} aria-label={`Role for ${m.name}`}
                  onChange={(ev) => void run(() => api(`/workspaces/${workspaceId}/members`, { method: 'PUT', body: { email: m.email, role: ev.target.value } }))()}>
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                </select>
                {m.id !== user.id && (
                  <button className="link" onClick={run(() => api(`/workspaces/${workspaceId}/members/${m.id}`, { method: 'DELETE' }))}>Remove</button>
                )}
              </span>
            ) : <span className="badge">{m.role}</span>}
          </li>
        ))}
      </ul>
      {isOwner && (
        <form onSubmit={addMember} className="row">
          <input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="Email of an existing user" aria-label="Invite by email" required />
          <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as Role })} aria-label="Role for new member">
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <button className="btn">Add</button>
        </form>
      )}
    </div>
  )
}


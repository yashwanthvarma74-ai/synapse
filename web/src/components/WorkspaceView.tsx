'use client'
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api, type Role } from '@/lib/api'
import { keys, useAction, useMembers, useWorkspaceDocs, useWorkspaces } from '@/lib/queries'
import { useUi } from '@/lib/uiStore'
import { useSession } from '@/lib/useSession'
import { usePageTitle } from '@/lib/usePageTitle'
import ShareDialog from './ShareDialog'
import DeleteWorkspaceDialog from './DeleteWorkspaceDialog'
import { useQueryClient } from '@tanstack/react-query'
import { EmptyDocsArt } from './ui/Illustrations'

const ROLES: Role[] = ['owner', 'editor', 'commenter', 'viewer']
const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', editor: 'Editor', commenter: 'Commenter', viewer: 'Viewer' }

// A small outline icon for each kind of document, so you can tell them apart at a glance
function DocIcon({ type }: { type: 'doc' | 'canvas' }) {
  return type === 'canvas' ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="8" height="7" rx="1.5" /><circle cx="17" cy="7" r="3.5" /><rect x="8" y="14" width="13" height="7" rx="1.5" /><path d="M7 10v4" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5M9 13h7M9 17h5" />
    </svg>
  )
}

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`
  return `${Math.round(s / 86400)} days ago`
}

export default function WorkspaceView({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const { user } = useSession()
  // Three independent requests; TanStack Query runs them together and caches each
  const { data: all, error: e1 } = useWorkspaces(!!user)
  const { data: docs, error: e2 } = useWorkspaceDocs(workspaceId, !!user)
  const { data: members = [], error: e3 } = useMembers(workspaceId, !!user)
  const ws = all?.find((w) => w.id === workspaceId) ?? null
  const [title, setTitle] = useState('')
  const sharing = useUi((s) => s.shareOpen)
  const setSharing = useUi((s) => s.setShareOpen)
  const deleting = useUi((s) => s.deleteWorkspaceOpen)
  const setDeleting = useUi((s) => s.setDeleteWorkspaceOpen)
  const qc = useQueryClient()
  const [invite, setInvite] = useState({ email: '', role: 'editor' as Role })
  const action = useAction([keys.docs(workspaceId), keys.members(workspaceId), keys.workspaces])
  const error = action.error || e1?.message || e2?.message || e3?.message || ''

  const run = (fn: () => Promise<unknown>) => async (e?: FormEvent) => {
    e?.preventDefault()
    await action.run(fn)
  }

  const create = (type: 'doc' | 'canvas') => run(async () => {
    const name = title.trim() || (type === 'canvas' ? 'Untitled board' : 'Untitled document')
    const d = await api<{ id: string }>(`/workspaces/${workspaceId}/documents`, { body: { title: name, type } })
    router.push(`/doc/${d.id}`)
  })
  const addMember = run(async () => {
    await api(`/workspaces/${workspaceId}/members`, { method: 'PUT', body: invite })
    setInvite({ ...invite, email: '' })
  })
  usePageTitle(ws?.name)
  const isOwner = ws?.role === 'owner'
  const canEdit = ws?.role === 'owner' || ws?.role === 'editor'

  if (!user) return <div className="page"><p className="muted">Loading…</p></div>

  return (
    <div className="page">
      <nav aria-label="Back"><Link className="back-link" href="/">← All workspaces</Link></nav>
      <div className="page-head">
        <div>
          <h1>{ws?.name ?? 'Workspace'}</h1>
          <p>{ws ? ({ owner: 'You own this workspace.', editor: 'You can edit here.', commenter: 'You can read and comment here.', viewer: 'You can read here.' } as const)[ws.role] : ''}</p>
        </div>
        {isOwner && (
          <div className="row" style={{ margin: 0 }}>
            <button className="btn" onClick={() => setSharing(true)}>Invite people</button>
            <button className="btn danger-outline" onClick={() => setDeleting(true)}>Delete workspace</button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <ShareDialog workspaceId={workspaceId} open={sharing} onClose={() => setSharing(false)} />
      {ws && isOwner && (
        <DeleteWorkspaceDialog
          workspaceId={workspaceId}
          name={ws.name}
          items={docs?.length ?? 0}
          others={Math.max(0, members.length - 1)}
          open={deleting}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false)
            // forget everything cached about it, refresh the list, and go back to the start
            for (const key of [keys.docs(workspaceId), keys.members(workspaceId), keys.invites(workspaceId)]) qc.removeQueries({ queryKey: key })
            void qc.invalidateQueries({ queryKey: keys.workspaces })
            router.push('/')
          }}
        />
      )}

      <h2>Documents and boards</h2>
      {docs?.some((d) => d.title === 'Welcome to Synapse') && (
        <p className="muted">New here? Open <strong>Welcome to Synapse</strong> for a one-minute tour, or the <strong>Sample board</strong> to try the whiteboard. You can also start a new document or whiteboard of your own.</p>
      )}
      {canEdit && (
        <div className="create-row" role="group" aria-label="Create something new">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Give it a name (optional)" maxLength={120} aria-label="Name for the new document or board" />
          <button className="btn" onClick={create('doc')}>New document</button>
          <button className="btn secondary" onClick={create('canvas')}>New whiteboard</button>
        </div>
      )}
      {docs?.length === 0 ? (
        <div className="empty">
          <EmptyDocsArt />
          <strong>Nothing here yet</strong>
          {canEdit ? 'Create a document to write in, or a whiteboard to sketch on.' : 'When someone adds a document, you will see it here.'}
        </div>
      ) : (
        <ul className="cards" aria-label="Documents and boards">
          {docs?.map((d) => (
            <li key={d.id}>
              <Link href={`/doc/${d.id}`} className="card doc-card">
                <span className="icon"><DocIcon type={d.type} /></span>
                <strong>{d.title}</strong>
                <span className="meta">{d.type === 'canvas' ? 'Whiteboard' : 'Document'} · edited {ago(d.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2>People</h2>
      <ul className="list">
        {members.map((m) => (
          <li key={m.id} className="row spread">
            <span>{m.name} <span className="muted">{m.email.endsWith('@guest.invalid') ? 'guest' : m.email}</span></span>
            {isOwner ? (
              <span className="row" style={{ margin: 0 }}>
                <select value={m.role} aria-label={`Role for ${m.name}`}
                  onChange={(ev) => void run(() => api(`/workspaces/${workspaceId}/members`, { method: 'PUT', body: { email: m.email, role: ev.target.value } }))()}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                {m.id !== user.id && (
                  <button className="link" aria-label={`Remove ${m.name}`} onClick={run(() => api(`/workspaces/${workspaceId}/members/${m.id}`, { method: 'DELETE' }))}>Remove</button>
                )}
              </span>
            ) : <span className="badge">{ROLE_LABEL[m.role]}</span>}
          </li>
        ))}
      </ul>
      {isOwner && (
        <details>
          <summary>Add someone who already has an account</summary>
          <form onSubmit={addMember} className="create-row">
            <input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="Their email address" aria-label="Email of an existing user" required />
            <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as Role })} aria-label="Role for the new person">
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button className="btn secondary">Add</button>
          </form>
        </details>
      )}
    </div>
  )
}
